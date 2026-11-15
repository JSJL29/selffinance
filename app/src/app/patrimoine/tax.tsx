import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLoad } from '@/lib/data';
import {
  fetchOperationYears, fetchRealizedByAccount, fetchTaxSettings, fetchTaxSummary, saveTaxSettings,
} from '@/lib/patrimoine';
import { money, parseAmount } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { showAlert } from '@/lib/dialog';
import { Chip, ErrorBox, Loading } from '@/components/ui';
import { BackLink, Field, PrimaryButton } from '@/components/form';

const PEA = ['pea', 'pea_pme'];

/** Bilan fiscal estimé d'une année : plus-values réalisées, dividendes, impôt (CTO) ; PEA indicatif. */
export default function Tax() {
  const t = useTheme();
  const years = useLoad(fetchOperationYears, [], 'operationYears');
  const [year, setYear] = useState(new Date().getFullYear());
  const summary = useLoad(() => fetchTaxSummary(year), [year], `tax:${year}`);
  const accounts = useLoad(() => fetchRealizedByAccount(year), [year], `taxAccounts:${year}`);

  const s = summary.data;
  const cto = (accounts.data ?? []).filter((a) => a.envelope === 'cto');
  const pea = (accounts.data ?? []).filter((a) => PEA.includes(a.envelope));
  const reload = async () => { await Promise.all([summary.reload(), accounts.reload()]); };

  return (
    <SafeAreaView edges={['top']} style={[st.flex, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={st.content}>
        <BackLink label="Patrimoine" fallback="/patrimoine" />
        <Text style={[st.title, { color: t.text }]}>Bilan fiscal</Text>
        <View style={st.chips}>
          {(years.data ?? [year]).map((y) => <Chip key={y} label={String(y)} on={y === year} onPress={() => setYear(y)} />)}
        </View>

        {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
        {!s ? (summary.error ? null : <Loading />) : (
          <>
            <Card title="CTO · imposable">
              {cto.length === 0 && <Line label="Aucune vente sur un CTO" value="" />}
              {cto.map((a) => <Line key={a.account_id} label={a.account_name} value={signed(a.realized_eur)} tone={a.realized_eur} />)}
              <Line label="Plus-values" value={signed(s.cto_gains)} />
              <Line label="Moins-values" value={signed(s.cto_losses)} />
              <Line label="Net de l’année" value={signed(s.cto_net)} tone={s.cto_net} strong />
              {s.carried_losses > 0 && <Line label="Moins-values reportées" value={signed(-s.carried_losses)} />}
              <Line label="Plus-value imposable" value={money(s.taxable)} strong />
              {s.loss_to_carry > 0 && (
                <Line label={`Moins-value à reporter sur ${year + 1}`} value={money(s.loss_to_carry)} tone={-1} />
              )}
              <Line label="Dividendes (brut)" value={money(s.cto_dividends)} />
              {s.foreign_withholding > 0 && (
                <Line label="Retenues étrangères (non déduites)" value={money(s.foreign_withholding)} muted />
              )}
            </Card>

            <Card title={`Impôt estimé · flat tax ${String(Math.round(s.pfu_rate * 1000) / 10).replace('.', ',')} %`}>
              <Line label="Impôt estimé" value={money(s.estimated_tax)} strong />
              <Line label="Déjà prélevé par tes courtiers" value={money(s.already_withheld)} />
              <Line label="Reste à payer (estimé)" value={money(s.remaining)} tone={-s.remaining} strong />
            </Card>

            <Card title="PEA · non imposé tant que tu ne retires rien">
              {pea.length === 0 && <Line label="Aucune opération sur un PEA" value="" />}
              {pea.map((a) => <Line key={a.account_id} label={a.account_name} value={signed(a.realized_eur)} tone={a.realized_eur} />)}
              {s.pea_dividends > 0 && <Line label="Dividendes" value={money(s.pea_dividends)} />}
            </Card>

            <Settings key={year} year={year} onSaved={reload} />

            <Text style={[st.note, { color: t.muted }]}>
              Estimation. Seules les ventes réalisées comptent ; les plus et moins-values de tous tes CTO s’additionnent.
              Les montants en devises sont convertis au taux du jour de l’opération. Le relevé fiscal (IFU) de tes
              courtiers français fait foi ; pour IBKR, c’est à toi de déclarer.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const signed = (n: number) => money(n, 'EUR', { sign: true });

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[st.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Text style={[st.cardTitle, { color: t.muted }]}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Line({ label, value, tone, strong, muted }: {
  label: string; value: string; tone?: number; strong?: boolean; muted?: boolean;
}) {
  const t = useTheme();
  const color = muted ? t.muted : tone == null || tone === 0 ? t.text : tone > 0 ? t.success : t.danger;
  return (
    <View style={st.line}>
      <Text style={[st.lineLabel, { color: muted ? t.muted : t.text, fontWeight: strong ? '600' : '400' }]}>{label}</Text>
      <Text style={[st.lineValue, { color, fontWeight: strong ? '700' : '500' }]}>{value}</Text>
    </View>
  );
}

/** Taux PFU et moins-values reportées de l'année, modifiables. */
function Settings({ year, onSaved }: { year: number; onSaved: () => Promise<void> }) {
  const t = useTheme();
  const current = useLoad(() => fetchTaxSettings(year), [year]);
  const [rate, setRate] = useState<string | null>(null);
  const [losses, setLosses] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!current.data) return null;

  const rateText = rate ?? String(Math.round(current.data.pfu_rate * 1000) / 10).replace('.', ',');
  const lossesText = losses ?? String(current.data.carried_losses).replace('.', ',');
  const nRate = parseAmount(rateText);
  const nLosses = lossesText.trim() === '' ? 0 : parseAmount(lossesText);
  const valid = nRate != null && nRate >= 0 && nRate <= 100 && nLosses != null && nLosses >= 0;

  async function save() {
    setBusy(true);
    try {
      await saveTaxSettings(year, { pfu_rate: nRate! / 100, carried_losses: nLosses! });
      // Relire les réglages enregistrés, sinon les champs réafficheraient l'ancienne valeur.
      await Promise.all([current.reload(), onSaved()]);
      setRate(null);
      setLosses(null);
    } catch (e) {
      showAlert('Réglages fiscaux', e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[st.card, { backgroundColor: t.card, borderColor: t.border, gap: 12 }]}>
      <Text style={[st.cardTitle, { color: t.muted }]}>RÉGLAGES {year}</Text>
      <Field label="Taux de la flat tax (%)" value={rateText} onChangeText={setRate} keyboardType="decimal-pad"
        hint="31,4 % en 2026 (12,8 % d’impôt + 18,6 % de prélèvements sociaux)." />
      <Field label="Moins-values reportées des années passées (€)" value={lossesText} onChangeText={setLosses}
        keyboardType="decimal-pad" hint="Montant figurant sur ta dernière déclaration (case des moins-values reportables)." />
      <PrimaryButton label="Enregistrer" onPress={save} disabled={!valid || (rate == null && losses == null)} busy={busy} />
    </View>
  );
}

const st = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  cardTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineLabel: { fontSize: 14, flexShrink: 1 },
  lineValue: { fontSize: 14, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, lineHeight: 17 },
});
