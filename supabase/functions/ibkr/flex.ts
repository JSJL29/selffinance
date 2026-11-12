// Lecture des réponses du Flex Web Service d'IBKR (module pur, testé dans flex.test.ts).

export type FlexPosition = {
  conid: string;
  symbol: string;
  name: string;
  isin: string | null;
  currency: string;
  type: 'stock' | 'fund' | 'bond' | 'crypto' | 'other';
  exchange: string | null;
  quantity: number;
  markPrice: number;
  costBasisPrice: number;
};
export type FlexTrade = {
  id: string;
  conid: string;
  symbol: string;
  name: string;
  isin: string | null;
  type: FlexPosition['type'];
  side: 'BUY' | 'SELL';
  date: string;
  quantity: number;     // quantité achetée ou vendue (positive)
  price: number;
  commission: number;   // frais (positifs)
  currency: string;
  fxRateToBase: number | null;   // null si absent du relevé (taux à prendre ailleurs)
  realized: number;     // plus-value réalisée calculée par IBKR (FIFO), dans `currency` ; 0 pour un achat
};
export type FlexCashTx = {
  id: string;
  conid: string | null;
  type: 'dividend' | 'withholding';
  date: string;
  amount: number;
  currency: string;
  fxRateToBase: number | null;
  description: string;
};
export type FlexStatement = {
  accountId: string | null;
  date: string | null;
  hasTrades: boolean;   // section Trades présente : le relevé fait foi pour les ordres jusqu'à `date`
  positions: FlexPosition[];
  cash: { currency: string; amount: number }[];
  trades: FlexTrade[];
  cashTx: FlexCashTx[];
};
export type FlexResponse = {
  status: string | null;
  referenceCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);

/** Attributs de chaque balise `<tag … />` ou `<tag …>`. */
function elements(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}\\s([^>]*?)\\/?>`, 'g'))) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
    out.push(attrs);
  }
  return out;
}

const text = (xml: string, tag: string) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? decode(m[1].trim()) : null;
};

const TYPES: Record<string, FlexPosition['type']> = { STK: 'stock', FUND: 'fund', BOND: 'bond', CRYPTO: 'crypto' };
const num = (s: string | undefined) => (s == null || s === '' ? NaN : Number(s));

/** Réponse de SendRequest ou de GetStatement quand le relevé n'est pas prêt. */
export function parseFlexResponse(xml: string): FlexResponse {
  return {
    status: text(xml, 'Status'),
    referenceCode: text(xml, 'ReferenceCode'),
    errorCode: text(xml, 'ErrorCode'),
    errorMessage: text(xml, 'ErrorMessage'),
  };
}

/** Relevé Flex (Open Positions + Cash Report). */
export function parseStatement(xml: string): FlexStatement {
  if (!xml.includes('<FlexQueryResponse')) throw new Error('Réponse IBKR inattendue : pas de relevé Flex.');
  const st = elements(xml, 'FlexStatement')[0] ?? {};

  const positions = elements(xml, 'OpenPosition')
    .filter((p) => (p.levelOfDetail ?? 'SUMMARY') === 'SUMMARY' && p.assetCategory !== 'CASH')
    .map((p): FlexPosition => ({
      conid: p.conid ?? `${p.symbol}@${p.listingExchange ?? ''}`,
      symbol: p.symbol ?? '',
      name: p.description || p.symbol || '',
      isin: p.isin || null,
      currency: p.currency || 'USD',
      type: TYPES[p.assetCategory ?? ''] ?? 'other',
      exchange: p.listingExchange || null,
      quantity: num(p.position),
      markPrice: num(p.markPrice),
      costBasisPrice: num(p.costBasisPrice),
    }))
    .filter((p) => Number.isFinite(p.quantity) && p.quantity !== 0);

  const cash = elements(xml, 'CashReportCurrency')
    .filter((c) => c.currency && c.currency !== 'BASE_SUMMARY' && Number.isFinite(num(c.endingCash)))
    .map((c) => ({ currency: c.currency, amount: num(c.endingCash) }));

  // Achats et ventes de titres (pas les conversions de devises « CASH », ni les dérivés),
  // niveau exécution ; une ligne sans date est ignorée plutôt que de bloquer toute la synchro.
  const trades = elements(xml, 'Trade')
    .filter((t) => (t.buySell === 'BUY' || t.buySell === 'SELL') && (t.levelOfDetail ?? 'EXECUTION') === 'EXECUTION' && t.tradeID
      && TYPES[t.assetCategory ?? ''] && isoDate(t.tradeDate))
    .map((t): FlexTrade => ({
      id: t.tradeID,
      conid: t.conid ?? '',
      symbol: t.symbol ?? '',
      name: t.description || t.symbol || '',
      isin: t.isin || null,
      type: TYPES[t.assetCategory ?? ''] ?? 'other',
      side: t.buySell as 'BUY' | 'SELL',
      date: isoDate(t.tradeDate)!,
      quantity: Math.abs(num(t.quantity)),
      price: num(t.tradePrice),
      commission: Math.abs(num(t.ibCommission) || 0),
      currency: t.currency || 'USD',
      fxRateToBase: rate(t.fxRateToBase),
      realized: t.buySell === 'SELL' ? num(t.fifoPnlRealized) || 0 : 0,
    }));

  const CASH_TYPES: Record<string, FlexCashTx['type']> = {
    'Dividends': 'dividend',
    'Payment In Lieu Of Dividends': 'dividend',
    'Withholding Tax': 'withholding',
  };
  const cashDate = (c: Record<string, string>) => isoDate(c.dateTime) ?? isoDate(c.settleDate) ?? isoDate(c.reportDate);
  const cashTx = elements(xml, 'CashTransaction')
    .filter((c) => CASH_TYPES[c.type ?? ''] && c.transactionID && cashDate(c) && Number.isFinite(num(c.amount)))
    .map((c): FlexCashTx => ({
      id: c.transactionID,
      conid: c.conid || null,
      type: CASH_TYPES[c.type],
      date: cashDate(c)!,
      amount: num(c.amount),
      currency: c.currency || 'USD',
      fxRateToBase: rate(c.fxRateToBase),
      description: c.description ?? '',
    }));

  return {
    accountId: st.accountId ?? null, date: isoDate(st.toDate), hasTrades: /<Trades[\s>/]/.test(xml),
    positions, cash, trades, cashTx,
  };
}

/** Taux vers la devise de base ; null s'il est absent ou invalide (jamais 1 par défaut). */
function rate(s: string | undefined): number | null {
  const n = num(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** « 20261105 » ou « 20261105;202000 » → « 2026-11-05 ». */
function isoDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ---------- Ordres du jour (Trade Confirmation Flex Query, période « Aujourd'hui ») ----------

export type FlexConfirm = {
  id: string;
  conid: string;
  symbol: string;
  name: string;
  isin: string | null;
  type: FlexPosition['type'];
  date: string;
  side: 'BUY' | 'SELL';
  quantity: number;     // positive
  price: number;
  commission: number;   // positive
  currency: string;
};

/** Exécutions de titres du jour. Ignore les lignes « ordre », le change (CASH), les dérivés et les annulations. */
export function parseConfirmations(xml: string): FlexConfirm[] {
  if (!xml.includes('<FlexQueryResponse')) throw new Error('Réponse IBKR inattendue : pas de relevé Flex.');
  return elements(xml, 'TradeConfirm')
    .filter((t) => (t.buySell === 'BUY' || t.buySell === 'SELL')
      && (t.levelOfDetail ?? 'EXECUTION') === 'EXECUTION' && t.tradeID && t.conid
      && TYPES[t.assetCategory ?? ''] && isoDate(t.tradeDate)
      && Number.isFinite(num(t.quantity)) && Number.isFinite(num(t.price ?? t.tradePrice)))
    .map((t): FlexConfirm => ({
      id: t.tradeID,
      conid: t.conid,
      symbol: t.symbol ?? '',
      name: t.description || t.symbol || '',
      isin: t.isin || null,
      type: TYPES[t.assetCategory ?? ''],
      date: isoDate(t.tradeDate)!,
      side: t.buySell as 'BUY' | 'SELL',
      quantity: Math.abs(num(t.quantity)),
      price: num(t.price ?? t.tradePrice),
      commission: Math.abs(num(t.commission ?? t.ibCommission) || 0),
      currency: t.currency || 'USD',
    }));
}

/** Ordre du jour pour l'historique : PRU au moment de l'ordre et plus-value provisoire (ventes). */
export type TodayOp = FlexConfirm & { avgCost: number | null; realized: number | null };

/**
 * Ajoute au relevé de la veille les ordres exécutés depuis (date > `statementDate`) :
 * achat → quantité + PRU moyen (frais inclus, comme IBKR) ; vente → quantité, PRU inchangé ;
 * espèces débitées ou créditées dans la devise de l'ordre. Le lendemain, le relevé officiel les contient déjà.
 * `ops` : ces ordres pour l'historique ; plus-value d'une vente = (prix − PRU) × quantité − frais (PRU moyen,
 * règle française), null si le titre n'est pas connu.
 */
export function applyTodayTrades(
  positions: FlexPosition[], cash: { currency: string; amount: number }[],
  confirms: FlexConfirm[], statementDate: string,
) {
  const pos = new Map(positions.map((p) => [p.conid, { ...p }]));
  const money = new Map(cash.map((c) => [c.currency, c.amount]));
  const ops: TodayOp[] = [];
  for (const t of confirms) {
    if (t.date <= statementDate) continue;
    const p = pos.get(t.conid);
    const gross = t.quantity * t.price;
    const avgCost = t.side === 'SELL' && p ? p.costBasisPrice : null;
    ops.push({ ...t, avgCost, realized: avgCost == null ? null : (t.price - avgCost) * t.quantity - t.commission });
    if (t.side === 'BUY') {
      if (p) {
        const q = p.quantity + t.quantity;
        p.costBasisPrice = (p.quantity * p.costBasisPrice + gross + t.commission) / q;
        p.quantity = q;
      } else {
        pos.set(t.conid, {
          conid: t.conid, symbol: t.symbol, name: t.name, isin: t.isin, currency: t.currency, type: t.type,
          exchange: null, quantity: t.quantity, markPrice: t.price, costBasisPrice: (gross + t.commission) / t.quantity,
        });
      }
      money.set(t.currency, (money.get(t.currency) ?? 0) - gross - t.commission);
    } else {
      if (p) p.quantity -= t.quantity;
      money.set(t.currency, (money.get(t.currency) ?? 0) + gross - t.commission);
    }
  }
  return {
    applied: ops.length,
    ops,
    positions: [...pos.values()].filter((p) => Math.abs(p.quantity) > 1e-9),
    cash: [...money].map(([currency, amount]) => ({ currency, amount })),
  };
}
