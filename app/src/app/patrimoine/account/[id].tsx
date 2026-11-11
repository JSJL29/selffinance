import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLoad } from '@/lib/data';
import { ManualAccount, PositionRow, envelopeLabel, fetchManualAccount, fetchPositions, syncIbkr } from '@/lib/patrimoine';
import { ago, money, pct, shortDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { BackLink } from '@/components/form';
import { showAlert } from '@/lib/dialog';

/** Détail d'un compte manuel : solde (épargne) ou liquidités + positions (placements). */
export default function ManualAccountDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const account = useLoad(() => fetchManualAccount(id), [id]);
  const positions = useLoad(() => fetchPositions(id), [id]);

  if (!account.data && !account.error) return <Loading />;
  const a = account.data;
  const refresh = async () => { await Promise.all([account.refresh(), positions.refresh()]); };
  const color = a && a.pnl_eur > 0 ? t.success : a && a.pnl_eur < 0 ? t.danger : t.muted;
  const edit = () => router.push({ pathname: '/patrimoine/account-edit', params: { id } });
  const synced = !!a?.sync_source;

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={account.refreshing || positions.refreshing} onRefresh={refresh} tintColor={t.primary} colors={[t.primary]} />}>
        <BackLink label="Patrimoine" />
        {account.error && <ErrorBox message={account.error} onRetry={account.reload} />}
        {a && (
          <>
            <View style={s.titleRow}>
              <View style={s.grow}>
                <Text style={[s.title, { color: t.text }]}>{a.name}</Text>
                <Text style={[s.small, { color: t.muted }]}>{[envelopeLabel(a.envelope), a.institution].filter(Boolean).join(' · ')}</Text>
              </View>
              <Pressable onPress={edit} hitSlop={10} accessibilityLabel="Modifier le compte">
                <Ionicons name="create-outline" size={22} color={t.primary} />
              </Pressable>
            </View>
            <Text style={[s.big, { color: t.text }]}>{a.value_eur == null ? '— €' : money(a.value_eur)}</Text>
            {a.kind === 'investment' && a.invested_eur > 0 && (
              <Text style={[s.small, { color }]}>
                {money(a.pnl_eur, 'EUR', { sign: true })} ({pct(a.pnl_pct)}) sur {money(a.invested_eur)} investis
              </Text>
            )}

            {synced && <IbkrSyncBox account={a} onDone={refresh} />}

            <Pressable onPress={edit} disabled={synced} style={[s.cash, { backgroundColor: t.card, borderColor: t.border }]}>
              <View style={s.grow}>
                <Text style={[s.name, { color: t.text }]}>{a.kind === 'savings' ? 'Solde' : 'Liquidités'}</Text>
                <Text style={[s.small, { color: t.muted }]}>
                  {synced ? `Relevé IBKR${a.cash_updated_at ? ` du ${shortDate(a.cash_updated_at)}` : ''}, converti en €`
                    : a.cash_updated_at ? `Mis à jour le ${shortDate(a.cash_updated_at)}` : 'Saisi à la main'}
                </Text>
              </View>
              <Text style={[s.amount, { color: t.text }]}>{money(a.cash_balance, a.currency)}</Text>
              {!synced && <Ionicons name="create-outline" size={18} color={t.muted} />}
            </Pressable>

            {a.kind === 'investment' && (
              <>
                <Text style={[s.section, { color: t.muted }]}>POSITIONS</Text>
                {positions.error && <ErrorBox message={positions.error} onRetry={positions.reload} />}
                {positions.data?.map((p) => <PositionLine key={p.id} p={p} readOnly={synced} />)}
                {positions.data?.length === 0 && (
                  <Empty text={synced ? 'Aucune position : lance une synchronisation.' : 'Aucune position pour l’instant.'} />
                )}
                {!synced && (
                  <Pressable
                    onPress={() => router.push({ pathname: '/patrimoine/position-edit', params: { accountId: id } })}
                    style={({ pressed }) => [s.add, { borderColor: t.border, backgroundColor: pressed ? t.border : 'transparent' }]}>
                    <Ionicons name="add" size={18} color={t.primary} />
                    <Text style={{ color: t.primary, fontSize: 15, fontWeight: '600' }}>Ajouter une position</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** « cours du 11/11 », « cours manuel du 11/11 » ou « cours introuvable ». */
function priceLabel(p: Pick<PositionRow, 'last_price' | 'last_price_date' | 'price_source' | 'price_error'>): string {
  if (p.last_price == null) return 'cours introuvable';
  const when = p.last_price_date ? ` du ${shortDate(p.last_price_date)}` : '';
  return p.price_source === 'manual' ? `valeur saisie${when}` : `cours${when}`;
}

/** État de la synchro IBKR + bouton pour la relancer. */
function IbkrSyncBox({ account, onDone }: { account: ManualAccount; onDone: () => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await syncIbkr();
      await onDone();
      showAlert('IBKR synchronisé', `${r.positions} position${r.positions > 1 ? 's' : ''} · relevé du ${shortDate(r.date)}`);
    } catch (e) {
      await onDone();
      showAlert('Synchro IBKR', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.sync, { borderColor: account.sync_error ? t.danger : t.border }]}>
      <View style={s.grow}>
        <Text style={[s.small, { color: t.text, fontWeight: '600' }]}>Synchronisé avec IBKR</Text>
        <Text style={[s.small, { color: t.muted }]}>
          {busy ? 'Récupération du relevé (jusqu’à 1 min)…'
            : `${account.last_synced_at ? `Dernière synchro ${ago(account.last_synced_at)}` : 'Jamais synchronisé'} · auto chaque jour à 7 h`}
        </Text>
        {!!account.sync_error && !busy && <Text style={[s.small, { color: t.danger }]}>{account.sync_error}</Text>}
      </View>
      <Pressable onPress={run} disabled={busy} style={[s.syncButton, { borderColor: t.primary }]}>
        {busy ? <ActivityIndicator size="small" color={t.primary} />
          : <Text style={{ color: t.primary, fontWeight: '600', fontSize: 13 }}>Synchroniser</Text>}
      </Pressable>
    </View>
  );
}

function PositionLine({ p, readOnly }: { p: PositionRow; readOnly?: boolean }) {
  const t = useTheme();
  const color = (p.pnl_eur ?? 0) > 0 ? t.success : (p.pnl_eur ?? 0) < 0 ? t.danger : t.muted;
  const valueLine = p.type === 'fonds_euros';
  const detail = valueLine
    ? `versé ${money(p.avg_cost, p.cost_currency)}`
    : `${String(p.quantity).replace('.', ',')} × ${p.last_price == null ? '—' : money(p.last_price, p.instrument_currency)}`;
  const missing = p.value_eur == null;
  return (
    <Pressable
      disabled={readOnly}
      onPress={() => router.push({ pathname: '/patrimoine/position-edit', params: { accountId: p.account_id, id: p.id } })}
      style={({ pressed }) => [s.position, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
      <View style={s.grow}>
        <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{p.instrument_name}</Text>
        <Text style={[s.small, { color: t.muted }]} numberOfLines={1}>{detail}</Text>
        <Text style={[s.tiny, { color: missing || p.price_error ? t.danger : t.muted }]} numberOfLines={1}>
          {missing && p.last_price != null ? 'taux de change indisponible' : priceLabel(p)}
          {!missing && p.cost_currency !== 'EUR' ? ' · plus-value hors effet de change' : ''}
        </Text>
      </View>
      <View style={s.right}>
        <Text style={[s.amount, { color: t.text }]}>{p.value_eur == null ? '— €' : money(p.value_eur)}</Text>
        {p.pnl_eur != null && <Text style={[s.small, { color }]}>{money(p.pnl_eur, 'EUR', { sign: true })} ({pct(p.pnl_pct)})</Text>}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '700' },
  big: { fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 4 },
  small: { fontSize: 13 },
  tiny: { fontSize: 11, marginTop: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  right: { alignItems: 'flex-end' },
  cash: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginTop: 12 },
  sync: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, marginTop: 12 },
  syncButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, minWidth: 110, alignItems: 'center' },
  section: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginTop: 18, marginBottom: 4 },
  position: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
});
