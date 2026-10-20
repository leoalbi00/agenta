import { Mic, SendHorizontal, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalModal } from '../components/ApprovalModal';
import { Timeline } from '../components/Timeline';
import { type AgendaProposal, planInput } from '../services/agenda';
import { getItemsByDate, saveItems, updateItemStatus } from '../services/storage';
import type { CalendarItem } from '../types';
import { occursOnDate } from '../utils/items';
import { parseDateString, toDateString } from '../utils/time';

export function HomeScreen() {
  const [date] = useState(() => toDateString(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [input, setInput] = useState('');
  const [proposal, setProposal] = useState<AgendaProposal | null>(null);
  const [saving, setSaving] = useState(false);
  // Shown above the input bar (Alert.alert does nothing on the web)
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<TextInputInstance>(null);

  const loadItems = useCallback(async () => {
    try {
      setItems(await getItemsByDate(date));
    } catch {
      setMessage('Impossibile caricare gli impegni salvati.');
    }
  }, [date]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;

    setMessage(null);
    try {
      const result = await planInput(text, date, items);
      if ('error' in result) {
        setMessage(result.error);
        return;
      }
      setProposal(result.proposal);
    } catch {
      setMessage('Impossibile calcolare la proposta.');
    }
  };

  const handleAccept = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await saveItems(
        proposal.items.map((item) => (item.status === 'proposed' ? { ...item, status: 'confirmed' } : item)),
      );
      setProposal(null);
      setInput('');
      await loadItems();
    } catch {
      setMessage('Impossibile salvare gli impegni.');
    } finally {
      setSaving(false);
    }
  };

  const handleItemPress = async (item: CalendarItem) => {
    try {
      await updateItemStatus(item.id, item.status === 'completed' ? 'confirmed' : 'completed');
      await loadItems();
    } catch {
      setMessage("Impossibile aggiornare l'impegno.");
    }
  };

  const handleMicPress = () => {
    inputRef.current?.focus();
    setMessage('Il riconoscimento vocale integrato non è ancora disponibile: usa il microfono della tastiera iOS.');
  };

  // While the modal is open, the proposal for this day is previewed in the timeline
  const timelineItems = useMemo(() => {
    if (!proposal) return items;
    const changedIds = new Set(proposal.items.map((item) => item.id));
    const previews = proposal.items.filter((item) => occursOnDate(item, date));
    return [...items.filter((item) => !changedIds.has(item.id)), ...previews];
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

        {message && (
          <View className="mx-3 mb-2 flex-row items-start gap-2 rounded-2xl bg-amber-50 p-3">
            <TriangleAlert color="#b45309" size={16} />
            <Text className="flex-1 text-sm text-amber-800">{message}</Text>
            <Pressable onPress={() => setMessage(null)} accessibilityLabel="Chiudi" hitSlop={8}>
              <X color="#b45309" size={16} />
            </Pressable>
          </View>
        )}

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
        changes={proposal?.changes ?? []}
        notice={proposal?.notice}
        saving={saving}
        onAccept={handleAccept}
        onCancel={() => setProposal(null)}
      />
    </SafeAreaView>
  );
}
