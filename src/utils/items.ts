import type { CalendarItem } from '../types';
import { addDays, parseDateString } from './time';

export interface TimeRange {
  start: string;
  end: string;
}

/** Fixed events use their fixed times, flexible tasks their proposed times. */
export function getItemTimeRange(item: CalendarItem): TimeRange | null {
  const start = item.type === 'fixed' ? item.fixedStartTime : item.proposedStartTime;
  const end = item.type === 'fixed' ? item.fixedEndTime : item.proposedEndTime;
  return start && end ? { start, end } : null;
}

/** True if the item overlaps the given day, or is planned for it when it has no times yet. */
export function occursOnDate(item: CalendarItem, dateString: string): boolean {
  const range = getItemTimeRange(item);
  if (!range) {
    return item.scheduledDate === dateString;
  }
  const dayStart = parseDateString(dateString).getTime();
  const dayEnd = parseDateString(addDays(dateString, 1)).getTime();
  return new Date(range.start).getTime() < dayEnd && new Date(range.end).getTime() > dayStart;
}

/** Sorts by start time; items without times go last. */
export function compareByStartTime(a: CalendarItem, b: CalendarItem): number {
  const startA = getItemTimeRange(a)?.start;
  const startB = getItemTimeRange(b)?.start;
  if (!startA || !startB) {
    return startA ? -1 : startB ? 1 : 0;
  }
  return new Date(startA).getTime() - new Date(startB).getTime();
}
