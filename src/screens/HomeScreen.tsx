import { Mic, SendHorizontal, TriangleAlert, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApprovalModal } from '../components/ApprovalModal';
import { ItemActionsModal } from '../components/ItemActionsModal';
import { Timeline } from '../components/Timeline';
import { type AgendaProposal, planInput } from '../services/agenda';
import { deleteItem, getItemsByDate, saveItems, updateItemStatus } from '../services/storage';
import type { CalendarItem } from '../types';
import { getItemTimeRange, occursOnDate } from '../utils/items';
import { parseDateString, toDateString } from '../utils/time';

export function HomeScreen() {
  const [date] = useState(() => toDateString(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [input, setInput] = useState('');
  const [proposal, setProposal] = useState<AgendaProposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [cascadeAccepted, setCascadeAccepted] = useState(false);
  // Item whose actions (complete, delete) are shown
  const [selectedItem, setSelectedItem] = useState<CalendarItem | null>(null);
  const [updatingItem, setUpdatingItem] = useState(false);
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
      setCascadeAccepted(false);
      setProposal(result.proposal);
    } catch {
      setMessage('Impossibile calcolare la proposta.');
    }
  };

  // The proposal's items plus, if the user agreed, the shifts of the following events
  const proposedItems = useMemo(
    () => (proposal ? [...proposal.items, ...(cascadeAccepted ? (proposal.cascade?.items ?? []) : [])] : []),
    [proposal, cascadeAccepted],
  );

  const handleAccept = async () => {
    if (!proposal) return;
    setSaving(true);
    try {
      await saveItems(
        proposedItems.map((item) => (item.status === 'proposed' ? { ...item, status: 'confirmed' } : item)),
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

  const updateSelectedItem = async (update: () => Promise<unknown>, errorMessage: string) => {
    setUpdatingItem(true);
    try {
      await update();
      setSelectedItem(null);
      await loadItems();
    } catch {
      setMessage(errorMessage);
    } finally {
      setUpdatingItem(false);
    }
  };

  const handleToggleCompleted = (item: CalendarItem) => {
    // Back to "to do": confirmed if it has a time, otherwise still to plan
    const reopenedStatus = getItemTimeRange(item) ? 'confirmed' : 'pending';
    return updateSelectedItem(
      () => updateItemStatus(item.id, item.status === 'completed' ? reopenedStatus : 'completed'),
      "Impossibile aggiornare l'impegno.",
    );
  };

  const handleDelete = (item: CalendarItem) =>
    updateSelectedItem(() => deleteItem(item.id), "Impossibile eliminare l'impegno.");

  const handleMicPress = () => {
    inputRef.current?.focus();
    setMessage('Il riconoscimento vocale integrato non è ancora disponibile: usa il microfono della tastiera iOS.');
  };

  // While the modal is open, the proposal for this day is previewed in the timeline
  const timelineItems = useMemo(() => {
    if (!proposal) return items;
    const changedIds = new Set(proposedItems.map((item) => item.id));
    const previews = proposedItems.filter((item) => occursOnDate(item, date));
    return [...items.filter((item) => !changedIds.has(item.id)), ...previews];
  }, [items, proposal, proposedItems, date]);

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

        <Timeline items={timelineItems} date={date} onItemPress={proposal ? undefined : setSelectedItem} />

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

      <ItemActionsModal
        item={selectedItem}
        busy={updatingItem}
        onToggleCompleted={handleToggleCompleted}
        onDelete={handleDelete}
        onClose={() => setSelectedItem(null)}
      />

      <ApprovalModal
        visible={proposal !== null}
        rawText={proposal?.rawText ?? ''}
        items={proposal?.items ?? []}
        unscheduled={proposal?.unscheduled ?? []}
        changes={proposal?.changes ?? []}
        notice={proposal?.notice}
        cascade={proposal?.cascade}
        cascadeAccepted={cascadeAccepted}
        onToggleCascade={() => setCascadeAccepted((accepted) => !accepted)}
        saving={saving}
        onAccept={handleAccept}
        onCancel={() => setProposal(null)}
      />
    </SafeAreaView>
  );
}
