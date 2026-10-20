import { CircleCheck, Sparkles } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';

import type { CalendarItem } from '../types';
import { getItemTimeRange } from '../utils/items';
import { formatTimeOfDay } from '../utils/time';

type CardVariant = 'fixed' | 'proposed' | 'flexible' | 'completed';

interface TaskCardProps {
  item: CalendarItem;
  /** Single-line layout for short events */
  compact?: boolean;
  onPress?: (item: CalendarItem) => void;
}

const VARIANT_CLASSES: Record<CardVariant, { card: string; title: string; time: string }> = {
  fixed: { card: 'bg-blue-600', title: 'text-white', time: 'text-blue-100' },
  proposed: {
    card: 'border-2 border-dashed border-violet-500 bg-violet-50',
    title: 'text-violet-900',
    time: 'text-violet-700',
  },
  flexible: { card: 'bg-violet-500', title: 'text-white', time: 'text-violet-100' },
  completed: { card: 'border border-slate-200 bg-slate-100', title: 'text-slate-400 line-through', time: 'text-slate-400' },
};

function getVariant(item: CalendarItem): CardVariant {
  if (item.status === 'completed') return 'completed';
  if (item.type === 'fixed') return 'fixed';
  return item.status === 'proposed' ? 'proposed' : 'flexible';
}

export function TaskCard({ item, compact = false, onPress }: TaskCardProps) {
  const variant = getVariant(item);
  const classes = VARIANT_CLASSES[variant];
  const range = getItemTimeRange(item);
  const timeLabel = range ? `${formatTimeOfDay(range.start)} – ${formatTimeOfDay(range.end)}` : null;

  return (
    <Pressable
      onPress={onPress && (() => onPress(item))}
      disabled={!onPress}
      className={`h-full overflow-hidden rounded-xl px-3 ${compact ? 'justify-center py-1' : 'py-2'} ${classes.card}`}
    >
      <View className="flex-row items-center gap-1.5">
        {variant === 'completed' && <CircleCheck color="#16a34a" size={16} />}
        <Text numberOfLines={1} className={`flex-1 text-sm font-semibold ${classes.title}`}>
          {item.title}
        </Text>
        {variant === 'fixed' && (
          <View className="rounded-full bg-white/20 px-2 py-0.5">
            <Text className="text-[10px] font-bold uppercase text-white">Fisso</Text>
          </View>
        )}
        {compact && timeLabel && variant !== 'proposed' && (
          <Text className={`text-xs ${classes.time}`}>{timeLabel}</Text>
        )}
      </View>

      {variant === 'proposed' && timeLabel ? (
        <View className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-violet-600 px-2 py-0.5">
          <Sparkles color="#ffffff" size={11} />
          <Text className="text-[11px] font-semibold text-white">Suggerito {timeLabel}</Text>
        </View>
      ) : (
        !compact && timeLabel && <Text className={`mt-0.5 text-xs ${classes.time}`}>{timeLabel}</Text>
      )}
    </Pressable>
  );
}
