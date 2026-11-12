// Patrimoine : comptes manuels, titres, positions, cours (fonction Edge `quotes`).
import { supabase } from './supabase';
import { functionError } from './data';
import { isoDay } from './format';

export type AccountKind = 'savings' | 'investment';
export type Envelope =
  | 'livret_a' | 'ldds' | 'lep' | 'livret' | 'pea' | 'pea_pme' | 'cto'
  | 'assurance_vie' | 'per' | 'epargne_salariale' | 'crypto' | 'autre';
export type InstrumentType = 'stock' | 'etf' | 'fund' | 'fcpe' | 'fonds_euros' | 'bond' | 'crypto' | 'other';
export type PriceSource = 'yahoo' | 'amf' | 'manual';

export const ENVELOPES: { value: Envelope; label: string; kind: AccountKind }[] = [
  { value: 'livret_a', label: 'Livret A', kind: 'savings' },
  { value: 'ldds', label: 'LDDS', kind: 'savings' },
  { value: 'lep', label: 'LEP', kind: 'savings' },
  { value: 'livret', label: 'Livret', kind: 'savings' },
  { value: 'pea', label: 'PEA', kind: 'investment' },
  { value: 'pea_pme', label: 'PEA-PME', kind: 'investment' },
  { value: 'cto', label: 'CTO', kind: 'investment' },
  { value: 'assurance_vie', label: 'Assurance-vie', kind: 'investment' },
  { value: 'per', label: 'PER', kind: 'investment' },
  { value: 'epargne_salariale', label: 'Épargne salariale', kind: 'investment' },
  { value: 'crypto', label: 'Crypto', kind: 'investment' },
  { value: 'autre', label: 'Autre', kind: 'savings' },
];
export const envelopeLabel = (e: Envelope) => ENVELOPES.find((x) => x.value === e)?.label ?? e;

export type ManualAccount = {
  id: string;
  name: string;
  institution: string | null;
  kind: AccountKind;
  envelope: Envelope;
  currency: string;
  cash_balance: number;
  cash_updated_at: string | null;
  hidden: boolean;
  sort_order: number;
  /** Compte rempli automatiquement (positions et liquidités en lecture seule). */
  sync_source: 'ibkr' | null;
  last_synced_at: string | null;
  sync_error: string | null;
  cash_eur: number | null;
  positions_value_eur: number;
  invested_eur: number;
  pnl_eur: number;
  pnl_pct: number | null;
  value_eur: number | null;
  missing_prices: number;
  positions: number;
};

export type PositionRow = {
  id: string;
  account_id: string;
  instrument_id: string;
  quantity: number;
  avg_cost: number;
  cost_currency: string;
  instrument_name: string;
  isin: string | null;
  type: InstrumentType;
  price_source: PriceSource;
  source_symbol: string | null;
  instrument_currency: string;
  last_price: number | null;
  last_price_date: string | null;
  price_error: string | null;
  value_eur: number | null;
  invested_eur: number | null;
  pnl_eur: number | null;
  pnl_pct: number | null;
};

export type SearchResult = {
  name: string;
  isin: string | null;
  symbol: string;
  exchange: string;
  currency: string | null;
  type: InstrumentType;
  source: 'yahoo' | 'amf';
};

/** Les colonnes numeric arrivent en texte : on les convertit. */
function nums<T>(row: Record<string, unknown>, keys: string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) out[k] = row[k] == null ? null : Number(row[k]);
  return out as T;
}

const ACCOUNT_NUMS = ['cash_balance', 'cash_eur', 'positions_value_eur', 'invested_eur', 'pnl_eur', 'pnl_pct', 'value_eur'];
const POSITION_NUMS = ['quantity', 'avg_cost', 'last_price', 'value_eur', 'invested_eur', 'pnl_eur', 'pnl_pct'];

export async function fetchManualAccounts(): Promise<ManualAccount[]> {
  const { data, error } = await supabase.from('manual_account_view').select('*')
    .order('sort_order').order('created_at');
  if (error) throw error;
  return (data ?? []).map((r) => nums<ManualAccount>(r, ACCOUNT_NUMS));
}

/** Lève une erreur si le compte n'existe plus (supprimé) : les écrans affichent alors l'erreur. */
export async function fetchManualAccount(id: string): Promise<ManualAccount> {
  const { data, error } = await supabase.from('manual_account_view').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Compte introuvable (supprimé ?).');
  return nums<ManualAccount>(data, ACCOUNT_NUMS);
}

export async function fetchPositions(accountId: string): Promise<PositionRow[]> {
  const { data, error } = await supabase.from('position_view').select('*')
    .eq('account_id', accountId).order('instrument_name');
  if (error) throw error;
  return (data ?? []).map((r) => nums<PositionRow>(r, POSITION_NUMS));
}

export async function fetchPosition(id: string): Promise<PositionRow> {
  const { data, error } = await supabase.from('position_view').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Position introuvable (supprimée ?).');
  return nums<PositionRow>(data, POSITION_NUMS);
}

/** Position déjà détenue sur ce titre dans ce compte, s'il y en a une. */
export async function findPosition(accountId: string, instrumentId: string) {
  const { data, error } = await supabase.from('positions').select('id, quantity, avg_cost, cost_currency')
    .eq('account_id', accountId).eq('instrument_id', instrumentId).maybeSingle();
  if (error) throw error;
  return data ? { ...data, quantity: Number(data.quantity), avg_cost: Number(data.avg_cost) } as
    { id: string; quantity: number; avg_cost: number; cost_currency: string } : null;
}

export type AccountInput = {
  id?: string;
  name: string;
  institution?: string | null;
  kind: AccountKind;
  envelope: Envelope;
  cash_balance: number;
  currency?: string;
};

/** Crée ou met à jour un compte manuel ; renvoie son id. */
export async function saveManualAccount(a: AccountInput): Promise<string> {
  const row = {
    name: a.name.trim(),
    institution: a.institution?.trim() || null,
    kind: a.kind,
    envelope: a.envelope,
    cash_balance: a.cash_balance,
    currency: a.currency ?? 'EUR',
    cash_updated_at: isoDay(new Date()),
  };
  const q = a.id
    ? supabase.from('manual_accounts').update(row).eq('id', a.id).select('id').single()
    : supabase.from('manual_accounts').insert(row).select('id').single();
  const { data, error } = await q;
  if (error) throw error;
  return data.id as string;
}

/** Récupère positions et liquidités du compte IBKR (Flex Web Service). Prend jusqu'à ~1 min. */
export async function syncIbkr(): Promise<{ date: string; positions: number; cash_eur: number; today?: number }> {
  const { data, error } = await supabase.functions.invoke('ibkr/sync', { body: {} });
  if (error) throw new Error(await functionError(error));
  return data;
}

export async function deleteManualAccount(id: string) {
  const { error } = await supabase.from('manual_accounts').delete().eq('id', id);
  if (error) throw error;
}

export async function searchInstruments(q: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.functions.invoke(`quotes/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
  if (error) throw new Error(await functionError(error));
  return data.results as SearchResult[];
}

export async function refreshQuotes(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.functions.invoke('quotes/refresh', { body: { ids } });
  if (error) throw new Error(await functionError(error));
}

export type ManualInstrument = { name: string; type: InstrumentType; currency?: string; price: number };

/**
 * Trouve ou crée le titre correspondant (une ligne par cotation) et renvoie son id.
 * Un titre coté reçoit son cours tout de suite ; un titre manuel prend le cours saisi.
 */
export async function upsertInstrument(r: SearchResult | ManualInstrument): Promise<string> {
  if ('symbol' in r) {
    const { data: found } = await supabase.from('instruments').select('id')
      .eq('source_symbol', r.symbol).maybeSingle();
    if (found) return found.id as string;
    const { data, error } = await supabase.from('instruments').insert({
      name: r.name, isin: r.isin, type: r.type, currency: r.currency ?? 'EUR',
      price_source: r.source, source_symbol: r.symbol,
    }).select('id').single();
    if (error) throw error;
    await refreshQuotes([data.id]).catch(() => undefined); // l'erreur reste visible via price_error
    return data.id as string;
  }
  const { data, error } = await supabase.from('instruments').insert({
    name: r.name.trim(), type: r.type, currency: r.currency ?? 'EUR', price_source: 'manual',
    // source_symbol unique pour qu'un même nom saisi deux fois reste deux lignes distinctes
    source_symbol: `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    last_price: r.price, last_price_date: isoDay(new Date()), price_updated_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  await supabase.from('instrument_prices').upsert({ instrument_id: data.id, date: isoDay(new Date()), price: r.price });
  return data.id as string;
}

/** Cours saisi à la main ; `currency` change aussi la devise d'un titre manuel. */
export async function setManualPrice(instrumentId: string, price: number, currency?: string) {
  const date = isoDay(new Date());
  const { error } = await supabase.from('instruments').update({
    last_price: price, last_price_date: date, price_updated_at: new Date().toISOString(), price_error: null,
    ...(currency ? { currency } : {}),
  }).eq('id', instrumentId);
  if (error) throw error;
  await supabase.from('instrument_prices').upsert({ instrument_id: instrumentId, date, price });
}

export type PositionInput = {
  id?: string;
  account_id: string;
  instrument_id: string;
  quantity: number;
  avg_cost: number;
  cost_currency?: string;
};

export async function savePosition(p: PositionInput) {
  const row = {
    account_id: p.account_id, instrument_id: p.instrument_id, quantity: p.quantity,
    avg_cost: p.avg_cost, cost_currency: p.cost_currency ?? 'EUR', updated_at: new Date().toISOString(),
  };
  // Pas d'upsert : un ajout sur un titre déjà détenu est fusionné par l'écran (mergePosition).
  const { error } = p.id
    ? await supabase.from('positions').update(row).eq('id', p.id)
    : await supabase.from('positions').insert(row);
  if (error) throw error;
}

export async function deletePosition(id: string) {
  const { error } = await supabase.from('positions').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Opérations (ventes, dividendes) et bilan fiscal ----------

export type OperationKind = 'sell' | 'dividend' | 'withholding';

export type Operation = {
  id: string;
  account_id: string;
  instrument_id: string | null;
  kind: OperationKind;
  date: string;
  quantity: number | null;
  price: number | null;
  fees: number;
  amount: number | null;
  tax_withheld: number;
  currency: string;
  avg_cost: number | null;
  realized: number | null;
  fx_per_eur: number;
  cash_credit: number;
  source: 'manual' | 'ibkr';
  note: string | null;
  instrument_name: string | null;
  account_name: string;
  envelope: Envelope;
  realized_eur: number | null;
  amount_eur: number | null;
};

export type TaxSummary = {
  year: number;
  pfu_rate: number;
  cto_gains: number;
  cto_losses: number;
  cto_net: number;
  carried_losses: number;
  taxable: number;
  loss_to_carry: number;
  cto_dividends: number;
  foreign_withholding: number;
  already_withheld: number;
  estimated_tax: number;
  remaining: number;
  pea_realized: number;
  pea_dividends: number;
};

const OPERATION_NUMS = ['quantity', 'price', 'fees', 'amount', 'tax_withheld', 'avg_cost', 'realized',
  'fx_per_eur', 'cash_credit', 'realized_eur', 'amount_eur'];
const TAX_NUMS = ['pfu_rate', 'cto_gains', 'cto_losses', 'cto_net', 'carried_losses', 'taxable', 'loss_to_carry',
  'cto_dividends', 'foreign_withholding', 'already_withheld', 'estimated_tax', 'remaining', 'pea_realized', 'pea_dividends'];

export async function fetchOperations(accountId: string): Promise<Operation[]> {
  const { data, error } = await supabase.from('operation_view').select('*')
    .eq('account_id', accountId).order('date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => nums<Operation>(r, OPERATION_NUMS));
}

/** Vend tout ou partie d'une position manuelle (positions et liquidités mises à jour côté serveur). */
export async function sellPosition(positionId: string, s: { quantity: number; price: number; fees: number; date: string }) {
  const { error } = await supabase.rpc('sell_position', {
    p_position: positionId, p_quantity: s.quantity, p_price: s.price, p_fees: s.fees, p_date: s.date,
  });
  if (error) throw error;
}

export async function addDividend(d: {
  account_id: string; instrument_id: string | null; date: string; amount: number; tax_withheld: number;
  currency: string; note?: string;
}) {
  const { error } = await supabase.rpc('add_dividend', {
    p_account: d.account_id, p_instrument: d.instrument_id, p_date: d.date, p_amount: d.amount,
    p_tax_withheld: d.tax_withheld, p_currency: d.currency, p_note: d.note ?? null,
  });
  if (error) throw error;
}

/** Supprime une opération manuelle (une vente rend les titres ; les liquidités sont reprises). */
export async function deleteOperation(id: string) {
  const { error } = await supabase.rpc('delete_operation', { p_op: id });
  if (error) throw error;
}

export async function fetchTaxSummary(year: number): Promise<TaxSummary> {
  const { data, error } = await supabase.rpc('tax_summary', { p_year: year }).single();
  if (error) throw error;
  return nums<TaxSummary>(data as Record<string, unknown>, TAX_NUMS);
}

export type RealizedByAccount = {
  account_id: string; account_name: string; envelope: Envelope; realized_eur: number; dividends_eur: number;
};

/** Plus-values réalisées et dividendes de l'année, compte par compte (EUR). */
export async function fetchRealizedByAccount(year: number): Promise<RealizedByAccount[]> {
  const { data, error } = await supabase.from('operation_view')
    .select('account_id, account_name, envelope, kind, realized_eur, amount_eur')
    .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
  if (error) throw error;
  const by = new Map<string, RealizedByAccount>();
  for (const r of data ?? []) {
    const a = by.get(r.account_id) ?? {
      account_id: r.account_id, account_name: r.account_name, envelope: r.envelope as Envelope,
      realized_eur: 0, dividends_eur: 0,
    };
    if (r.kind === 'sell') a.realized_eur += Number(r.realized_eur ?? 0);
    if (r.kind === 'dividend') a.dividends_eur += Number(r.amount_eur ?? 0);
    by.set(r.account_id, a);
  }
  return [...by.values()].sort((x, y) => x.account_name.localeCompare(y.account_name, 'fr'));
}

/** Années ayant au moins une opération, plus l'année en cours (la plus récente d'abord). */
export async function fetchOperationYears(): Promise<number[]> {
  const { data, error } = await supabase.from('operations').select('date').order('date', { ascending: true }).limit(1);
  if (error) throw error;
  const now = new Date().getFullYear();
  const first = data?.[0] ? Number(String(data[0].date).slice(0, 4)) : now;
  return Array.from({ length: now - Math.min(first, now) + 1 }, (_, i) => now - i);
}

export async function fetchTaxSettings(year: number): Promise<{ pfu_rate: number; carried_losses: number }> {
  const { data, error } = await supabase.from('tax_settings').select('pfu_rate, carried_losses').eq('year', year).maybeSingle();
  if (error) throw error;
  return { pfu_rate: Number(data?.pfu_rate ?? 0.314), carried_losses: Number(data?.carried_losses ?? 0) };
}

export async function saveTaxSettings(year: number, s: { pfu_rate: number; carried_losses: number }) {
  const { error } = await supabase.from('tax_settings').upsert({ year, ...s });
  if (error) throw error;
}
