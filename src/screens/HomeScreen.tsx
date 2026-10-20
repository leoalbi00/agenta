import { Mic, SendHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalModal } from '../components/ApprovalModal';
import { Timeline } from '../components/Timeline';
import { parseInputToTasks } from '../services/nlp';
import { fitFlexibleTasks } from '../services/scheduler';
import { getItemsByDate, saveItems, updateItemStatus } from '../services/storage';
import type { CalendarItem } from '../types';
import { generateId } from '../utils/id';
import { compareByStartTime, occursOnDate } from '../utils/items';
import { minutesToTime, parseDateString, toDateString } from '../utils/time';

const SCHEDULER_INTERVAL_MINUTES = 15;

interface Proposal {
  rawText: string;
  items: CalendarItem[];
  unscheduled: CalendarItem[];
}

/** The day a draft belongs to: fixed events by their start, flexible tasks by their planned day. */
function getDraftDate(item: CalendarItem, fallback: string): string {
  return item.type === 'fixed' && item.fixedStartTime ? item.fixedStartTime.slice(0, 10) : (item.scheduledDate ?? fallback);
}

/** Now, rounded up to the scheduler grid, so tasks aren't proposed in the past. */
function getEarliestStartToday(): string {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutesToTime(Math.ceil(minutes / SCHEDULER_INTERVAL_MINUTES) * SCHEDULER_INTERVAL_MINUTES);
}

export function HomeScreen() {
  const [date] = useState(() => toDateString(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [input, setInput] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);

  const loadItems = useCallback(async () => {
    try {
      setItems(await getItemsByDate(date));
    } catch {
      Alert.alert('Errore', 'Impossibile caricare gli impegni salvati.');
    }
  }, [date]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;

    const parsed = parseInputToTasks(text, date);
    const createdAt = new Date().toISOString();
    const drafts: CalendarItem[] = parsed.items.map((draft) => ({
      title: 'Nuovo impegno',
      type: 'flexible',
      category: 'personal',
      ...draft,
      id: generateId(),
      status: 'proposed',
      createdAt,
    }));

    try {
      const proposed: CalendarItem[] = [];
      const unscheduled: CalendarItem[] = [];
      const draftDates = [...new Set(drafts.map((draft) => getDraftDate(draft, date)))];

      for (const draftDate of draftDates) {
        const dayDrafts = drafts.filter((draft) => getDraftDate(draft, date) === draftDate);
        const fixed = dayDrafts.filter((draft) => draft.type === 'fixed');
        const existing = draftDate === date ? items : await getItemsByDate(draftDate);
        const result = fitFlexibleTasks(
          [...existing, ...fixed],
          dayDrafts.filter((draft) => draft.type === 'flexible'),
          draftDate,
          {
            intervalMinutes: SCHEDULER_INTERVAL_MINUTES,
            earliestStartTime: draftDate === toDateString(new Date()) ? getEarliestStartToday() : undefined,
          },
        );
        proposed.push(...fixed, ...result.scheduled);
        unscheduled.push(...result.unscheduled);
      }

      setProposal({ rawText: parsed.rawText, items: proposed.sort(compareByStartTime), unscheduled });
    } catch {
      Alert.alert('Errore', 'Impossibile calcolare la proposta.');
    }
  };

  const handleAccept = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await saveItems(proposal.items.map((item) => ({ ...item, status: 'confirmed' })));
      setProposal(null);
      setInput('');
      await loadItems();
    } catch {
      Alert.alert('Errore', 'Impossibile salvare gli impegni.');
    } finally {
      setSaving(false);
    }
  };

  const handleItemPress = async (item: CalendarItem) => {
    try {
      await updateItemStatus(item.id, item.status === 'completed' ? 'confirmed' : 'completed');
      await loadItems();
    } catch {
      Alert.alert('Errore', "Impossibile aggiornare l'impegno.");
    }
  };

  const handleMicPress = () => {
    inputRef.current?.focus();
    Alert.alert(
      'Dettatura vocale',
      'Il riconoscimento vocale integrato non è ancora disponibile: usa il microfono della tastiera iOS.',
    );
  };

  // While the modal is open, proposals for this day are previewed in the timeline
  const timelineItems = useMemo(() => {
    const previews = proposal?.items.filter((item) => occursOnDate(item, date)) ?? [];
    return [...items, ...previews];
  }, [items, proposal, date]);

  const dateLabel = parseDateString(date).toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <SafeAreaView className="flex-1 bg-slate-50" edges={['top', 'bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="px-4 pb-3 pt-2">
          <Text className="text-sm font-medium capitalize text-slate-500">{dateLabel}</Text>
          <Text className="text-3xl font-bold text-slate-900">SmartAgenda</Text>
        </View>

        <Timeline items={timelineItems} date={date} onItemPress={proposal ? undefined : handleItemPress} />

        <View className="flex-row items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
          <Pressable
            onPress={handleMicPress}
            accessibilityLabel="Dettatura vocale"
            className="rounded-full bg-slate-100 p-3 active:bg-slate-200"
          >
            <Mic color="#475569" size={20} />
          </Pressable>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSubmit}
            placeholder="Es. riunione dalle 10 alle 11, studiare per 2 ore"
            placeholderTextColor="#94a3b8"
            returnKeyType="send"
            className="flex-1 rounded-full bg-slate-100 px-4 py-3 text-base text-slate-900"
          />
          <Pressable
            onPress={handleSubmit}
            disabled={!input.trim()}
            accessibilityLabel="Invia"
            className={`rounded-full p-3 ${input.trim() ? 'bg-indigo-600 active:bg-indigo-700' : 'bg-indigo-200'}`}
          >
            <SendHorizontal color="#ffffff" size={20} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ApprovalModal
        visible={proposal !== null}
        rawText={proposal?.rawText ?? ''}
        items={proposal?.items ?? []}
        unscheduled={proposal?.unscheduled ?? []}
        saving={saving}
        onAccept={handleAccept}
        onCancel={() => setProposal(null)}
      />
    </SafeAreaView>
  );
}
