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
  date: string;
  quantity: number;     // quantité vendue (positive)
  price: number;
  commission: number;   // frais (positifs)
  currency: string;
  fxRateToBase: number;
  realized: number;     // plus-value réalisée calculée par IBKR (FIFO), dans `currency`
};
export type FlexCashTx = {
  id: string;
  conid: string | null;
  type: 'dividend' | 'withholding';
  date: string;
  amount: number;
  currency: string;
  fxRateToBase: number;
  description: string;
};
export type FlexStatement = {
  accountId: string | null;
  date: string | null;
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

  // Ventes uniquement (les achats ne sont pas importés), niveau exécution.
  const trades = elements(xml, 'Trade')
    .filter((t) => t.buySell === 'SELL' && (t.levelOfDetail ?? 'EXECUTION') === 'EXECUTION' && t.tradeID)
    .map((t): FlexTrade => ({
      id: t.tradeID,
      conid: t.conid ?? '',
      date: isoDate(t.tradeDate) ?? '',
      quantity: Math.abs(num(t.quantity)),
      price: num(t.tradePrice),
      commission: Math.abs(num(t.ibCommission) || 0),
      currency: t.currency || 'USD',
      fxRateToBase: num(t.fxRateToBase) || 1,
      realized: num(t.fifoPnlRealized) || 0,
    }));

  const CASH_TYPES: Record<string, FlexCashTx['type']> = {
    'Dividends': 'dividend',
    'Payment In Lieu Of Dividends': 'dividend',
    'Withholding Tax': 'withholding',
  };
  const cashTx = elements(xml, 'CashTransaction')
    .filter((c) => CASH_TYPES[c.type ?? ''] && c.transactionID)
    .map((c): FlexCashTx => ({
      id: c.transactionID,
      conid: c.conid || null,
      type: CASH_TYPES[c.type],
      date: isoDate(c.dateTime ?? c.settleDate) ?? '',
      amount: num(c.amount),
      currency: c.currency || 'USD',
      fxRateToBase: num(c.fxRateToBase) || 1,
      description: c.description ?? '',
    }));

  return { accountId: st.accountId ?? null, date: isoDate(st.toDate), positions, cash, trades, cashTx };
}

/** « 20261105 » ou « 20261105;202000 » → « 2026-11-05 ». */
function isoDate(s: string | undefined): string | null {
  const m = s?.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
