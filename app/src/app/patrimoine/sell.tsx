import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLoad } from '@/lib/data';
import { PositionRow, fetchPosition, sellPosition } from '@/lib/patrimoine';
import { previewSale } from '@/lib/sale';
import { frDate, isoDay, money, parseAmount, parseFrDate } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { showAlert } from '@/lib/dialog';
import { ErrorBox, Loading } from '@/components/ui';
import { BackLink, Field, PrimaryButton, currencySymbol } from '@/components/form';

/** Vente de tout ou partie d'une position manuelle. */
export default function Sell() {
  const { positionId } = useLocalSearchParams<{ positionId: string }>();
  const pos = useLoad(() => fetchPosition(positionId), [positionId]);
  if (pos.error) return <ErrorBox message={pos.error} onRetry={pos.reload} />;
  if (!pos.data) return <Loading />;
  return <SellForm key={pos.data.id} p={pos.data} />;
}

function SellForm({ p }: { p: PositionRow }) {
  const t = useTheme();
  const [qty, setQty] = useState(String(p.quantity).replace('.', ','));
  const [price, setPrice] = useState(p.last_price != null && p.instrument_currency === p.cost_currency
    ? String(p.last_price).replace('.', ',') : '');
  const [fees, setFees] = useState('0');
  const [date, setDate] = useState(frDate(isoDay(new Date())));
  const [busy, setBusy] = useState(false);
  const sym = currencySymbol(p.cost_currency);

  const nQty = parseAmount(qty);
  const nPrice = parseAmount(price);
  const nFees = fees.trim() === '' ? 0 : parseAmount(fees);
  const isoDate = parseFrDate(date);
  const preview = nQty == null || nPrice == null || nFees == null
    ? null
    : previewSale({ quantity: p.quantity, avg_cost: p.avg_cost }, { quantity: nQty, price: nPrice, fees: nFees });
  const valid = preview?.ok === true && !!isoDate;

  async function save() {
    setBusy(true);
    try {
      await sellPosition(p.id, { quantity: nQty!, price: nPrice!, fees: nFees!, date: isoDate! });
      router.dismissTo({ pathname: '/patrimoine/account/[id]', params: { id: p.account_id } });
    } catch (e) {
      showAlert('Vente', e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const color = preview?.ok && preview.realized > 0 ? t.success : preview?.ok && preview.realized < 0 ? t.danger : t.muted;

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <BackLink label="Position" fallback="/patrimoine" />
          <Text style={[s.title, { color: t.text }]} numberOfLines={2}>Vendre · {p.instrument_name}</Text>
          <Text style={[s.small, { color: t.muted }]}>
            Tu détiens {String(p.quantity).replace('.', ',')} titres · PRU {money(p.avg_cost, p.cost_currency)}
          </Text>

          <Field label={`Quantité vendue (max ${String(p.quantity).replace('.', ',')})`} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
          <Field label={`Prix de vente unitaire (${sym})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0,00" />
          <Field label={`Frais (${sym})`} value={fees} onChangeText={setFees} keyboardType="decimal-pad" />
          <Field label="Date de la vente" value={date} onChangeText={setDate} placeholder="JJ/MM/AAAA"
            hint={isoDate ? undefined : 'Format JJ/MM/AAAA'} />

          <View style={[s.preview, { backgroundColor: t.card, borderColor: t.border }]}>
            {preview?.ok ? (
              <>
                <Text style={[s.big, { color }]}>
                  {preview.realized >= 0 ? 'Plus-value' : 'Moins-value'} : {money(preview.realized, p.cost_currency, { sign: true })}
                </Text>
                <Text style={[s.small, { color: t.muted }]}>
                  {money(preview.proceeds, p.cost_currency)} ajoutés aux liquidités · il te restera {String(preview.remaining).replace('.', ',')} titres
                </Text>
              </>
            ) : (
              <Text style={[s.small, { color: preview ? t.danger : t.muted }]}>
                {preview && !preview.ok ? preview.error : 'Saisis la quantité et le prix pour voir la plus-value.'}
              </Text>
            )}
          </View>

          <PrimaryButton label="Vendre" onPress={save} disabled={!valid} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { fontSize: 24, fontWeight: '700' },
  small: { fontSize: 13 },
  big: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  preview: { padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
});
