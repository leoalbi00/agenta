import { ArrowRightLeft, Clock, Info, Sparkles, TriangleAlert } from 'lucide-react-native';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AgendaChange } from '../services/agenda';
import type { CalendarItem } from '../types';
import { formatTimeWindow, getItemTimeRange } from '../utils/items';
import { CATEGORY_LABELS } from '../utils/labels';
import { formatDayLabel, formatDuration, formatTimeOfDay } from '../utils/time';

interface ApprovalModalProps {
  visible: boolean;
  /** The sentence typed by the user */
  rawText: string;
  /** Items with a time, ready to be confirmed */
  items: CalendarItem[];
  /** Flexible tasks the scheduler couldn't fit: they are not saved */
  unscheduled: CalendarItem[];
  /** Changes to the existing agenda; when present they replace the list of items */
  changes?: AgendaChange[];
  notice?: string;
  saving?: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

function ProposalRow({ item }: { item: CalendarItem }) {
  const range = getItemTimeRange(item);
  const isFixed = item.type === 'fixed';
  const durationMinutes = item.estimatedMinutes ?? 0;
  const timeWindow = formatTimeWindow(item);

  return (
    <View
      className={`mb-2 rounded-2xl p-3 ${isFixed ? 'bg-blue-50' : 'border-2 border-dashed border-violet-400 bg-violet-50'}`}
    >
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-base font-semibold text-slate-900">{item.title}</Text>
        <View className={`rounded-full px-2 py-0.5 ${isFixed ? 'bg-blue-600' : 'bg-violet-600'}`}>
          <Text className="text-[10px] font-bold uppercase text-white">{isFixed ? 'Fisso' : 'Flessibile'}</Text>
        </View>
      </View>
      {range && (
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <Clock color={isFixed ? '#1d4ed8' : '#6d28d9'} size={14} />
          <Text className={`text-sm font-semibold ${isFixed ? 'text-blue-700' : 'text-violet-700'}`}>
            {formatDayLabel(range.start.slice(0, 10))} · {formatTimeOfDay(range.start)} – {formatTimeOfDay(range.end)}
          </Text>
        </View>
      )}
      <Text className="mt-1 text-xs text-slate-500">
        {CATEGORY_LABELS[item.category]} ·{' '}
        {isFixed
          ? "Orario indicato da te"
          : `Primo slot libero da ${formatDuration(durationMinutes)} trovato dallo scheduler`}
        {timeWindow && ` · ${timeWindow}`}
      </Text>
    </View>
  );
}

function describeChange({ kind, item, minutes }: AgendaChange): string {
  const range = getItemTimeRange(item);
  const start = range ? formatTimeOfDay(range.start) : '';
  switch (kind) {
    case 'moved':
      return `Riorganizzazione agenda: ${item.title} spostato alle ${start}`;
    case 'extended':
      return `${item.title} allungato di ${formatDuration(minutes ?? 0)}: ora ${start} – ${range ? formatTimeOfDay(range.end) : ''}`;
    case 'unscheduled':
      return `${item.title} non entra più nella giornata: torna tra i task da pianificare`;
    case 'conflict':
      return `${item.title} è un evento fisso alle ${start}: non lo sposto automaticamente`;
  }
}

function ChangeRow({ change }: { change: AgendaChange }) {
  const isWarning = change.kind === 'unscheduled' || change.kind === 'conflict';
  return (
    <View className={`mb-2 flex-row items-start gap-2 rounded-2xl p-3 ${isWarning ? 'bg-amber-50' : 'bg-violet-50'}`}>
      {isWarning ? <TriangleAlert color="#b45309" size={16} /> : <ArrowRightLeft color="#6d28d9" size={16} />}
      <Text className={`flex-1 text-sm font-medium ${isWarning ? 'text-amber-800' : 'text-violet-900'}`}>
        {describeChange(change)}
      </Text>
    </View>
  );
}

export function ApprovalModal({
  visible,
  rawText,
  items,
  unscheduled,
  changes = [],
  notice,
  saving = false,
  onAccept,
  onCancel,
}: ApprovalModalProps) {
  const insets = useSafeAreaInsets();
  const canAccept = items.length > 0 && !saving;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-end bg-black/50">
        <Pressable className="flex-1" onPress={onCancel} disabled={saving} />
        <View className="rounded-t-3xl bg-white px-5 pt-5" style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="mb-4 flex-row items-center gap-2">
            <Sparkles color="#4f46e5" size={20} />
            <Text className="text-lg font-bold text-slate-900">
              {changes.length ? 'Riorganizzazione agenda' : "Proposta dell'agenda"}
            </Text>
          </View>

          <Text className="mb-1 text-xs font-semibold uppercase text-slate-400">Hai scritto</Text>
          <View className="mb-4 rounded-xl bg-slate-100 px-3 py-2">
            <Text className="italic text-slate-700">“{rawText}”</Text>
          </View>

          <ScrollView style={{ maxHeight: 320 }}>
            {notice && (
              <View className="mb-2 flex-row items-start gap-2 rounded-2xl bg-slate-100 p-3">
                <Info color="#475569" size={16} />
                <Text className="flex-1 text-sm text-slate-700">{notice}</Text>
              </View>
            )}
            {changes.length
              ? changes.map((change) => <ChangeRow key={`${change.kind}-${change.item.id}`} change={change} />)
              : items.map((item) => <ProposalRow key={item.id} item={item} />)}

            {unscheduled.length > 0 && (
              <View className="mb-2 rounded-2xl bg-amber-50 p-3">
                <View className="mb-1 flex-row items-center gap-1.5">
                  <TriangleAlert color="#b45309" size={14} />
                  <Text className="text-sm font-semibold text-amber-800">Nessuno slot libero abbastanza lungo</Text>
                </View>
                {unscheduled.map((item) => (
                  <Text key={item.id} className="text-sm text-amber-800">
                    • {item.title}
                    {item.estimatedMinutes ? ` (${formatDuration(item.estimatedMinutes)})` : ''}
                    {formatTimeWindow(item) ? `, ${formatTimeWindow(item)}` : ''}
                  </Text>
                ))}
                <Text className="mt-1 text-xs text-amber-700">Questi task non verranno salvati.</Text>
              </View>
            )}
          </ScrollView>

          <View className="mt-3 flex-row gap-3">
            <Pressable
              onPress={onCancel}
              disabled={saving}
              className="flex-1 items-center rounded-2xl border border-slate-300 py-3.5 active:bg-slate-100"
            >
              <Text className="font-semibold text-slate-700">Annulla</Text>
            </Pressable>
            <Pressable
              onPress={onAccept}
              disabled={!canAccept}
              className={`flex-1 items-center rounded-2xl py-3.5 ${canAccept ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-indigo-300'}`}
            >
              {saving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text className="font-semibold text-white">Accetta e Salva</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
