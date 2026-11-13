# Historique du patrimoine — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photo quotidienne (22 h Paris) de la valeur de chaque compte, et courbes : total en haut du Patrimoine, une courbe par page de compte.

**Architecture:** Table `wealth_snapshots` (une ligne par compte et par jour) remplie en SQL par `pg_cron`, sans accès bancaire. L'app lit les lignes, calcule les séries dans un module pur testé (`history.ts`), et les dessine avec un composant SVG maison (`LineChart`) dont la géométrie vient d'un second module pur testé (`chart.ts`).

**Tech Stack:** Postgres/Supabase (RLS, pg_cron), Expo SDK 58 + Expo Router, TypeScript, `react-native-svg` (nouveau, module natif), `PanResponder` (React Native), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-13-historique-patrimoine-design.md`

## Global Constraints

- Photo à **22 h heure de Paris** ; tâche horaire qui ne fait rien hors de cette heure (modèle `run_scheduled_sync`).
- La photo ne lit que la base : **aucun appel Enable Banking**.
- Valeur manquante (taux/cours) → `null`, **jamais un repli à 1**.
- Total d'un jour = somme des `value_eur` connus des comptes **non masqués aujourd'hui** (même règle que `netWorth()`).
- RLS `public.is_app_user()` ; fonctions `security invoker` sauf `run_wealth_snapshot` (definer, comme `run_scheduled_sync`) ; `revoke … from public, anon, authenticated` sur les fonctions d'écriture.
- Périodes : `1S`, `1M`, `3M`, `1A`, `Tout` ; défaut **3M**, non mémorisé.
- Moins de 2 points : texte exact « La courbe se remplit chaque soir à 22 h. »
- Bulle au toucher : « 12 nov. : 47 980 € » (date courte FR, montant `money()`), suffixe « · incomplet » si point douteux.
- `app.json` `version` → **1.1.0** ; textes de l'app en français.
- Les modules purs (`history.ts`, `chart.ts`) n'importent **pas** `supabase` (sinon `node --test` échoue).

## Review Focus

1. Courbe avec 0 ou 1 point → message, pas de plantage ni de `NaN` dans le tracé (test `chart.test.ts` : `linePath` avec 1 point, `yDomain` vide).
2. Valeurs toutes égales (livret qui ne bouge pas) → domaine Y non nul, ligne plate au milieu (test `yDomain` constant).
3. Jour avec valeur `null` → trou dans la courbe, pas un zéro (tests `linePath` et `totalSeries`).
4. Découvert (valeur négative) → graduations qui incluent les négatifs (test `niceTicks` min < 0).
5. Fuseau : `periodStart` travaille sur des chaînes `AAAA-MM-JJ` locales, pas d'UTC qui décale d'un jour (test sur le 1ᵉʳ du mois).
6. Reconnexion bancaire (uid renommé) → l'historique suit (test SQL).

---

### Task 1: Base — table, photo, cron

**Files:**
- Create: `supabase/migrations/20261113120000_wealth_snapshots.sql`
- Test: `supabase/tests/snapshots.sql`

**Interfaces:**
- Produces:
  - table `public.wealth_snapshots(date date not null, bank_uid text null → accounts(uid) on update cascade on delete cascade, manual_id uuid null → manual_accounts(id) on delete cascade, value_eur numeric null, invested_eur numeric null, missing int not null default 0, created_at timestamptz not null default now())`, check `num_nonnulls(bank_uid, manual_id) = 1`, unique `(date, bank_uid)`, unique `(date, manual_id)`, index sur `date` ; RLS lecture `is_app_user()` ; `grant select … to authenticated`.
  - `public.take_wealth_snapshot(p_date date default (now() at time zone 'Europe/Paris')::date) returns integer` — supprime `p_date`, réinsère depuis `account_view` (`balance_eur`, `invested_eur` null) et `manual_account_view` (`value_eur`, `invested_eur` si `kind = 'investment'` sinon null, `missing_prices`) ; renvoie le nombre de lignes. Exécution : `service_role` seulement.
  - `public.run_wealth_snapshot(p_force boolean default false) returns void` — security definer ; sort si `not p_force` et heure Paris ≠ 22 ; sinon `perform public.take_wealth_snapshot()`. Revoke de tous.
  - `cron.schedule('wealth-snapshot', '0 * * * *', 'select public.run_wealth_snapshot()')`.
  - En fin de migration : `select public.take_wealth_snapshot();` (premier point).

- [ ] **Step 1: Write the failing test** `supabase/tests/snapshots.sql` (format des autres tests : `begin; … do $$ … raise exception … $$; select 'OK'; rollback;`) avec :
  - compte bancaire `test-snap-a` (EUR, balance 100) + devise `ZZZ` sans taux (`test-snap-z`, balance 50) + compte manuel livret (cash 200) ;
  - `take_wealth_snapshot('2026-01-10')` deux fois → exactement 1 ligne par compte de test pour ce jour (idempotent) ;
  - `value_eur` = 100 pour `test-snap-a`, `null` pour `test-snap-z`, 200 pour le livret, `invested_eur` null pour le livret ;
  - `update accounts set uid = 'test-snap-a2' where uid = 'test-snap-a'` → la ligne du 10/01 a `bank_uid = 'test-snap-a2'` ;
  - `has_function_privilege('authenticated', 'public.take_wealth_snapshot(date)', 'execute')` est faux, idem `run_wealth_snapshot(boolean)`.
- [ ] **Step 2: Run it before the migration** (MCP `execute_sql`) → erreur « relation wealth_snapshots does not exist ».
- [ ] **Step 3: Write the migration** selon l'Interfaces ci-dessus.
- [ ] **Step 4: Apply** (MCP `apply_migration`, nom `wealth_snapshots`) puis relancer le test → `OK` ; `get_advisors` sécurité → aucun nouvel avertissement.
- [ ] **Step 5: Commit** `feat(patrimoine): photo quotidienne de la valeur des comptes (22 h)`.

### Task 2: Séries de l'historique (module pur)

**Files:**
- Create: `app/src/lib/history.ts`
- Modify: `app/src/lib/patrimoine.ts` (ajout de `fetchWealthHistory`)
- Test: `app/tests/history.test.ts`

**Interfaces:**
- Consumes: table `wealth_snapshots` (Task 1).
- Produces (`history.ts`, sans import supabase) :
  - `export type Period = '1S' | '1M' | '3M' | '1A' | 'Tout'` ; `export const PERIODS: Period[]`.
  - `export type SnapshotRow = { date: string; bank_uid: string | null; manual_id: string | null; value_eur: number | null; invested_eur: number | null; missing: number }`.
  - `export type Point = { date: string; value: number | null; doubtful: boolean }`.
  - `periodStart(period: Period, today: string): string | null` — `null` pour `Tout` ; sinon today − 7 j / 1 mois / 3 mois / 1 an, en `AAAA-MM-JJ`.
  - `totalSeries(rows: SnapshotRow[], visible: { bank: Set<string>; manual: Set<string> }): Point[]` — par date croissante, somme des `value_eur` connus des lignes visibles ; `doubtful` si une ligne visible a `value_eur` null ou `missing > 0`.
  - `accountSeries(rows: SnapshotRow[], match: (r: SnapshotRow) => boolean, field: 'value_eur' | 'invested_eur'): Point[]` — par date, somme des lignes correspondantes ; `value` null si toutes nulles ; `doubtful` si l'une est nulle ou `missing > 0` ; dates sans ligne correspondante absentes.
- Produces (`patrimoine.ts`) : `fetchWealthHistory(from: string | null): Promise<SnapshotRow[]>` — `select date, bank_uid, manual_id, value_eur, invested_eur, missing` ordonné par date, `gte('date', from)` si non null, nombres convertis avec `Number` (null conservé).

- [ ] **Step 1: Write failing tests** `history.test.ts` :
  - `periodStart('3M', '2026-11-13') === '2026-08-13'`, `periodStart('1S', '2026-03-01') === '2026-02-22'`, `periodStart('1M', '2026-03-31') === '2026-02-28'` (fin de mois ramenée), `periodStart('Tout', …) === null` ;
  - `totalSeries` : deux jours, compte masqué exclu, valeur null → somme des autres et `doubtful: true`, `missing: 2` → `doubtful: true`, tri par date ;
  - `accountSeries` d'un groupe de deux `bank_uid` → somme ; toutes nulles → `value: null` ; `field: 'invested_eur'`.
- [ ] **Step 2:** `cd app && npm test` → échec (module absent).
- [ ] **Step 3:** Implémenter `history.ts` et `fetchWealthHistory`.
- [ ] **Step 4:** `npm test` → tout passe ; `npx tsc --noEmit` → 0.
- [ ] **Step 5: Commit** `feat(patrimoine): séries de l'historique (total, compte, période)`.

### Task 3: Géométrie de la courbe (module pur)

**Files:**
- Create: `app/src/lib/chart.ts`
- Test: `app/tests/chart.test.ts`

**Interfaces:**
- Produces :
  - `yDomain(values: (number | null)[]): [number, number]` — min/max des valeurs connues avec 10 % de marge ; valeurs égales → ±1 % (au moins ±1) ; aucune valeur → `[0, 1]`.
  - `niceTicks(min: number, max: number, count?: number): number[]` — `count` défaut 4 ; pas « rond » (1, 2, 2,5, 5 × 10ⁿ), valeurs dans `[min, max]`.
  - `scale(domain: [number, number], range: [number, number]): (v: number) => number` — linéaire.
  - `linePath(points: { x: number; y: number | null }[]): string` — `M x y L x y …` ; un `null` coupe le trait (nouveau `M` après) ; aucun point → `''`.
  - `nearestIndex(xs: number[], x: number): number` — index du x le plus proche ; `-1` si vide.

- [ ] **Step 1: Write failing tests** : `yDomain([])` → `[0, 1]` ; `yDomain([500, 500])` → min < 500 < max ; `yDomain([-200, 1000])` inclut −200 ; `niceTicks(-200, 1000)` contient 0 et des valeurs négatives ; `niceTicks(0, 47980)` → pas rond (ex. 10000 ou 20000) ; `linePath([{x:0,y:5}])` → `'M0 5'` sans `NaN` ; `linePath` avec un `null` au milieu → deux `M` ; `nearestIndex([0, 10, 20], 14) === 1`, `nearestIndex([], 3) === -1`.
- [ ] **Step 2:** `npm test` → échec.
- [ ] **Step 3:** Implémenter `chart.ts`.
- [ ] **Step 4:** `npm test` → passe.
- [ ] **Step 5: Commit** `feat(patrimoine): géométrie des courbes`.

### Task 4: Composant `LineChart` + sélecteur de période

**Files:**
- Create: `app/src/components/LineChart.tsx`
- Modify: `app/package.json`, `app/package-lock.json` (via `npx expo install react-native-svg`), `app/app.json` (`version` 1.1.0)

**Interfaces:**
- Consumes: `Point`, `Period`, `PERIODS` (Task 2) ; `yDomain`, `niceTicks`, `scale`, `linePath`, `nearestIndex` (Task 3) ; `useTheme` (`src/lib/theme.ts`), `money` (`src/lib/format.ts`).
- Produces :
  - `export function LineChart(props: { series: { points: Point[]; dashed?: boolean; label: string }[]; height?: number }): JSX.Element` — hauteur défaut 180 ; la 1ʳᵉ série porte les dates (axe X) ; largeur via `onLayout` ; graduations Y à gauche (format court, ex. « 40 k€ ») ; `PanResponder` → ligne verticale + bulle « 12 nov. : 47 980 € » (+ « · incomplet » si `doubtful`) pour chaque série (label avant le montant si plusieurs séries) ; < 2 points dans la 1ʳᵉ série → texte « La courbe se remplit chaque soir à 22 h. ».
  - `export function PeriodPicker(props: { value: Period; onChange: (p: Period) => void }): JSX.Element` — 5 boutons, actif en `t.primary`.

- [ ] **Step 1:** `cd app && npx expo install react-native-svg` ; `version` → `1.1.0` dans `app.json`.
- [ ] **Step 2:** Écrire `LineChart.tsx` (pas de logique de calcul dedans : tout passe par `chart.ts`).
- [ ] **Step 3:** `npx tsc --noEmit && npx eslint src tests && npm test` → 0 erreur.
- [ ] **Step 4: Commit** `feat(patrimoine): composant de courbe (react-native-svg)`.

### Task 5: Courbes dans les écrans

**Files:**
- Modify: `app/src/app/(tabs)/patrimoine.tsx` (sous le total, avant « Bilan fiscal »)
- Modify: `app/src/app/patrimoine/account/[id].tsx` (en-tête du compte)
- Modify: `app/src/app/account/[id].tsx` (en-tête du groupe bancaire)

**Interfaces:**
- Consumes: `fetchWealthHistory` (Task 2), `periodStart`, `totalSeries`, `accountSeries`, `PERIODS` (Task 2), `LineChart`, `PeriodPicker` (Task 4), `useLoad` (`data.ts`), `isoDay` (`format.ts`).

- [ ] **Step 1:** Patrimoine : état `period` (défaut `'3M'`), `useLoad(() => fetchWealthHistory(periodStart(period, isoDay(new Date()))), [period])` ; ensembles visibles = `uid` des comptes bancaires non masqués (`bank.data`) et `id` des comptes manuels non masqués (`manual.data`) ; `LineChart` avec `totalSeries`.
- [ ] **Step 2:** Compte manuel : `accountSeries(rows, r => r.manual_id === id, 'value_eur')` (label « Valeur ») ; si `kind === 'investment'`, 2ᵉ série `invested_eur` en pointillés (label « Investi »).
- [ ] **Step 3:** Groupe bancaire : `accountSeries(rows, r => uids.includes(r.bank_uid ?? ''), 'value_eur')`.
- [ ] **Step 4:** `npx tsc --noEmit && npx eslint src tests && npm test` puis `npx expo export --platform android --output-dir <scratchpad>/export` → succès. Vérifier sur le web (`npx expo start --web`) que les trois écrans s'affichent avec le message « La courbe se remplit… » ou une courbe.
- [ ] **Step 5: Commit** `feat(patrimoine): courbes du total et de chaque compte`.

### Task 6: Livraison

- [ ] **Step 1:** Demander confirmation à l'utilisateur avant le build (nouvel APK à installer, l'APK 1.0.0 ne reçoit plus de mises à jour).
- [ ] **Step 2:** `cd app && EXPO_TOKEN=… npx eas-cli build -p android --profile preview --non-interactive` → lien d'installation de l'APK.
- [ ] **Step 3:** Donner le lien à l'utilisateur ; le lendemain, vérifier qu'une ligne existe pour la date du jour à 22 h (`select date, count(*) from wealth_snapshots group by date`).
