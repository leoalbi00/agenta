import type { CalendarItem, TaskCategory } from '../types';
import { addDays, combineDateAndMinutes, minutesToTime, parseDateString, toDateString } from '../utils/time';

export interface ParseResult {
  items: Partial<CalendarItem>[];
  /** Per item: true if the duration was written ("per 2 ore"), false if it's a default */
  explicitDuration: boolean[];
  rawText: string;
}

export type Intent = 'CREATE_TASK' | 'EXTEND_TASK' | 'RESCHEDULE_DELAY';

/** How the user refers to an existing task ("la spesa", "lo studio") */
export interface TaskReference {
  query: string;
  /** Category implied by the words, if any ("palestra" -> health) */
  category?: TaskCategory;
}

export type IntentResult =
  | ({ intent: 'CREATE_TASK' } & ParseResult)
  | {
      intent: 'EXTEND_TASK';
      /** null: the task in progress */
      target: TaskReference | null;
      extraMinutes: number;
      rawText: string;
    }
  | {
      intent: 'RESCHEDULE_DELAY';
      /** null: all the following activities */
      target: TaskReference | null;
      /** "HH:mm" the target can't start before ("non arrivo prima delle 14:30") */
      minStartTime?: string;
      /** "HH:mm" the target should start by ("tra le 14/14:30" -> 14:30) */
      latestStartTime?: string;
      /** "HH:mm" the target must end by ("tra le 14 e le 16") */
      maxEndTime?: string;
      /** Relative delay when no time is given ("posticipa di 30 minuti") */
      delayMinutes?: number;
      /** Said as "non riesco / non penso di riuscire...", which can also describe a new task */
      negated: boolean;
      rawText: string;
    };

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

/** Words that don't identify a task ("andare a parlare con Riccardo" vs "andare in palestra") */
const GENERIC_STEMS = new Set([
  'fare', 'andar', 'devo', 'dover', 'penso', 'riusc', 'prima', 'dopo', 'oggi', 'doman', 'tempo', 'magar',
  'con', 'per', 'una', 'uno', 'gli', 'del', 'dal', 'nel', 'sul', 'all', 'alla', 'alle', 'dell', 'della', 'delle', 'degli',
]);

/** Stems that name the same activity */
const SYNONYM_STEMS: Record<string, string> = {
  mangi: 'pasto', pranz: 'pasto', cena: 'pasto', cenar: 'pasto', colaz: 'pasto', meren: 'pasto', spunt: 'pasto',
  studi: 'studi', ripas: 'studi',
  palest: 'allen', allen: 'allen',
};

/** Word stems matched at the start of a word, checked in order */
const CATEGORY_KEYWORDS: [TaskCategory, string[]][] = [
  ['health', ['palestra', 'medic', 'dottor', 'dentist', 'allenament', 'allenarm', 'corsa', 'correre', 'yoga', 'pilates', 'visita', 'farmacia', 'nuot', 'cammin', 'fisioterap']],
  ['study', ['studi', 'esame', 'lezion', 'ripass', 'compit', 'corso', 'universit', 'libro', 'legger', 'pagin', 'capitol', 'tesi']],
  ['work', ['lavor', 'riunion', 'meeting', 'call', 'mail', 'email', 'client', 'progett', 'ufficio', 'report', 'presentazion', 'colloqui']],
  ['chores', ['spesa', 'pulir', 'pulizi', 'lavatric', 'bucato', 'cucinar', 'stirar', 'bollett', 'piatti', 'aspirapolvere', 'riordin', 'supermercato']],
];

const MEAL_OR_TRAVEL_STEMS = [
  'pranz', 'cena', 'cenare', 'colazion', 'aperitiv', 'merend', 'spuntin', 'brunch',
  'andare', 'tornare', 'rientrare', 'spostament', 'viaggi', 'tragitt', 'raggiunger', 'accompagnar', 'guidare',
];

const WEEKDAYS = ['domenica', 'luned[iì]', 'marted[iì]', 'mercoled[iì]', 'gioved[iì]', 'venerd[iì]', 'sabato'];

/** A clock time, optionally with an alternative after a slash ("14:00/14:30") */
const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?(?:\s*\/\s*\d{1,2}(?:[:.]\d{2})?)?)`;
/** A time not followed by a unit, so "entro 2 ore" isn't read as "entro le 2" */
const CLOCK_TIME = String.raw`${TIME}(?!\s*(?:ore|ora|h|minuti|min)\b)`;

const RANGE_PATTERNS = [
  new RegExp(String.raw`\b(?:dalle|dall'|da)\s*(?:ore\s+)?${TIME}\s*(?:alle|all'|a)\s*(?:ore\s+)?${TIME}\b`),
  /\b(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})\b/,
];
const SINGLE_TIME_PATTERN = new RegExp(String.raw`\b(?:alle|all'|verso le|ore)\s*(?:ore\s+)?${TIME}\b`);
const MIDDAY_PATTERN = /\b(?:a\s+)?mezzogiorno\b/;

/** "tra le 15 e le 18" */
const BETWEEN_PATTERN = new RegExp(String.raw`\b(?:tra|fra)\s+le\s+(?:ore\s+)?${CLOCK_TIME}\s+e\s+le\s+(?:ore\s+)?${CLOCK_TIME}`);
/** "tra le 14/14:30": start between the alternatives */
const START_BETWEEN_PATTERN = new RegExp(String.raw`\b(?:tra|fra)\s+le\s+(?:ore\s+)?${CLOCK_TIME}(?!\s*e\s+le)`);

/** "non riesco", "non penso di riuscire": a time next to it is excluded, not a start */
const NEGATION_PATTERN =
  /\bnon\s+(?:(?:penso|credo)\s+di\s+(?:riuscire|farcela|fare in tempo|arrivare)|riesco|riuscir[oò]|posso|potr[oò]|ce la faccio|ce la far[oò]|faccio in tempo|arrivo|arriver[oò]|ci sono|ci sar[oò]|sono liber[oa]|sar[oò] liber[oa]|torno|rientro)\b/;
/** A time introduced by "alle" & co. ("non alle 13:30" is excluded even without a verb) */
const PLAIN_TIME_PATTERN = new RegExp(String.raw`\b(?:non\s+)?(?:alle|all'|per le|verso le|ore)\s*(?:ore\s+)?${CLOCK_TIME}`);
/** "dopo le 15", "dalle 15 in poi" */
const NOT_BEFORE_PATTERN = new RegExp(
  String.raw`\b(?:non prima delle|non prima di|dopo le|dopo l'|a partire dalle|a partire dall'|dalle|dall')\s*(?:ore\s+)?${CLOCK_TIME}(?:\s+in poi)?`,
);
/** "prima delle 18", "entro le 18" */
const NOT_AFTER_PATTERN = new RegExp(
  String.raw`\b(?:prima delle|prima dell'|prima di|entro le|entro l'|entro|non oltre le|non dopo le|fino alle|fino all')\s*(?:ore\s+)?${CLOCK_TIME}`,
);
const NAMED_WINDOWS: [RegExp, TimeWindow][] = [
  [/\bdopo (?:il )?pranzo\b/, { minStartMinutes: 14 * 60 }],
  [/\bprima (?:di|del) pranzo\b/, { maxEndMinutes: 12 * 60 + 30 }],
  [/\bdopo (?:la )?cena\b/, { minStartMinutes: 21 * 60 }],
  [/\bprima (?:di|della) cena\b/, { maxEndMinutes: 19 * 60 + 30 }],
  [/\b(?:(?:di|del|in|nella)\s+)?(?:mattinata|mattina|mattino)\b|\bstamattina\b/, { maxEndMinutes: 12 * 60 }],
  [/\b(?:(?:di|del|nel)\s+)?pomeriggio\b/, { minStartMinutes: 14 * 60, maxEndMinutes: 19 * 60 }],
  [/\b(?:(?:di|della|in|nella)\s+)?(?:serata|sera)\b|\bstasera\b/, { minStartMinutes: 18 * 60 }],
];

/** Travel time to a place ("a 5 minuti da casa"), not the task duration */
const TRAVEL_PATTERN =
  /\b(?:(?:che\s+)?(?:è|e'|dista|si trova)\s+)?(?:a\s+)?\d+\s*(?:minuti|min)\s+(?:a piedi|di (?:distanza|strada|cammino|macchina|auto|bici|tragitto)|in (?:macchina|auto|bici|bicicletta|moto|metro|autobus|bus|treno)|(?:da|dal|dalla|dall')\s*[^\s,;.]+|lontan[oa])/;

/** Clauses describing the situation, not a task ("ora mi trovo a casa", "orario indefinito") */
const STOP_BEFORE_CONJUNCTION = String.raw`(?:(?!\s(?:e|ma|però|poi|quindi|devo|dovrei|voglio|vorrei|ho)\s)[^,;.\n])*`;
const CONTEXT_PATTERNS = [
  new RegExp(String.raw`\b(?:(?:ora|adesso|attualmente|in questo momento)\s+)?mi trovo\b${STOP_BEFORE_CONJUNCTION}`, 'gi'),
  new RegExp(
    String.raw`\b(?:ora|adesso|attualmente|in questo momento)\s+(?:sono|sto)\s+(?:a|in|al|alla|allo|ai|da|dal|dalla|fuori)\b${STOP_BEFORE_CONJUNCTION}`,
    'gi',
  ),
  /\b(?:orario|ora)\s+(?:indefinit[oa]|non definit[oa]|libero|flessibile|qualsiasi|a scelta)\b/gi,
  /\bsenza\s+(?:un\s+)?orario(?:\s+(?:preciso|fisso|definito))?\b/gi,
  /\b(?:quando\s+(?:vuoi|capita|posso|riesco|ho tempo)|in qualsiasi momento|a qualsiasi ora|non importa (?:quando|l'orario|l'ora))\b/gi,
];

/** "non arrivo prima delle 15", "posticipa la riunione", "sono in ritardo" */
const DELAY_PATTERNS = [
  NEGATION_PATTERN,
  /\b(?:posticipa(?:re)?|rimanda(?:re)?|ritarda(?:re)?|slitta(?:re)?|sposta(?:re)?(?:\s+(?:più\s+)?(?:avanti|in avanti))?)\b/,
  /\b(?:sono|sar[oò])\s+in\s+ritardo\b|\b(?:ritardo|arrivo tardi|faccio tardi|arriver[oò] tardi)\b/,
  /\b(?:arrivo|arriver[oò]|torno|torner[oò]|rientro|sar[oò] liber[oa]|sono liber[oa])\s+(?:solo\s+)?(?=(?:alle|all'|dopo le|verso le|per le)\b)/,
];

/** End of a word ending in an accented letter ("più"), where \b doesn't work */
const WORD_END = String.raw`(?![\wàèéìòù])`;

/** "ci metto più tempo a studiare", "allunga la riunione", "mi servono 20 minuti in più" */
const EXTEND_PATTERNS = [
  new RegExp(
    String.raw`\b(?:ci\s+)?(?:metto|metter[oò]|vuole|vorr[aà]|serve|servono|servir[aà]|occorre)\s+(?:(?:un po'|molto|ancora)\s+)?(?:di\s+)?(?:più|piu|altro|altri|altre)(?:\s+tempo)?${WORD_END}`,
  ),
  new RegExp(String.raw`\bho bisogno di\s+(?:(?:un po'|ancora)\s+)?(?:più|piu|altro|altri)(?:\s+tempo)?${WORD_END}`),
  /\b(?:allunga(?:re)?|prolunga(?:re)?|estendi|estendere)\b/,
  new RegExp(String.raw`\b(?:dura|durer[aà]|richiede|richieder[aà])\s+(?:di\s+)?(?:più|piu)${WORD_END}`),
  /\b(?:mi\s+)?(?:serve|servono)\s+(?:ancora\s+)?(?=\d|un|mezz)/,
  new RegExp(String.raw`\bin più${WORD_END}`),
];

/** Times bounding a delay; the latest one wins ("non prima delle 14:00/14:30" -> 14:30) */
const DELAY_TIME_PATTERN = new RegExp(
  String.raw`\b(?:non prima delle|non prima di|prima delle|prima dell'|prima di|fino alle|fino all'|dopo le|dopo l'|verso le|per le|alle|all'|dalle|dall')\s*(?:ore\s+)?${CLOCK_TIME}`,
  'g',
);

/** Words around a task reference that aren't part of its name */
const REFERENCE_FILLER =
  /^(?:mi|ci|a|ad|per|con|da|di|nel|nello|nella|nei|negli|nelle|col|coi|sul|sullo|sulla|al|allo|alla|ai|agli|alle|in|più|piu|tempo|fare|finire|mio|mia|miei|mie)(?:\s+|$)|\s+(?:in più|di più|più|piu|ancora|oggi)$/i;
const ALL_ACTIVITIES = /^(?:tutto|tutti|tutte|il resto|resto|le attività|attività|gli impegni|impegni|i task|task|quello che segue|le prossime attività)$/i;

const SEGMENT_SEPARATOR = /[,;\n]+|\.\s+|\s+e poi\s+|\s+poi\s+/i;
const LEADING_CONJUNCTION = /^(?:e|ma|però|pero|poi|quindi|inoltre|ora|adesso|magari|meglio|facciamo|piuttosto|forse|anzi|diciamo)(?:\s+|$)/i;
/** Negation left at the start of a title ("non penso di riuscire a mangiare" -> "mangiare") */
const LEADING_NEGATION =
  /^non\s+(?:(?:penso|credo)\s+di\s+(?:riuscire|farcela|fare in tempo)|riesco|riuscir[oò]|posso|potr[oò]|ce la faccio|ce la far[oò])\s+(?:a\s+|ad\s+)?/i;
const LEADING_FILLER = /^(?:(?:io|che)\s+)?(?:devo|dovrei|voglio|vorrei|bisogna|tocca|ho|avr[oò]|c'[eè]|ricordami di|ricordati di|ricorda di|mi serve)\s+/i;
const LEADING_ARTICLE = /^(?:un|una|uno|il|lo|la|i|gli|le)\s+|^l'/i;
const TRAILING_CONNECTOR = /\s+(?:per|di|da|a|e|ma|in|verso|circa)$/i;

interface Match {
  index: number;
  length: number;
}

interface TimeMatch extends Match {
  startMinutes: number;
  endMinutes?: number;
}

interface DurationMatch extends Match {
  minutes: number;
  /** Written as "per 5 minuti" */
  explicit: boolean;
}

interface DateMatch extends Match {
  dateString: string;
}

interface TimeWindow {
  minStartMinutes?: number;
  /** Latest start ("tra le 14/14:30"), turned into maxEndTime with the task duration */
  maxStartMinutes?: number;
  maxEndMinutes?: number;
}

interface ParsedSegment {
  /** null when the clause only carries constraints ("dopo le 15") */
  item: Partial<CalendarItem> | null;
  explicitDuration: boolean;
  window: TimeWindow;
  dateString?: string;
}

/**
 * Hours without a day part are read as the most likely time for an agenda:
 * "alle 3" -> 15:00, unless the text says "mattina".
 */
function toDayMinutes(hours: number, minutes: number, text: string): number | null {
  if (hours > 23 || minutes > 59) {
    return null;
  }
  const isAfternoon = /\b(?:pomeriggio|sera|stasera)\b/.test(text);
  const isMorning = /\b(?:mattina|mattino|stamattina)\b/.test(text);
  if (hours < 12 && (isAfternoon || (!isMorning && hours >= 1 && hours <= 7))) {
    hours += 12;
  }
  return hours * 60 + minutes;
}

interface ClockRange {
  first: number;
  last: number;
}

/** "14:30" or "14:00/14:30" -> minutes of the earliest and latest alternative */
function parseClock(token: string, text: string): ClockRange | null {
  const minutes: number[] = [];
  for (const part of token.split('/')) {
    const [hours, mins = '0'] = part.trim().split(/[:.]/);
    const value = toDayMinutes(Number(hours), Number(mins), text);
    if (value === null) return null;
    minutes.push(value);
  }
  return { first: Math.min(...minutes), last: Math.max(...minutes) };
}

/** Replaces a match with spaces, so later patterns can't reuse it and indexes stay valid. */
function blank(text: string, { index, length }: Match): string {
  return text.slice(0, index) + ' '.repeat(length) + text.slice(index + length);
}

function findRange(text: string, original: string): TimeMatch | null {
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = parseClock(match[1], original);
    const end = parseClock(match[2], original);
    if (!start || !end) continue;
    const startMinutes = start.first;
    let endMinutes = end.last;
    // "dalle 11 alle 1" -> 11:00-13:00
    if (endMinutes <= startMinutes && endMinutes + 12 * 60 > startMinutes && endMinutes < 12 * 60) {
      endMinutes += 12 * 60;
    }
    if (endMinutes <= startMinutes) {
      endMinutes = startMinutes + DEFAULT_FIXED_MINUTES;
    }
    return { index: match.index, length: match[0].length, startMinutes, endMinutes };
  }
  return null;
}

function findSingleTime(text: string, original: string): TimeMatch | null {
  const single = SINGLE_TIME_PATTERN.exec(text);
  const clock = single && parseClock(single[1], original);
  if (single && clock) {
    // "alle 14:00/14:30" is the window 14:00-14:30
    const endMinutes = clock.last > clock.first ? clock.last : undefined;
    return { index: single.index, length: single[0].length, startMinutes: clock.first, endMinutes };
  }
  const midday = MIDDAY_PATTERN.exec(text);
  return midday ? { index: midday.index, length: midday[0].length, startMinutes: 12 * 60 } : null;
}

/** "tra le 14 e le 16" (start after, end before) or "tra le 14/14:30" (start between). */
function findBetween(text: string, original: string): { window: TimeWindow; match: Match } | null {
  const between = BETWEEN_PATTERN.exec(text);
  if (between) {
    // With alternatives ("14:00/14:30") the most conservative bound is used
    return {
      window: {
        minStartMinutes: parseClock(between[1], original)?.last,
        maxEndMinutes: parseClock(between[2], original)?.first,
      },
      match: { index: between.index, length: between[0].length },
    };
  }
  const startBetween = START_BETWEEN_PATTERN.exec(text);
  const clock = startBetween && parseClock(startBetween[1], original);
  if (startBetween && clock) {
    return {
      window: { minStartMinutes: clock.first, maxStartMinutes: clock.last },
      match: { index: startBetween.index, length: startBetween[0].length },
    };
  }
  return null;
}

/** "non riesco alle 13:30": the time can't be the start, the new slot begins after it. */
function findExcludedTime(text: string, original: string): { match: Match; minStartMinutes: number } | null {
  const time = PLAIN_TIME_PATTERN.exec(text);
  if (!time || !(NEGATION_PATTERN.test(original) || /^non\b/.test(time[0]))) {
    return null;
  }
  const clock = parseClock(time[1], original);
  return clock && {
    match: { index: time.index, length: time[0].length },
    minStartMinutes: clock.last + EXCLUDED_TIME_OFFSET_MINUTES,
  };
}

/** Finds time windows ("dopo le 15", "prima di cena"); returns the window and the matched spans. */
function findWindow(text: string, original: string): { window: TimeWindow; matches: Match[] } {
  const window: TimeWindow = {};
  const matches: Match[] = [];
  let remaining = text;
  const consume = (match: RegExpExecArray) => {
    const span = { index: match.index, length: match[0].length };
    matches.push(span);
    remaining = blank(remaining, span);
  };

  const between = findBetween(remaining, original);
  if (between) {
    Object.assign(window, between.window);
    matches.push(between.match);
    remaining = blank(remaining, between.match);
  }
  const notBefore = NOT_BEFORE_PATTERN.exec(remaining);
  if (notBefore) {
    window.minStartMinutes = parseClock(notBefore[1], original)?.last;
    consume(notBefore);
  }
  const notAfter = NOT_AFTER_PATTERN.exec(remaining);
  if (notAfter) {
    window.maxEndMinutes = parseClock(notAfter[1], original)?.first;
    consume(notAfter);
  }
  for (const [pattern, named] of NAMED_WINDOWS) {
    const match = pattern.exec(remaining);
    if (match) {
      window.minStartMinutes ??= named.minStartMinutes;
      window.maxEndMinutes ??= named.maxEndMinutes;
      consume(match);
    }
  }
  return { window, matches };
}

function findDuration(text: string): DurationMatch | null {
  const patterns: [RegExp, (match: RegExpExecArray) => number][] = [
    [/\b(\d+(?:[.,]\d+)?)\s*(?:ore|ora|h)\s+e\s+mezz[ao]\b/, (m) => parseFloat(m[1].replace(',', '.')) * 60 + 30],
    [/\b(\d+)\s*h\s*(\d{1,2})\b/, (m) => Number(m[1]) * 60 + Number(m[2])],
    [
      /\b(\d+(?:[.,]\d+)?)\s*(?:ore|ora|h)(?:\s+e\s+(\d+)\s*(?:minuti|min))?\b/,
      (m) => parseFloat(m[1].replace(',', '.')) * 60 + Number(m[2] ?? 0),
    ],
    [/\bun'?\s?ora\s+e\s+mezz[ao]\b/, () => 90],
    [/\bun'?\s?ora\b/, () => 60],
    [/\bmezz'?\s?ora\b/, () => 30],
    [/\bun quarto d'ora\b/, () => 15],
    [/\b(\d+)\s*(?:minuti|min)\b/, (m) => Number(m[1])],
  ];
  for (const [pattern, toMinutes] of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const minutes = Math.round(toMinutes(match));
      if (minutes > 0) {
        const explicit = /\bper\s+$/.test(text.slice(0, match.index));
        return { index: match.index, length: match[0].length, minutes, explicit };
      }
    }
  }
  return null;
}

function findDate(text: string, baseDate: string): DateMatch | null {
  const relative: [RegExp, number][] = [
    [/\bdopodomani\b/, 2],
    [/\bdomani\b/, 1],
    [/\b(?:oggi|stasera|stamattina|stamani)\b/, 0],
  ];
  for (const [pattern, offset] of relative) {
    const match = pattern.exec(text);
    if (match) {
      return { index: match.index, length: match[0].length, dateString: addDays(baseDate, offset) };
    }
  }

  const weekday = new RegExp(String.raw`\b(?:(?:il|la|di|per)\s+)?(${WEEKDAYS.join('|')})(?!\w)`).exec(text);
  if (weekday) {
    const target = WEEKDAYS.findIndex((day) => new RegExp(`^${day}$`).test(weekday[1]));
    const current = parseDateString(baseDate).getDay();
    // Next occurrence, never today: "lunedì" said on a Monday means next week
    const offset = (target - current + 7) % 7 || 7;
    return { index: weekday.index, length: weekday[0].length, dateString: addDays(baseDate, offset) };
  }
  return null;
}

function matchesStem(text: string, stems: string[]): boolean {
  return stems.some((stem) => new RegExp(`(?:^|[^\\p{L}])${stem}`, 'u').test(text));
}

function findCategory(text: string): TaskCategory | undefined {
  return CATEGORY_KEYWORDS.find(([, stems]) => matchesStem(text, stems))?.[0];
}

function detectCategory(text: string): TaskCategory {
  return findCategory(text) ?? 'personal';
}

/** The title left after removing the matched expressions and filler words; empty if nothing is left. */
function cleanTitle(text: string, matches: Match[]): string {
  let title = text;
  // Remove from the end so earlier indexes stay valid
  for (const { index, length } of [...matches].sort((a, b) => b.index - a.index)) {
    title = `${title.slice(0, index)} ${title.slice(index + length)}`;
  }
  title = title.replace(/\s+/g, ' ').replace(/^[\s\-:.,;!?]+|[\s\-:.,;!?]+$/g, '');

  let previous: string;
  do {
    previous = title;
    title = title
      .replace(LEADING_CONJUNCTION, '')
      .replace(LEADING_NEGATION, '')
      .replace(LEADING_FILLER, '')
      .replace(LEADING_ARTICLE, '')
      .replace(/^(?:per|a|ad)\s+/i, '')
      .replace(TRAILING_CONNECTOR, '')
      .trim();
  } while (title !== previous);

  return title && title.charAt(0).toUpperCase() + title.slice(1);
}

function parseSegment(segment: string, baseDate: string): ParsedSegment {
  // Same length as `segment`, so match indexes can be used on the original text
  const original = segment.toLowerCase();
  const matches: Match[] = [];
  let text = original;
  const consume = <T extends Match>(match: T | null): T | null => {
    if (match) {
      matches.push(match);
      text = blank(text, match);
    }
    return match;
  };

  const travel = TRAVEL_PATTERN.exec(text);
  consume(travel && { index: travel.index, length: travel[0].length });
  const excluded = findExcludedTime(text, original);
  if (excluded) {
    consume(excluded.match);
    const negation = NEGATION_PATTERN.exec(text);
    consume(negation && { index: negation.index, length: negation[0].length });
  }
  const range = excluded ? null : consume(findRange(text, original));
  const { window, matches: windowMatches }: { window: TimeWindow; matches: Match[] } = range
    ? { window: {}, matches: [] }
    : findWindow(text, original);
  windowMatches.forEach(consume);
  if (excluded) {
    window.minStartMinutes = Math.max(window.minStartMinutes ?? 0, excluded.minStartMinutes);
  }
  const time = range ?? consume(findSingleTime(text, original));
  const duration = consume(findDuration(text));
  const date = consume(findDate(text, baseDate));

  const title = cleanTitle(segment, matches);
  if (!title && !time) {
    return { item: null, explicitDuration: false, window, dateString: date?.dateString };
  }

  const category = detectCategory(text);
  const isMealOrTravel = matchesStem(text, MEAL_OR_TRAVEL_STEMS);
  const minMinutes = isMealOrTravel && !duration?.explicit ? MIN_MEAL_OR_TRAVEL_MINUTES : 0;
  const dateString = date?.dateString ?? baseDate;

  if (time) {
    const minutes = Math.max(duration?.minutes ?? DEFAULT_FIXED_MINUTES, minMinutes);
    return {
      item: {
        title: title || 'Nuovo impegno',
        type: 'fixed',
        category,
        fixedStartTime: combineDateAndMinutes(dateString, time.startMinutes),
        fixedEndTime: combineDateAndMinutes(dateString, time.endMinutes ?? time.startMinutes + minutes),
        status: 'pending',
      },
      explicitDuration: duration !== null,
      window,
    };
  }

  return {
    item: {
      title,
      type: 'flexible',
      category,
      estimatedMinutes: Math.max(duration?.minutes ?? DEFAULT_FLEXIBLE_MINUTES[category], minMinutes),
      scheduledDate: dateString,
      status: 'pending',
    },
    explicitDuration: duration !== null,
    window,
  };
}

/** Applies a window to a flexible task; fixed events already have their times. */
function applyWindow(item: Partial<CalendarItem>, { minStartMinutes, maxStartMinutes, maxEndMinutes }: TimeWindow): void {
  if (item.type !== 'flexible') return;
  if (minStartMinutes !== undefined) item.minStartTime = minutesToTime(minStartMinutes);
  const latestEnd =
    maxStartMinutes !== undefined && item.estimatedMinutes ? maxStartMinutes + item.estimatedMinutes : undefined;
  const maxEnd = Math.min(maxEndMinutes ?? Infinity, latestEnd ?? Infinity);
  if (maxEnd !== Infinity) item.maxEndTime = minutesToTime(maxEnd);
}

/**
 * Turns free text into draft calendar items, one per clause
 * ("riunione dalle 10 alle 11, poi studiare per 2 ore").
 * Clauses with an explicit time become fixed events, the others flexible tasks.
 * Clauses with only a constraint ("dopo le 15") apply to the previous task,
 * and context clauses ("ora mi trovo a casa") are ignored.
 * `baseDate` ("YYYY-MM-DD") is the day relative words like "domani" refer to.
 */
export function parseInputToTasks(text: string, baseDate = toDateString(new Date())): ParseResult {
  const rawText = text.trim();
  const cleaned = CONTEXT_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, ','),
    rawText.replace(/[‘’]/g, "'"),
  );

  const items: Partial<CalendarItem>[] = [];
  const explicitDuration: boolean[] = [];
  // Constraints written before any task ("dopo le 15, fare la spesa")
  let pending: ParsedSegment[] = [];

  for (const segment of cleaned.split(SEGMENT_SEPARATOR)) {
    if (!segment.trim()) continue;
    const parsed = parseSegment(segment.trim(), baseDate);
    const previous = items[items.length - 1];

    if (!parsed.item) {
      if (previous) {
        applyWindow(previous, parsed.window);
        if (parsed.dateString && previous.type === 'flexible') previous.scheduledDate = parsed.dateString;
      } else {
        pending.push(parsed);
      }
      continue;
    }

    for (const constraint of pending) {
      applyWindow(parsed.item, constraint.window);
      if (constraint.dateString && parsed.item.type === 'flexible') parsed.item.scheduledDate = constraint.dateString;
    }
    pending = [];
    applyWindow(parsed.item, parsed.window);
    items.push(parsed.item);
    explicitDuration.push(parsed.explicitDuration);
  }
  return { items, explicitDuration, rawText };
}

/** The task named in the text once the given spans are removed; null if none ("tutto", or nothing left). */
function extractReference(text: string, matches: Match[]): TaskReference | null {
  const clean = (part: string) => {
    let query = part.trim();
    let previous: string;
    do {
      previous = query;
      query = query
        .replace(LEADING_CONJUNCTION, '')
        .replace(REFERENCE_FILLER, '')
        .replace(LEADING_ARTICLE, '')
        .trim();
    } while (query !== previous);
    return query;
  };
  // "mangiare, magari ..." -> the first clause that names something
  const query = cleanTitle(text, matches).split(/\s*[,;]\s*/).map(clean).find(Boolean);
  if (!query || ALL_ACTIVITIES.test(query)) {
    return null;
  }
  return { query, category: findCategory(query.toLowerCase()) };
}

/**
 * Classifies the text as a new task, a longer duration for an existing task,
 * or a delay of an existing task (or of everything that follows).
 * `baseDate` ("YYYY-MM-DD") is the day relative words like "domani" refer to.
 */
export function parseIntent(text: string, baseDate = toDateString(new Date())): IntentResult {
  const rawText = text.trim();
  const normalized = rawText.replace(/[\u2018\u2019]/g, "'");
  const lower = normalized.toLowerCase();
  const isDelay = DELAY_PATTERNS.some((pattern) => pattern.test(lower));
  const isExtend = !isDelay && EXTEND_PATTERNS.some((pattern) => pattern.test(lower));
  if (!isDelay && !isExtend) {
    return { intent: 'CREATE_TASK', ...parseInputToTasks(rawText, baseDate) };
  }

  const matches: Match[] = [];
  let remaining = lower;
  const consume = (match: Match | null) => {
    if (match) {
      matches.push(match);
      remaining = blank(remaining, match);
    }
  };
  for (const pattern of isDelay ? DELAY_PATTERNS : EXTEND_PATTERNS) {
    const match = pattern.exec(remaining);
    consume(match && { index: match.index, length: match[0].length });
  }
  // Only today's agenda can be changed: drop day words from the task name
  consume(findDate(remaining, baseDate));

  if (isExtend) {
    const duration = findDuration(remaining);
    consume(duration);
    return {
      intent: 'EXTEND_TASK',
      target: extractReference(normalized, matches),
      extraMinutes: duration?.minutes ?? DEFAULT_EXTENSION_MINUTES,
      rawText,
    };
  }

  // The new earliest start is the latest of: an excluded time (+15 min), a window start, other times
  const minStarts: number[] = [];
  const excluded = findExcludedTime(remaining, lower);
  if (excluded) {
    consume(excluded.match);
    minStarts.push(excluded.minStartMinutes);
  }
  const between = findBetween(remaining, lower);
  if (between) {
    consume(between.match);
    if (between.window.minStartMinutes !== undefined) minStarts.push(between.window.minStartMinutes);
  }
  for (const match of [...remaining.matchAll(DELAY_TIME_PATTERN)]) {
    const clock = parseClock(match[1], lower);
    if (clock) {
      minStarts.push(clock.last);
    }
    consume({ index: match.index, length: match[0].length });
  }
  const minStartMinutes = minStarts.length ? Math.max(...minStarts) : undefined;
  const duration = minStartMinutes === undefined ? findDuration(remaining) : null;
  consume(duration);
  const toTime = (minutes: number | undefined) => (minutes !== undefined ? minutesToTime(minutes) : undefined);

  return {
    intent: 'RESCHEDULE_DELAY',
    target: extractReference(normalized, matches),
    minStartTime: toTime(minStartMinutes),
    latestStartTime: toTime(between?.window.maxStartMinutes),
    maxEndTime: toTime(between?.window.maxEndMinutes),
    delayMinutes: minStartMinutes === undefined ? (duration?.minutes ?? DEFAULT_DELAY_MINUTES) : undefined,
    negated: NEGATION_PATTERN.test(lower),
    rawText,
  };
}

/** Meaningful word stems of a task title, with synonyms merged ("mangiare" and "pranzo" are the same) */
function taskStems(text: string): string[] {
  const stems = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, 5))
    .filter((stem) => !GENERIC_STEMS.has(stem))
    .map((stem) => SYNONYM_STEMS[stem] ?? stem);
  return [...new Set(stems)];
}

export interface TaskMatch {
  /** Words of the query found in the title */
  matched: number;
  queryWords: number;
  titleWords: number;
}

/** How many meaningful words a reference ("lo studio") shares with a task title ("Studiare") */
export function matchTaskWords(query: string, title: string): TaskMatch {
  const queryStems = taskStems(query);
  const titleStems = taskStems(title);
  const matched = queryStems.filter((stem) =>
    titleStems.some((titleStem) => titleStem.startsWith(stem) || stem.startsWith(titleStem)),
  ).length;
  return { matched, queryWords: queryStems.length, titleWords: titleStems.length };
}

/**
 * True if two titles name the same task: all the meaningful words of one appear in the other
 * ("Mangiare" / "Pranzo", but not "Chiamare Marco" / "Chiamare la nonna").
 */
export function isSameTask(titleA: string, titleB: string): boolean {
  const { matched, queryWords, titleWords } = matchTaskWords(titleA, titleB);
  return matched > 0 && (matched === queryWords || matched === titleWords);
}
