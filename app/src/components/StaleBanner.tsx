// Pastille « Hors connexion · données de 14:32 » : l'écran montre la dernière copie faute de réseau.
// Toucher relance ; nouvel essai toutes les 10 s ; disparaît au premier succès (src/lib/stale.ts).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { staleStore } from '@/lib/data';
import { staleLabel } from '@/lib/stale';
import { useTheme } from '@/lib/theme';

const RETRY_MS = 10_000;
const TAB_BAR = 64; // au-dessus de la barre d'onglets

export function StaleBanner() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const at = useSyncExternalStore(staleStore.subscribe, staleStore.oldest, staleStore.oldest);
  const [trying, setTrying] = useState(false);
  const busy = useRef(false);

  const retry = useCallback(async () => {
    if (busy.current) return; // jamais deux essais en même temps
    busy.current = true;
    setTrying(true);
    try {
      await staleStore.retryAll();
    } finally {
      busy.current = false;
      setTrying(false);
    }
  }, []);

  useEffect(() => {
    if (!at) return;
    const timer = setInterval(retry, RETRY_MS);
    return () => clearInterval(timer);
  }, [at, retry]);

  if (!at) return null;
  return (
    <View pointerEvents="box-none" style={[s.wrap, { bottom: insets.bottom + TAB_BAR }]}>
      <Pressable
        onPress={retry} disabled={trying} accessibilityRole="button"
        accessibilityLabel={`${staleLabel(at)}. Toucher pour réessayer.`}
        style={[s.pill, { backgroundColor: t.card, borderColor: t.border }]}>
        <Ionicons name="cloud-offline-outline" size={15} color={t.muted} />
        <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{staleLabel(at)}</Text>
        {trying ? <ActivityIndicator size="small" color={t.muted} /> : <Ionicons name="refresh" size={14} color={t.primary} />}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth, elevation: 3,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
});
