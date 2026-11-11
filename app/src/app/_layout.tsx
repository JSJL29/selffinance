import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function RootLayout() {
  const t = useTheme();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // l'écran de démarrage reste affiché

  return (
    // Version web (PC) : l'app reste dans une colonne de la largeur d'un téléphone, centrée.
    <View style={Platform.OS === 'web' ? [s.webPage, { backgroundColor: t.border }] : s.flex}>
      <View style={Platform.OS === 'web' ? [s.webFrame, { backgroundColor: t.bg }] : s.flex}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="account/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="add-bank" />
          <Stack.Screen name="bank-connected" />
          <Stack.Screen name="patrimoine/account/[id]" />
          <Stack.Screen name="patrimoine/account-edit" />
          <Stack.Screen name="patrimoine/position-edit" />
          <Stack.Screen name="patrimoine/sell" />
          <Stack.Screen name="patrimoine/dividend" />
          <Stack.Screen name="patrimoine/tax" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  webPage: { flex: 1, alignItems: 'center' },
  webFrame: { flex: 1, width: '100%', maxWidth: 480, overflow: 'hidden' },
});
