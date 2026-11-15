import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLoad } from '@/lib/data';
import {
  PositionRow, SearchResult, deletePosition, fetchPosition, findPosition, savePosition, searchInstruments, setManualPrice,
  upsertInstrument,
} from '@/lib/patrimoine';
import { canEditPrice, mergePosition } from '@/lib/positions';
import { money, parseAmount } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Chip, ErrorBox, Loading } from '@/components/ui';
import { BackLink, CurrencyPicker, DangerLink, Field, PrimaryButton, currencySymbol } from '@/components/form';
import { showAlert } from '@/lib/dialog';
import { goBack } from '@/lib/nav';

type Mode = 'quoted' | 'value' | 'unlisted';
const MODES: { value: Mode; label: string }[] = [
  { value: 'quoted', label: 'Titre coté' },
  { value: 'value', label: 'Fonds euros / montant' },
  { value: 'unlisted', label: 'Non coté (FCPE…)' },
];

const fmt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));

/** Ajout (sans `id`) ou modification d'une position d'un compte d'investissement. */
export default function PositionEdit() {
  const { accountId, id } = useLocalSearchParams<{ accountId: string; id?: string }>();
  const existing = useLoad(() => (id ? fetchPosition(id) : Promise.resolve(null)), [id]);
  if (!id) return <NewForm accountId={accountId} />;
  if (existing.error) return <Screen title="Position"><ErrorBox message={existing.error} onRetry={existing.reload} /></Screen>;
  if (!existing.data) return <Loading />;
  return <EditForm key={existing.data.id} p={existing.data} />;
}

/** Demande confirmation avant d'ajouter un achat à une position déjà détenue. */
function confirmMerge(name: string, held: number, cur: string): Promise<boolean> {
  return new Promise((resolve) => showAlert(
    'Titre déjà détenu',
    `Tu as déjà ${fmt(held)} × ${name} sur ce compte. Les quantités seront additionnées et le PRU recalculé (moyenne pondérée, ${cur}).`,
    [
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Additionner', onPress: () => resolve(true) },
    ],
    { cancelable: true, onDismiss: () => resolve(false) },
  ));
}

// ---------- Nouvelle position ----------
function NewForm({ accountId }: { accountId: string }) {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('quoted');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState<string>('EUR');
  const [busy, setBusy] = useState(false);
  const sym = currencySymbol(currency);

  // Recherche avec un délai de 400 ms après la dernière frappe.
  useEffect(() => {
    if (mode !== 'quoted' || picked || q.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchInstruments(q.trim());
        if (!cancelled) { setResults(r); setSearchError(null); }
      } catch (e) {
        if (!cancelled) setSearchError(errMsg(e));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [q, mode, picked]);

  const nQty = parseAmount(qty);
  const nCost = parseAmount(cost);
  const nPrice = parseAmount(price);
  const valid =
    mode === 'quoted' ? !!picked && nQty != null && nQty > 0 && nCost != null && nCost >= 0
    : mode === 'value' ? name.trim() !== '' && nCost != null && nPrice != null
    : name.trim() !== '' && nQty != null && nQty > 0 && nCost != null && nPrice != null;

  async function save() {
    setBusy(true);
    try {
      const instrumentId =
        mode === 'quoted' ? await upsertInstrument(picked!)
        : await upsertInstrument({ name, type: mode === 'value' ? 'fonds_euros' : 'fcpe', currency, price: nPrice! });
      const added = { quantity: mode === 'value' ? 1 : nQty!, avg_cost: nCost! };
      // Titre déjà détenu sur ce compte : on additionne au lieu d'écraser.
      const held = await findPosition(accountId, instrumentId);
      if (held) {
        if (held.cost_currency !== currency) {
          showAlert('Devise différente',
            `Ta position existante a un PRU en ${currencySymbol(held.cost_currency)}. Saisis cet achat dans la même devise.`);
          return;
        }
        if (!(await confirmMerge(picked?.name ?? name, held.quantity, held.cost_currency))) return;
        await savePosition({ id: held.id, account_id: accountId, instrument_id: instrumentId,
          cost_currency: held.cost_currency, ...mergePosition(held, added) });
      } else {
        await savePosition({ account_id: accountId, instrument_id: instrumentId, cost_currency: currency, ...added });
      }
      goBack({ pathname: '/patrimoine/account/[id]', params: { id: accountId } });
    } catch (e) {
      showAlert('Position', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Nouvelle position">
      <View style={s.chips}>
        {MODES.map((m) => <Chip key={m.value} label={m.label} on={mode === m.value} onPress={() => setMode(m.value)} />)}
      </View>

      {mode === 'quoted' && (
        picked ? (
          <Pressable onPress={() => { setPicked(null); setResults(null); }} style={[s.picked, { backgroundColor: t.card, borderColor: t.primary }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.name, { color: t.text }]}>{picked.name}</Text>
              <Text style={[s.small, { color: t.muted }]}>{[picked.symbol, picked.exchange, picked.currency].filter(Boolean).join(' · ')}</Text>
            </View>
            <Text style={{ color: t.primary }}>Changer</Text>
          </Pressable>
        ) : (
          <>
            <Field label="Titre" value={q} onChangeText={setQ} placeholder="ISIN ou nom (ex. FR0000120073, Amundi MSCI World)" autoCorrect={false} autoCapitalize="characters" />
            {searching && <ActivityIndicator color={t.primary} />}
            {searchError && <Text style={{ color: t.danger }}>{searchError}</Text>}
            {results?.map((r) => (
              <Pressable
                key={r.symbol} onPress={() => setPicked(r)}
                style={({ pressed }) => [s.result, { backgroundColor: pressed ? t.border : t.card, borderColor: t.border }]}>
                <Text style={[s.name, { color: t.text }]} numberOfLines={1}>{r.name}</Text>
                <Text style={[s.small, { color: t.muted }]}>{[r.symbol, r.exchange, r.currency].filter(Boolean).join(' · ')}</Text>
              </Pressable>
            ))}
            {results?.length === 0 && !searching && (
              <Text style={[s.small, { color: t.muted }]}>
                Aucun résultat. Pour un fonds d’entreprise ou un titre non coté, choisis « Non coté ».
              </Text>
            )}
          </>
        )
      )}

      {mode !== 'quoted' && (
        <Field label="Nom" value={name} onChangeText={setName}
          placeholder={mode === 'value' ? 'Fonds euros Generali' : 'Natixis Avenir 4, FCPE Mon Entreprise…'} />
      )}

      <CurrencyPicker
        value={currency} onChange={setCurrency}
        label={mode === 'quoted' ? 'Devise du PRU' : 'Devise des montants'}
      />

      {mode === 'value' ? (
        <>
          <Field label={`Montant versé (${sym})`} value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0,00" />
          <Field label={`Valeur actuelle (${sym})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0,00"
            hint="À mettre à jour de temps en temps (relevé annuel, espace client)." />
        </>
      ) : (
        <>
          <Field label="Quantité" value={qty} onChangeText={setQty} keyboardType="decimal-pad" placeholder="Nombre de titres ou de parts" />
          <Field label={`Prix de revient unitaire (PRU) en ${sym}`} value={cost} onChangeText={setCost} keyboardType="decimal-pad"
            placeholder="0,00"
            hint={currency === 'EUR'
              ? 'Affiché par ton courtier (PRU, prix moyen d’achat). En €, la plus-value inclut l’effet de change.'
              : 'En $, la plus-value est calculée au taux du jour (hors effet de change).'} />
          {mode === 'unlisted' && (
            <Field label={`Valeur actuelle d’une part (${sym})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0,00" />
          )}
        </>
      )}

      <PrimaryButton label="Ajouter" onPress={save} disabled={!valid} busy={busy} />
    </Screen>
  );
}

// ---------- Modification ----------
function EditForm({ p }: { p: PositionRow }) {
  const t = useTheme();
  const valueLine = p.type === 'fonds_euros';
  const manual = p.price_source === 'manual';
  const editPrice = canEditPrice(p); // titre manuel, ou titre coté dont le cours est introuvable
  const [qty, setQty] = useState(fmt(p.quantity));
  const [cost, setCost] = useState(fmt(p.avg_cost));
  const [price, setPrice] = useState(fmt(p.last_price));
  const [currency, setCurrency] = useState<string>(p.cost_currency);
  const [busy, setBusy] = useState(false);
  const sym = currencySymbol(currency);
  // Titre manuel : la valeur est dans la même devise que les montants saisis.
  const priceSym = manual ? sym : currencySymbol(p.instrument_currency);

  const nQty = valueLine ? 1 : parseAmount(qty);
  const nCost = parseAmount(cost);
  const nPrice = parseAmount(price);
  const valid = nQty != null && nQty > 0 && nCost != null && (!manual || nPrice != null);

  async function save() {
    setBusy(true);
    try {
      await savePosition({ id: p.id, account_id: p.account_id, instrument_id: p.instrument_id, quantity: nQty!, avg_cost: nCost!, cost_currency: currency });
      const currencyChanged = manual && currency !== p.instrument_currency;
      if (editPrice && nPrice != null && (nPrice !== p.last_price || currencyChanged)) {
        await setManualPrice(p.instrument_id, nPrice, manual ? currency : undefined);
      }
      goBack({ pathname: '/patrimoine/account/[id]', params: { id: p.account_id } });
    } catch (e) {
      showAlert('Position', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    showAlert(`Supprimer « ${p.instrument_name} » ?`, undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await deletePosition(p.id);
            goBack({ pathname: '/patrimoine/account/[id]', params: { id: p.account_id } });
          } catch (e) {
            showAlert('Position', errMsg(e));
          }
        },
      },
    ]);
  }

  return (
    <Screen title={p.instrument_name}>
      <Text style={[s.small, { color: t.muted }]}>
        {[p.isin, p.source_symbol?.startsWith('manual:') ? null : p.source_symbol].filter(Boolean).join(' · ')}
        {!manual && p.last_price != null ? `  ·  cours ${money(p.last_price, p.instrument_currency)}` : ''}
      </Text>
      <CurrencyPicker value={currency} onChange={setCurrency} label={manual ? 'Devise des montants' : 'Devise du PRU'} />
      {valueLine ? (
        <>
          <Field label={`Montant versé (${sym})`} value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
          <Field label={`Valeur actuelle (${sym})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        </>
      ) : (
        <>
          <Field label="Quantité" value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
          <Field label={`PRU (${sym})`} value={cost} onChangeText={setCost} keyboardType="decimal-pad" />
          {editPrice && (
            <Field
              label={`Valeur actuelle d’une part (${priceSym})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad"
              hint={manual ? undefined : 'Cours introuvable automatiquement : saisis-le à la main.'}
            />
          )}
        </>
      )}
      <PrimaryButton label="Enregistrer" onPress={save} disabled={!valid} busy={busy} />
      {!valueLine && (
        <Pressable
          onPress={() => router.push({ pathname: '/patrimoine/sell', params: { positionId: p.id } })}
          style={({ pressed }) => [s.sell, { borderColor: t.primary, backgroundColor: pressed ? t.border : 'transparent' }]}>
          <Text style={{ color: t.primary, fontSize: 16, fontWeight: '600' }}>Vendre</Text>
        </Pressable>
      )}
      <Text style={[s.small, { color: t.muted }]}>
        « Vendre » enregistre la plus-value réalisée pour ton bilan fiscal. « Supprimer » efface la ligne sans rien enregistrer.
      </Text>
      <DangerLink label="Supprimer cette position" onPress={remove} />
    </Screen>
  );
}

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <BackLink label="Compte" fallback="/patrimoine" />
          <Text style={[s.title, { color: t.text }]} numberOfLines={2}>{title}</Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { fontSize: 26, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  name: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13 },
  sell: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  picked: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  result: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
});
