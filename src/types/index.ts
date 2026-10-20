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
  /** "YYYY-MM-DD": day a flexible task is planned for */
  scheduledDate?: string;
  /** ISO 8601 datetime proposed by the scheduler, only for flexible tasks */
  proposedStartTime?: string;
  /** ISO 8601 datetime proposed by the scheduler, only for flexible tasks */
  proposedEndTime?: string;
  /** "HH:mm": a flexible task can't be scheduled before this time ("dopo le 15") */
  minStartTime?: string;
  /** "HH:mm": a flexible task must end by this time ("prima delle 18") */
  maxEndTime?: string;
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
