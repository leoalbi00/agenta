import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CalendarItem, CalendarItemStatus } from '../types';
import { compareByStartTime, occursOnDate } from '../utils/items';

const STORAGE_KEY = '@smartagenda/items';

let writeQueue: Promise<unknown> = Promise.resolve();

/** Serializes read-modify-write operations so concurrent saves don't overwrite each other. */
function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation);
  writeQueue = result.catch(() => undefined);
  return result;
}

async function readItems(): Promise<CalendarItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as CalendarItem[]) : [];
}

async function writeItems(items: CalendarItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function getAllItems(): Promise<CalendarItem[]> {
  return readItems();
}

export async function getItemById(id: string): Promise<CalendarItem | null> {
  const items = await readItems();
  return items.find((item) => item.id === id) ?? null;
}

/** Items occurring on `dateString` ("YYYY-MM-DD"), sorted by start time. */
export async function getItemsByDate(dateString: string): Promise<CalendarItem[]> {
  const items = await readItems();
  return items.filter((item) => occursOnDate(item, dateString)).sort(compareByStartTime);
}

/** Inserts the items, or replaces those with an existing id. */
export function saveItems(newItems: CalendarItem[]): Promise<void> {
  return enqueueWrite(async () => {
    const itemsById = new Map((await readItems()).map((item) => [item.id, item]));
    for (const item of newItems) {
      itemsById.set(item.id, item);
    }
    await writeItems([...itemsById.values()]);
  });
}

export async function saveItem(item: CalendarItem): Promise<CalendarItem> {
  await saveItems([item]);
  return item;
}

/** Merges `changes` into the item. Returns the updated item, or null if not found. */
export function updateItem(
  id: string,
  changes: Partial<Omit<CalendarItem, 'id'>>,
): Promise<CalendarItem | null> {
  return enqueueWrite(async () => {
    const items = await readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return null;
    }
    items[index] = { ...items[index], ...changes };
    await writeItems(items);
    return items[index];
  });
}

export function updateItemStatus(id: string, status: CalendarItemStatus): Promise<CalendarItem | null> {
  return updateItem(id, { status });
}

/** Returns false if no item had that id. */
export function deleteItem(id: string): Promise<boolean> {
  return enqueueWrite(async () => {
    const items = await readItems();
    const remaining = items.filter((item) => item.id !== id);
    if (remaining.length === items.length) {
      return false;
    }
    await writeItems(remaining);
    return true;
  });
}

export function clearAllItems(): Promise<void> {
  return enqueueWrite(() => AsyncStorage.removeItem(STORAGE_KEY));
}

/** Deletes the items with these ids, in one write. */
export function deleteItems(ids: string[]): Promise<void> {
  return enqueueWrite(async () => {
    const items = await readItems();
    await writeItems(items.filter((item) => !ids.includes(item.id)));
  });
}
