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
<Trade accountId="U1234567" currency="USD" fxRateToBase="0.9" assetCategory="STK" symbol="AAPL" conid="265598" tradeID="111" tradeDate="20261105" quantity="-2" tradePrice="300" ibCommission="-1" fifoPnlRealized="24.5" buySell="SELL" levelOfDetail="EXECUTION" />
</Trades>
<CashTransactions>
<CashTransaction accountId="U1234567" currency="USD" fxRateToBase="0.9" conid="265598" type="Dividends" amount="3.2" dateTime="20261106" description="AAPL CASH DIVIDEND" transactionID="222" />
<CashTransaction accountId="U1234567" currency="USD" fxRateToBase="0.9" conid="265598" type="Withholding Tax" amount="-0.48" dateTime="20261106;202000" description="AAPL US TAX" transactionID="223" />
<CashTransaction accountId="U1234567" currency="EUR" fxRateToBase="1" conid="" type="Deposits/Withdrawals" amount="500" dateTime="20261101" description="DEPOT" transactionID="224" />
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

test('parseStatement lit les ventes (SELL) avec la plus-value IBKR, ignore les achats', () => {
  assert.deepEqual(parseStatement(STATEMENT).trades, [
    { id: '111', conid: '265598', date: '2026-11-05', quantity: 2, price: 300, commission: 1,
      currency: 'USD', fxRateToBase: 0.9, realized: 24.5 },
  ]);
});

test('parseStatement lit dividendes et retenues à la source, ignore les autres mouvements', () => {
  assert.deepEqual(parseStatement(STATEMENT).cashTx, [
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
