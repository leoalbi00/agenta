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
import { type ParsedAction, type UpdateReason, parseUserInput } from './nlp';
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
  rawText: string;
  /** Items saved on approval; status 'proposed' becomes 'confirmed' */
  items: CalendarItem[];
  /** New flexible tasks that didn't fit: not saved */
  unscheduled: CalendarItem[];
  /** How the existing agenda changes; items not listed here are new */
  changes: AgendaChange[];
  cascade?: CascadeProposal;
  /** Items deleted on approval */
  deletions: CalendarItem[];
  /** The whole day is emptied: the user must confirm it */
  clearAll: boolean;
  /** Extra information for the user */
  notice?: string;
}

export type PlanResult = { proposal: AgendaProposal } | { error: string };

type UpdateAction = Extract<ParsedAction, { action: 'UPDATE' }>;
type ShiftAllAction = Extract<ParsedAction, { action: 'SHIFT_ALL' }>;
type CreateAction = Extract<ParsedAction, { action: 'CREATE' }>;

const CHANGE_KINDS: Record<UpdateReason, AgendaChangeKind> = {
  extend: 'extended',
  delay: 'moved',
  statement: 'updated',
};

/** A fixed event or a flexible task with no known length */
const DEFAULT_DURATION_MINUTES = 60;

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
 * Gives a flexible task its new times. It stays at its current start if that respects its window
 * (a longer task keeps its start); otherwise it takes the first free time in its window.
 * If its window has no free time, it takes the first time clear of what can't move (fixed events,
 * tasks started), and the cascade offers to move the flexible tasks it overlaps; failing that,
 * the start of the window.
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
  const anchors = others.filter(
    (other) => other.type === 'fixed' || other.status === 'in_progress' || other.status === 'completed',
  );
  const clearOfAnchors = fitFlexibleTasks(anchors, [{ ...item, estimatedMinutes: duration }], dateString, {
    intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
    earliestStartTime,
  }).scheduled[0];
  if (clearOfAnchors) {
    return { ...clearOfAnchors, status: item.status };
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

/** A proposal made of requested changes, new items, deletions and the cascade they may need. */
function buildProposal(
  rawText: string,
  dateString: string,
  dayItems: CalendarItem[],
  primaries: AgendaChange[],
  now: Date,
  extras: { newItems?: CalendarItem[]; unscheduled?: CalendarItem[]; deletions?: CalendarItem[]; notices?: string[] } = {},
): AgendaProposal {
  const { newItems = [], unscheduled = [], deletions = [], notices = [] } = extras;
  const remaining = dayItems.filter((item) => !deletions.some(({ id }) => id === item.id));
  const originals = new Map(remaining.map((item) => [item.id, item]));
  const changes = primaries.map((change) => ({ ...change, item: asPreview(change.item, originals.get(change.item.id)) }));
  const todayNew = newItems.filter((item) => getItemTimeRange(item)?.start.startsWith(dateString));

  if (!changes.length && !newItems.length && !deletions.length && !notices.length) {
    notices.push("Nessuna modifica necessaria: l'agenda è già compatibile.");
  }
  return {
    rawText,
    items: [...changes.map(({ item }) => item), ...newItems].sort(compareByStartTime),
    unscheduled,
    changes,
    cascade: computeCascade(remaining, changes, dateString, now, todayNew),
    deletions,
    clearAll: false,
    notice: notices.join(' ') || undefined,
  };
}

/**
 * The existing task with the changes the user asked for: a longer duration, a new time,
 * a delay (new earliest start), or new details (window, duration).
 * Returns a message instead when nothing changes.
 */
function applyUpdate(
  update: UpdateAction,
  target: CalendarItem,
  dayItems: CalendarItem[],
  dateString: string,
  now: Date,
): AgendaChange | string {
  const others = dayItems.filter((item) => item.id !== target.id);
  const range = getItemTimeRange(target);
  const start = range ? minutesFromDayStart(range.start, dateString) : null;
  const end = range ? minutesFromDayStart(range.end, dateString) : null;
  const currentDuration = start !== null && end !== null ? end - start : (target.estimatedMinutes ?? DEFAULT_DURATION_MINUTES);
  const isFixed = target.type === 'fixed' && start !== null;
  const withFixedTimes = (newStart: number, duration: number): CalendarItem => ({
    ...target,
    fixedStartTime: combineDateAndMinutes(dateString, newStart),
    fixedEndTime: combineDateAndMinutes(dateString, newStart + duration),
  });
  /** "tra le 14/14:30": the task must start by then, so it ends by then plus its duration */
  const maxEndFor = (duration: number) =>
    update.maxEndTime ??
    (update.latestStartTime ? minutesToTime(timeToMinutes(update.latestStartTime) + duration) : target.maxEndTime);

  if (update.extraMinutes) {
    if (!range) return `'${target.title}' non ha ancora un orario da allungare.`;
    const extended: CalendarItem =
      target.type === 'fixed'
        ? { ...target, fixedEndTime: addMinutesToISO(range.end, update.extraMinutes) }
        : {
            ...target,
            estimatedMinutes: currentDuration + update.extraMinutes,
            proposedEndTime: addMinutesToISO(range.end, update.extraMinutes),
          };
    return { kind: 'extended', item: extended, minutes: update.extraMinutes };
  }

  let updated: CalendarItem;
  if (update.newStartTime) {
    // An explicit time: the task takes it
    const newStart = timeToMinutes(update.newStartTime);
    const duration = update.newEndTime
      ? timeToMinutes(update.newEndTime) - newStart
      : (update.newDuration ?? currentDuration);
    updated = target.type === 'fixed' ? withFixedTimes(newStart, duration) : withFlexibleTimes(target, dateString, newStart, duration);
  } else if (update.reason === 'delay') {
    // A fixed event moves exactly; a flexible task gets a new earliest start and is re-placed
    const newStart = update.minStartTime
      ? timeToMinutes(update.minStartTime)
      : (start ?? 0) + (update.delayMinutes ?? 0);
    updated = isFixed
      ? withFixedTimes(newStart, currentDuration)
      : placeFlexible(
          { ...target, minStartTime: minutesToTime(newStart), maxEndTime: maxEndFor(currentDuration) },
          others,
          dateString,
          now,
        );
  } else {
    if (!update.minStartTime && !update.maxEndTime && !update.latestStartTime && !update.newDuration) {
      return `'${target.title}' è già in agenda: non creo un duplicato.`;
    }
    const duration = update.newDuration ?? currentDuration;
    const placed = placeFlexible(
      {
        ...target,
        // Placed as a flexible task from its current times
        type: 'flexible',
        proposedStartTime: range?.start,
        proposedEndTime: range?.end,
        estimatedMinutes: duration,
        minStartTime: update.minStartTime ?? target.minStartTime,
        maxEndTime: maxEndFor(duration),
      },
      others,
      dateString,
      now,
    );
    // A fixed event takes the time chosen in its window but stays fixed
    updated = isFixed
      ? withFixedTimes(minutesFromDayStart(getItemTimeRange(placed)!.start, dateString), duration)
      : placed;
  }

  if (isSameTime(updated, target)) {
    return update.reason === 'delay'
      ? `'${target.title}' è già dopo le ${update.minStartTime ?? 'ora indicata'}: nessuno spostamento.`
      : `'${target.title}' è già in agenda con questi orari.`;
  }
  return { kind: CHANGE_KINDS[update.reason], item: updated };
}

/** New tasks placed in their day: fixed events as said, flexible tasks in the first free time. */
async function planNewTasks(
  creates: CreateAction[],
  dateString: string,
  dayItems: CalendarItem[],
  now: Date,
): Promise<{ newItems: CalendarItem[]; unscheduled: CalendarItem[] }> {
  const createdAt = now.toISOString();
  const drafts: CalendarItem[] = creates.map(({ task }) => ({
    title: 'Nuovo impegno',
    type: 'flexible',
    category: 'personal',
    ...task,
    id: generateId(),
    status: 'proposed',
    createdAt,
  }));
  // Fixed events by their start, flexible tasks by their planned day
  const getDraftDate = (item: CalendarItem) =>
    item.type === 'fixed' && item.fixedStartTime ? item.fixedStartTime.slice(0, 10) : (item.scheduledDate ?? dateString);

  const newItems: CalendarItem[] = [];
  const unscheduled: CalendarItem[] = [];
  for (const draftDate of new Set(drafts.map(getDraftDate))) {
    const dayDrafts = drafts.filter((draft) => getDraftDate(draft) === draftDate);
    const fixed = dayDrafts.filter((draft) => draft.type === 'fixed');
    const existing = draftDate === dateString ? dayItems : await getItemsByDate(draftDate);
    const result = fitFlexibleTasks(
      [...existing, ...fixed],
      dayDrafts.filter((draft) => draft.type === 'flexible'),
      draftDate,
      { intervalMinutes: SCHEDULER_INTERVAL_MINUTES, earliestStartTime: getEarliestStart(draftDate, now) },
    );
    newItems.push(...fixed, ...result.scheduled);
    unscheduled.push(...result.unscheduled);
  }
  return { newItems, unscheduled };
}

/** "non arrivo prima delle 14:30" with no task named: everything not started before that time moves after it. */
function planShiftAll(
  shift: ShiftAllAction,
  rawText: string,
  dateString: string,
  dayItems: CalendarItem[],
  now: Date,
): AgendaProposal {
  const nowMinutes = dateString === toDateString(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const minStart = shift.minStartTime ? timeToMinutes(shift.minStartTime) : nowMinutes + (shift.delayMinutes ?? 0);
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
    rawText,
    items: [...toSave.values()].sort(compareByStartTime),
    unscheduled: [],
    changes: changes.sort((a, b) => compareByStartTime(a.item, b.item)),
    deletions: [],
    clearAll: false,
    notice: affected.length ? undefined : `Nessuna attività da spostare prima delle ${minutesToTime(minStart)}.`,
  };
}

function notFoundMessage(query: string): string {
  return query
    ? `Non ho trovato "${query}" nell'agenda di oggi.`
    : "Non ho trovato un'attività in corso da modificare.";
}

/**
 * Turns the user's text into a proposal for the agenda of `dateString`, interpreting it against
 * the items already saved for that day (`dayItems`): new tasks, changes to existing ones,
 * deletions, or emptying the day. Shifts of the following events are offered separately, in `cascade`.
 */
export async function planInput(
  text: string,
  dateString: string,
  dayItems: CalendarItem[],
  now = new Date(),
): Promise<PlanResult> {
  const { rawText, actions } = parseUserInput(text, dayItems, { date: dateString, now });
  if (!actions.length) {
    return { error: 'Non ho capito cosa aggiungere o modificare.' };
  }

  if (actions.some(({ action }) => action === 'CLEAR_ALL')) {
    return {
      proposal: {
        rawText,
        items: [],
        unscheduled: [],
        changes: [],
        deletions: dayItems,
        clearAll: true,
        notice: dayItems.length ? undefined : 'Non ci sono impegni da eliminare oggi.',
      },
    };
  }

  const shift = actions.find((action): action is ShiftAllAction => action.action === 'SHIFT_ALL');
  if (shift) {
    return { proposal: planShiftAll(shift, rawText, dateString, dayItems, now) };
  }

  const notices: string[] = [];
  const deletions: CalendarItem[] = [];
  const primaries: AgendaChange[] = [];
  const creates: CreateAction[] = [];
  // Later changes see the earlier ones
  let working = [...dayItems];

  for (const action of actions) {
    if (action.action === 'UNRESOLVED') {
      notices.push(notFoundMessage(action.query));
    } else if (action.action === 'DELETE') {
      deletions.push(...dayItems.filter(({ id }) => action.targetTaskIds.includes(id)));
    } else if (action.action === 'CREATE') {
      creates.push(action);
    } else if (action.action === 'UPDATE') {
      const target = working.find(({ id }) => id === action.targetTaskId);
      if (!target) continue;
      const result = applyUpdate(action, target, working, dateString, now);
      if (typeof result === 'string') {
        notices.push(result);
      } else {
        primaries.push(result);
        working = working.map((item) => (item.id === result.item.id ? result.item : item));
      }
    }
  }

  // Only unresolved references: nothing to propose
  if (notices.length === actions.length && actions.every(({ action }) => action === 'UNRESOLVED')) {
    return { error: notices.join(' ') };
  }

  const remaining = working.filter((item) => !deletions.some(({ id }) => id === item.id));
  const { newItems, unscheduled } = await planNewTasks(creates, dateString, remaining, now);
  return {
    proposal: buildProposal(rawText, dateString, dayItems, primaries, now, {
      newItems,
      unscheduled,
      deletions,
      notices,
    }),
  };
}
