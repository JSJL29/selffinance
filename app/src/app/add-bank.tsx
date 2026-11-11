import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Aspsp, fetchAccounts, fetchAspsps, useLoad } from '@/lib/data';
import { useTheme } from '@/lib/theme';
import { ErrorBox, Loading } from '@/components/ui';
import { useConnectBank } from '@/components/connect';
import { showAlert } from '@/lib/dialog';
import { goBack } from '@/lib/nav';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Liste des banques françaises disponibles chez Enable Banking, avec recherche. */
export default function AddBank() {
  const t = useTheme();
  const aspsps = useLoad(() => fetchAspsps('FR'), []);
  const accounts = useLoad(fetchAccounts, []);
  const [q, setQ] = useState('');
  const { busy, connect } = useConnectBank();

  const connected = useMemo(() => new Set((accounts.data ?? []).map((a) => a.bank)), [accounts.data]);
  const list = useMemo(() => {
    const all = aspsps.data ?? [];
    const n = norm(q.trim());
    return n ? all.filter((a) => norm(a.name).includes(n)) : all;
  }, [aspsps.data, q]);

  function pick(a: Aspsp) {
    const again = connected.has(a.name);
    showAlert(
      again ? `Reconnecter ${a.name} ?` : `Connecter ${a.name} ?`,
      `Tu vas te connecter sur le site de ta banque puis valider dans son app. L'accès est valable ${Math.min(a.max_days, 180)} jours.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Continuer',
          onPress: async () => {
            if (await connect(a.name)) router.navigate('/');
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <View style={s.header}>
        <Pressable onPress={() => goBack('/')} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={18} color={t.primary} />
          <Text style={{ color: t.primary, fontSize: 15 }}>Comptes</Text>
        </Pressable>
        <Text style={[s.title, { color: t.text }]}>Ajouter une banque</Text>
        <TextInput
          value={q} onChangeText={setQ} placeholder="Rechercher (Fortuneo, Boursorama…)" placeholderTextColor={t.muted}
          autoCorrect={false} clearButtonMode="while-editing"
          style={[s.search, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
        />
      </View>

      {aspsps.error ? <ErrorBox message={aspsps.error} onRetry={aspsps.reload} />
        : !aspsps.data ? <Loading />
        : (
          <FlatList
            data={list}
            keyExtractor={(a) => a.name}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => pick(item)} disabled={!!busy}
                style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
                {item.logo
                  ? <Image source={{ uri: item.logo }} style={s.logo} resizeMode="contain" />
                  : <View style={[s.logo, { backgroundColor: t.tag }]} />}
                <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{item.name}</Text>
                {busy === item.name ? <ActivityIndicator color={t.primary} />
                  : connected.has(item.name) ? <Text style={[s.badge, { color: t.success }]}>connectée</Text>
                  : <Ionicons name="add-circle-outline" size={20} color={t.primary} />}
              </Pressable>
            )}
          />
        )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  logo: { width: 32, height: 32, borderRadius: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: '500' },
  badge: { fontSize: 12, fontWeight: '600' },
});
