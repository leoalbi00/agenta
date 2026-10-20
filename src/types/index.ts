export type EventType = 'fixed' | 'flexible';

export type TaskCategory = 'work' | 'study' | 'chores' | 'health' | 'personal';

export type CalendarItemStatus = 'pending' | 'proposed' | 'confirmed' | 'in_progress' | 'completed';

export interface CalendarItem {
  id: string;
  title: string;
  type: EventType;
  category: TaskCategory;
  /** ISO 8601 datetime, only for fixed events */
  fixedStartTime?: string;
  /** ISO 8601 datetime, only for fixed events */
  fixedEndTime?: string;
  /** Estimated duration of a flexible task */
  estimatedMinutes?: number;
  /** Total units for tasks split into parts (e.g. chapters, pages) */
  totalUnits?: number;
  completedUnits?: number;
  status: CalendarItemStatus;
  actualDurationMinutes?: number;
  /** ISO 8601 datetime */
  createdAt: string;
}

export interface DailySlot {
  /** "HH:mm" */
  startTime: string;
  /** "HH:mm" */
  endTime: string;
  isOccupied: boolean;
  itemId?: string;
}
