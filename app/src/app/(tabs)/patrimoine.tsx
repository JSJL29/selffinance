import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchAccounts, useLoad } from '@/lib/data';
import { ManualAccount, envelopeLabel, fetchManualAccounts, fetchQuotesUpdatedAt, refreshHeldQuotes, syncIbkr } from '@/lib/patrimoine';
import { netWorth } from '@/lib/networth';
import { ago, money, pct } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { ErrorBox, Loading } from '@/components/ui';
import { showAlert } from '@/lib/dialog';

/** Onglet Patrimoine : total général, plus-value des placements, comptes par catégorie. */
export default function Patrimoine() {
  const t = useTheme();
  const bank = useLoad(fetchAccounts, []);
  const manual = useLoad(fetchManualAccounts, []);
  const quotedAt = useLoad(() => fetchQuotesUpdatedAt(), []);
  const [quoting, setQuoting] = useState(false);

  // Cours en direct à l'ouverture de l'onglet, puis recalcul des montants.
  useEffect(() => {
    refreshHeldQuotes().then(() => Promise.all([manual.reload(), quotedAt.reload()]), () => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nw = useMemo(() => netWorth(bank.data ?? [], manual.data ?? []), [bank.data, manual.data]);
  const visible = (manual.data ?? []).filter((m) => !m.hidden);
  const savings = visible.filter((m) => m.kind === 'savings');
  const investments = visible.filter((m) => m.kind === 'investment');
  const bankCount = (bank.data ?? []).filter((a) => !a.hidden).length;

  if ((!bank.data && !bank.error) || (!manual.data && !manual.error)) return <Loading />;

  const refresh = async () => {
    setQuoting(true);
    await refreshHeldQuotes().catch(() => undefined); // cours en direct ; en cas d'échec on garde les derniers
    setQuoting(false);
    await Promise.all([bank.refresh(), manual.refresh(), quotedAt.refresh()]);
  };
  const pnlColor = nw.pnl > 0 ? t.success : nw.pnl < 0 ? t.danger : t.muted;

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={quoting || bank.refreshing || manual.refreshing} onRefresh={refresh} tintColor={t.primary} colors={[t.primary]} />}>
        <View style={s.header}>
          <Text style={[s.small, { color: t.muted }]}>Patrimoine total</Text>
          <Text style={[s.total, { color: t.text }]}>{money(nw.total)}</Text>
          {nw.invested > 0 && (
            <Text style={[s.small, { color: pnlColor }]}>
              Placements {money(nw.pnl, 'EUR', { sign: true })} ({pct(nw.pnlPct)})
            </Text>
          )}
          {quotedAt.data && (
            <Text style={[s.small, { color: t.muted }]}>Cours mis à jour {ago(quotedAt.data)}</Text>
          )}
          <Pressable onPress={() => router.push('/patrimoine/tax')} hitSlop={8} style={s.taxLink}>
            <Ionicons name="receipt-outline" size={15} color={t.primary} />
            <Text style={{ color: t.primary, fontSize: 14, fontWeight: '600' }}>Bilan fiscal {new Date().getFullYear()}</Text>
          </Pressable>
          {bank.error && <ErrorBox message={bank.error} onRetry={bank.reload} />}
          {manual.error && <ErrorBox message={manual.error} onRetry={manual.reload} />}
        </View>

        <Section title="Comptes bancaires" amount={nw.bank} />
        <Pressable
          onPress={() => router.navigate('/')}
          style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
          <Ionicons name="wallet-outline" size={22} color={t.primary} />
          <View style={s.grow}>
            <Text style={[s.name, { color: t.text }]}>Comptes courants</Text>
            <Text style={[s.small, { color: t.muted }]}>{bankCount} compte{bankCount > 1 ? 's' : ''} synchronisé{bankCount > 1 ? 's' : ''}</Text>
          </View>
          <Text style={[s.amount, { color: t.text }]}>{money(nw.bank)}</Text>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>

        <Section title="Épargne" amount={nw.savings} />
        {savings.map((a) => <AccountRow key={a.id} a={a} />)}

        <Section title="Placements" amount={nw.investments} />
        {investments.map((a) => <AccountRow key={a.id} a={a} />)}

        {visible.length === 0 && (
          <Text style={[s.empty, { color: t.muted }]}>
            Ajoute ton Livret A, ton PEA, ton CTO… pour voir tout ton patrimoine ici.
          </Text>
        )}

        {manual.data && !manual.data.some((m) => m.sync_source === 'ibkr') && (
          <ConnectIbkr onDone={manual.reload} />
        )}

        <Pressable
          onPress={() => router.push('/patrimoine/account-edit')}
          style={({ pressed }) => [s.add, { borderColor: t.border, backgroundColor: pressed ? t.border : 'transparent' }]}>
          <Ionicons name="add" size={18} color={t.primary} />
          <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>Ajouter un compte</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Première synchro IBKR : crée le compte « CTO IBKR » et le remplit. */
function ConnectIbkr({ onDone }: { onDone: () => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await syncIbkr();
      showAlert('IBKR connecté', `${r.positions} position${r.positions > 1 ? 's' : ''} récupérée${r.positions > 1 ? 's' : ''}.`);
    } catch (e) {
      showAlert('IBKR', e instanceof Error ? e.message : String(e));
    } finally {
      await onDone();
      setBusy(false);
    }
  }
  return (
    <Pressable
      onPress={run} disabled={busy}
      style={({ pressed }) => [s.add, { borderColor: t.border, backgroundColor: pressed ? t.border : 'transparent' }]}>
      {busy ? <ActivityIndicator color={t.primary} /> : <Ionicons name="sync" size={18} color={t.primary} />}
      <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>
        {busy ? 'Récupération du relevé IBKR…' : 'Connecter IBKR (synchro automatique)'}
      </Text>
    </Pressable>
  );
}

function Section({ title, amount }: { title: string; amount: number }) {
  const t = useTheme();
  return (
    <View style={s.section}>
      <Text style={[s.sectionTitle, { color: t.muted }]}>{title.toUpperCase()}</Text>
      <Text style={[s.sectionTitle, { color: t.muted }]}>{money(amount)}</Text>
    </View>
  );
}

function AccountRow({ a }: { a: ManualAccount }) {
  const t = useTheme();
  const invest = a.kind === 'investment';
  const color = a.pnl_eur > 0 ? t.success : a.pnl_eur < 0 ? t.danger : t.muted;
  const sub = [envelopeLabel(a.envelope), a.institution].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/patrimoine/account/[id]', params: { id: a.id } })}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
      <View style={s.grow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{a.name}</Text>
        <Text style={[s.small, { color: t.muted }]} numberOfLines={1}>{sub}</Text>
        {a.missing_prices > 0 && (
          <Text style={[s.small, { color: t.danger }]}>
            <Ionicons name="warning-outline" /> {a.missing_prices} cours manquant{a.missing_prices > 1 ? 's' : ''}
          </Text>
        )}
      </View>
      <View style={s.right}>
        <Text style={[s.amount, { color: t.text }]}>{a.value_eur == null ? '— €' : money(a.value_eur)}</Text>
        {invest && a.invested_eur > 0 && (
          <Text style={[s.small, { color }]}>{money(a.pnl_eur, 'EUR', { sign: true })} ({pct(a.pnl_pct)})</Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  total: { fontSize: 36, fontWeight: '700', marginVertical: 4, fontVariant: ['tabular-nums'] },
  small: { fontSize: 13 },
  taxLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10 },
  section: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginHorizontal: 12, marginBottom: 8, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  name: { fontSize: 16, fontWeight: '600' },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { textAlign: 'center', paddingHorizontal: 32, paddingVertical: 12 },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginHorizontal: 12, marginTop: 12, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
});
