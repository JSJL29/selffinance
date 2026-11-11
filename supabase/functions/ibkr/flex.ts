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
export type FlexStatement = {
  accountId: string | null;
  date: string | null;
  positions: FlexPosition[];
  cash: { currency: string; amount: number }[];
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
  const to = st.toDate?.match(/^(\d{4})(\d{2})(\d{2})/);

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

  return { accountId: st.accountId ?? null, date: to ? `${to[1]}-${to[2]}-${to[3]}` : null, positions, cash };
}
