import { addDays, parseDateString } from '../../utils/time';

/** A recognized expression's position in the clause */
export interface Span {
  index: number;
  length: number;
}

/** "14:30" -> both 14:30; "14:00/14:30" -> 14:00 and 14:30 */
export interface ClockRange {
  first: number;
  last: number;
}

export interface TimeWindow {
  minStartMinutes?: number;
  /** Latest start ("tra le 14/14:30"), turned into a latest end with the task duration */
  maxStartMinutes?: number;
  maxEndMinutes?: number;
}

/** Everything about time found in a clause, as said (interpretation is up to the caller) */
export interface TimeSlots {
  spans: Span[];
  /** "dalle 10 alle 11", "14:30-15:15" */
  range?: { start: number; end: number };
  /** "alle 15", "alle 14:00/14:30" */
  time?: ClockRange;
  /** "non riesco alle 13:30", "non alle 13" (needs the negation flag) */
  excluded?: ClockRange;
  /** "tra le 15 e le 18", "tra le 14/14:30" */
  between?: TimeWindow;
  /** "dopo le 15", "dalle 15 in poi", "non prima delle 15" */
  notBefore?: ClockRange;
  /** "prima delle 18", "entro le 18", "fino alle 18" */
  notAfter?: ClockRange;
  /** "dopo pranzo", "nel pomeriggio" */
  named?: TimeWindow;
  duration?: { minutes: number; explicit: boolean };
  /** "YYYY-MM-DD" for "domani", "lunedì"... */
  date?: string;
}

const WEEKDAYS = ['domenica', 'luned[iì]', 'marted[iì]', 'mercoled[iì]', 'gioved[iì]', 'venerd[iì]', 'sabato'];

/** A clock time, optionally with an alternative after a slash ("14:00/14:30") */
const TIME = String.raw`(\d{1,2}(?:[:.]\d{2})?(?:\s*\/\s*\d{1,2}(?:[:.]\d{2})?)?)`;
/** A time not followed by a unit, so "entro 2 ore" isn't read as "entro le 2" */
const CLOCK_TIME = String.raw`${TIME}(?!\s*(?:ore|ora|h|minuti|min)\b)`;

const RANGE_PATTERNS = [
  new RegExp(String.raw`\b(?:dalle|dall'|da)\s*(?:ore\s+)?${TIME}\s*(?:alle|all'|a)\s*(?:ore\s+)?${TIME}\b`),
  /\b(\d{1,2}[:.]\d{2})\s*-\s*(\d{1,2}[:.]\d{2})\b/,
];
const SINGLE_TIME_PATTERN = new RegExp(String.raw`\b(?:non\s+)?(?:alle|all'|verso le|per le|ore)\s*(?:ore\s+)?${CLOCK_TIME}`);
const MIDDAY_PATTERN = /\b(?:a\s+)?mezzogiorno\b/;
const BETWEEN_PATTERN = new RegExp(
  String.raw`\b(?:tra|fra)\s+le\s+(?:ore\s+)?${CLOCK_TIME}\s+e\s+le\s+(?:ore\s+)?${CLOCK_TIME}`,
);
const START_BETWEEN_PATTERN = new RegExp(String.raw`\b(?:tra|fra)\s+le\s+(?:ore\s+)?${CLOCK_TIME}(?!\s*e\s+le)`);
const NOT_BEFORE_PATTERN = new RegExp(
  String.raw`\b(?:non prima delle|non prima di|dopo le|dopo l'|a partire dalle|a partire dall'|dalle|dall')\s*(?:ore\s+)?${CLOCK_TIME}(?:\s+in poi)?`,
);
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
const DURATION_PATTERNS: [RegExp, (match: RegExpExecArray) => number][] = [
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

/** Clauses describing the situation rather than a task ("ora mi trovo a casa", "orario indefinito") */
const STOP_BEFORE_CONJUNCTION = String.raw`(?:(?!\s(?:e|ma|però|poi|quindi|devo|dovrei|voglio|vorrei|ho)\s)[^,;.\n])*`;
export const CONTEXT_PATTERNS = [
  new RegExp(String.raw`\b(?:(?:ora|adesso|attualmente|in questo momento)\s+)?mi trovo\b${STOP_BEFORE_CONJUNCTION}`, 'gi'),
  new RegExp(
    String.raw`\b(?:ora|adesso|attualmente|in questo momento)\s+(?:sono|sto)\s+(?:a|in|al|alla|allo|ai|da|dal|dalla|fuori)\b${STOP_BEFORE_CONJUNCTION}`,
    'gi',
  ),
  /\b(?:orario|ora)\s+(?:indefinit[oa]|non definit[oa]|libero|flessibile|qualsiasi|a scelta)\b/gi,
  /\bsenza\s+(?:un\s+)?orario(?:\s+(?:preciso|fisso|definito))?\b/gi,
  /\b(?:quando\s+(?:vuoi|capita|posso|riesco|ho tempo)|in qualsiasi momento|a qualsiasi ora|non importa (?:quando|l'orario|l'ora))\b/gi,
];

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

function findDate(text: string, baseDate: string): { span: Span; date: string } | null {
  const relative: [RegExp, number][] = [
    [/\bdopodomani\b/, 2],
    [/\bdomani\b/, 1],
    [/\b(?:oggi|stasera|stamattina|stamani)\b/, 0],
  ];
  for (const [pattern, offset] of relative) {
    const match = pattern.exec(text);
    if (match) {
      return { span: { index: match.index, length: match[0].length }, date: addDays(baseDate, offset) };
    }
  }
  const weekday = new RegExp(String.raw`\b(?:(?:il|la|di|per)\s+)?(${WEEKDAYS.join('|')})(?!\w)`).exec(text);
  if (weekday) {
    const target = WEEKDAYS.findIndex((day) => new RegExp(`^${day}$`).test(weekday[1]));
    const current = parseDateString(baseDate).getDay();
    // Next occurrence, never today: "lunedì" said on a Monday means next week
    const offset = (target - current + 7) % 7 || 7;
    return { span: { index: weekday.index, length: weekday[0].length }, date: addDays(baseDate, offset) };
  }
  return null;
}

/**
 * Finds the time expressions of a clause. Each recognized expression is blanked before looking
 * for the next one, so the same words are never read twice.
 * `negated` says whether the clause denies an ability ("non riesco"), making "alle X" an excluded time.
 */
export function findTimeSlots(clause: string, baseDate: string, negated: boolean): TimeSlots {
  // Same length as `clause`, so span indexes can be used on the original text
  const original = clause.toLowerCase();
  let text = original;
  const slots: TimeSlots = { spans: [] };
  const consume = (match: RegExpExecArray | null): RegExpExecArray | null => {
    if (match) {
      const span = { index: match.index, length: match[0].length };
      slots.spans.push(span);
      text = text.slice(0, span.index) + ' '.repeat(span.length) + text.slice(span.index + span.length);
    }
    return match;
  };

  consume(TRAVEL_PATTERN.exec(text));

  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(text);
    const start = match && parseClock(match[1], original);
    const end = match && parseClock(match[2], original);
    if (!match || !start || !end) continue;
    let endMinutes = end.last;
    // "dalle 11 alle 1" -> 11:00-13:00
    if (endMinutes <= start.first && endMinutes + 12 * 60 > start.first && endMinutes < 12 * 60) {
      endMinutes += 12 * 60;
    }
    if (endMinutes > start.first) {
      slots.range = { start: start.first, end: endMinutes };
      consume(match);
      break;
    }
  }

  const between = BETWEEN_PATTERN.exec(text);
  const startBetween = between ? null : START_BETWEEN_PATTERN.exec(text);
  if (between) {
    // With alternatives the most conservative bound is used
    slots.between = {
      minStartMinutes: parseClock(between[1], original)?.last,
      maxEndMinutes: parseClock(between[2], original)?.first,
    };
    consume(between);
  } else if (startBetween) {
    const clock = parseClock(startBetween[1], original);
    if (clock) {
      slots.between = { minStartMinutes: clock.first, maxStartMinutes: clock.last };
      consume(startBetween);
    }
  }

  const notBefore = NOT_BEFORE_PATTERN.exec(text);
  slots.notBefore = (notBefore && parseClock(notBefore[1], original)) ?? undefined;
  consume(notBefore);
  const notAfter = NOT_AFTER_PATTERN.exec(text);
  slots.notAfter = (notAfter && parseClock(notAfter[1], original)) ?? undefined;
  consume(notAfter);

  for (const [pattern, window] of NAMED_WINDOWS) {
    if (consume(pattern.exec(text))) {
      slots.named = {
        minStartMinutes: slots.named?.minStartMinutes ?? window.minStartMinutes,
        maxEndMinutes: slots.named?.maxEndMinutes ?? window.maxEndMinutes,
      };
    }
  }

  const single = SINGLE_TIME_PATTERN.exec(text);
  const clock = single && parseClock(single[1], original);
  if (single && clock) {
    // "non alle 13" excludes the time even without a verb
    if (negated || /^non\b/.test(single[0])) {
      slots.excluded = clock;
    } else {
      slots.time = clock;
    }
    consume(single);
  } else if (consume(MIDDAY_PATTERN.exec(text))) {
    slots.time = { first: 12 * 60, last: 12 * 60 };
  }

  for (const [pattern, toMinutes] of DURATION_PATTERNS) {
    const match = pattern.exec(text);
    const minutes = match && Math.round(toMinutes(match));
    if (match && minutes) {
      slots.duration = { minutes, explicit: /\bper\s+$/.test(text.slice(0, match.index)) };
      consume(match);
      break;
    }
  }

  const date = findDate(text, baseDate);
  if (date) {
    slots.date = date.date;
    slots.spans.push(date.span);
  }
  return slots;
}

/** True if the clause has any time expression */
export function hasTime(slots: TimeSlots): boolean {
  return Boolean(slots.range || slots.time || slots.excluded || slots.between || slots.notBefore || slots.notAfter);
}
