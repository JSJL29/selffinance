import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchMonthTx, useLoad } from '@/lib/data';
import { type ListItem, groupByDay, pairTransfers, withoutInternal } from '@/lib/transfers';
import { fetchManualAccounts } from '@/lib/patrimoine';
import { money, monthLabel } from '@/lib/format';
import { bankShortName, useTheme } from '@/lib/theme';
import { Chip, DayHeader, Empty, ErrorBox, Loading, TransferRow, TxRow } from '@/components/ui';

// Choix « masquer les virements internes », gardé sur l'appareil (stockage local, peut être indisponible).
const HIDE_KEY = 'transactions.hideInternal';
const readHide = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const writeHide = (v: boolean) => { try { localStorage.setItem(HIDE_KEY, v ? '1' : '0'); } catch { /* sans effet */ } };

const itemKey = (i: ListItem) => (i.kind === 'tx' ? String(i.tx.id) : `v${i.out.id}-${i.in.id}`);

const ALL = 'Tous';

export default function Transactions() {
  const t = useTheme();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [bank, setBank] = useState(ALL);
  const { data, error, refreshing, refresh, reload } = useLoad(() => fetchMonthTx(month), [month.getTime()], `tx:${month.getFullYear()}-${month.getMonth() + 1}`);

  const banks = useMemo(() => [...new Set((data ?? []).map((x) => x.bank))].sort((a, b) => a.localeCompare(b, 'fr')), [data]);
  const shown = useMemo(() => (data ?? []).filter((x) => bank === ALL || x.bank === bank), [data, bank]);
  // Virement SG → BNP : les deux opérations réunies en une ligne (totaux inchangés, les internes en sont exclus).
  // Les virements vers un compte manuel (Livret A, PEA…) n'ont pas de contrepartie bancaire : jamais appariés.
  const manual = useLoad(fetchManualAccounts, [], 'manualAccounts');
  const manualNames = useMemo(() => new Set((manual.data ?? []).map((m) => m.name)), [manual.data]);
  const [hideInternal, setHideInternal] = useState(readHide);
  const toggleHide = () => setHideInternal((v) => { writeHide(!v); return !v; });
  const sections = useMemo(() => {
    const items = pairTransfers(shown, manualNames);
    return groupByDay(hideInternal ? withoutInternal(items) : items);
  }, [shown, manualNames, hideInternal]);

  // Opération sans taux de change connu : exclue des totaux plutôt que comptée en euros.
  const spent = shown.filter((x) => !x.is_internal && x.amount < 0).reduce((sum, x) => sum + (x.amount_eur ?? 0), 0);
  const received = shown.filter((x) => !x.is_internal && x.amount > 0).reduce((sum, x) => sum + (x.amount_eur ?? 0), 0);

  const now = new Date();
  const isCurrent = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={itemKey}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.primary} colors={[t.primary]} />}
        ListHeaderComponent={
          <View>
            <View style={s.header}>
              <Text style={[s.title, { color: t.text }]}>Toutes les transactions</Text>
              <View style={s.monthRow}>
                <Pressable onPress={() => shift(-1)} hitSlop={12}><Ionicons name="chevron-back" size={20} color={t.primary} /></Pressable>
                <Text style={[s.month, { color: t.text }]}>{monthLabel(month)}</Text>
                <Pressable onPress={() => shift(1)} disabled={isCurrent} hitSlop={12}>
                  <Ionicons name="chevron-forward" size={20} color={isCurrent ? t.border : t.primary} />
                </Pressable>
              </View>
              <Text style={[s.small, { color: t.muted }]}>Dépenses hors virements internes</Text>
              <View style={s.totalRow}>
                <Text style={[s.big, { color: t.text }]}>{money(spent)}</Text>
                <Pressable
                  onPress={toggleHide} hitSlop={8}
                  accessibilityRole="switch" accessibilityState={{ checked: hideInternal }}
                  accessibilityLabel="Masquer les virements internes"
                  style={[s.hideBtn, { borderColor: hideInternal ? t.primary : t.border, backgroundColor: hideInternal ? t.tag : 'transparent' }]}>
                  <Ionicons name={hideInternal ? 'eye-off-outline' : 'eye-outline'} size={16} color={hideInternal ? t.primary : t.muted} />
                  <Text style={{ color: hideInternal ? t.primary : t.muted, fontSize: 13, fontWeight: '600' }}>
                    {hideInternal ? 'Internes masqués' : 'Internes visibles'}
                  </Text>
                </Pressable>
              </View>
              {received > 0 && <Text style={[s.small, { color: t.success }]}>Rentrées : {money(received, 'EUR', { sign: true })}</Text>}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {[ALL, ...banks].map((b) => (
                <Chip key={b} label={b === ALL ? b : bankShortName(b)} on={bank === b} onPress={() => setBank(b)} />
              ))}            </ScrollView>
            {error && <ErrorBox message={error} onRetry={reload} />}
          </View>
        }
        renderSectionHeader={({ section }) => <DayHeader iso={section.title} />}
        renderItem={({ item }) => (item.kind === 'tx'
          ? <TxRow tx={item.tx} showBank />
          : <TransferRow out={item.out} in={item.in} />)}
        ListEmptyComponent={data ? <Empty text="Aucune opération ce mois-ci." /> : error ? undefined : <Loading compact />}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, marginBottom: 6 },
  month: { fontSize: 16, fontWeight: '600', minWidth: 130, textAlign: 'center' },
  small: { fontSize: 13 },
  big: { fontSize: 34, fontWeight: '700', marginVertical: 2, fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  hideBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  chips: { gap: 8, paddingHorizontal: 20, paddingVertical: 8 },
});
