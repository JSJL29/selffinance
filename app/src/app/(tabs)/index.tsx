import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AccountGroup, fetchAccounts, groupAccounts, useLoad } from '@/lib/data';
import { ago, money } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { BankDot, ErrorBox, Loading } from '@/components/ui';

export default function Accounts() {
  const t = useTheme();
  const { data, error, refreshing, refresh, reload } = useLoad(fetchAccounts, []);
  const groups = useMemo(() => (data ? groupAccounts(data) : []), [data]);

  const total = groups.reduce((sum, g) => sum + (g.balanceEur ?? 0), 0);
  const lastSync = groups.reduce<string | null>((m, g) => (g.lastSyncAt && (!m || g.lastSyncAt > m) ? g.lastSyncAt : m), null);
  const missing = groups.filter((g) => g.balanceEur == null).length;

  if (!data && !error) return <Loading />;

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} colors={[t.primary]} />}
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={[s.small, { color: t.muted }]}>Total de tous mes comptes</Text>
            <Text style={[s.total, { color: t.text }]}>{money(total)}</Text>
            <Text style={[s.small, { color: t.muted }]}>
              Mis à jour {ago(lastSync)}
              {missing > 0 ? ` · ${missing} solde${missing > 1 ? 's' : ''} à saisir` : ''}
            </Text>
            {error && <ErrorBox message={error} onRetry={reload} />}
          </View>
        }
        renderItem={({ item }) => <AccountRow g={item} />}
        ListFooterComponent={
          <Text onPress={() => supabase.auth.signOut()} style={[s.signOut, { color: t.muted }]}>Se déconnecter</Text>
        }
      />
    </SafeAreaView>
  );
}

function AccountRow({ g }: { g: AccountGroup }) {
  const t = useTheme();
  const others = g.members.filter((m) => m.currency && m.currency !== 'EUR' && (m.current_balance ?? 0) !== 0);
  const sub = [g.name, ...others.map((m) => money(m.current_balance ?? 0, m.currency ?? 'EUR'))].join(' · ');
  const manual = g.members.some((m) => m.balance_source === 'manual');
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/account/[id]', params: { id: g.key } })}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
      <BankDot bank={g.bank} />
      <View style={s.grow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{g.bank}</Text>
        <Text style={[s.small, { color: t.muted }]} numberOfLines={1}>{sub}</Text>
        {g.error && (
          <Text style={[s.small, { color: t.danger }]} numberOfLines={1}>
            <Ionicons name="warning-outline" /> Synchro en erreur
          </Text>
        )}
      </View>
      <View style={s.right}>
        {g.balanceEur == null ? (
          <Text style={[s.small, { color: t.primary }]}>Solde à saisir</Text>
        ) : (
          <Text style={[s.amount, { color: t.text }]}>{money(g.balanceEur)}</Text>
        )}
        {manual && <Text style={[s.tiny, { color: t.muted }]}>saisi + opérations</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 },
  total: { fontSize: 36, fontWeight: '700', marginVertical: 4, fontVariant: ['tabular-nums'] },
  small: { fontSize: 13 },
  tiny: { fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginHorizontal: 12, marginBottom: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  signOut: { textAlign: 'center', padding: 24, fontSize: 13 },
});
