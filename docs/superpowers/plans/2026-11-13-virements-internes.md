# Virements internes — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les comptes manuels suivent les virements faits depuis/vers les banques ; les virements entre banques s'affichent en une ligne « SG → BNP ».

**Architecture:** Migration : libellé + date de départ sur `manual_accounts`, somme des virements calculée dans `manual_account_view`, classement « interne » étendu. App : fonction pure `pairTransfers` qui fusionne les paires dans l'onglet Transactions.

**Tech Stack:** Postgres/Supabase, Expo/React Native, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-13-virements-internes-design.md`

## Global Constraints
- Libellé = texte simple, recherche sans casse dans « contrepartie + libellé » (`strpos(lower(..), lower(pattern)) > 0`), jamais de regex saisie.
- Virements comptés si `booking_date > transfers_from` ; conversion `fx_convert` ; un taux absent rend `transfers` null (jamais 1).
- Comptes `sync_source` non nul (IBKR) : pas de virements.
- Le formulaire d'un compte manuel affiche le solde **virements compris** ; enregistrer met `cash_balance` = valeur saisie et `transfers_from` = aujourd'hui.
- Aucune ligne d'attribution dans les commits.

## Review Focus
1. Enregistrer le formulaire sans rien changer ne perd ni ne double les virements (test SQL : solde effectif identique après « ré-enregistrement »).
2. Virement le jour même de la saisie → non compté (test SQL).
3. Libellé vide ou null → aucun virement, aucun classement (test SQL).
4. Deux virements identiques le même jour (2 × −50 €) → deux paires distinctes, aucune opération réutilisée (test `pairTransfers`).
5. Paire impossible (même compte, même signe, devises différentes, > 3 jours) → lignes séparées (test `pairTransfers`).

---

### Task 1: Base — libellé, somme des virements, classement
**Files:** Create `supabase/migrations/20261113150000_manual_transfers.sql`, `supabase/tests/manual_transfers.sql`.
**Produces:** colonnes `manual_accounts.transfer_pattern text`, `transfers_from date not null default current_date` ; vue `manual_account_view` recréée avec `transfers numeric` (devise du compte), `cash_eur`/`value_eur` incluant `transfers` ; `classify_transaction` : libellé d'un compte manuel (non synchronisé, libellé non vide) prioritaire → `is_internal`, `internal_label` = nom du compte ; déclencheur sur `manual_accounts` (insert, update of `transfer_pattern`) qui reclasse les opérations (fonction `security definer`).
- [ ] Test SQL (RED puis GREEN via MCP) : Livret test (cash 1000, libellé « LIVRET TEST », `transfers_from` = 2026-01-10) ; opérations bancaires −300 le 2026-01-11 (« VIR VERS LIVRET TEST »), +100 le 2026-01-12, −50 le 2026-01-10 (même jour → ignorée), −20 USD sans taux un autre test ; attendu `transfers` = 200, `cash_eur` = 1200, opérations classées internes avec le nom du compte ; libellé vide → `transfers` = 0 ; mise à jour `cash_balance` = 1200 et `transfers_from` = 2026-01-12 → `transfers` = 0 (pas de double compte) ; devise sans taux → `transfers` null.
- [ ] Migration appliquée (MCP), `get_advisors` sans nouvel avertissement. Commit `feat(patrimoine): virements vers les comptes manuels`.

### Task 2: App — libellé et solde virements compris
**Files:** Modify `app/src/lib/patrimoine.ts` (`ManualAccount` + `transfer_pattern`, `transfers_from`, `transfers` ; `ACCOUNT_NUMS` + `transfers` ; `AccountInput.transfer_pattern` ; `saveManualAccount` écrit `transfer_pattern` (vide → null) et `transfers_from: isoDay(new Date())`), `app/src/app/patrimoine/account-edit.tsx` (champ « Libellé des virements », solde prérempli `cash_balance + transfers`), `app/src/app/patrimoine/account/[id].tsx` (solde affiché `cash_balance + transfers`, mention « dont ±x de virements depuis le … »).
- [ ] `tsc`, `eslint`, `npm test`. Commit `feat(patrimoine): libellé des virements et solde à jour`.

### Task 3: Fusion des virements entre banques
**Files:** Create `app/src/lib/transfers.ts`, `app/tests/transfers.test.ts` ; Modify `app/src/components/ui.tsx` (`TransferRow`), `app/src/app/(tabs)/transactions.tsx`.
**Produces:** `type ListItem = { kind: 'tx'; tx: Tx } | { kind: 'transfer'; out: Tx; in: Tx }` ; `pairTransfers(txs: Tx[]): ListItem[]` (ordre d'entrée conservé, la paire à la place du débit) ; `groupByDay(items: ListItem[]): { title: string; data: ListItem[] }[]`. `Tx` vient de `data.ts` (type seulement).
- [ ] Tests (RED puis GREEN) : paire simple SG −1000 / BNP +1000 à 1 jour → 1 élément `transfer` ; même compte → pas de paire ; même signe → non ; devises différentes → non ; 4 jours → non ; 2 × (−50/+50) le même jour → 2 paires distinctes ; une non interne → non ; choix du crédit le plus proche en date ; `groupByDay` regroupe par date du débit.
- [ ] `TransferRow` : « SG → BNP » (noms courts), montant sans signe, couleur neutre, étiquette « interne » ; onglet Transactions utilise `pairTransfers` + `groupByDay`.
- [ ] `tsc`, `eslint`, `npm test`, `expo export`. Commit `feat(transactions): virements entre banques sur une seule ligne`.

### Task 4: Relecture et livraison
- [ ] Relecture indépendante ; corrections (test d'abord) ; `eas update` (JS seulement) après accord.
