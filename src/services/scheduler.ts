import type { CalendarItem, CalendarItemStatus, DailySlot, TaskCategory } from '../types';
import { generateId } from '../utils/id';
import { getItemTimeRange } from '../utils/items';
import {
  addDays,
  combineDateAndMinutes,
  minutesFromDayStart,
  minutesToTime,
  timeToMinutes,
} from '../utils/time';

export interface SchedulerOptions {
  dayStart?: string;
  dayEnd?: string;
  intervalMinutes?: number;
  /** "HH:mm": no task is placed before this time (e.g. now, when planning today) */
  earliestStartTime?: string;
}

export interface FreeGap {
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

export interface FitResult {
  /** Tasks placed in the day, with proposed times and status 'proposed' */
  scheduled: CalendarItem[];
  /** Tasks that didn't fit (no free gap large enough within their time window, or missing estimatedMinutes) */
  unscheduled: CalendarItem[];
  /** The day's grid after placement */
  slots: DailySlot[];
}

export interface ReflowResult {
  /** Flexible tasks whose times changed, with the new proposed times */
  moved: CalendarItem[];
  /** Flexible tasks that no longer fit in the day */
  unscheduled: CalendarItem[];
}

/** Flexible tasks the scheduler may move; in-progress and completed ones stay where they are */
const MOVABLE_STATUSES: CalendarItemStatus[] = ['pending', 'proposed', 'confirmed'];

export function generateTimeSlots(dayStart = '08:00', dayEnd = '22:00', intervalMinutes = 15): DailySlot[] {
  if (intervalMinutes <= 0) {
    throw new Error('intervalMinutes must be greater than 0');
  }
  const slots: DailySlot[] = [];
  const end = timeToMinutes(dayEnd);
  for (let start = timeToMinutes(dayStart); start + intervalMinutes <= end; start += intervalMinutes) {
    slots.push({
      startTime: minutesToTime(start),
      endTime: minutesToTime(start + intervalMinutes),
      isOccupied: false,
    });
  }
  return slots;
}

/** Marks every slot overlapping [startMinutes, endMinutes) as occupied. */
function markOccupied(slots: DailySlot[], startMinutes: number, endMinutes: number, itemId?: string): void {
  for (const slot of slots) {
    if (timeToMinutes(slot.startTime) < endMinutes && timeToMinutes(slot.endTime) > startMinutes) {
      slot.isOccupied = true;
      slot.itemId ??= itemId;
    }
  }
}

/** True if [startMinutes, endMinutes) is inside the grid and all its slots are free. */
function isFree(slots: DailySlot[], startMinutes: number, endMinutes: number): boolean {
  if (!slots.length || startMinutes < timeToMinutes(slots[0].startTime)) return false;
  if (endMinutes > timeToMinutes(slots[slots.length - 1].endTime)) return false;
  return slots.every(
    (slot) =>
      !slot.isOccupied || timeToMinutes(slot.startTime) >= endMinutes || timeToMinutes(slot.endTime) <= startMinutes,
  );
}

/** Rounds minutes up to the next slot boundary of a grid starting at `dayStart`. */
function alignToGrid(minutes: number, dayStart: string, intervalMinutes: number): number {
  const gridStart = timeToMinutes(dayStart);
  return gridStart + Math.ceil((minutes - gridStart) / intervalMinutes) * intervalMinutes;
}

/** Runs of consecutive free slots, in chronological order. */
export function findFreeGaps(slots: DailySlot[]): FreeGap[] {
  const gaps: FreeGap[] = [];
  let current: FreeGap | null = null;
  for (const slot of slots) {
    if (slot.isOccupied) {
      current = null;
    } else if (current && current.endTime === slot.startTime) {
      current.endTime = slot.endTime;
      current.durationMinutes = timeToMinutes(current.endTime) - timeToMinutes(current.startTime);
    } else {
      current = {
        startTime: slot.startTime,
        endTime: slot.endTime,
        durationMinutes: timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime),
      };
      gaps.push(current);
    }
  }
  return gaps;
}

/** Earliest start inside a free gap such that the task fits in the gap and in [minStart, maxEnd]. */
function findStart(gaps: FreeGap[], duration: number, minStart: number, maxEnd: number): number | null {
  for (const gap of gaps) {
    const start = Math.max(timeToMinutes(gap.startTime), minStart);
    const end = start + duration;
    if (end <= timeToMinutes(gap.endTime) && end <= maxEnd) {
      return start;
    }
  }
  return null;
}

/**
 * Places flexible tasks, in the given order, at the earliest free time long enough for them
 * that respects their `minStartTime` / `maxEndTime` window.
 * Fixed events and flexible tasks that already have proposed times block their slots.
 */
export function fitFlexibleTasks(
  existingItems: CalendarItem[],
  newTasks: CalendarItem[],
  dateString: string,
  { dayStart = '08:00', dayEnd = '22:00', intervalMinutes = 15, earliestStartTime }: SchedulerOptions = {},
): FitResult {
  const slots = generateTimeSlots(dayStart, dayEnd, intervalMinutes);
  if (earliestStartTime) {
    markOccupied(slots, 0, timeToMinutes(earliestStartTime));
  }
  // Tasks being (re)scheduled must not block themselves
  const newTaskIds = new Set(newTasks.map((task) => task.id));

  for (const item of existingItems) {
    const range = getItemTimeRange(item);
    if (range && !newTaskIds.has(item.id)) {
      markOccupied(
        slots,
        minutesFromDayStart(range.start, dateString),
        minutesFromDayStart(range.end, dateString),
        item.id,
      );
    }
  }

  const scheduled: CalendarItem[] = [];
  const unscheduled: CalendarItem[] = [];

  for (const task of newTasks) {
    const duration = task.estimatedMinutes;
    const start =
      task.type === 'flexible' && duration && duration > 0
        ? findStart(
            findFreeGaps(slots),
            duration,
            task.minStartTime ? alignToGrid(timeToMinutes(task.minStartTime), dayStart, intervalMinutes) : -Infinity,
            task.maxEndTime ? timeToMinutes(task.maxEndTime) : Infinity,
          )
        : null;
    if (start === null || !duration) {
      unscheduled.push(task);
      continue;
    }
    markOccupied(slots, start, start + duration, task.id);
    scheduled.push({
      ...task,
      scheduledDate: dateString,
      proposedStartTime: combineDateAndMinutes(dateString, start),
      proposedEndTime: combineDateAndMinutes(dateString, start + duration),
      status: 'proposed',
    });
  }

  return { scheduled, unscheduled, slots };
}

/**
 * Re-places the day's flexible tasks after a change (an event extended or moved, a new `minStartTime`).
 * Fixed events, in-progress/completed tasks and tasks before `earliestStartTime` stay where they are.
 * The other flexible tasks, in their current order, keep their time if it's still free and inside
 * their window; otherwise they're pushed forward to the first free time that fits.
 */
export function reflowDay(
  items: CalendarItem[],
  dateString: string,
  { dayStart = '08:00', dayEnd = '22:00', intervalMinutes = 15, earliestStartTime }: SchedulerOptions = {},
): ReflowResult {
  const slots = generateTimeSlots(dayStart, dayEnd, intervalMinutes);
  const earliest = earliestStartTime ? timeToMinutes(earliestStartTime) : -Infinity;
  if (earliestStartTime) {
    markOccupied(slots, 0, earliest);
  }

  const timed = items.flatMap((item) => {
    const range = getItemTimeRange(item);
    return range
      ? [{ item, start: minutesFromDayStart(range.start, dateString), end: minutesFromDayStart(range.end, dateString) }]
      : [];
  });
  const isMovable = ({ item, start }: (typeof timed)[number]) =>
    item.type === 'flexible' && MOVABLE_STATUSES.includes(item.status) && start >= earliest;

  for (const entry of timed) {
    if (!isMovable(entry)) {
      markOccupied(slots, entry.start, entry.end, entry.item.id);
    }
  }

  const moved: CalendarItem[] = [];
  const unscheduled: CalendarItem[] = [];

  for (const { item, start, end } of timed.filter(isMovable).sort((a, b) => a.start - b.start)) {
    const duration = item.estimatedMinutes ?? end - start;
    const minStart = item.minStartTime
      ? alignToGrid(timeToMinutes(item.minStartTime), dayStart, intervalMinutes)
      : -Infinity;
    const maxEnd = item.maxEndTime ? timeToMinutes(item.maxEndTime) : Infinity;
    const fitsInPlace = start >= minStart && start + duration <= maxEnd && isFree(slots, start, start + duration);
    const newStart = fitsInPlace
      ? start
      : findStart(
          findFreeGaps(slots),
          duration,
          Math.max(minStart, alignToGrid(start, dayStart, intervalMinutes)),
          maxEnd,
        );
    if (newStart === null) {
      unscheduled.push(item);
      continue;
    }
    markOccupied(slots, newStart, newStart + duration, item.id);
    if (newStart !== start || newStart + duration !== end) {
      moved.push({
        ...item,
        proposedStartTime: combineDateAndMinutes(dateString, newStart),
        proposedEndTime: combineDateAndMinutes(dateString, newStart + duration),
      });
    }
  }

  return { moved, unscheduled };
}

/**
 * Splits a large goal (e.g. 500 pages) into one flexible task per day starting from `startDate`
 * (e.g. 50 pages/day for 10 days). The last day gets the remainder.
 * With `minutesPerUnit`, each task also gets an `estimatedMinutes` so it can be fitted in the day.
 */
export function partitionGoal(
  title: string,
  category: TaskCategory,
  totalUnits: number,
  unitsPerDay: number,
  startDate: string,
  minutesPerUnit?: number,
): CalendarItem[] {
  if (totalUnits <= 0 || unitsPerDay <= 0) {
    throw new Error('totalUnits and unitsPerDay must be greater than 0');
  }
  const days = Math.ceil(totalUnits / unitsPerDay);
  const createdAt = new Date().toISOString();

  return Array.from({ length: days }, (_, dayIndex) => {
    const units = Math.min(unitsPerDay, totalUnits - dayIndex * unitsPerDay);
    return {
      id: generateId(),
      title: `${title} (${dayIndex + 1}/${days})`,
      type: 'flexible',
      category,
      totalUnits: units,
      completedUnits: 0,
      estimatedMinutes: minutesPerUnit ? Math.ceil(units * minutesPerUnit) : undefined,
      scheduledDate: addDays(startDate, dayIndex),
      status: 'pending',
      createdAt,
    };
  });
}
