import type { CalendarItem } from '../types';
import { generateId } from '../utils/id';
import { compareByStartTime, getItemTimeRange } from '../utils/items';
import {
  addMinutesToISO,
  combineDateAndMinutes,
  minutesFromDayStart,
  minutesToTime,
  timeToMinutes,
  toDateString,
} from '../utils/time';
import {
  type Intent,
  type IntentResult,
  type ParseResult,
  type TaskReference,
  isSameTask,
  matchTaskWords,
  parseInputToTasks,
  parseIntent,
} from './nlp';
import { alignToGrid, fitFlexibleTasks, reflowDay } from './scheduler';
import { getItemsByDate } from './storage';

const SCHEDULER_INTERVAL_MINUTES = 15;
const DAY_START = '08:00';

/** A moved task ending less than this before the next event "squeezes" it: the next event is offered a shift */
const TIGHT_BUFFER_MINUTES = 15;

export type AgendaChangeKind = 'moved' | 'extended' | 'updated' | 'unscheduled' | 'conflict';

export interface AgendaChange {
  kind: AgendaChangeKind;
  /** The item as it will be saved (for 'conflict', as it is now) */
  item: CalendarItem;
  /** For 'extended': minutes added */
  minutes?: number;
}

/** Shifts of the following events caused by the change, applied only if the user agrees */
export interface CascadeProposal {
  /** "Lo spostamento di 'Pranzo' impatta l'impegno successivo. Vuoi che posticipi '...' alle 15:30?" */
  message: string;
  changes: AgendaChange[];
  items: CalendarItem[];
}

export interface AgendaProposal {
  intent: Intent;
  rawText: string;
  /** Items saved on approval; status 'proposed' becomes 'confirmed' */
  items: CalendarItem[];
  /** New flexible tasks that didn't fit: not saved */
  unscheduled: CalendarItem[];
  /** How the existing agenda changes; items not listed here are new */
  changes: AgendaChange[];
  cascade?: CascadeProposal;
  /** Extra information for the user */
  notice?: string;
}

export type PlanResult = { proposal: AgendaProposal } | { error: string };

type ExtendIntent = Extract<IntentResult, { intent: 'EXTEND_TASK' }>;
type DelayIntent = Extract<IntentResult, { intent: 'RESCHEDULE_DELAY' }>;

const CHANGE_VERBS: Partial<Record<AgendaChangeKind, string>> = {
  moved: 'Lo spostamento di',
  extended: "L'allungamento di",
  updated: 'La modifica di',
};

/** Now, rounded up to the scheduler grid, when planning today; nothing is proposed in the past. */
function getEarliestStart(dateString: string, now: Date): string | undefined {
  if (dateString !== toDateString(now)) return undefined;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutesToTime(Math.ceil(minutes / SCHEDULER_INTERVAL_MINUTES) * SCHEDULER_INTERVAL_MINUTES);
}

function isSameTime(a: CalendarItem, b: CalendarItem | undefined): boolean {
  const rangeA = getItemTimeRange(a);
  const rangeB = b && getItemTimeRange(b);
  return rangeA?.start === rangeB?.start && rangeA?.end === rangeB?.end;
}

/** Moved flexible tasks are shown as proposals until approved */
function asPreview(item: CalendarItem, original: CalendarItem | undefined): CalendarItem {
  return item.type === 'flexible' && item.status === 'confirmed' && !isSameTime(item, original)
    ? { ...item, status: 'proposed' }
    : item;
}

function withFlexibleTimes(item: CalendarItem, dateString: string, start: number, duration: number): CalendarItem {
  return {
    ...item,
    scheduledDate: dateString,
    estimatedMinutes: duration,
    proposedStartTime: combineDateAndMinutes(dateString, start),
    proposedEndTime: combineDateAndMinutes(dateString, start + duration),
  };
}

/**
 * The task the user refers to: best word match with the title, then same category.
 * Without a reference: the task in progress now, or the next one.
 * Ties go to the task closest to now.
 */
function findTarget(items: CalendarItem[], reference: TaskReference | null, now: Date): CalendarItem | null {
  const candidates = items.filter((item) => item.status !== 'completed' && getItemTimeRange(item));
  const distanceFromNow = (item: CalendarItem) => {
    const range = getItemTimeRange(item)!;
    const start = new Date(range.start).getTime();
    const end = new Date(range.end).getTime();
    return start <= now.getTime() && now.getTime() < end ? 0 : Math.abs(start - now.getTime());
  };

  const scored = candidates.map((item) => {
    if (!reference) return { item, score: 1 };
    const { matched } = matchTaskWords(reference.query, item.title);
    return { item, score: matched + (reference.category === item.category ? 0.5 : 0) };
  });

  const best = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || distanceFromNow(a.item) - distanceFromNow(b.item))[0];
  return best?.item ?? null;
}

/**
 * Gives a flexible task its new times. It stays at its current start if that respects its window
 * (a longer task keeps its start); otherwise it takes the first free time in its window.
 * If its window has no free time, it goes at the start of the window anyway: the cascade then
 * offers to move what it overlaps.
 */
function placeFlexible(item: CalendarItem, others: CalendarItem[], dateString: string, now: Date): CalendarItem {
  const range = getItemTimeRange(item);
  const currentStart = range ? minutesFromDayStart(range.start, dateString) : null;
  const duration =
    item.estimatedMinutes ?? (range && currentStart !== null ? minutesFromDayStart(range.end, dateString) - currentStart : 30);
  const earliestStartTime = getEarliestStart(dateString, now);
  const earliest = earliestStartTime ? timeToMinutes(earliestStartTime) : -Infinity;
  const minStart = item.minStartTime ? timeToMinutes(item.minStartTime) : -Infinity;
  const maxEnd = item.maxEndTime ? timeToMinutes(item.maxEndTime) : Infinity;

  if (currentStart !== null && currentStart >= Math.max(minStart, earliest) && currentStart + duration <= maxEnd) {
    return withFlexibleTimes(item, dateString, currentStart, duration);
  }
  const { scheduled } = fitFlexibleTasks(others, [{ ...item, estimatedMinutes: duration }], dateString, {
    intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
    earliestStartTime,
  });
  if (scheduled.length) {
    return { ...scheduled[0], status: item.status };
  }
  const fallback = alignToGrid(
    Math.max(minStart, earliest, timeToMinutes(DAY_START)),
    DAY_START,
    SCHEDULER_INTERVAL_MINUTES,
  );
  return withFlexibleTimes(item, dateString, fallback, duration);
}

/** The first other item starting at or after `item`, with its start in minutes. */
function findNextItem(items: CalendarItem[], item: CalendarItem, dateString: string) {
  const start = minutesFromDayStart(getItemTimeRange(item)!.start, dateString);
  return items
    .flatMap((other) => {
      const range = getItemTimeRange(other);
      if (!range || other.id === item.id || other.status === 'completed') return [];
      const otherStart = minutesFromDayStart(range.start, dateString);
      return otherStart >= start ? [{ item: other, start: otherStart }] : [];
    })
    .sort((a, b) => a.start - b.start)[0];
}

/**
 * The shifts needed after the requested changes (`primaries`, which stay as requested):
 * following events that now overlap them, or start right after a task that used to end earlier,
 * are pushed forward (fixed events only when directly hit). `pinned` items (e.g. just-planned new tasks) don't move.
 */
function computeCascade(
  dayItems: CalendarItem[],
  primaries: AgendaChange[],
  dateString: string,
  now: Date,
  pinned: CalendarItem[] = [],
): CascadeProposal | undefined {
  const primaryById = new Map(
    primaries.filter(({ item }) => getItemTimeRange(item)).map(({ item }) => [item.id, item]),
  );
  if (!primaryById.size) return undefined;

  const originals = new Map(dayItems.map((item) => [item.id, item]));
  const merged = [...dayItems.map((item) => primaryById.get(item.id) ?? item), ...pinned];
  const firstPrimaryStart = Math.min(
    ...[...primaryById.values()].map((item) => minutesFromDayStart(getItemTimeRange(item)!.start, dateString)),
  );

  // Leave a margin after a primary when the next event wasn't already right after it
  const blocking = merged.map((item) => {
    if (!primaryById.has(item.id)) return item;
    const end = minutesFromDayStart(getItemTimeRange(item)!.end, dateString);
    const next = findNextItem(merged, item, dateString);
    const originalRange = getItemTimeRange(originals.get(item.id) ?? item);
    const originalGap = next && originalRange ? next.start - minutesFromDayStart(originalRange.end, dateString) : 0;
    const gap = next ? next.start - end : Infinity;
    if (gap < 0 || gap >= TIGHT_BUFFER_MINUTES || originalGap < TIGHT_BUFFER_MINUTES) return item;
    const blockedEnd = combineDateAndMinutes(dateString, end + TIGHT_BUFFER_MINUTES);
    return item.type === 'fixed' ? { ...item, fixedEndTime: blockedEnd } : { ...item, proposedEndTime: blockedEnd };
  });

  // Only what comes after the change can be shifted
  const pinnedIds = blocking
    .filter((item) => {
      const range = getItemTimeRange(item);
      return (
        primaryById.has(item.id) ||
        pinned.some((other) => other.id === item.id) ||
        (range && minutesFromDayStart(range.start, dateString) < firstPrimaryStart)
      );
    })
    .map((item) => item.id);

  // A fixed event moves only if a changed task overlaps it or squeezes it directly;
  // flexible tasks pushed forward flow around fixed events instead
  const primaryRanges = blocking
    .filter((item) => primaryById.has(item.id))
    .map((item) => getItemTimeRange(item)!)
    .map((range) => ({ start: minutesFromDayStart(range.start, dateString), end: minutesFromDayStart(range.end, dateString) }));
  const movableFixedIds = blocking
    .filter((item) => {
      const range = getItemTimeRange(item);
      if (item.type !== 'fixed' || !range || pinnedIds.includes(item.id)) return false;
      const start = minutesFromDayStart(range.start, dateString);
      const end = minutesFromDayStart(range.end, dateString);
      return primaryRanges.some((primary) => start < primary.end && end > primary.start);
    })
    .map((item) => item.id);

  const { moved, unscheduled } = reflowDay(blocking, dateString, {
    intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
    earliestStartTime: getEarliestStart(dateString, now),
    pinnedIds,
    movableFixedIds,
  });
  if (!moved.length && !unscheduled.length) return undefined;

  const changes: AgendaChange[] = [
    ...moved.map((item) => ({ kind: 'moved' as const, item: asPreview(item, originals.get(item.id)) })),
    ...unscheduled.map((item) => ({
      kind: 'unscheduled' as const,
      item: { ...item, proposedStartTime: undefined, proposedEndTime: undefined, status: 'pending' as const },
    })),
  ].sort((a, b) => compareByStartTime(a.item, b.item));

  const [primary] = primaries;
  const verb = CHANGE_VERBS[primary.kind] ?? 'La modifica di';
  const firstMoved = changes.find(({ kind }) => kind === 'moved');
  const firstStart = firstMoved && getItemTimeRange(firstMoved.item)!.start.slice(11, 16);
  const message = firstMoved
    ? `${verb} '${primary.item.title}' impatta l'impegno successivo. Vuoi che posticipi '${firstMoved.item.title}' alle ${firstStart}?`
    : `${verb} '${primary.item.title}' impatta l'impegno successivo. Vuoi rimettere '${changes[0].item.title}' tra i task da pianificare?`;

  return { message, changes, items: changes.map(({ item }) => item) };
}

/** A proposal made of requested changes, new items and the cascade they may need. */
function buildProposal(
  parsed: { intent: Intent; rawText: string },
  dateString: string,
  dayItems: CalendarItem[],
  primaries: AgendaChange[],
  now: Date,
  extras: { newItems?: CalendarItem[]; unscheduled?: CalendarItem[]; notices?: string[] } = {},
): AgendaProposal {
  const { newItems = [], unscheduled = [], notices = [] } = extras;
  const originals = new Map(dayItems.map((item) => [item.id, item]));
  const changes = primaries.map((change) => ({ ...change, item: asPreview(change.item, originals.get(change.item.id)) }));
  const todayNew = newItems.filter((item) => getItemTimeRange(item)?.start.startsWith(dateString));

  if (!changes.length && !newItems.length && !notices.length) {
    notices.push("Nessuna modifica necessaria: l'agenda è già compatibile.");
  }
  return {
    intent: parsed.intent,
    rawText: parsed.rawText,
    items: [...changes.map(({ item }) => item), ...newItems].sort(compareByStartTime),
    unscheduled,
    changes,
    cascade: computeCascade(dayItems, changes, dateString, now, todayNew),
    notice: notices.join(' ') || undefined,
  };
}

/**
 * Applies a parsed task to the existing task it duplicates: new times, window or duration.
 * Returns null when the text adds nothing to the existing task.
 */
function updateExistingTask(
  existing: CalendarItem,
  draft: CalendarItem,
  explicitDuration: boolean,
  others: CalendarItem[],
  dateString: string,
  now: Date,
): CalendarItem | null {
  const range = getItemTimeRange(existing);
  const currentStart = range ? minutesFromDayStart(range.start, dateString) : null;
  const currentDuration = range && currentStart !== null ? minutesFromDayStart(range.end, dateString) - currentStart : null;

  if (draft.type === 'fixed' && draft.fixedStartTime && draft.fixedEndTime) {
    // An explicit time: the existing task takes it
    if (existing.type === 'fixed') {
      return { ...existing, fixedStartTime: draft.fixedStartTime, fixedEndTime: draft.fixedEndTime };
    }
    const start = minutesFromDayStart(draft.fixedStartTime, dateString);
    return withFlexibleTimes(existing, dateString, start, minutesFromDayStart(draft.fixedEndTime, dateString) - start);
  }

  if (!draft.minStartTime && !draft.maxEndTime && !explicitDuration) {
    return null;
  }
  const duration = explicitDuration ? draft.estimatedMinutes : (existing.estimatedMinutes ?? currentDuration ?? undefined);

  if (existing.type === 'fixed' && currentStart !== null && currentDuration !== null) {
    const minStart = draft.minStartTime ? timeToMinutes(draft.minStartTime) : currentStart;
    const start = Math.max(currentStart, minStart);
    const end = start + (duration ?? currentDuration);
    return {
      ...existing,
      fixedStartTime: combineDateAndMinutes(dateString, start),
      fixedEndTime: combineDateAndMinutes(dateString, end),
    };
  }
  return placeFlexible(
    {
      ...existing,
      estimatedMinutes: duration,
      minStartTime: draft.minStartTime ?? existing.minStartTime,
      maxEndTime: draft.maxEndTime ?? existing.maxEndTime,
    },
    others,
    dateString,
    now,
  );
}

async function planCreate(
  parsed: ParseResult & { intent: Intent },
  dateString: string,
  dayItems: CalendarItem[],
  now: Date,
  notices: string[] = [],
): Promise<AgendaProposal> {
  const createdAt = now.toISOString();
  const drafts: CalendarItem[] = parsed.items.map((draft) => ({
    title: 'Nuovo impegno',
    type: 'flexible',
    category: 'personal',
    ...draft,
    id: generateId(),
    status: 'proposed',
    createdAt,
  }));
  // Fixed events by their start, flexible tasks by their planned day
  const getDraftDate = (item: CalendarItem) =>
    item.type === 'fixed' && item.fixedStartTime ? item.fixedStartTime.slice(0, 10) : (item.scheduledDate ?? dateString);

  // A task already in today's agenda is updated instead of duplicated
  const primaries: AgendaChange[] = [];
  const newDrafts: CalendarItem[] = [];
  drafts.forEach((draft, index) => {
    const existing =
      getDraftDate(draft) === dateString
        ? dayItems.find((item) => item.status !== 'completed' && isSameTask(draft.title, item.title))
        : undefined;
    if (!existing) {
      newDrafts.push(draft);
      return;
    }
    const others = dayItems.filter((item) => item.id !== existing.id);
    const updated = updateExistingTask(existing, draft, parsed.explicitDuration[index], others, dateString, now);
    if (updated) {
      primaries.push({ kind: 'updated', item: updated });
    } else {
      notices.push(`'${existing.title}' è già in agenda: non creo un duplicato.`);
    }
  });

  const updatedById = new Map(primaries.map(({ item }) => [item.id, item]));
  const today = dayItems.map((item) => updatedById.get(item.id) ?? item);
  const proposed: CalendarItem[] = [];
  const unscheduled: CalendarItem[] = [];
  for (const draftDate of new Set(newDrafts.map(getDraftDate))) {
    const dayDrafts = newDrafts.filter((draft) => getDraftDate(draft) === draftDate);
    const fixed = dayDrafts.filter((draft) => draft.type === 'fixed');
    const existing = draftDate === dateString ? today : await getItemsByDate(draftDate);
    const result = fitFlexibleTasks(
      [...existing, ...fixed],
      dayDrafts.filter((draft) => draft.type === 'flexible'),
      draftDate,
      { intervalMinutes: SCHEDULER_INTERVAL_MINUTES, earliestStartTime: getEarliestStart(draftDate, now) },
    );
    proposed.push(...fixed, ...result.scheduled);
    unscheduled.push(...result.unscheduled);
  }

  return buildProposal(parsed, dateString, dayItems, primaries, now, { newItems: proposed, unscheduled, notices });
}

function planExtend(parsed: ExtendIntent, dateString: string, dayItems: CalendarItem[], now: Date): PlanResult {
  const target = findTarget(dayItems, parsed.target, now);
  if (!target) {
    return {
      error: parsed.target
        ? `Non ho trovato "${parsed.target.query}" nell'agenda di oggi.`
        : "Non ho trovato un'attività in corso da allungare.",
    };
  }
  const range = getItemTimeRange(target)!;
  const extended: CalendarItem =
    target.type === 'fixed'
      ? { ...target, fixedEndTime: addMinutesToISO(range.end, parsed.extraMinutes) }
      : {
          ...target,
          estimatedMinutes:
            minutesFromDayStart(range.end, dateString) - minutesFromDayStart(range.start, dateString) + parsed.extraMinutes,
          proposedEndTime: addMinutesToISO(range.end, parsed.extraMinutes),
        };
  return {
    proposal: buildProposal(parsed, dateString, dayItems, [
      { kind: 'extended', item: extended, minutes: parsed.extraMinutes },
    ], now),
  };
}

/** "non arrivo prima delle 14:30" with no task named: everything not started before that time moves after it. */
function planDelayAll(parsed: DelayIntent, dateString: string, dayItems: CalendarItem[], now: Date): AgendaProposal {
  const nowMinutes = dateString === toDateString(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const minStart = parsed.minStartTime ? timeToMinutes(parsed.minStartTime) : nowMinutes + (parsed.delayMinutes ?? 0);
  const affected = dayItems.filter((item) => {
    const range = getItemTimeRange(item);
    if (!range || item.status === 'completed' || item.status === 'in_progress') return false;
    const start = minutesFromDayStart(range.start, dateString);
    return start >= nowMinutes && start < minStart;
  });
  const updatedById = new Map<string, CalendarItem>(
    affected
      .filter((item) => item.type === 'flexible')
      .map((item) => [item.id, { ...item, minStartTime: minutesToTime(minStart) }]),
  );
  const merged = dayItems.map((item) => updatedById.get(item.id) ?? item);
  const { moved, unscheduled } = reflowDay(merged, dateString, {
    intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
    earliestStartTime: getEarliestStart(dateString, now),
  });

  const originals = new Map(dayItems.map((item) => [item.id, item]));
  const toSave = new Map(updatedById);
  const changes: AgendaChange[] = [];
  for (const item of moved) {
    toSave.set(item.id, asPreview(item, originals.get(item.id)));
    changes.push({ kind: 'moved', item: toSave.get(item.id)! });
  }
  for (const item of unscheduled) {
    // Back to the tasks to plan, without times
    toSave.set(item.id, { ...item, proposedStartTime: undefined, proposedEndTime: undefined, status: 'pending' });
    changes.push({ kind: 'unscheduled', item: toSave.get(item.id)! });
  }
  // Fixed events can't be moved automatically: they're reported as conflicts
  for (const item of affected.filter(({ type }) => type === 'fixed')) {
    changes.push({ kind: 'conflict', item });
  }

  return {
    intent: parsed.intent,
    rawText: parsed.rawText,
    items: [...toSave.values()].sort(compareByStartTime),
    unscheduled: [],
    changes: changes.sort((a, b) => compareByStartTime(a.item, b.item)),
    notice: affected.length ? undefined : `Nessuna attività da spostare prima delle ${minutesToTime(minStart)}.`,
  };
}

async function planDelay(
  parsed: DelayIntent,
  dateString: string,
  dayItems: CalendarItem[],
  now: Date,
): Promise<PlanResult> {
  if (!parsed.target) {
    return { proposal: planDelayAll(parsed, dateString, dayItems, now) };
  }

  const target = findTarget(dayItems, parsed.target, now);
  if (!target) {
    // "non penso di riuscire a mangiare alle 13:30" with no meal planned: it's a new task
    if (parsed.negated) {
      const notice = `Non ho trovato '${parsed.target.query}' in agenda: lo aggiungo come nuovo impegno.`;
      const created = parseInputToTasks(parsed.rawText, dateString);
      return { proposal: await planCreate({ ...created, intent: 'CREATE_TASK' }, dateString, dayItems, now, [notice]) };
    }
    return { error: `Non ho trovato "${parsed.target.query}" nell'agenda di oggi.` };
  }

  const range = getItemTimeRange(target)!;
  const start = minutesFromDayStart(range.start, dateString);
  const end = minutesFromDayStart(range.end, dateString);
  const newStart = parsed.minStartTime ? timeToMinutes(parsed.minStartTime) : start + (parsed.delayMinutes ?? 0);
  const others = dayItems.filter((item) => item.id !== target.id);

  // A fixed event moves exactly; a flexible task gets a new window and is re-placed
  const updated: CalendarItem =
    target.type === 'fixed'
      ? {
          ...target,
          fixedStartTime: combineDateAndMinutes(dateString, newStart),
          fixedEndTime: combineDateAndMinutes(dateString, newStart + end - start),
        }
      : placeFlexible(
          {
            ...target,
            minStartTime: minutesToTime(newStart),
            maxEndTime:
              parsed.maxEndTime ??
              (parsed.latestStartTime
                ? minutesToTime(timeToMinutes(parsed.latestStartTime) + (target.estimatedMinutes ?? end - start))
                : target.maxEndTime),
          },
          others,
          dateString,
          now,
        );

  const primaries: AgendaChange[] = isSameTime(updated, target) ? [] : [{ kind: 'moved', item: updated }];
  return {
    proposal: buildProposal(parsed, dateString, dayItems, primaries, now, {
      notices: primaries.length ? [] : [`'${target.title}' è già dopo le ${minutesToTime(newStart)}: nessuno spostamento.`],
    }),
  };
}

/**
 * Turns the user's text into a proposal for the agenda of `dateString`:
 * new tasks (or updates of the same task already planned), a longer task, or a delay.
 * Shifts of the following events are offered separately, in `cascade`.
 * `dayItems` are the items already saved for that day.
 */
export async function planInput(
  text: string,
  dateString: string,
  dayItems: CalendarItem[],
  now = new Date(),
): Promise<PlanResult> {
  const parsed = parseIntent(text, dateString);
  switch (parsed.intent) {
    case 'CREATE_TASK':
      return { proposal: await planCreate(parsed, dateString, dayItems, now) };
    case 'EXTEND_TASK':
      return planExtend(parsed, dateString, dayItems, now);
    case 'RESCHEDULE_DELAY':
      return planDelay(parsed, dateString, dayItems, now);
  }
}
