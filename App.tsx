import './global.css';

import { StatusBar } from 'expo-status-bar';
import { CalendarCheck } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-slate-50">
        <View className="flex-1 items-center justify-center px-6">
          <View className="mb-6 rounded-3xl bg-indigo-600 p-5">
            <CalendarCheck color="#ffffff" size={40} />
          </View>
          <Text className="text-3xl font-bold text-slate-900">SmartAgenda</Text>
          <Text className="mt-2 text-center text-base text-slate-500">
            Setup completato: Expo + TypeScript + NativeWind
          </Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
