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
import { type Intent, type IntentResult, type TaskReference, parseIntent } from './nlp';
import { fitFlexibleTasks, reflowDay } from './scheduler';
import { getItemsByDate } from './storage';

const SCHEDULER_INTERVAL_MINUTES = 15;

export type AgendaChangeKind = 'moved' | 'extended' | 'unscheduled' | 'conflict';

export interface AgendaChange {
  kind: AgendaChangeKind;
  /** The item as it will be saved (for 'conflict', as it is now) */
  item: CalendarItem;
  /** For 'extended': minutes added */
  minutes?: number;
}

export interface AgendaProposal {
  intent: Intent;
  rawText: string;
  /** Items saved on approval; status 'proposed' becomes 'confirmed' */
  items: CalendarItem[];
  /** New flexible tasks that didn't fit: not saved */
  unscheduled: CalendarItem[];
  /** How the existing agenda changes (empty for new tasks) */
  changes: AgendaChange[];
  /** Extra information for the user */
  notice?: string;
}

export type PlanResult = { proposal: AgendaProposal } | { error: string };

type ExtendIntent = Extract<IntentResult, { intent: 'EXTEND_TASK' }>;
type DelayIntent = Extract<IntentResult, { intent: 'RESCHEDULE_DELAY' }>;

/** Now, rounded up to the scheduler grid, when planning today; nothing is proposed in the past. */
function getEarliestStart(dateString: string, now: Date): string | undefined {
  if (dateString !== toDateString(now)) return undefined;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutesToTime(Math.ceil(minutes / SCHEDULER_INTERVAL_MINUTES) * SCHEDULER_INTERVAL_MINUTES);
}

/** First 5 letters of the meaningful words, so "studio" matches "Studiare" */
function wordStems(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, 5));
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
    const titleStems = wordStems(item.title);
    const wordScore = wordStems(reference.query).filter((stem) =>
      titleStems.some((titleStem) => titleStem.startsWith(stem) || stem.startsWith(titleStem)),
    ).length;
    return { item, score: wordScore + (reference.category === item.category ? 0.5 : 0) };
  });

  const best = scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || distanceFromNow(a.item) - distanceFromNow(b.item))[0];
  return best?.item ?? null;
}

function isSameTime(a: CalendarItem, b: CalendarItem): boolean {
  const rangeA = getItemTimeRange(a);
  const rangeB = getItemTimeRange(b);
  return rangeA?.start === rangeB?.start && rangeA?.end === rangeB?.end;
}

/**
 * Applies `updated` items to the day, pushes forward the flexible tasks that now conflict,
 * and describes what changes.
 */
function buildReflowProposal(
  parsed: ExtendIntent | DelayIntent,
  dateString: string,
  dayItems: CalendarItem[],
  updated: CalendarItem[],
  now: Date,
  extras: { extended?: { id: string; minutes: number }; conflicts?: CalendarItem[]; notice?: string } = {},
): AgendaProposal {
  const updatedById = new Map(updated.map((item) => [item.id, item]));
  const merged = dayItems.map((item) => updatedById.get(item.id) ?? item);
  const { moved, unscheduled } = reflowDay(merged, dateString, {
    intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
    earliestStartTime: getEarliestStart(dateString, now),
  });

  const toSave = new Map(updated.map((item) => [item.id, item]));
  for (const item of moved) {
    toSave.set(item.id, item);
  }
  for (const item of unscheduled) {
    // Back to the tasks to plan, without times
    toSave.set(item.id, { ...item, proposedStartTime: undefined, proposedEndTime: undefined, status: 'pending' });
  }

  const originals = new Map(dayItems.map((item) => [item.id, item]));
  const changes: AgendaChange[] = [];
  for (const item of toSave.values()) {
    const original = originals.get(item.id)!;
    if (item.status === 'pending' && !getItemTimeRange(item)) {
      changes.push({ kind: 'unscheduled', item });
    } else if (item.id === extras.extended?.id) {
      changes.push({ kind: 'extended', item, minutes: extras.extended.minutes });
    } else if (!isSameTime(item, original)) {
      changes.push({ kind: 'moved', item });
    }
  }
  for (const item of extras.conflicts ?? []) {
    changes.push({ kind: 'conflict', item });
  }

  // Moved flexible tasks are shown as proposals until approved
  const items = [...toSave.values()].map((item) =>
    item.type === 'flexible' && item.status === 'confirmed' && !isSameTime(item, originals.get(item.id)!)
      ? { ...item, status: 'proposed' as const }
      : item,
  );

  return {
    intent: parsed.intent,
    rawText: parsed.rawText,
    items: items.sort(compareByStartTime),
    unscheduled: [],
    changes: changes.sort((a, b) => compareByStartTime(a.item, b.item)),
    notice:
      extras.notice ?? (changes.length ? undefined : "Nessuno spostamento necessario: l'agenda è già compatibile."),
  };
}

async function planCreate(
  parsed: Extract<IntentResult, { intent: 'CREATE_TASK' }>,
  dateString: string,
  dayItems: CalendarItem[],
  now: Date,
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

  const proposed: CalendarItem[] = [];
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
    proposed.push(...fixed, ...result.scheduled);
    unscheduled.push(...result.unscheduled);
  }

  return {
    intent: parsed.intent,
    rawText: parsed.rawText,
    items: proposed.sort(compareByStartTime),
    unscheduled,
    changes: [],
  };
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
    proposal: buildReflowProposal(parsed, dateString, dayItems, [extended], now, {
      extended: { id: target.id, minutes: parsed.extraMinutes },
    }),
  };
}

function planDelay(parsed: DelayIntent, dateString: string, dayItems: CalendarItem[], now: Date): PlanResult {
  const isToday = dateString === toDateString(now);
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : 0;
  let notice: string | undefined;

  if (parsed.target) {
    const target = findTarget(dayItems, parsed.target, now);
    if (target) {
      const range = getItemTimeRange(target)!;
      const start = minutesFromDayStart(range.start, dateString);
      const end = minutesFromDayStart(range.end, dateString);
      const newStart = parsed.minStartTime ? timeToMinutes(parsed.minStartTime) : start + (parsed.delayMinutes ?? 0);
      // A fixed event moves exactly; a flexible task gets a new earliest start and is re-placed
      const updated: CalendarItem =
        target.type === 'fixed'
          ? {
              ...target,
              fixedStartTime: combineDateAndMinutes(dateString, newStart),
              fixedEndTime: combineDateAndMinutes(dateString, newStart + end - start),
            }
          : { ...target, minStartTime: minutesToTime(newStart) };
      return { proposal: buildReflowProposal(parsed, dateString, dayItems, [updated], now) };
    }
    notice = `Non ho trovato "${parsed.target.query}": sposto tutte le attività successive.`;
  }

  // Everything not started yet that begins before the new time
  const minStart = parsed.minStartTime ? timeToMinutes(parsed.minStartTime) : nowMinutes + (parsed.delayMinutes ?? 0);
  const affected = dayItems.filter((item) => {
    const range = getItemTimeRange(item);
    if (!range || item.status === 'completed' || item.status === 'in_progress') return false;
    const start = minutesFromDayStart(range.start, dateString);
    return start >= nowMinutes && start < minStart;
  });
  const updated = affected
    .filter((item) => item.type === 'flexible')
    .map((item) => ({ ...item, minStartTime: minutesToTime(minStart) }));
  // Fixed events can't be moved automatically: they're reported as conflicts
  const conflicts = affected.filter((item) => item.type === 'fixed');

  return {
    proposal: buildReflowProposal(parsed, dateString, dayItems, updated, now, {
      conflicts,
      notice: notice ?? (affected.length ? undefined : `Nessuna attività da spostare prima delle ${minutesToTime(minStart)}.`),
    }),
  };
}

/**
 * Turns the user's text into a proposal for the agenda of `dateString`:
 * new tasks, a longer task, or a delay, with the following tasks moved forward when needed.
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
