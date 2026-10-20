import { CircleCheck, Clock, RotateCcw, Trash, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CalendarItem } from '../types';
import { getItemTimeRange } from '../utils/items';
import { CATEGORY_LABELS } from '../utils/labels';
import { formatDuration, formatTimeOfDay } from '../utils/time';

interface ItemActionsModalProps {
  /** The item tapped in the timeline; null hides the modal */
  item: CalendarItem | null;
  busy?: boolean;
  onToggleCompleted: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onClose: () => void;
}

export function ItemActionsModal({ item, busy = false, onToggleCompleted, onDelete, onClose }: ItemActionsModalProps) {
  const insets = useSafeAreaInsets();
  // Deleting can't be undone: the first tap asks for confirmation
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [item?.id]);

  const range = item && getItemTimeRange(item);
  const isCompleted = item?.status === 'completed';

  return (
    <Modal visible={item !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onClose} disabled={busy} />
        {item && (
          <View className="rounded-t-3xl bg-white px-5 pt-5" style={{ paddingBottom: insets.bottom + 16 }}>
            <View className="mb-1 flex-row items-start gap-2">
              <Text className={`flex-1 text-lg font-bold text-slate-900 ${isCompleted ? 'line-through' : ''}`}>
                {item.title}
              </Text>
              <Pressable onPress={onClose} disabled={busy} accessibilityLabel="Chiudi" hitSlop={8}>
                <X color="#64748b" size={20} />
              </Pressable>
            </View>
            <View className="mb-5 flex-row items-center gap-1.5">
              <Clock color="#64748b" size={14} />
              <Text className="text-sm text-slate-500">
                {range
                  ? `${formatTimeOfDay(range.start)} – ${formatTimeOfDay(range.end)}`
                  : `Da pianificare${item.estimatedMinutes ? ` · ${formatDuration(item.estimatedMinutes)}` : ''}`}
                {` · ${item.type === 'fixed' ? 'Fisso' : 'Flessibile'} · ${CATEGORY_LABELS[item.category]}`}
              </Text>
            </View>

            <Pressable
              onPress={() => onToggleCompleted(item)}
              disabled={busy}
              className="mb-3 flex-row items-center justify-center gap-2 rounded-2xl border border-slate-300 py-3.5 active:bg-slate-100"
            >
              {isCompleted ? <RotateCcw color="#334155" size={18} /> : <CircleCheck color="#16a34a" size={18} />}
              <Text className="font-semibold text-slate-700">
                {isCompleted ? 'Segna come da fare' : 'Segna come completato'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => (confirmingDelete ? onDelete(item) : setConfirmingDelete(true))}
              disabled={busy}
              accessibilityLabel={confirmingDelete ? 'Conferma eliminazione' : 'Elimina impegno'}
              className={`flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${
                confirmingDelete ? 'bg-red-600 active:bg-red-700' : 'border border-red-200 bg-red-50 active:bg-red-100'
              }`}
            >
              {busy ? (
                <ActivityIndicator color={confirmingDelete ? '#ffffff' : '#dc2626'} />
              ) : (
                <>
                  <Trash color={confirmingDelete ? '#ffffff' : '#dc2626'} size={18} />
                  <Text className={`font-semibold ${confirmingDelete ? 'text-white' : 'text-red-600'}`}>
                    {confirmingDelete ? 'Tocca di nuovo per eliminare' : 'Elimina impegno'}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
