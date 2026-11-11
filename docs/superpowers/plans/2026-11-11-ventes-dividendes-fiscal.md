# Ventes, dividendes et bilan fiscal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ventes et dividendes (manuels + IBKR automatique) avec plus-values réalisées et bilan fiscal annuel estimé.

**Architecture:** Table `operations` + fonctions SQL atomiques (vente, dividende, annulation) qui tiennent positions et liquidités à jour ; fonction SQL `tax_summary(year)` pour le bilan ; la fonction Edge `ibkr` importe ventes et dividendes du relevé Flex de façon idempotente ; écrans Expo (Vendre, Opérations, Bilan fiscal).

**Tech Stack:** Supabase (Postgres 17, Edge Functions Deno), Expo SDK 58, TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-11-ventes-dividendes-fiscal-design.md`

## Global Constraints

- PFU par défaut **0.314** ; CTO = `envelope = 'cto'` ; PEA = `envelope in ('pea','pea_pme')` (indicatif, hors estimation) ; AV, PER, épargne salariale, crypto exclus du bilan.
- Plus-value vente = (prix − PRU) × quantité − frais ; PRU des titres restants inchangé.
- Liquidités du compte créditées du net (vente : q × prix − frais ; dividende : brut − `tax_withheld`), converties dans la devise du compte via `fx_rates` ; annulation = débit inverse (`cash_credit` figé).
- Montants EUR = montant / `fx_per_eur` (1 EUR = `fx_per_eur` devise) ; IBKR : `fx_per_eur = 1 / fxRateToBase` (base EUR).
- Import IBKR idempotent sur (`source`, `external_id`).
- RLS `is_app_user()` ; fonctions SQL `security invoker` (exécutées par l'app) sauf mention.
- Toujours libeller le bilan « estimation » ; l'IFU fait foi.
- App : `npx tsc --noEmit`, `npx eslint src tests`, `npm test` sans erreur avant chaque commit.

## Review Focus

- Vendre plus que la quantité détenue → refus explicite, rien n'est modifié. Testé Task 1.
- Vendre toute la position puis annuler la vente → position recréée au PRU figé, liquidités revenues au montant initial. Testé Task 1.
- Année sans aucune opération → bilan à zéro, pas d'erreur ni de division par zéro. Testé Task 1.
- Relevé IBKR rejoué deux jours de suite → aucune opération en double. Testé Task 3 (parser) et Task 3 step SQL (contrainte unique).
- Net CTO négatif → impôt estimé 0 et « moins-value à reporter » = valeur absolue. Testé Task 1.

---

### Task 1: Schéma opérations et bilan (SQL)

**Files:**
- Create: `supabase/migrations/20261112100000_operations.sql`
- Test: `supabase/tests/operations.sql`

**Interfaces:**
- Produces (tables) : `operations(id uuid pk, account_id uuid → manual_accounts on delete cascade, instrument_id uuid → instruments null, kind text check in ('sell','dividend','withholding'), date date not null, quantity numeric, price numeric, fees numeric not null default 0, amount numeric, tax_withheld numeric not null default 0, currency text not null, avg_cost numeric, realized numeric, fx_per_eur numeric not null default 1, cash_credit numeric not null default 0, source text not null default 'manual' check in ('manual','ibkr'), external_id text, note text, created_at timestamptz default now(), unique (source, external_id))` ; `tax_settings(year int pk, pfu_rate numeric not null default 0.314, carried_losses numeric not null default 0)`.
- Produces (fonctions, appelables par `authenticated`) :
  - `sell_position(p_position uuid, p_quantity numeric, p_price numeric, p_fees numeric, p_date date) returns uuid` — erreur `'Quantité vendue supérieure à la quantité détenue'` si p_quantity > quantité ou ≤ 0.
  - `add_dividend(p_account uuid, p_instrument uuid, p_date date, p_amount numeric, p_tax_withheld numeric, p_currency text, p_note text) returns uuid`
  - `delete_operation(p_op uuid) returns void` — opérations `source='manual'` seulement ; vente : rend les titres (fusion pondérée si la position existe, sinon recréation au PRU figé) ; retire `cash_credit` des liquidités.
  - `tax_summary(p_year int) returns table (year int, pfu_rate numeric, cto_gains numeric, cto_losses numeric, cto_net numeric, carried_losses numeric, taxable numeric, loss_to_carry numeric, cto_dividends numeric, foreign_withholding numeric, already_withheld numeric, estimated_tax numeric, remaining numeric, pea_realized numeric, pea_dividends numeric)` — montants EUR, arrondis à 2 décimales ; `taxable = greatest(0, cto_net - carried_losses)` ; `loss_to_carry = greatest(0, -(cto_net - carried_losses))` ; `estimated_tax = round((taxable + cto_dividends) * pfu_rate, 2)` ; `remaining = estimated_tax - already_withheld`.
- Produces (vue) : `operation_view` = `operations` + `instrument_name`, `account_name`, `envelope`, `realized_eur`, `amount_eur`.

- [ ] **Step 1: Écrire `supabase/tests/operations.sql`** (transaction annulée, `raise exception` au premier écart, `select 'OK'`) couvrant :
  - CTO A (EUR, liquidités 100) avec 10 titres PRU 100 ; `sell_position(…, 4, 150, 2, '2026-06-01')` → realized = 198, quantité restante 6, liquidités 100 + 598 = 698.
  - `sell_position(…, 7, …)` sur la position de 6 → exception `Quantité vendue supérieure`.
  - CTO B : vente 5 titres PRU 50 à 30, frais 0 → realized −100.
  - `add_dividend(CTO A, null, '2026-07-01', 20, 6, 'EUR', null)` → liquidités +14.
  - `tax_summary(2026)` → `cto_gains = 198`, `cto_losses = -100`, `cto_net = 98`, `cto_dividends = 20`, `already_withheld = 6`, `estimated_tax = round((98+20)*0.314,2) = 37.05`, `remaining = 31.05`.
  - `insert into tax_settings values (2026, 0.314, 150)` → `taxable = 0`, `loss_to_carry = 52`, `estimated_tax = round(20*0.314,2) = 6.28`.
  - `tax_summary(2019)` (aucune opération) → toutes les sommes à 0.
  - Vendre la totalité de CTO B restante puis `delete_operation` de cette vente → position recréée (quantité et PRU d'origine), liquidités revenues.
  - `delete_operation` du dividende → liquidités −14.
- [ ] **Step 2: Lancer le test** (MCP `execute_sql`) → Expected : FAIL `relation "public.operations" does not exist`.
- [ ] **Step 3: Écrire la migration** et l'appliquer (MCP `apply_migration`, nom `operations`).
- [ ] **Step 4: Relancer le test** → Expected : `OK`.
- [ ] **Step 5: Commit** `feat(fiscal): opérations, ventes, dividendes et bilan (SQL)`.

### Task 2: Aperçu de vente (pur TS)

**Files:**
- Create: `app/src/lib/sale.ts`
- Test: `app/tests/sale.test.ts`

**Interfaces:**
- Produces : `previewSale(p: { quantity: number; avg_cost: number }, s: { quantity: number; price: number; fees: number }): { ok: true; realized: number; proceeds: number; remaining: number } | { ok: false; error: string }` (arrondis 2 décimales).

- [ ] **Step 1: Tests** : `previewSale({quantity:10,avg_cost:100},{quantity:4,price:150,fees:2})` → `{ok:true, realized:198, proceeds:598, remaining:6}` ; quantité 11 → `{ok:false, error:'Tu n’as que 10 titres.'}` ; quantité 0 → `{ok:false, error:'Quantité invalide.'}` ; prix négatif → `{ok:false, error:'Prix invalide.'}`.
- [ ] **Step 2: `npm test`** → FAIL (module absent).
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: `npm test`** → PASS.
- [ ] **Step 5: Commit** `feat(fiscal): aperçu de vente`.

### Task 3: IBKR — ventes et dividendes automatiques

**Files:**
- Modify: `supabase/functions/ibkr/flex.ts`, `supabase/functions/ibkr/flex.test.ts`, `supabase/functions/ibkr/index.ts`

**Interfaces:**
- Produces : `FlexStatement.trades: { id: string; conid: string; date: string; quantity: number; price: number; commission: number; currency: string; fxRateToBase: number; realized: number }[]` (SELL uniquement, niveau EXECUTION ou sans niveau) ; `FlexStatement.cashTx: { id: string; conid: string | null; type: 'dividend' | 'withholding'; date: string; amount: number; currency: string; fxRateToBase: number; description: string }[]` (types `Dividends`, `Payment In Lieu Of Dividends` → dividend ; `Withholding Tax` → withholding ; autres ignorés).

- [ ] **Step 1: Tests parser** : ajouter au XML d'exemple une section `<Trades>` (un BUY ignoré, un SELL `tradeID="111" quantity="-2" tradePrice="300" ibCommission="-1" fifoPnlRealized="24.5" fxRateToBase="0.9" tradeDate="20261105" currency="USD" conid="265598"`) et `<CashTransactions>` (`type="Dividends" amount="3.2" transactionID="222"`, `type="Withholding Tax" amount="-0.48" transactionID="223"`, `type="Deposits/Withdrawals"` ignoré). Assertions : 1 trade `{id:'111', quantity:2, price:300, commission:1, realized:24.5, date:'2026-11-05', fxRateToBase:0.9}` ; 2 cashTx (dividend 3.2, withholding −0.48) ; relevé sans ces sections → `trades: []`, `cashTx: []`.
- [ ] **Step 2: `node --test supabase/functions/ibkr/`** → FAIL.
- [ ] **Step 3: Implémenter le parser.**
- [ ] **Step 4: Tests** → PASS.
- [ ] **Step 5: Import dans `index.ts`** : après les positions, `upsert` dans `operations` avec `onConflict: 'source,external_id'`, `ignoreDuplicates: true` ; vente : `kind='sell'`, `quantity`, `price`, `fees=commission`, `realized`, `currency`, `fx_per_eur = 1/fxRateToBase`, `instrument_id` via `ibkr:<conid>` (null si inconnu) ; dividendes/retenues : `amount`, `currency`, `fx_per_eur`. `cash_credit = 0` (les liquidités IBKR viennent du relevé). Ajouter `operations` importées au résultat `{ …, sells, dividends }`.
- [ ] **Step 6: Déployer** et lancer `run_ibkr_sync(true)` deux fois → Expected : 2ᵉ appel n'ajoute aucune ligne (`select count(*) from operations where source='ibkr'` identique).
- [ ] **Step 7: Commit** `feat(fiscal): import IBKR des ventes et dividendes`.

### Task 4: Couche données app

**Files:**
- Modify: `app/src/lib/patrimoine.ts`

**Interfaces:**
- Produces : types `Operation` (miroir de `operation_view`), `TaxSummary` (colonnes de `tax_summary`) ; `fetchOperations(accountId: string): Promise<Operation[]>` (date desc) ; `sellPosition(positionId: string, s: { quantity: number; price: number; fees: number; date: string }): Promise<void>` ; `addDividend(d: { account_id: string; instrument_id: string | null; date: string; amount: number; tax_withheld: number; currency: string; note?: string }): Promise<void>` ; `deleteOperation(id: string): Promise<void>` ; `fetchTaxSummary(year: number): Promise<TaxSummary>` ; `fetchRealizedByAccount(year: number): Promise<{ account_id: string; account_name: string; envelope: Envelope; realized_eur: number; dividends_eur: number }[]>` ; `saveTaxSettings(year: number, s: { pfu_rate: number; carried_losses: number }): Promise<void>`.

- [ ] **Step 1: Implémenter** (RPC `sell_position`, `add_dividend`, `delete_operation`, `tax_summary` ; `operation_view` filtrée par année pour `fetchRealizedByAccount`).
- [ ] **Step 2: `npx tsc --noEmit` + `npx eslint src tests`** → 0.
- [ ] **Step 3: Commit** `feat(fiscal): couche données`.

### Task 5: Écrans

**Files:**
- Create: `app/src/app/patrimoine/sell.tsx` (param `positionId`), `app/src/app/patrimoine/dividend.tsx` (param `accountId`), `app/src/app/patrimoine/tax.tsx`
- Modify: `app/src/app/patrimoine/position-edit.tsx` (bouton « Vendre »), `app/src/app/patrimoine/account/[id].tsx` (section Opérations + « Ajouter un dividende » pour les comptes non synchronisés ; suppression d'une opération manuelle avec confirmation), `app/src/app/(tabs)/patrimoine.tsx` (lien « Bilan fiscal »), `app/src/app/_layout.tsx` (routes).

- [ ] **Step 1: Vendre** : quantité (max affiché), prix et frais dans la devise du PRU, date (aujourd'hui par défaut, format `JJ/MM/AAAA`), aperçu via `previewSale` (plus-value colorée + montant crédité), bouton désactivé si `ok:false`.
- [ ] **Step 2: Dividende** : titre facultatif (liste des positions du compte), montant brut, impôt déjà prélevé (0 par défaut), devise (`CurrencyPicker`), date.
- [ ] **Step 3: Opérations** sur la page du compte : ligne = date · type · titre · montant / plus-value ; appui long ou bouton → supprimer (manuel uniquement).
- [ ] **Step 4: Bilan fiscal** : sélecteur d'année (année courante et précédentes ayant des opérations), bloc CTO (par compte puis net, report, imposable, à reporter), dividendes CTO, retenues étrangères (« non déduites »), impôt estimé (taux affiché), déjà prélevé, reste ; bloc PEA indicatif ; champs modifiables taux PFU et moins-values reportées ; mention « Estimation — l'IFU de ton courtier fait foi ».
- [ ] **Step 5: Vérifier** : tsc, eslint, `npm test`, `npx expo export --platform android` → succès.
- [ ] **Step 6: Commit** `feat(fiscal): écrans vente, dividende, opérations, bilan`.

### Task 6: Docs, vérification de bout en bout, push

- [ ] **Step 1:** `docs/SETUP.md` §11 : ajouter les sections *Trades* et *Cash Transactions* (champs du spec) et la période *Last 365 Calendar Days* ; README : feuille de route.
- [ ] **Step 2:** Test SQL en tant que propriétaire (`set local role authenticated` + claims) : vente + `tax_summary` lisibles ; inconnu authentifié → `sell_position` refusé (RLS).
- [ ] **Step 3:** Commit + `git push origin main`.
