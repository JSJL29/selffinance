import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  AccountGroup, CONSENT_WARN_DAYS, consentDaysLeft, fetchAccounts, fetchSyncBudget, groupAccounts, syncNow, useLoad,
} from '@/lib/data';
import { ago, money } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { BankDot, ErrorBox, Loading } from '@/components/ui';
import { showAlert } from '@/lib/dialog';

export default function Accounts() {
  const t = useTheme();
  const { data, error, refreshing, refresh, reload } = useLoad(fetchAccounts, [], 'accounts');
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
            <SyncButton onDone={reload} />
            {error && <ErrorBox message={error} onRetry={reload} />}
          </View>
        }
        renderItem={({ item }) => <AccountRow g={item} />}
        ListFooterComponent={
          <>
            <Pressable
              onPress={() => router.push('/add-bank')}
              style={({ pressed }) => [s.addBank, { borderColor: t.border, backgroundColor: pressed ? t.border : 'transparent' }]}>
              <Ionicons name="add" size={18} color={t.primary} />
              <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>Ajouter une banque</Text>
            </Pressable>
            <Text onPress={() => supabase.auth.signOut()} style={[s.signOut, { color: t.muted }]}>Se déconnecter</Text>
          </>
        }
      />
    </SafeAreaView>
  );
}

/** Synchro manuelle des banques, dans la limite du budget du jour (4 accès, automatiques compris). */
function SyncButton({ onDone }: { onDone: () => Promise<void> }) {
  const t = useTheme();
  const budget = useLoad(fetchSyncBudget, []);
  const [busy, setBusy] = useState(false);
  const left = budget.data?.manual_left ?? null;
  const disabled = busy || !left;

  async function run() {
    setBusy(true);
    const err = await syncNow();
    await Promise.all([onDone(), budget.reload()]);
    setBusy(false);
    if (err) showAlert('Synchronisation', err);
  }

  function confirm() {
    showAlert(
      'Synchroniser maintenant ?',
      `Les banques limitent les accès à 4 par jour, synchros automatiques comprises. Il te restera ${left! - 1} synchro${left! - 1 > 1 ? 's' : ''} manuelle${left! - 1 > 1 ? 's' : ''} aujourd'hui.`,
      [{ text: 'Annuler', style: 'cancel' }, { text: 'Synchroniser', onPress: run }],
    );
  }

  const next = budget.data?.next_auto;
  const nextText = next == null ? 'synchro automatique désactivée' : `prochaine auto à ${next} h`;

  return (
    <View style={s.syncWrap}>
      <View style={s.syncLine}>
        <Pressable
          onPress={confirm} disabled={disabled}
          style={[s.syncButton, { backgroundColor: t.primary, opacity: disabled && !busy ? 0.45 : 1 }]}>
          {busy
            ? <ActivityIndicator size="small" color={t.primaryText} />
            : <Ionicons name="sync" size={16} color={t.primaryText} />}
          <Text style={[s.syncText, { color: t.primaryText }]}>
            {busy ? 'Synchro en cours…' : 'Synchroniser maintenant'}
          </Text>
        </Pressable>
        <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Réglages de synchro">
          <Ionicons name="settings-outline" size={22} color={t.muted} />
        </Pressable>
      </View>
      <Text style={[s.tiny, { color: t.muted }]}>
        {busy ? 'Environ 20 secondes'
          : left == null ? ' '
          : left === 0 ? `Plus de synchro manuelle aujourd'hui · ${nextText}`
          : `${left} synchro${left > 1 ? 's' : ''} manuelle${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''} · ${nextText}`}
      </Text>
    </View>
  );
}

function AccountRow({ g }: { g: AccountGroup }) {
  const t = useTheme();
  const others = g.members.filter((m) => m.currency && m.currency !== 'EUR' && (m.current_balance ?? 0) !== 0);
  const sub = [g.name, ...others.map((m) => money(m.current_balance ?? 0, m.currency ?? 'EUR'))].join(' · ');
  const manual = g.members.some((m) => m.balance_source === 'manual');
  const consentLeft = consentDaysLeft(g.consentUntil);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/account/[id]', params: { id: g.key } })}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
      <BankDot bank={g.bank} />
      <View style={s.grow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{g.bank}</Text>
        <Text style={[s.small, { color: t.muted }]} numberOfLines={1}>{sub}</Text>
        {consentLeft != null && consentLeft <= CONSENT_WARN_DAYS ? (
          <Text style={[s.small, { color: t.danger }]} numberOfLines={1}>
            <Ionicons name="link-outline" /> {consentLeft < 0 ? 'Accès expiré · à reconnecter' : `Accès expire dans ${consentLeft} j · à reconnecter`}
          </Text>
        ) : g.error ? (
          <Text style={[s.small, { color: t.danger }]} numberOfLines={1}>
            <Ionicons name="warning-outline" /> Synchro en erreur
          </Text>
        ) : null}
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
  addBank: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 12, marginTop: 4, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
  syncWrap: { marginTop: 14, alignItems: 'flex-start', gap: 6, alignSelf: 'stretch' },
  syncLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  syncButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999 },
  syncText: { fontSize: 14, fontWeight: '600' },
});
