// Lancer : node --test supabase/functions/ibkr/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexResponse, parseStatement } from './flex.ts';

const STATEMENT = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="selffinance" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20261110" toDate="20261110" period="LastBusinessDay" whenGenerated="20261111;071500">
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" listingExchange="NASDAQ" position="10" markPrice="200.5" costBasisPrice="150.25" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" listingExchange="NASDAQ" position="4" markPrice="200.5" costBasisPrice="140" levelOfDetail="LOT" />
<OpenPosition accountId="U1234567" currency="EUR" assetCategory="STK" symbol="CSPX" description="ISHARES CORE S&amp;P 500" conid="75776072" isin="IE00B5BMR087" listingExchange="AEB" position="3" markPrice="600" costBasisPrice="550" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1234567" currency="USD" assetCategory="CASH" symbol="EUR.USD" description="EUR.USD" conid="12087792" isin="" listingExchange="IDEALPRO" position="100" markPrice="1.1" costBasisPrice="1.08" levelOfDetail="SUMMARY" />
</OpenPositions>
<CashReport>
<CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" endingCash="1234.5" />
<CashReportCurrency accountId="U1234567" currency="EUR" levelOfDetail="Currency" endingCash="1000" />
<CashReportCurrency accountId="U1234567" currency="USD" levelOfDetail="Currency" endingCash="250.75" />
</CashReport>
<Trades>
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.9" assetCategory="STK" symbol="AAPL" conid="265598" tradeID="110" tradeDate="20261104" quantity="3" tradePrice="290" ibCommission="-1" fifoPnlRealized="0" buySell="BUY" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.9" assetCategory="STK" symbol="AAPL" description="APPLE INC" isin="US0378331005" conid="265598" tradeID="111" tradeDate="20261105" quantity="-2" tradePrice="300" ibCommission="-1" fifoPnlRealized="24.5" buySell="SELL" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.92" assetCategory="CASH" symbol="EUR.USD" conid="12087792" tradeID="112" tradeDate="20261105" quantity="-1000" tradePrice="1.08" ibCommission="-2" fifoPnlRealized="0" buySell="SELL" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.92" assetCategory="OPT" symbol="AAPL 261218C00300000" conid="999" tradeID="113" tradeDate="20261105" quantity="-1" tradePrice="5" ibCommission="-1" fifoPnlRealized="400" buySell="SELL" levelOfDetail="EXECUTION" />
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.92" assetCategory="STK" symbol="MSFT" conid="272093" tradeID="114" tradeDate="" quantity="-1" tradePrice="500" ibCommission="-1" fifoPnlRealized="10" buySell="SELL" levelOfDetail="EXECUTION" />
</Trades>
<CashTransactions>
<CashTransaction accountId="U1234567" currency="USD" fxRateToBase="0.9" conid="265598" type="Dividends" amount="3.2" dateTime="20261106" description="AAPL CASH DIVIDEND" transactionID="222" />
<CashTransaction accountId="U1234567" currency="USD" fxRateToBase="0.9" conid="265598" type="Withholding Tax" amount="-0.48" dateTime="20261106;202000" description="AAPL US TAX" transactionID="223" />
<CashTransaction accountId="U1234567" currency="EUR" fxRateToBase="1" conid="" type="Deposits/Withdrawals" amount="500" dateTime="20261101" description="DEPOT" transactionID="224" />
<CashTransaction accountId="U1234567" currency="USD" conid="272093" type="Dividends" amount="1.5" dateTime="" settleDate="20261107" description="MSFT CASH DIVIDEND" transactionID="225" />
</CashTransactions>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

test('parseStatement lit les positions SUMMARY (ignore les LOT et le change CASH)', () => {
  const s = parseStatement(STATEMENT);
  assert.equal(s.accountId, 'U1234567');
  assert.deepEqual(s.positions, [
    { conid: '265598', symbol: 'AAPL', name: 'APPLE INC', isin: 'US0378331005', currency: 'USD', type: 'stock',
      exchange: 'NASDAQ', quantity: 10, markPrice: 200.5, costBasisPrice: 150.25 },
    { conid: '75776072', symbol: 'CSPX', name: 'ISHARES CORE S&P 500', isin: 'IE00B5BMR087', currency: 'EUR', type: 'stock',
      exchange: 'AEB', quantity: 3, markPrice: 600, costBasisPrice: 550 },
  ]);
});

test('parseStatement lit les liquidités par devise (sans la ligne BASE_SUMMARY)', () => {
  assert.deepEqual(parseStatement(STATEMENT).cash, [
    { currency: 'EUR', amount: 1000 },
    { currency: 'USD', amount: 250.75 },
  ]);
});

test('parseStatement : date du relevé (toDate) au format ISO', () => {
  assert.equal(parseStatement(STATEMENT).date, '2026-11-10');
});

test('parseStatement refuse un document qui n’est pas un relevé', () => {
  assert.throws(() => parseStatement('<html>Erreur</html>'), /relevé/);
});

test('parseFlexResponse : succès de SendRequest', () => {
  const r = parseFlexResponse(`<FlexStatementResponse timestamp="11 November, 2026 07:15 AM EST">
<Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>
<Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`);
  assert.deepEqual(r, { status: 'Success', referenceCode: '1234567890', errorCode: null, errorMessage: null });
});

test('parseFlexResponse : relevé en cours de génération (1019)', () => {
  const r = parseFlexResponse(`<FlexStatementResponse timestamp="x"><Status>Warn</Status><ErrorCode>1019</ErrorCode>
<ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`);
  assert.equal(r.status, 'Warn');
  assert.equal(r.errorCode, '1019');
  assert.match(r.errorMessage!, /in progress/);
});

test('parseStatement lit les ventes de titres (SELL) avec la plus-value IBKR et de quoi nommer le titre', () => {
  assert.deepEqual(parseStatement(STATEMENT).trades, [
    { id: '111', conid: '265598', symbol: 'AAPL', name: 'APPLE INC', isin: 'US0378331005', type: 'stock',
      date: '2026-11-05', quantity: 2, price: 300, commission: 1, currency: 'USD', fxRateToBase: 0.9, realized: 24.5 },
  ]);
});

test('parseStatement ignore achats, conversions de devises (CASH), dérivés et lignes sans date', () => {
  const ids = parseStatement(STATEMENT).trades.map((t) => t.id);
  assert.deepEqual(ids, ['111']); // 110 achat, 112 change, 113 option, 114 sans date
});

test('parseStatement : date de repli (settleDate) et taux de change absent = null', () => {
  const msft = parseStatement(STATEMENT).cashTx.find((c) => c.id === '225');
  assert.equal(msft?.date, '2026-11-07');
  assert.equal(msft?.fxRateToBase, null);
});

test('parseStatement lit dividendes et retenues à la source, ignore les autres mouvements', () => {
  assert.deepEqual(parseStatement(STATEMENT).cashTx.filter((c) => c.id !== '225'), [
    { id: '222', conid: '265598', type: 'dividend', date: '2026-11-06', amount: 3.2, currency: 'USD',
      fxRateToBase: 0.9, description: 'AAPL CASH DIVIDEND' },
    { id: '223', conid: '265598', type: 'withholding', date: '2026-11-06', amount: -0.48, currency: 'USD',
      fxRateToBase: 0.9, description: 'AAPL US TAX' },
  ]);
});

test('parseStatement sans sections Trades / Cash Transactions : listes vides', () => {
  const s = parseStatement('<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" toDate="20261110"></FlexStatement></FlexStatements></FlexQueryResponse>');
  assert.deepEqual(s.trades, []);
  assert.deepEqual(s.cashTx, []);
});

// ---------- Confirmations d'ordres du jour (Trade Confirmation Flex Query) ----------
import { applyTodayTrades, parseConfirmations } from './flex.ts';

const CONFIRMS = `<FlexQueryResponse queryName="jour" type="TCF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20261112" toDate="20261112" period="Today" whenGenerated="20261112;160000">
<TradeConfirms>
<TradeConfirm accountId="U1234567" currency="EUR" assetCategory="STK" symbol="CSPX" description="ISHARES CORE S&amp;P 500" conid="75776072" isin="IE00B5BMR087" tradeID="301" tradeDate="20261112" buySell="BUY" quantity="2" price="610" commission="-1.25" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="NVDA" description="NVIDIA CORP" conid="4815747" isin="US67066G1040" tradeID="302" tradeDate="20261112" buySell="BUY" quantity="5" price="100" commission="-1" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" isin="US0378331005" tradeID="303" tradeDate="20261112" buySell="SELL" quantity="-4" price="210" commission="-1" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" conid="265598" tradeID="" orderID="9" tradeDate="20261112" buySell="SELL" quantity="-4" price="210" commission="-1" levelOfDetail="ORDER" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="CASH" symbol="EUR.USD" conid="12087792" tradeID="304" tradeDate="20261112" buySell="BUY" quantity="100" price="1.08" commission="-2" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="TSLA" conid="76792991" tradeID="305" tradeDate="20261112" buySell="BUY (Ca.)" quantity="1" price="300" commission="0" levelOfDetail="EXECUTION" />
</TradeConfirms>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

test('parseConfirmations garde les exécutions de titres (achats et ventes), sans ordres, change ni annulations', () => {
  const c = parseConfirmations(CONFIRMS);
  assert.deepEqual(c.map((x) => [x.id, x.side, x.quantity, x.price, x.commission]), [
    ['301', 'BUY', 2, 610, 1.25],
    ['302', 'BUY', 5, 100, 1],
    ['303', 'SELL', 4, 210, 1],
  ]);
  assert.equal(c[0].name, 'ISHARES CORE S&P 500');
  assert.equal(c[0].date, '2026-11-12');
  assert.equal(c[1].type, 'stock');
});

test('parseConfirmations : relevé vide (aucun ordre du jour) → liste vide', () => {
  assert.deepEqual(parseConfirmations('<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" /></FlexStatements></FlexQueryResponse>'), []);
});

test('applyTodayTrades ajoute les ordres postérieurs au relevé : quantités, PRU, nouvelles lignes, espèces', () => {
  const st = parseStatement(STATEMENT); // relevé du 2026-11-10 : AAPL 10 @150.25, CSPX 3 @550, cash EUR 1000 / USD 250.75
  const r = applyTodayTrades(st.positions, st.cash, parseConfirmations(CONFIRMS), st.date!);
  assert.equal(r.applied, 3);
  const by = new Map(r.positions.map((p) => [p.symbol, p]));
  // CSPX : (3×550 + 2×610 + 1,25) / 5
  assert.equal(by.get('CSPX')!.quantity, 5);
  assert.ok(Math.abs(by.get('CSPX')!.costBasisPrice - (3 * 550 + 2 * 610 + 1.25) / 5) < 1e-9);
  // AAPL : vente partielle, PRU inchangé
  assert.equal(by.get('AAPL')!.quantity, 6);
  assert.equal(by.get('AAPL')!.costBasisPrice, 150.25);
  // NVDA : nouvelle ligne, cours = prix d'achat
  assert.equal(by.get('NVDA')!.quantity, 5);
  assert.ok(Math.abs(by.get('NVDA')!.costBasisPrice - (500 + 1) / 5) < 1e-9);
  assert.equal(by.get('NVDA')!.markPrice, 100);
  assert.equal(by.get('NVDA')!.isin, 'US67066G1040');
  // Espèces : EUR 1000 − 1221,25 ; USD 250,75 − 501 + 839
  const cash = new Map(r.cash.map((c) => [c.currency, c.amount]));
  assert.ok(Math.abs(cash.get('EUR')! - (1000 - 1221.25)) < 1e-9);
  assert.ok(Math.abs(cash.get('USD')! - (250.75 - 501 + 839)) < 1e-9);
  // Entrées non modifiées
  assert.equal(st.positions.find((p) => p.symbol === 'CSPX')!.quantity, 3);
});

test('applyTodayTrades ignore les ordres déjà dans le relevé (date ≤ date du relevé)', () => {
  const st = parseStatement(STATEMENT);
  const r = applyTodayTrades(st.positions, st.cash, parseConfirmations(CONFIRMS), '2026-11-12');
  assert.equal(r.applied, 0);
  assert.deepEqual(r.positions, st.positions);
  assert.deepEqual(r.cash, st.cash);
});

test('applyTodayTrades retire une ligne vendue en totalité et crée la devise absente', () => {
  const pos = [{ conid: '1', symbol: 'X', name: 'X', isin: null, currency: 'GBP', type: 'stock' as const, exchange: null, quantity: 2, markPrice: 10, costBasisPrice: 8 }];
  const sell = [{ id: '9', conid: '1', symbol: 'X', name: 'X', isin: null, type: 'stock' as const, date: '2026-11-12', side: 'SELL' as const, quantity: 2, price: 11, commission: 1, currency: 'GBP' }];
  const r = applyTodayTrades(pos, [], sell, '2026-11-11');
  assert.equal(r.positions.length, 0);
  assert.deepEqual(r.cash, [{ currency: 'GBP', amount: 21 }]);
});
