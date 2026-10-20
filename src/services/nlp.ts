import type { CalendarItem, TaskCategory } from '../types';
import { addDays, combineDateAndMinutes, parseDateString, toDateString } from '../utils/time';

export interface ParseResult {
  items: Partial<CalendarItem>[];
  rawText: string;
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

/** Word stems matched at the start of a word, checked in order */
const CATEGORY_KEYWORDS: [TaskCategory, string[]][] = [
  ['health', ['palestra', 'medic', 'dottor', 'dentist', 'allenament', 'allenarm', 'corsa', 'correre', 'yoga', 'pilates', 'visita', 'farmacia', 'nuot', 'cammin', 'fisioterap']],
  ['study', ['studi', 'esame', 'lezion', 'ripass', 'compit', 'corso', 'universit', 'libro', 'legger', 'pagin', 'capitol', 'tesi']],
  ['work', ['lavor', 'riunion', 'meeting', 'call', 'mail', 'email', 'client', 'progett', 'ufficio', 'report', 'presentazion', 'colloqui']],
  ['chores', ['spesa', 'pulir', 'pulizi', 'lavatric', 'bucato', 'cucinar', 'stirar', 'bollett', 'piatti', 'aspirapolvere', 'riordin', 'supermercato']],
];

const WEEKDAYS = ['domenica', 'luned[iì]', 'marted[iì]', 'mercoled[iì]', 'gioved[iì]', 'venerd[iì]', 'sabato'];

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?`;
const RANGE_PATTERNS = [
  new RegExp(String.raw`\b(?:dalle|dall'|da)\s*(?:ore\s+)?${TIME}\s*(?:alle|all'|a)\s*(?:ore\s+)?${TIME}\b`),
  /\b(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})\b/,
];
const SINGLE_TIME_PATTERN = new RegExp(String.raw`\b(?:alle|all'|verso le|ore)\s*(?:ore\s+)?${TIME}\b`);
const MIDDAY_PATTERN = /\b(?:a\s+)?mezzogiorno\b/;
const DAY_PART_PATTERN = /\b(?:di|del|della|in)\s+(?:mattina|mattino|pomeriggio|sera)\b/;

const SEGMENT_SEPARATOR = /[,;\n]+|\.\s+|\s+e poi\s+|\s+poi\s+/i;
const LEADING_FILLER = /^(?:(?:io|che|e)\s+)?(?:devo|dovrei|voglio|vorrei|bisogna|tocca|ho|avr[oò]|c'[eè]|ricordami di|ricordati di|ricorda di|mi serve)\s+/i;
const LEADING_ARTICLE = /^(?:un|una|uno|il|lo|la|i|gli|le)\s+|^l'/i;
const TRAILING_CONNECTOR = /\s+(?:per|di|da|a|e|in|verso|circa)$/i;

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
}

interface DateMatch extends Match {
  dateString: string;
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

function findTime(text: string): TimeMatch | null {
  for (const pattern of RANGE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const startMinutes = toDayMinutes(Number(match[1]), Number(match[2] ?? 0), text);
    let endMinutes = toDayMinutes(Number(match[3]), Number(match[4] ?? 0), text);
    if (startMinutes === null || endMinutes === null) continue;
    // "dalle 11 alle 1" -> 11:00-13:00
    if (endMinutes <= startMinutes && endMinutes + 12 * 60 > startMinutes && endMinutes < 12 * 60) {
      endMinutes += 12 * 60;
    }
    if (endMinutes <= startMinutes) {
      endMinutes = startMinutes + DEFAULT_FIXED_MINUTES;
    }
    return { index: match.index, length: match[0].length, startMinutes, endMinutes };
  }

  const single = SINGLE_TIME_PATTERN.exec(text);
  if (single) {
    const startMinutes = toDayMinutes(Number(single[1]), Number(single[2] ?? 0), text);
    if (startMinutes !== null) {
      return { index: single.index, length: single[0].length, startMinutes };
    }
  }

  const midday = MIDDAY_PATTERN.exec(text);
  return midday ? { index: midday.index, length: midday[0].length, startMinutes: 12 * 60 } : null;
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
        return { index: match.index, length: match[0].length, minutes };
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

function detectCategory(text: string): TaskCategory {
  for (const [category, stems] of CATEGORY_KEYWORDS) {
    if (stems.some((stem) => new RegExp(`(?:^|[^\\p{L}])${stem}`, 'u').test(text))) {
      return category;
    }
  }
  return 'personal';
}

function cleanTitle(text: string, matches: Match[]): string {
  let title = text;
  // Remove from the end so earlier indexes stay valid
  for (const { index, length } of [...matches].sort((a, b) => b.index - a.index)) {
    title = `${title.slice(0, index)} ${title.slice(index + length)}`;
  }
  title = title.replace(/\s+/g, ' ').replace(/^[\s\-:.!?]+|[\s\-:.!?]+$/g, '');

  let previous: string;
  do {
    previous = title;
    title = title
      .replace(LEADING_FILLER, '')
      .replace(LEADING_ARTICLE, '')
      .replace(/^per\s+/i, '')
      .replace(TRAILING_CONNECTOR, '')
      .trim();
  } while (title !== previous);

  return title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Nuovo impegno';
}

function parseSegment(segment: string, baseDate: string): Partial<CalendarItem> {
  // Same length as `segment`, so match indexes can be used on the original text
  const text = segment.toLowerCase();
  const time = findTime(text);
  const duration = findDuration(text);
  const date = findDate(text, baseDate);
  const dayPart = DAY_PART_PATTERN.exec(text);
  const dayPartMatch = dayPart && { index: dayPart.index, length: dayPart[0].length };
  const matches = [time, duration, date, dayPartMatch].filter((match): match is NonNullable<typeof match> => match !== null);

  const category = detectCategory(text);
  const title = cleanTitle(segment, matches);
  const dateString = date?.dateString ?? baseDate;

  if (time) {
    const endMinutes = time.endMinutes ?? time.startMinutes + (duration?.minutes ?? DEFAULT_FIXED_MINUTES);
    return {
      title,
      type: 'fixed',
      category,
      fixedStartTime: combineDateAndMinutes(dateString, time.startMinutes),
      fixedEndTime: combineDateAndMinutes(dateString, endMinutes),
      status: 'pending',
    };
  }

  return {
    title,
    type: 'flexible',
    category,
    estimatedMinutes: duration?.minutes ?? DEFAULT_FLEXIBLE_MINUTES[category],
    scheduledDate: dateString,
    status: 'pending',
  };
}

/**
 * Turns free text into draft calendar items, one per clause
 * ("riunione dalle 10 alle 11, poi studiare per 2 ore").
 * Clauses with an explicit time become fixed events, the others flexible tasks.
 * `baseDate` ("YYYY-MM-DD") is the day relative words like "domani" refer to.
 */
export function parseInputToTasks(text: string, baseDate = toDateString(new Date())): ParseResult {
  const rawText = text.trim();
  const items = rawText
    .replace(/[‘’]/g, "'")
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => parseSegment(segment, baseDate));
  return { items, rawText };
}
