import { ScrollView, Text, View } from 'react-native';

import type { CalendarItem } from '../types';
import { getItemTimeRange } from '../utils/items';
import { formatDuration, minutesFromDayStart, minutesToTime, timeToMinutes } from '../utils/time';
import { TaskCard } from './TaskCard';

const HOUR_HEIGHT = 96;
/** Smallest readable card: a single line with title and time */
const MIN_CARD_HEIGHT = 44;
/** Below this height cards switch to the single-line layout */
const COMPACT_CARD_HEIGHT = 64;
/** Vertical space between consecutive cards */
const CARD_GAP = 4;
const LABEL_WIDTH = 56;
/** Minutes covered by a card of minimum height: closer items are laid out side by side */
const MIN_CARD_MINUTES = (MIN_CARD_HEIGHT / HOUR_HEIGHT) * 60;

interface TimelineProps {
  items: CalendarItem[];
  /** "YYYY-MM-DD" of the day shown */
  date: string;
  dayStart?: string;
  dayEnd?: string;
  onItemPress?: (item: CalendarItem) => void;
}

interface PositionedItem {
  item: CalendarItem;
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/**
 * Positions timed items on the grid. Items that overlap on screen (also because short items
 * are drawn taller than their duration) share the width side by side instead of covering each other.
 */
function layoutItems(items: CalendarItem[], date: string, dayStartMinutes: number, dayEndMinutes: number) {
  const clamp = (minutes: number) => Math.min(Math.max(minutes, dayStartMinutes), dayEndMinutes);
  const timed = items
    .flatMap((item) => {
      const range = getItemTimeRange(item);
      if (!range) return [];
      const start = clamp(minutesFromDayStart(range.start, date));
      const end = clamp(minutesFromDayStart(range.end, date));
      // How far down the card reaches on screen, which can be past its real end
      const visualEnd = Math.max(end, start + MIN_CARD_MINUTES);
      return end > start ? [{ item, start, end, visualEnd }] : [];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const positioned: PositionedItem[] = [];
  let cluster: PositionedItem[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const closeCluster = () => cluster.forEach((entry) => (entry.lanes = laneEnds.length));

  for (const { item, start, end, visualEnd } of timed) {
    if (start >= clusterEnd) {
      closeCluster();
      cluster = [];
      laneEnds = [];
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(visualEnd);
    } else {
      laneEnds[lane] = visualEnd;
    }
    const entry: PositionedItem = {
      item,
      top: ((start - dayStartMinutes) / 60) * HOUR_HEIGHT,
      height: Math.max(((end - start) / 60) * HOUR_HEIGHT, MIN_CARD_HEIGHT),
      lane,
      lanes: 1,
    };
    cluster.push(entry);
    positioned.push(entry);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  closeCluster();
  return positioned;
}

export function Timeline({ items, date, dayStart = '08:00', dayEnd = '22:00', onItemPress }: TimelineProps) {
  const dayStartMinutes = timeToMinutes(dayStart);
  const dayEndMinutes = timeToMinutes(dayEnd);
  const hours = Array.from(
    { length: Math.floor((dayEndMinutes - dayStartMinutes) / 60) + 1 },
    (_, index) => dayStartMinutes + index * 60,
  );
  const positioned = layoutItems(items, date, dayStartMinutes, dayEndMinutes);
  const untimed = items.filter((item) => !getItemTimeRange(item));

  return (
    <View className="flex-1">
      {untimed.length > 0 && (
        <View className="border-b border-slate-200 px-4 pb-3">
          <Text className="mb-2 text-xs font-semibold uppercase text-slate-400">Da pianificare</Text>
          <View className="flex-row flex-wrap gap-2">
            {untimed.map((item) => (
              <View key={item.id} className="rounded-full bg-violet-100 px-3 py-1">
                <Text className="text-xs font-medium text-violet-800">
                  {item.title}
                  {item.estimatedMinutes ? ` · ${formatDuration(item.estimatedMinutes)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <ScrollView contentContainerClassName="px-4 pb-6 pt-3">
        <View style={{ height: (hours.length - 1) * HOUR_HEIGHT + 16 }}>
          {hours.map((minutes, index) => (
            <View
              key={minutes}
              className="absolute left-0 right-0 flex-row items-start"
              style={{ top: index * HOUR_HEIGHT - 7 }}
            >
              <Text className="text-xs text-slate-400" style={{ width: LABEL_WIDTH }}>
                {minutesToTime(minutes)}
              </Text>
              <View className="mt-[7px] h-px flex-1 bg-slate-200" />
            </View>
          ))}

          <View className="absolute bottom-0 right-0 top-0" style={{ left: LABEL_WIDTH }}>
            {positioned.map(({ item, top, height, lane, lanes }) => (
              <View
                key={item.id}
                className="absolute px-0.5"
                style={{ top, height, left: `${(lane / lanes) * 100}%`, width: `${100 / lanes}%` }}
              >
                <View className="flex-1" style={{ marginBottom: CARD_GAP }}>
                  <TaskCard
                    item={item}
                    compact={height < COMPACT_CARD_HEIGHT}
                    narrow={lanes > 1}
                    onPress={onItemPress}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
