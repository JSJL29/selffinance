import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.bg },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Comptes', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="patrimoine"
        options={{ title: 'Patrimoine', tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color as string} size={size} /> }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <Ionicons name="swap-vertical" color={color as string} size={size} /> }}
      />
    </Tabs>
  );
}
