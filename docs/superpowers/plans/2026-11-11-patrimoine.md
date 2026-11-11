# Patrimoine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onglet « Patrimoine » avec comptes manuels (livrets, PEA, CTO, AV, PER, épargne salariale), positions (quantité + PRU), référentiel de titres avec cours automatiques (Yahoo / AMF / manuel) et plus-values.

**Architecture:** Tables + vues Postgres (RLS `is_app_user()`) qui calculent valeur, investi et plus-value en EUR ; fonction Edge `quotes` (recherche + mise à jour des cours, derrière une interface de fournisseur) appelée par l'app et par `pg_cron` ; écrans Expo Router qui lisent les vues via `supabase-js`.

**Tech Stack:** Supabase (Postgres 17, pg_cron, pg_net, Edge Functions Deno), Expo SDK 58, Expo Router, TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-11-patrimoine-design.md`

## Global Constraints

- Projet Supabase `pkyvpjfzngsjfnvhwbsn`. Migrations : fichier dans `supabase/migrations/` **et** appliquées via MCP `apply_migration`.
- RLS sur toutes les nouvelles tables ; lecture/écriture `to authenticated using (public.is_app_user())`.
- Fonctions Edge déployées avec `verify_jwt = false` et leur propre authentification : secret Vault (`sync_config().sync_secret`) pour le cron, JWT d'un `app_user` pour l'app.
- Les cours ne passent jamais par Enable Banking ni par `sync_runs` (le budget de 4 accès/jour n'est pas touché).
- Montants affichés en EUR. Taux absent de `fx_rates` → `null` + mention « taux de change indisponible » (pas de repli à 1).
- Liquidités : dans la valeur du compte, hors investi et hors plus-value.
- PRU par défaut en EUR (`cost_currency = 'EUR'`).
- Unicité des titres : (`isin`, `source_symbol`).
- Cron des cours : jours ouvrés, 19 h heure de Paris.
- App : `npx expo install` pour les dépendances ; `npx tsc --noEmit` et `npx eslint src` sans erreur avant chaque commit.

## Review Focus

- Titre sans cours (source `manual` jamais saisie, ou Yahoo en échec) → la position affiche « cours introuvable » ; valeur et plus-value `null`, le total du compte ignore la ligne et le signale. Testé en Task 1 (assertion SQL).
- Devise sans taux (ex. titre en `CHF` absent de `fx_rates`) → valeur EUR `null`, pas de calcul faux. Testé en Task 1.
- Recherche ISIN qui renvoie plusieurs places → Euronext Paris EUR en premier. Testé en Task 2 (appel réel sur `IE00B4L5Y983`).
- Saisie décimale française (« 512,30 ») dans les formulaires → acceptée. Testé en Task 4 (helper `parseAmount`).
- Suppression d'un compte avec positions → positions supprimées en cascade, titres conservés. Testé en Task 1.

---

### Task 1: Schéma Patrimoine (tables, vues, RLS)

**Files:**
- Create: `supabase/migrations/20261111200000_patrimoine.sql`

**Interfaces:**
- Produces (tables) : `manual_accounts(id uuid pk default gen_random_uuid(), name text not null, institution text, kind text check in ('savings','investment'), envelope text check in ('livret_a','ldds','lep','livret','pea','pea_pme','cto','assurance_vie','per','epargne_salariale','crypto','autre'), currency text default 'EUR', cash_balance numeric not null default 0, cash_updated_at date, hidden bool default false, sort_order int default 0, created_at timestamptz default now())`
- `instruments(id uuid pk, isin text, amf_code text, name text not null, type text check in ('stock','etf','fund','fcpe','fonds_euros','bond','crypto','other'), currency text not null default 'EUR', price_source text check in ('yahoo','amf','manual'), source_symbol text, last_price numeric, last_price_date date, price_updated_at timestamptz, price_error text, created_at)`, unique (`isin`, `source_symbol`) **nulls not distinct**.
- `instrument_prices(instrument_id uuid → instruments on delete cascade, date date, price numeric not null, primary key (instrument_id, date))`
- `positions(id uuid pk, account_id → manual_accounts on delete cascade, instrument_id → instruments on delete restrict, quantity numeric not null, avg_cost numeric not null, cost_currency text not null default 'EUR', updated_at timestamptz default now(), unique (account_id, instrument_id))`
- Vues (`security_invoker = true`) :
  - `position_view` : colonnes de `positions` + `instrument_name, isin, type, price_source, instrument_currency, last_price, last_price_date, price_error, value_eur, invested_eur, pnl_eur, pnl_pct` (pct = pnl/invested, `null` si investi = 0).
  - `manual_account_view` : colonnes de `manual_accounts` + `cash_eur, positions_value_eur, invested_eur, pnl_eur, pnl_pct, value_eur (= cash_eur + positions_value_eur), missing_prices int` (lignes dont `value_eur` est null).
- Conversion : montant / `fx_rates.per_eur` (jointure stricte ; EUR via la ligne `('EUR', 1)` existante).

- [ ] **Step 1: Écrire la migration** (tables, contraintes, RLS + policies `select/insert/update/delete` pour `is_app_user()`, grants à `authenticated`, vues).
- [ ] **Step 2: Appliquer via MCP `apply_migration` (nom `patrimoine`).**
- [ ] **Step 3: Test SQL dans une transaction annulée (`begin … rollback`)** :

```sql
begin;
insert into manual_accounts (id,name,kind,envelope,cash_balance) values ('00000000-0000-0000-0000-0000000000a1','PEA test','investment','pea',100);
insert into instruments (id,name,type,currency,price_source,source_symbol,last_price) values
 ('00000000-0000-0000-0000-0000000000b1','ETF','etf','EUR','yahoo','X.PA',110),
 ('00000000-0000-0000-0000-0000000000b2','Sans cours','stock','EUR','manual',null,null),
 ('00000000-0000-0000-0000-0000000000b3','Suisse','stock','XXX','manual','Y',50);
insert into positions (account_id,instrument_id,quantity,avg_cost) values
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',10,100),
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2',5,20),
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b3',1,40);
-- attendu : b1 value 1100 invested 1000 pnl 100 pct 0.1 ; b2 value null ; b3 value null (taux absent)
select instrument_name, value_eur, invested_eur, pnl_eur, pnl_pct from position_view order by instrument_name;
-- attendu : cash 100, positions 1100, value 1200, invested 1000 (lignes valorisées seulement), pnl 100, missing_prices 2
select cash_eur, positions_value_eur, value_eur, invested_eur, pnl_eur, missing_prices from manual_account_view;
delete from manual_accounts where id='00000000-0000-0000-0000-0000000000a1';
select count(*) as positions_restantes from positions;           -- 0
select count(*) as titres_restants from instruments where id::text like '00000000%'; -- 3
rollback;
```

Expected : valeurs ci-dessus exactement.
- [ ] **Step 4: `get_advisors` security** → aucune alerte nouvelle hors « RLS sans policy » déjà connue.
- [ ] **Step 5: Commit** `feat(patrimoine): schéma comptes manuels, titres, positions`.

### Task 2: Fonction Edge `quotes` (recherche + mise à jour des cours)

**Files:**
- Create: `supabase/functions/quotes/index.ts`

**Interfaces:**
- Consumes: tables Task 1 ; `sync_config()` (Vault) ; `fx_rates`.
- Produces (HTTP) :
  - `GET /quotes/search?q=<isin|nom|code AMF>` (JWT app_user) → `{ ok: true, results: SearchResult[] }` avec `SearchResult = { name: string; isin: string | null; symbol: string; exchange: string; currency: string; type: InstrumentType; source: 'yahoo' | 'amf' }`, trié Euronext Paris EUR d'abord.
  - `POST /quotes/refresh` body `{ ids?: string[] }` — JWT app_user (ids obligatoires) ou secret Vault (tous les titres `yahoo`/`amf`) → `{ ok: boolean, updated: number, errors: Record<string,string> }`. Écrit `last_price, last_price_date, price_updated_at, price_error=null` + upsert `instrument_prices` ; en échec `price_error`.
- Interface interne : `type PriceProvider = { search(q: string): Promise<SearchResult[]>; quote(symbol: string): Promise<{ price: number; date: string; currency: string }> }` ; `providers: Record<'yahoo'|'amf', PriceProvider>`.

- [ ] **Step 1: Yahoo** : recherche `https://query2.finance.yahoo.com/v1/finance/search?q=` (ISIN accepté), cours `https://query2.finance.yahoo.com/v8/finance/chart/<symbol>?range=5d&interval=1d` (`meta.regularMarketPrice`, `meta.currency`, date du dernier timestamp). En-tête `User-Agent` générique (pas d'e-mail). Devise `GBp` → diviser par 100 et renvoyer `GBP`.
- [ ] **Step 2: AMF** : vérifier si la VL d'un FCPE par code AMF est récupérable simplement (fichiers ROSA / GECO). Si non en < 30 min d'investigation, `amf.search` renvoie `[]`, la saisie FCPE passe en `manual`, et noter la piste dans `docs/open-banking.md` (section Natixis).
- [ ] **Step 3: Déployer** (`deploy_edge_function`, `verify_jwt: false`).
- [ ] **Step 4: Test** via `net.http_get`/`net.http_post` depuis SQL avec le secret Vault :
  - `search?q=IE00B4L5Y983` sans JWT → 401.
  - `refresh` (secret) après insertion temporaire d'un titre `yahoo` `IWDA.AS` → `updated = 1`, `last_price > 0`, ligne dans `instrument_prices` ; puis supprimer le titre de test.
  - Recherche réelle `IE00B4L5Y983` : appel de `providers.yahoo.search` via route temporaire de debug **non déployée** → à défaut, vérifier en Task 5 depuis l'app que le premier résultat est en EUR.
- [ ] **Step 5: Commit** `feat(patrimoine): fonction quotes (Yahoo, AMF, interface fournisseur)`.

### Task 3: Cron des cours

**Files:**
- Create: `supabase/migrations/20261111201000_quotes_cron.sql`

**Interfaces:**
- Produces: `public.run_quotes_refresh() returns void` (security definer, réservée, appelle `/quotes/refresh` avec le secret si heure Paris = 19 et jour ouvré `extract(isodow) < 6`) ; job `pg_cron` `refresh-quotes` `'0 * * * *'`.

- [ ] **Step 1: Migration + application MCP.**
- [ ] **Step 2: Test** : `select public.run_quotes_refresh();` hors 19 h → aucune nouvelle ligne dans `net.http_request_queue` ; `select jobname, schedule from cron.job` → contient `refresh-quotes`.
- [ ] **Step 3: Commit** `feat(patrimoine): cron des cours 19 h jours ouvrés`.

### Task 4: Couche données app

**Files:**
- Create: `app/src/lib/patrimoine.ts`
- Modify: `app/src/lib/format.ts` (ajout `parseAmount`, `pct`)

**Interfaces:**
- Consumes: vues/tables Task 1, routes Task 2, `useLoad` et `functionError` (à exporter depuis `app/src/lib/data.ts`).
- Produces :
  - types `ManualAccount`, `PositionRow` (miroir des vues), `SearchResult`, `Envelope`, `InstrumentType`, constantes `ENVELOPES: { value: Envelope; label: string; kind: 'savings' | 'investment' }[]` (Livret A, LDDS, LEP, Livret, PEA, PEA-PME, CTO, Assurance-vie, PER, Épargne salariale, Crypto, Autre).
  - `fetchManualAccounts(): Promise<ManualAccount[]>`, `fetchPositions(accountId: string): Promise<PositionRow[]>`
  - `saveManualAccount(a: Partial<ManualAccount> & { name: string; kind; envelope }): Promise<string>` (insert ou update, renvoie id), `deleteManualAccount(id)`
  - `searchInstruments(q: string): Promise<SearchResult[]>`
  - `upsertInstrument(r: SearchResult | { name: string; type: InstrumentType; currency: string; price?: number }): Promise<string>` (réutilise l'existant par (isin, source_symbol) ; titre manuel → `price_source='manual'`, `last_price`, `last_price_date = today`) puis `refreshQuotes([id])` si non manuel.
  - `savePosition(p: { id?: string; account_id: string; instrument_id: string; quantity: number; avg_cost: number; cost_currency?: string })`, `deletePosition(id)`
  - `setManualPrice(instrumentId: string, price: number)` (met aussi `instrument_prices`)
  - `refreshQuotes(ids: string[]): Promise<void>`
  - `parseAmount(s: string): number | null` (accepte `"512,30"`, `"1 234,5"`, `"-3.2"` ; `""`/texte → null), `pct(x: number | null): string` (`+7,1 %`).

- [ ] **Step 1: Implémenter** ; exporter `functionError` depuis `data.ts`.
- [ ] **Step 2: Vérifier `parseAmount`** avec un script node jetable (`npx tsx -e` ou équivalent) : `parseAmount("512,30")===512.3`, `parseAmount("1 234,5")===1234.5`, `parseAmount("abc")===null`.
- [ ] **Step 3: `npx tsc --noEmit` + `npx eslint src`** → 0 erreur.
- [ ] **Step 4: Commit** `feat(patrimoine): couche données app`.

### Task 5: Écrans

**Files:**
- Create: `app/src/app/(tabs)/patrimoine.tsx`, `app/src/app/patrimoine/account/[id].tsx`, `app/src/app/patrimoine/account-edit.tsx` (param `id` optionnel), `app/src/app/patrimoine/position-edit.tsx` (params `accountId`, `id?`)
- Modify: `app/src/app/(tabs)/_layout.tsx` (onglet « Patrimoine », icône `pie-chart-outline`, entre Comptes et Transactions), `app/src/app/_layout.tsx` (routes protégées).

**Interfaces:**
- Consumes: Task 4 ; `fetchAccounts`/`groupAccounts` (comptes bancaires) de `data.ts` ; composants `ui.tsx`.

- [ ] **Step 1: Onglet Patrimoine** : total = Σ `balance_eur` des comptes bancaires non masqués + Σ `value_eur` des comptes manuels non masqués ; ligne « Placements +X € (+Y %) » (Σ pnl / Σ investi des comptes `investment`) ; sections Comptes bancaires (1 ligne résumé → `router.navigate('/')`), Épargne, Placements ; « + Ajouter un compte » ; mention « N cours manquants » si `missing_prices > 0`.
- [ ] **Step 2: Formulaire compte** : enveloppe (chips `ENVELOPES`), nom (prérempli avec le libellé), établissement, solde/liquidités (`parseAmount`), suppression avec confirmation.
- [ ] **Step 3: Détail compte** : épargne → solde + date + modifier ; investissement → liquidités modifiables + positions (nom, `q × cours`, valeur, plus-value colorée, « cours du JJ/MM » / « cours manuel » / « cours introuvable »), « + Ajouter une position », tirer pour rafraîchir = relire (pas d'appel de cours).
- [ ] **Step 4: Formulaire position** : deux modes — **Titre coté** (recherche debounce 400 ms → liste de résultats → quantité + PRU en EUR) et **Ligne à valeur** (nom, montant versé, valeur actuelle → titre `fonds_euros`/`other` manuel, `quantity=1`, `avg_cost=versé`, prix=valeur) ; « Titre introuvable ? Saisir à la main » (nom + cours). Sur un titre manuel existant : bouton « Mettre à jour le cours ».
- [ ] **Step 5: Vérifier** : `npx tsc --noEmit`, `npx eslint src`, `npx expo export --platform android --output-dir <tmp>` → succès ; supprimer le dossier tmp.
- [ ] **Step 6: Commit** `feat(patrimoine): onglet et écrans`.

### Task 6: Vérification bout en bout + docs + push

- [ ] **Step 1:** Insérer via SQL (en tant qu'utilisateur simulé, transaction annulée) un compte + une position yahoo et vérifier que `manual_account_view` est lisible avec `set local role authenticated` + claims de l'app_user.
- [ ] **Step 2:** Mettre à jour `README.md` (feuille de route : Patrimoine ✅, Historique / IBKR à venir) et `docs/open-banking.md` (section saisie manuelle → implémentée).
- [ ] **Step 3:** Commit + `git push origin main`.
