import type { CalendarItem, TaskCategory } from '../types';
import { getItemTimeRange } from '../utils/items';
import { combineDateAndMinutes, minutesToTime, toDateString } from '../utils/time';
import {
  type Cues,
  FUNCTION_WORDS,
  LEADING_MOTION_VERBS,
  WHOLE_DAY_WORDS,
  detectCues,
  findCategory,
  hasClitic,
  isMealOrTravel,
  tokenize,
} from './language/lexicon';
import { type ConceptBag, conceptBag, isMatch, matchScore, similarity, totalWeight } from './language/similarity';
import { CONTEXT_PATTERNS, type Span, type TimeSlots, type TimeWindow, findTimeSlots } from './language/timeExpressions';

/** New times, duration or window for an existing task ("HH:mm" times) */
export interface TaskChanges {
  /** "sposta la riunione alle 16", "mangiare alle 14" */
  newStartTime?: string;
  /** With a range ("dalle 10 alle 11") */
  newEndTime?: string;
  /** "mangiare per un'ora" */
  newDuration?: number;
  /** "ci metto più tempo" */
  extraMinutes?: number;
  /** "posticipa di 30 minuti" */
  delayMinutes?: number;
  /** "non riesco prima delle 14" */
  minStartTime?: string;
  /** "tra le 14/14:30" */
  latestStartTime?: string;
  /** "tra le 15 e le 17" */
  maxEndTime?: string;
}

/** Why an existing task changes: a longer task, a delay, or the task restated with new details */
export type UpdateReason = 'extend' | 'delay' | 'statement';

export type ParsedAction =
  /** "elimina tutti gli impegni", "cancella la giornata", "reset" */
  | { action: 'CLEAR_ALL' }
  /** "elimina la palestra", "cancella tutte le riunioni" */
  | { action: 'DELETE'; targetTaskIds: string[] }
  | ({ action: 'UPDATE'; reason: UpdateReason; targetTaskId: string; targetTitle: string } & TaskChanges)
  /** "non arrivo prima delle 14:30": everything not started yet moves after that time */
  | { action: 'SHIFT_ALL'; minStartTime?: string; delayMinutes?: number }
  | { action: 'CREATE'; task: Partial<CalendarItem>; explicitDuration: boolean }
  /** The text refers to a task that isn't in the agenda (or there's no task to refer to) */
  | { action: 'UNRESOLVED'; query: string };

export interface ParseResult {
  rawText: string;
  actions: ParsedAction[];
}

export interface ParseOptions {
  /** "YYYY-MM-DD" of the agenda `currentTasks` belong to; relative days ("domani") count from it */
  date?: string;
  now?: Date;
}

/** Duration of a fixed event when only the start time is given ("alle 15") */
const DEFAULT_FIXED_MINUTES = 60;

/** Duration of a flexible task when none is given ("devo fare la spesa") */
const DEFAULT_FLEXIBLE_MINUTES: Record<TaskCategory, number> = {
  work: 60,
  study: 60,
  chores: 45,
  health: 60,
  personal: 30,
};

/** Meals and trips last at least this long, unless written explicitly ("per 5 minuti") */
const MIN_MEAL_OR_TRAVEL_MINUTES = 30;

/** "ci metto più tempo a studiare" without an amount */
const DEFAULT_EXTENSION_MINUTES = 30;

/** "posticipa la spesa" without a time or an amount */
const DEFAULT_DELAY_MINUTES = 30;

/** "non riesco alle 13:30": the new slot starts at least this long after the excluded time */
const EXCLUDED_TIME_OFFSET_MINUTES = 15;

/** Below this weight a clause doesn't name a task on its own ("andarci", "vado") */
const MIN_CONTENT_WEIGHT = 0.5;

const CLAUSE_SEPARATOR = /[,;\n]+|\.(?:\s+|$)|\s+(?:e poi|poi|ma|però|pero|anche se)\s+/i;

/** Marks a clause that was written in brackets */
const ASIDE_MARK = '\u0001';

/** Verbs of motion that, before "a" + another verb, aren't the action ("andare a parlare con Riccardo") */
const MOTION_VERBS = new Set(['andare', 'vado', 'vai', 'va', 'passare', 'passo', 'uscire', 'esco', 'tornare', 'torno']);

interface AnalyzedClause {
  text: string;
  slots: TimeSlots;
  cues: Cues;
  /** What the clause talks about: no time expressions, intent words or filler */
  content: ConceptBag;
  contentWords: string[];
  /** Only adds details to the main clause: "posso andarci tra le 15 e le 17", "(verso le 13)" */
  isModifier: boolean;
}

/** A clause naming something, with the clauses that add details to it */
interface ClauseGroup {
  main?: AnalyzedClause;
  modifiers: AnalyzedClause[];
}

function toTime(minutes: number | undefined): string | undefined {
  return minutes !== undefined ? minutesToTime(minutes) : undefined;
}

function isInSpans(token: { start: number; end: number }, spans: Span[]): boolean {
  return spans.some(({ index, length }) => token.start >= index && token.end <= index + length);
}

/** Splits the text into clauses; text in brackets becomes a clause of its own, marked as an aside. */
function splitClauses(text: string): { text: string; aside: boolean }[] {
  const marked = text.replace(
    /[([]([^)\]]*)[)\]]/g,
    (_, inner: string) => `;${ASIDE_MARK}${inner.replace(/[,;]/g, ' ')};`,
  );
  const withoutContext = CONTEXT_PATTERNS.reduce((result, pattern) => result.replace(pattern, ';'), marked);
  return withoutContext
    .split(CLAUSE_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part.startsWith(ASIDE_MARK) ? { text: part.slice(1).trim(), aside: true } : { text: part, aside: false },
    )
    .filter((clause) => clause.text);
}

function analyzeClause(clause: { text: string; aside: boolean }, date: string): AnalyzedClause {
  const tokens = tokenize(clause.text);
  const cues = detectCues(tokens.map((token) => token.word));
  const slots = findTimeSlots(clause.text, date, cues.negatedAbility);
  const contentTokens = tokens.filter(
    (token) => !isInSpans(token, slots.spans) && !cues.cueWords.has(token.word) && !WHOLE_DAY_WORDS.has(token.word),
  );
  const content = conceptBag(contentTokens.map((token) => token.text).join(' '));
  const contentWords = contentTokens.map((token) => token.word).filter((word) => !FUNCTION_WORDS.has(word));
  return {
    text: clause.text,
    slots,
    cues,
    content,
    contentWords,
    isModifier:
      clause.aside || totalWeight(content) < MIN_CONTENT_WEIGHT || contentWords.every((word) => hasClitic(word)),
  };
}

/** Each main clause takes the modifiers after it; modifiers before any main clause go to the first one. */
function groupClauses(clauses: AnalyzedClause[]): ClauseGroup[] {
  const groups: ClauseGroup[] = [];
  let leading: AnalyzedClause[] = [];
  for (const clause of clauses) {
    if (!clause.isModifier) {
      groups.push({ main: clause, modifiers: leading });
      leading = [];
    } else if (groups.length) {
      groups[groups.length - 1].modifiers.push(clause);
    } else {
      leading.push(clause);
    }
  }
  // Only details: "non arrivo prima delle 14:30", "ho bisogno di più tempo"
  if (!groups.length && leading.length) {
    groups.push({ modifiers: leading });
  }
  return groups;
}

/** The group's cues together: an intent said in a modifier applies to the main clause too */
function mergeCues(clauses: AnalyzedClause[]): Cues {
  const merged = detectCues([]);
  for (const { cues } of clauses) {
    for (const key of ['clearAll', 'remove', 'everyMatch', 'extend', 'delay', 'negatedAbility', 'arrival'] as const) {
      merged[key] ||= cues[key];
    }
    cues.cueWords.forEach((word) => merged.cueWords.add(word));
  }
  return merged;
}

/** The group's time expressions together; the main clause's come first */
function mergeSlots(clauses: AnalyzedClause[]): TimeSlots {
  const merged: TimeSlots = { spans: [] };
  for (const { slots } of clauses) {
    merged.range ??= slots.range;
    merged.time ??= slots.time;
    merged.excluded ??= slots.excluded;
    merged.between ??= slots.between;
    merged.notBefore ??= slots.notBefore;
    merged.notAfter ??= slots.notAfter;
    merged.named ??= slots.named;
    merged.duration ??= slots.duration;
    merged.date ??= slots.date;
  }
  return merged;
}

/** Creating or restating a task: an excluded time and the bounds said limit when it can happen */
function statementWindow(slots: TimeSlots): TimeWindow {
  const minStarts = [
    slots.excluded && slots.excluded.last + EXCLUDED_TIME_OFFSET_MINUTES,
    slots.between?.minStartMinutes,
    slots.notBefore?.last,
    slots.named?.minStartMinutes,
  ].filter((minutes): minutes is number => minutes !== undefined);
  const maxEnds = [slots.between?.maxEndMinutes, slots.notAfter?.first, slots.named?.maxEndMinutes].filter(
    (minutes): minutes is number => minutes !== undefined,
  );
  return {
    minStartMinutes: minStarts.length ? Math.max(...minStarts) : undefined,
    maxStartMinutes: slots.between?.maxStartMinutes,
    maxEndMinutes: maxEnds.length ? Math.min(...maxEnds) : undefined,
  };
}

/** Delaying: every time said bounds when the task can start, and the latest wins ("14:00/14:30" -> 14:30) */
function delayStart(slots: TimeSlots): number | undefined {
  const bounds = [
    slots.excluded && slots.excluded.last + EXCLUDED_TIME_OFFSET_MINUTES,
    slots.between?.minStartMinutes,
    slots.notBefore?.last,
    slots.notAfter?.last,
    slots.time?.last,
    slots.range?.start,
  ].filter((minutes): minutes is number => minutes !== undefined);
  return bounds.length ? Math.max(...bounds) : undefined;
}

/** An explicit time ("alle 15", "dalle 10 alle 11", "alle 14:00/14:30"), unless it was excluded */
function explicitTimes(slots: TimeSlots): { start: number; end?: number } | null {
  if (slots.excluded) return null;
  if (slots.range) return { start: slots.range.start, end: slots.range.end };
  if (slots.time) return { start: slots.time.first, end: slots.time.last > slots.time.first ? slots.time.last : undefined };
  return null;
}

/**
 * The core of the action named by a clause: "non penso di riuscire a mangiare alle 13:30" -> "Mangiare",
 * "vado a parlare con Riccardo" -> "Parlare con Riccardo". Time expressions, intent words and
 * filler at the edges are removed; the words in between are kept as written.
 */
function extractTitle(clause: AnalyzedClause): string {
  const removed = (token: { word: string; start: number; end: number }) =>
    isInSpans(token, clause.slots.spans) || clause.cues.cueWords.has(token.word);
  const tokens = tokenize(clause.text).filter((token) => !removed(token));

  let first = 0;
  let last = tokens.length - 1;
  for (;;) {
    const word = tokens[first]?.word;
    if (word === undefined) break;
    if (FUNCTION_WORDS.has(word) || LEADING_MOTION_VERBS.has(word) || hasClitic(word) || WHOLE_DAY_WORDS.has(word)) {
      first++;
    } else if (
      MOTION_VERBS.has(word) &&
      (tokens[first + 1]?.word === 'a' || tokens[first + 1]?.word === 'ad') &&
      /(are|ere|ire)$/.test(tokens[first + 2]?.word ?? '')
    ) {
      first += 2;
    } else {
      break;
    }
  }
  // "... posso andarci": modal verbs and verbs pointing back aren't part of the name
  while (last >= first && (FUNCTION_WORDS.has(tokens[last].word) || hasClitic(tokens[last].word))) last--;
  if (first > last) return '';

  // The original text between the first and last kept word, without the removed words inside it
  const start = tokens[first].start;
  const end = tokens[last].end;
  const inner = tokenize(clause.text).filter((token) => token.start >= start && token.end <= end && removed(token));
  let title = clause.text.slice(start, end);
  for (const token of inner.reverse()) {
    title = `${title.slice(0, token.start - start)} ${title.slice(token.end - start)}`;
  }
  title = title
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-:.,;!?']+|[\s\-:.,;!?]+$/g, '');
  return title && title.charAt(0).toUpperCase() + title.slice(1);
}

function distanceFromNow(item: CalendarItem, now: Date): number {
  const range = getItemTimeRange(item);
  if (!range) return Infinity;
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  return start <= now.getTime() && now.getTime() < end ? 0 : Math.abs(start - now.getTime());
}

/**
 * The tasks of the day that `content` names, best first. With `category`, when no title
 * matches, the tasks of that category ("ci metto di più a cucinare" -> the chores).
 */
function findTasks(
  content: ConceptBag,
  tasks: CalendarItem[],
  now: Date,
  category?: TaskCategory,
): CalendarItem[] {
  const candidates = tasks.filter((task) => task.status !== 'completed');
  const matches = candidates
    .map((task) => ({ task, similarity: similarity(content, conceptBag(task.title)) }))
    .filter(({ similarity: match }) => isMatch(match))
    .sort(
      (a, b) =>
        matchScore(b.similarity) - matchScore(a.similarity) || distanceFromNow(a.task, now) - distanceFromNow(b.task, now),
    )
    .map(({ task }) => task);
  if (matches.length || !category) return matches;
  return candidates
    .filter((task) => task.category === category && getItemTimeRange(task))
    .sort((a, b) => distanceFromNow(a, now) - distanceFromNow(b, now));
}

/** "ho bisogno di più tempo": the task in progress, else the last one started, else the next */
function findCurrentTask(tasks: CalendarItem[], now: Date): CalendarItem | null {
  const timed = tasks
    .filter((task) => task.status !== 'completed' && getItemTimeRange(task))
    .map((task) => ({ task, start: new Date(getItemTimeRange(task)!.start).getTime() }));
  const started = timed.filter(({ start }) => start <= now.getTime()).sort((a, b) => b.start - a.start);
  const upcoming = timed.filter(({ start }) => start > now.getTime()).sort((a, b) => a.start - b.start);
  return started[0]?.task ?? upcoming[0]?.task ?? null;
}

function buildTask(main: AnalyzedClause, slots: TimeSlots, date: string): ParsedAction {
  const title = extractTitle(main) || 'Nuovo impegno';
  const category = findCategory(main.contentWords) ?? 'personal';
  const minMinutes =
    isMealOrTravel(main.contentWords) && !slots.duration?.explicit ? MIN_MEAL_OR_TRAVEL_MINUTES : 0;
  const dateString = slots.date ?? date;
  const times = explicitTimes(slots);
  const explicitDuration = slots.duration !== undefined;

  if (times) {
    const minutes = Math.max(slots.duration?.minutes ?? DEFAULT_FIXED_MINUTES, minMinutes);
    return {
      action: 'CREATE',
      task: {
        title,
        type: 'fixed',
        category,
        fixedStartTime: combineDateAndMinutes(dateString, times.start),
        fixedEndTime: combineDateAndMinutes(dateString, times.end ?? times.start + minutes),
        status: 'pending',
      },
      explicitDuration,
    };
  }

  const estimatedMinutes = Math.max(slots.duration?.minutes ?? DEFAULT_FLEXIBLE_MINUTES[category], minMinutes);
  const window = statementWindow(slots);
  const latestEnd = window.maxStartMinutes !== undefined ? window.maxStartMinutes + estimatedMinutes : undefined;
  const maxEnd = Math.min(window.maxEndMinutes ?? Infinity, latestEnd ?? Infinity);
  return {
    action: 'CREATE',
    task: {
      title,
      type: 'flexible',
      category,
      estimatedMinutes,
      scheduledDate: dateString,
      minStartTime: toTime(window.minStartMinutes),
      maxEndTime: maxEnd !== Infinity ? minutesToTime(maxEnd) : undefined,
      status: 'pending',
    },
    explicitDuration,
  };
}

/** A task restated with new details ("mangiare per un'ora", "vado a mangiare tra le 15 e le 17") */
function statementChanges(slots: TimeSlots): TaskChanges {
  const times = explicitTimes(slots);
  const window = statementWindow(slots);
  return {
    newStartTime: toTime(times?.start),
    newEndTime: toTime(times?.end),
    newDuration: slots.duration?.minutes,
    minStartTime: toTime(window.minStartMinutes),
    latestStartTime: toTime(window.maxStartMinutes),
    maxEndTime: toTime(window.maxEndMinutes),
  };
}

function buildAction(group: ClauseGroup, tasks: CalendarItem[], date: string, now: Date): ParsedAction | null {
  const { main } = group;
  const clauses = main ? [main, ...group.modifiers] : group.modifiers;
  const cues = mergeCues(clauses);
  const slots = mergeSlots(clauses);
  const content = main?.content ?? new Map();
  const category = main ? findCategory(main.contentWords) : undefined;
  const query = main ? extractTitle(main) : '';
  const update = (reason: UpdateReason, target: CalendarItem, changes: TaskChanges): ParsedAction => ({
    action: 'UPDATE',
    reason,
    targetTaskId: target.id,
    targetTitle: target.title,
    ...changes,
  });

  if (cues.remove) {
    const targets = main ? findTasks(content, tasks, now) : [];
    if (!targets.length) return { action: 'UNRESOLVED', query };
    return { action: 'DELETE', targetTaskIds: (cues.everyMatch ? targets : targets.slice(0, 1)).map(({ id }) => id) };
  }

  if (cues.extend) {
    const target = main ? findTasks(content, tasks, now, category)[0] : findCurrentTask(tasks, now);
    if (!target) return { action: 'UNRESOLVED', query };
    return update('extend', target, { extraMinutes: slots.duration?.minutes ?? DEFAULT_EXTENSION_MINUTES });
  }

  const bound = delayStart(slots);
  if (cues.delay || cues.negatedAbility || (cues.arrival && bound !== undefined)) {
    const changes: TaskChanges =
      bound !== undefined
        ? {
            minStartTime: toTime(bound),
            latestStartTime: toTime(slots.between?.maxStartMinutes),
            maxEndTime: toTime(slots.between?.maxEndMinutes),
          }
        : { delayMinutes: slots.duration?.minutes ?? DEFAULT_DELAY_MINUTES };
    if (!main) {
      return { action: 'SHIFT_ALL', minStartTime: changes.minStartTime, delayMinutes: changes.delayMinutes };
    }
    const target = findTasks(content, tasks, now, category)[0];
    if (target) return update('delay', target, changes);
    // "non penso di riuscire a fare yoga alle 18" with no yoga planned: a new task with that constraint
    if (cues.negatedAbility) return buildTask(main, slots, date);
    return { action: 'UNRESOLVED', query };
  }

  // Details with nothing to attach to
  if (!main) return null;

  // The same task already planned is updated, not duplicated
  const existing = findTasks(content, tasks, now)[0];
  if (existing && (slots.date ?? date) === date) {
    return update('statement', existing, statementChanges(slots));
  }
  return buildTask(main, slots, date);
}

/**
 * Interprets what the user wrote against the agenda of the day (`currentTasks`):
 * - CLEAR_ALL when the whole sentence asks to empty the day;
 * - DELETE / UPDATE when it names a task of the day (by meaning: "vado a mangiare" finds
 *   "Andare a mangiare a casa"), as a removal, a longer task, a delay or new details;
 * - SHIFT_ALL for a delay that names no task ("non arrivo prima delle 14:30");
 * - CREATE only for actions not in the agenda.
 * Secondary clauses ("posso andarci tra le 15 e le 17", text in brackets) add constraints to the
 * main clause instead of becoming tasks. One action per main clause.
 */
export function parseUserInput(text: string, currentTasks: CalendarItem[], options: ParseOptions = {}): ParseResult {
  const now = options.now ?? new Date();
  const date = options.date ?? toDateString(now);
  const rawText = text.trim();

  if (detectCues(tokenize(rawText).map((token) => token.word)).clearAll) {
    return { rawText, actions: [{ action: 'CLEAR_ALL' }] };
  }

  const clauses = splitClauses(rawText).map((clause) => analyzeClause(clause, date));
  const actions = groupClauses(clauses)
    .map((group) => buildAction(group, currentTasks, date, now))
    .filter((action): action is ParsedAction => action !== null);
  return { rawText, actions };
}
