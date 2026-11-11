import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';
import { isoDay } from './format';

export type AccountRow = {
  uid: string;
  bank: string;
  name: string | null;
  iban: string | null;
  currency: string | null;
  hidden: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  balance: number | null;
  balance_at: string | null;
  manual_balance: number | null;
  manual_balance_date: string | null;
  current_balance: number | null;
  balance_source: 'bank' | 'manual' | null;
  balance_eur: number | null;
};

export type Tx = {
  id: number;
  account_uid: string;
  booking_date: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  description: string | null;
  status: string | null;
  is_internal: boolean;
  internal_label: string | null;
  bank: string;
  iban: string | null;
  amount_eur: number;
};

/** Un « compte » affiché : Revolut EUR/USD/GBP partagent le même IBAN et sont regroupés. */
export type AccountGroup = {
  key: string;
  bank: string;
  name: string;
  iban: string | null;
  members: AccountRow[];
  balanceEur: number | null;
  lastSyncAt: string | null;
  error: string | null;
};

export function groupAccounts(rows: AccountRow[]): AccountGroup[] {
  const map = new Map<string, AccountGroup>();
  for (const r of rows) {
    if (r.hidden) continue;
    const key = r.iban ?? r.uid;
    let g = map.get(key);
    if (!g) {
      g = { key, bank: r.bank, name: r.name ?? 'Compte courant', iban: r.iban, members: [], balanceEur: null, lastSyncAt: null, error: null };
      map.set(key, g);
    }
    g.members.push(r);
    if (r.balance_eur != null) g.balanceEur = (g.balanceEur ?? 0) + Number(r.balance_eur);
    if (r.last_sync_at && (!g.lastSyncAt || r.last_sync_at > g.lastSyncAt)) g.lastSyncAt = r.last_sync_at;
    if (r.last_error) g.error = r.last_error;
  }
  // La devise principale (EUR) en premier, les comptes vides en dernier.
  for (const g of map.values()) {
    g.members.sort((a, b) => (a.currency === 'EUR' ? -1 : b.currency === 'EUR' ? 1 : Number(b.balance_eur ?? 0) - Number(a.balance_eur ?? 0)));
  }
  return [...map.values()].sort((a, b) => a.bank.localeCompare(b.bank, 'fr'));
}

export async function fetchAccounts(): Promise<AccountRow[]> {
  const { data, error } = await supabase.from('account_view').select('*');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    balance: r.balance == null ? null : Number(r.balance),
    current_balance: r.current_balance == null ? null : Number(r.current_balance),
    balance_eur: r.balance_eur == null ? null : Number(r.balance_eur),
    manual_balance: r.manual_balance == null ? null : Number(r.manual_balance),
  })) as AccountRow[];
}

const TX_COLS = 'id, account_uid, booking_date, amount, currency, counterparty, description, status, is_internal, internal_label, bank, iban, amount_eur';

const normTx = (r: Record<string, unknown>) => ({ ...r, amount: Number(r.amount), amount_eur: Number(r.amount_eur) }) as Tx;

export async function fetchAccountTx(uids: string[]): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('transaction_view')
    .select(TX_COLS)
    .in('account_uid', uids)
    .order('booking_date', { ascending: false })
    .order('id', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map(normTx);
}

export async function fetchMonthTx(month: Date): Promise<Tx[]> {
  const from = new Date(month.getFullYear(), month.getMonth(), 1);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const { data, error } = await supabase
    .from('transaction_view')
    .select(TX_COLS)
    .gte('booking_date', isoDay(from))
    .lt('booking_date', isoDay(to))
    .order('booking_date', { ascending: false })
    .order('id', { ascending: true })
    .limit(1000);
  if (error) throw error;
  return (data ?? []).map(normTx);
}

export async function setManualBalance(uid: string, amount: number | null) {
  const { error } = await supabase
    .from('accounts')
    .update({ manual_balance: amount, manual_balance_date: amount == null ? null : isoDay(new Date()) })
    .eq('uid', uid);
  if (error) throw error;
}

/** Budget de synchro du jour : 4 accès bancaires (DSP2), automatiques + manuels. */
export type SyncBudget = {
  daily_limit: number;
  used: number;
  auto_left: number;
  manual_left: number;
  next_auto: number | null;
};

export async function fetchSyncBudget(): Promise<SyncBudget> {
  const { data, error } = await supabase.rpc('sync_budget').single();
  if (error) throw error;
  return data as SyncBudget;
}

/** Heures (heure de Paris) des synchros automatiques, 0 à 4 par jour. */
export const MAX_AUTO_SYNCS = 4;

export async function fetchAutoHours(): Promise<number[]> {
  const { data, error } = await supabase.from('sync_settings').select('auto_hours').single();
  if (error) throw error;
  return (data.auto_hours as number[]) ?? [];
}

export async function saveAutoHours(hours: number[]) {
  const clean = [...new Set(hours)].sort((a, b) => a - b).slice(0, MAX_AUTO_SYNCS);
  const { error } = await supabase
    .from('sync_settings')
    .update({ auto_hours: clean, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw error;
}

/** Lance une synchro des banques maintenant. Renvoie un message d'erreur, ou null si tout est OK. */
export async function syncNow(): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('sync', { body: {} });
  if (error) {
    // Erreur HTTP de la fonction : son message est dans le corps JSON.
    const res = (error as { context?: Response }).context;
    const body = res ? await res.json().catch(() => null) : null;
    return body?.error ?? error.message;
  }
  if (data && data.ok === false) return 'Certaines banques n\'ont pas pu être synchronisées.';
  return null;
}

/** Libellé principal d'une transaction. */
export function txTitle(t: Tx): string {
  if (t.is_internal && t.internal_label) return t.internal_label;
  return t.counterparty || t.description || 'Opération';
}

export function txSubtitle(t: Tx): string {
  if (t.counterparty && t.description) return t.description;
  return '';
}

/** Regroupe une liste triée par date en sections pour SectionList. */
export function byDay(txs: Tx[]) {
  const sections: { title: string; data: Tx[] }[] = [];
  for (const t of txs) {
    const last = sections[sections.length - 1];
    if (last && last.title === t.booking_date) last.data.push(t);
    else sections.push({ title: t.booking_date, data: [t] });
  }
  return sections;
}

/** Charge des données, recharge à chaque retour sur l'écran et sur « tirer pour rafraîchir ». */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  useLayoutEffect(() => { fnRef.current = fn; });

  const load = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    }
  }, []);

  // Le premier chargement vient de useFocusEffect ; ici seulement quand les paramètres changent.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setData(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, refreshing, refresh, reload: load };
}
