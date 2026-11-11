import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useLoad } from '@/lib/data';
import { addDividend, fetchPositions } from '@/lib/patrimoine';
import { frDate, isoDay, money, parseAmount, parseFrDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { showAlert } from '@/lib/dialog';
import { Chip } from '@/components/ui';
import { BackLink, CurrencyPicker, Field, PrimaryButton, currencySymbol } from '@/components/form';
import { goBack } from '@/lib/nav';

/** Saisie d'un dividende reçu sur un compte manuel. */
export default function Dividend() {
  const t = useTheme();
  const { accountId } = useLocalSearchParams<{ accountId: string }>();
  const positions = useLoad(() => fetchPositions(accountId), [accountId]);
  const [instrument, setInstrument] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('0');
  const [currency, setCurrency] = useState<string>('EUR');
  const [date, setDate] = useState(frDate(isoDay(new Date())));
  const [busy, setBusy] = useState(false);
  const sym = currencySymbol(currency);

  const nAmount = parseAmount(amount);
  const nTax = tax.trim() === '' ? 0 : parseAmount(tax);
  const isoDate = parseFrDate(date);
  const valid = nAmount != null && nAmount > 0 && nTax != null && nTax >= 0 && nTax <= nAmount && !!isoDate;

  async function save() {
    setBusy(true);
    try {
      await addDividend({ account_id: accountId, instrument_id: instrument, date: isoDate!, amount: nAmount!,
        tax_withheld: nTax!, currency });
      goBack({ pathname: '/patrimoine/account/[id]', params: { id: accountId } });
    } catch (e) {
      showAlert('Dividende', e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <BackLink label="Compte" fallback={{ pathname: '/patrimoine/account/[id]', params: { id: accountId } }} />
          <Text style={[s.title, { color: t.text }]}>Dividende reçu</Text>

          <Text style={[s.label, { color: t.muted }]}>TITRE (FACULTATIF)</Text>
          <View style={s.chips}>
            <Chip label="Aucun" on={instrument == null} onPress={() => setInstrument(null)} />
            {positions.data?.map((p) => (
              <Chip key={p.instrument_id} label={p.instrument_name} on={instrument === p.instrument_id}
                onPress={() => setInstrument(p.instrument_id)} />
            ))}
          </View>

          <CurrencyPicker value={currency} onChange={setCurrency} />
          <Field label={`Montant brut (${sym})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
          <Field label={`Impôt déjà prélevé par le courtier (${sym})`} value={tax} onChangeText={setTax} keyboardType="decimal-pad"
            hint="Acompte et prélèvements sociaux retenus par un courtier français (0 dans un PEA)." />
          <Field label="Date" value={date} onChangeText={setDate} placeholder="JJ/MM/AAAA" hint={isoDate ? undefined : 'Format JJ/MM/AAAA'} />

          {valid && (
            <Text style={[s.small, { color: t.muted }]}>
              {money(nAmount! - nTax!, currency)} seront ajoutés aux liquidités du compte.
            </Text>
          )}
          <PrimaryButton label="Ajouter le dividende" onPress={save} disabled={!valid} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { fontSize: 26, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  small: { fontSize: 13 },
});
