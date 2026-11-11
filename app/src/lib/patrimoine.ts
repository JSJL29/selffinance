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

export async function fetchManualAccount(id: string): Promise<ManualAccount | null> {
  const { data, error } = await supabase.from('manual_account_view').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? nums<ManualAccount>(data, ACCOUNT_NUMS) : null;
}

export async function fetchPositions(accountId: string): Promise<PositionRow[]> {
  const { data, error } = await supabase.from('position_view').select('*')
    .eq('account_id', accountId).order('instrument_name');
  if (error) throw error;
  return (data ?? []).map((r) => nums<PositionRow>(r, POSITION_NUMS));
}

export type AccountInput = {
  id?: string;
  name: string;
  institution?: string | null;
  kind: AccountKind;
  envelope: Envelope;
  cash_balance: number;
};

/** Crée ou met à jour un compte manuel ; renvoie son id. */
export async function saveManualAccount(a: AccountInput): Promise<string> {
  const row = {
    name: a.name.trim(),
    institution: a.institution?.trim() || null,
    kind: a.kind,
    envelope: a.envelope,
    cash_balance: a.cash_balance,
    cash_updated_at: isoDay(new Date()),
  };
  const q = a.id
    ? supabase.from('manual_accounts').update(row).eq('id', a.id).select('id').single()
    : supabase.from('manual_accounts').insert(row).select('id').single();
  const { data, error } = await q;
  if (error) throw error;
  return data.id as string;
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

export async function setManualPrice(instrumentId: string, price: number) {
  const date = isoDay(new Date());
  const { error } = await supabase.from('instruments').update({
    last_price: price, last_price_date: date, price_updated_at: new Date().toISOString(), price_error: null,
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
  const { error } = p.id
    ? await supabase.from('positions').update(row).eq('id', p.id)
    : await supabase.from('positions').upsert(row, { onConflict: 'account_id,instrument_id' });
  if (error) throw error;
}

export async function deletePosition(id: string) {
  const { error } = await supabase.from('positions').delete().eq('id', id);
  if (error) throw error;
}
