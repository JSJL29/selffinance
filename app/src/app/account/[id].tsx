import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  AccountRow, CONSENT_WARN_DAYS, byDay, consentDaysLeft, fetchAccounts, fetchAccountTx, groupAccounts, setManualBalance, useLoad,
} from '@/lib/data';
import { useConnectBank } from '@/components/connect';
import { ago, maskIban, money, shortDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { DayHeader, Empty, ErrorBox, Loading, TxRow } from '@/components/ui';

export default function AccountDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const accounts = useLoad(fetchAccounts, []);
  const group = useMemo(() => groupAccounts(accounts.data ?? []).find((g) => g.key === id), [accounts.data, id]);
  const uids = group?.members.map((m) => m.uid) ?? [];
  const txs = useLoad(() => (uids.length ? fetchAccountTx(uids) : Promise.resolve([])), [uids.join(',')]);
  const sections = useMemo(() => byDay(txs.data ?? []), [txs.data]);

  if (!accounts.data && !accounts.error) return <Loading />;

  const refresh = async () => { await Promise.all([accounts.refresh(), txs.refresh()]); };

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <SectionList
        sections={sections}
        keyExtractor={(x) => String(x.id)}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={accounts.refreshing || txs.refreshing} onRefresh={refresh} tintColor={t.primary} colors={[t.primary]} />}
        ListHeaderComponent={
          <View style={s.header}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
              <Ionicons name="chevron-back" size={18} color={t.primary} />
              <Text style={{ color: t.primary, fontSize: 15 }}>Comptes</Text>
            </Pressable>
            {accounts.error && <ErrorBox message={accounts.error} onRetry={accounts.reload} />}
            {group && (
              <>
                <Text style={[s.title, { color: t.text }]}>{group.bank}</Text>
                <Text style={[s.small, { color: t.muted }]}>{[group.name, maskIban(group.iban)].filter(Boolean).join(' · ')}</Text>
                <Text style={[s.big, { color: t.text }]}>{group.balanceEur == null ? '— €' : money(group.balanceEur)}</Text>
                {group.members.length > 1 && group.members.map((m) => (
                  <Text key={m.uid} style={[s.small, { color: t.muted }]}>
                    {m.currency} : {money(m.current_balance ?? 0, m.currency ?? 'EUR')}
                  </Text>
                ))}
                <BalanceEditor account={group.members[0]} onSaved={accounts.reload} />
                {group.error && <Text style={[s.small, { color: t.danger, marginTop: 8 }]}>{group.error}</Text>}
                <ConsentBox bank={group.bank} until={group.consentUntil} onDone={refresh} />
              </>
            )}
            {txs.error && <ErrorBox message={txs.error} onRetry={txs.reload} />}
          </View>
        }
        renderSectionHeader={({ section }) => <DayHeader iso={section.title} />}
        renderItem={({ item }) => <TxRow tx={item} />}
        ListEmptyComponent={txs.data ? <Empty text="Aucune opération." /> : <Loading />}
        contentContainerStyle={{ paddingBottom: 32 }}
      />
    </SafeAreaView>
  );
}

/** Durée de l'accès bancaire et bouton pour le renouveler depuis l'app. */
function ConsentBox({ bank, until, onDone }: { bank: string; until: string | null; onDone: () => Promise<void> }) {
  const t = useTheme();
  const { busy, connect } = useConnectBank(onDone);
  const left = consentDaysLeft(until);
  const urgent = left != null && left <= CONSENT_WARN_DAYS;

  function confirm() {
    Alert.alert(
      `Reconnecter ${bank} ?`,
      'Tu vas te connecter sur le site de ta banque puis valider dans son app. Ton historique est conservé.',
      [{ text: 'Annuler', style: 'cancel' }, { text: 'Continuer', onPress: () => connect(bank) }],
    );
  }

  return (
    <View style={[s.consent, { borderColor: urgent ? t.danger : t.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[s.small, { color: t.text, fontWeight: '600' }]}>Accès bancaire</Text>
        <Text style={[s.small, { color: urgent ? t.danger : t.muted }]}>
          {left == null ? 'Date d’expiration inconnue'
            : left < 0 ? `Expiré le ${shortDate(until!)}`
            : `Valable jusqu’au ${shortDate(until!)} (${left} j)`}
        </Text>
      </View>
      <Pressable
        onPress={confirm} disabled={!!busy}
        style={[s.consentButton, { backgroundColor: urgent ? t.primary : 'transparent', borderColor: t.primary }]}>
        {busy
          ? <ActivityIndicator size="small" color={urgent ? t.primaryText : t.primary} />
          : <Text style={{ color: urgent ? t.primaryText : t.primary, fontWeight: '600', fontSize: 13 }}>Reconnecter</Text>}
      </Pressable>
    </View>
  );
}

/** Explique d'où vient le solde, et permet de le corriger à la main si la banque en renvoie un faux. */
function BalanceEditor({ account, onSaved }: { account: AccountRow; onSaved: () => void }) {
  const t = useTheme();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const info =
    account.balance_source === 'manual'
      ? `Solde saisi le ${shortDate(account.manual_balance_date!)} + opérations depuis`
      : account.balance_source === 'bank'
        ? `Solde donné par la banque · ${ago(account.balance_at)}`
        : 'La banque ne donne pas le solde : saisis-le une fois.';

  async function save(amount: number | null) {
    try {
      await setManualBalance(account.uid, amount);
      setEditing(false);
      onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : String(e));
    }
  }

  if (editing) {
    const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
    const valid = value.trim() !== '' && Number.isFinite(parsed);
    return (
      <View style={s.editor}>
        <Text style={[s.small, { color: t.muted }]}>Solde actuel du compte (aujourd’hui) :</Text>
        <View style={s.editRow}>
          <TextInput
            autoFocus keyboardType="decimal-pad" value={value} onChangeText={setValue}
            placeholder="0,00" placeholderTextColor={t.muted}
            style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
          />
          <Pressable disabled={!valid} onPress={() => save(parsed)} style={[s.btn, { backgroundColor: t.primary, opacity: valid ? 1 : 0.5 }]}>
            <Text style={{ color: t.primaryText, fontWeight: '600' }}>OK</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(false)} style={s.btn}>
            <Text style={{ color: t.muted }}>Annuler</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.editor}>
      <Text style={[s.small, { color: t.muted }]}>{info}</Text>
      <View style={s.links}>
        <Text onPress={() => { setValue(''); setEditing(true); }} style={[s.small, { color: t.primary, fontWeight: '600' }]}>
          {account.balance_source == null ? 'Saisir le solde' : 'Corriger le solde'}
        </Text>
        {account.balance_source === 'manual' && account.balance != null && (
          <Text onPress={() => save(null)} style={[s.small, { color: t.primary }]}>Revenir au solde de la banque</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: 12, borderWidth: 1 },
  consentButton: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, minWidth: 104, alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  back: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginLeft: -4 },
  title: { fontSize: 22, fontWeight: '700' },
  small: { fontSize: 13 },
  big: { fontSize: 34, fontWeight: '700', marginTop: 8, marginBottom: 2, fontVariant: ['tabular-nums'] },
  editor: { marginTop: 8, gap: 6 },
  links: { flexDirection: 'row', gap: 16 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
});
