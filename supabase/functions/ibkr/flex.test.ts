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
