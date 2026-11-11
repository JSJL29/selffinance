# Patrimoine : comptes manuels, placements et plus-values (conception)

Date : 11/11/2026 · Statut : proposé

## Intention

SelfFinance montre aujourd'hui les comptes courants récupérés par Open Banking (SG, Revolut, BNP via Enable Banking). Il manque tout ce que l'Open Banking ne couvre pas : Livret A et autres livrets, PEA, CTO, assurance-vie, PER, épargne salariale (Natixis Interépargne), IBKR. Le propriétaire veut **voir tout son patrimoine au même endroit** et savoir, pour chaque placement, **ce qu'il a payé et ce que ça vaut aujourd'hui**, c'est-à-dire sa plus-value ou moins-value.

Utilisateur unique : le propriétaire, déjà authentifié (`app_users`).

## Objectifs

1. **Comptes manuels d'épargne** (Livret A, LDDS, LEP, poches Revolut, compte à terme…) : un nom, un établissement, un solde saisi à la main et sa date.
2. **Comptes d'investissement manuels** (PEA, CTO, assurance-vie, PER, PEE/PERCO…) : des **liquidités** saisies à la main, plus des **positions**.
3. **Positions** : un titre, une **quantité** et un **prix de revient unitaire (PRU)**. La saisie se fait en positions, pas en historique d'opérations.
4. **Référentiel de titres** : on cherche un titre par **ISIN ou par nom**. Les cours se mettent à jour automatiquement quand une source existe ; sinon on saisit le cours à la main.
5. Pour chaque position, chaque compte et l'ensemble : **valeur actuelle, montant investi, plus-value ou moins-value en € et en %**.
6. **Nouvel onglet « Patrimoine »** : total général (comptes bancaires + épargne + placements) et plus-value globale des placements, avec le détail par compte.

## Non-objectifs (pour cette étape)

- **Historique des opérations** (achats, ventes, dividendes, versements) et plus-values réalisées. C'est l'étape suivante : le modèle doit permettre d'ajouter plus tard une table d'opérations sans casser les positions (voir « Évolutions prévues »).
- **IBKR automatique** (Flex Web Service) : étape suivante. Pour l'instant, IBKR se saisit comme un compte manuel.
- Graphiques d'évolution, performance annualisée, fiscalité (PFU, abattements), intérêts des livrets calculés automatiquement.
- Import de relevés CSV ou PDF.

## Anti-objectifs

- Toucher au budget de **4 accès bancaires par jour** (DSP2) : les cours ne passent jamais par Enable Banking ni par `sync_runs`.
- Afficher une valeur fausse sans le signaler : un cours ancien ou introuvable doit être visible comme tel (date du cours, mention « cours manuel » ou « cours introuvable »).
- Exposer des données à d'autres que le propriétaire : même RLS que l'existant (`public.is_app_user()`).

## Contraintes et existant

- **App** : Expo SDK 58 + Expo Router (`app/src/app`), onglets dans `app/src/app/(tabs)/_layout.tsx` (« Comptes », « Transactions »). Thème dans `app/src/lib/theme.ts`, accès aux données dans `app/src/lib/data.ts` (hook `useLoad`), composants dans `app/src/components/ui.tsx`. Les règles du projet sont dans `app/AGENTS.md` (`npx expo install`, tsc + `npx eslint src` avant de livrer).
- **Supabase** (projet `pkyvpjfzngsjfnvhwbsn`, eu-west-3). Les migrations sont dans `supabase/migrations/` et s'appliquent avec le MCP Supabase. Fonctions Edge déjà en place : `sync` (Enable Banking) et `bank` (connexion des banques). Les secrets sont dans Vault et lus via `public.sync_config()`, réservée à service_role. Les fonctions sont déployées avec `verify_jwt = false` et font leur propre vérification : secret Vault pour le cron, JWT d'un `app_user` pour l'app.
- **Cron** : `pg_cron` + `pg_net`. Le job `sync-banks` tourne chaque heure et appelle `public.run_scheduled_sync()`.
- **Taux de change** : `public.fx_rates` (1 EUR = `per_eur` unités), mis à jour par `sync` depuis frankfurter.app.
- Tous les montants affichés sont convertis en **EUR**.

## Approches envisagées pour les cours

| | Approche | Avantages | Inconvénients |
|---|---|---|---|
| **1 (retenue)** | **Yahoo Finance** (API non officielle) pour les actions et ETF, avec recherche par ISIN ou nom, + **base AMF** (GECO / fichiers ROSA) pour les FCPE publics, + **saisie manuelle** en dernier recours | Gratuit, large couverture (Euronext, US…) | Non officiel : peut changer ou limiter sans prévenir |
| 2 | API payante (EODHD ou équivalent) | Fiable, nombreux fonds par ISIN | ~20 €/mois |
| 3 | Tout à la main | Rien ne casse | Pénible, contraire au but |

**Choix du propriétaire : 1.** La récupération des cours est isolée derrière une interface de « fournisseur de cours » unique, pour pouvoir passer à la 2 sans toucher au reste.

## Ce qui a été décidé

- **Saisie en positions** : quantité + PRU, pas d'historique pour l'instant.
- **Onglet séparé « Patrimoine »**, l'onglet « Comptes » reste centré sur les comptes courants et les dépenses.
- **Le total du Patrimoine inclut les comptes bancaires** Open Banking. *(choix proposé par Claude, non contesté)*
- **Cours mis à jour une fois par jour ouvré vers 19 h (heure de Paris)**, et immédiatement à l'ajout d'un titre. *(choix proposé par Claude, non contesté)*
- **IBKR et Natixis** se saisissent à la main pour l'instant. Pour Natixis, le cours vient de l'AMF quand le fonds y est publié, sinon il se saisit à la main.

## Modèle de données (proposition)

Toutes les tables ont la RLS activée : lecture et écriture réservées à `is_app_user()`, sauf mention contraire.

- **`manual_accounts`** : `id uuid`, `name` (« PEA Fortuneo »), `institution` (« Fortuneo »), `kind` (`savings` | `investment`), `envelope` (`livret_a`, `ldds`, `lep`, `livret`, `pea`, `pea_pme`, `cto`, `assurance_vie`, `per`, `epargne_salariale`, `crypto`, `autre`), `currency` (défaut EUR), `cash_balance numeric` (solde d'un livret, ou liquidités d'un compte d'investissement), `cash_updated_at date`, `hidden boolean`, `sort_order int`, `created_at`.
- **`instruments`** (référentiel partagé entre comptes, une ligne par cotation) : `id uuid`, `isin text null`, `amf_code text null` (FCPE), `name`, `type` (`stock` | `etf` | `fund` | `fcpe` | `fonds_euros` | `bond` | `crypto` | `other`), unicité (`isin`, `source_symbol`), `currency` (devise de cotation), `price_source` (`yahoo` | `amf` | `manual`), `source_symbol` (ticker Yahoo, ex. `CW8.PA`, ou code AMF), `last_price numeric`, `last_price_date date`, `price_updated_at timestamptz`, `price_error text`.
- **`instrument_prices`** (historique des cours, pour plus tard) : `instrument_id`, `date`, `price`, clé primaire (`instrument_id`, `date`). Elle est alimentée à chaque mise à jour et sert aux futurs graphiques.
- **`positions`** : `id uuid`, `account_id → manual_accounts`, `instrument_id → instruments`, `quantity numeric`, `avg_cost numeric` (PRU), `cost_currency` (défaut : devise du compte, en pratique EUR, car les courtiers français affichent le PRU en EUR), `updated_at`. Unicité (`account_id`, `instrument_id`).
- **Vues** (`security_invoker`) :
  - `position_view` : valeur EUR = `quantity × last_price` converti depuis `instruments.currency` ; investi EUR = `quantity × avg_cost` converti depuis `cost_currency` ; plus-value en € et en %. Elle expose aussi l'âge du cours et la source.
  - `manual_account_view` : liquidités EUR + somme des positions, investi, plus-value.
  - `net_worth` (ou calcul dans l'app) : comptes bancaires (`account_view.balance_eur`) + comptes manuels.

### Règles de calcul *(choix de Claude après relecture)*

- **Liquidités** : elles comptent dans la **valeur** du compte, mais **pas dans le montant investi ni dans la plus-value**. Plus-value d'un compte = Σ (valeur − investi) de ses positions ; % = plus-value / investi des positions. La valeur affichée d'un compte = liquidités + valeur des positions.
- **Fonds euros (assurance-vie, PER) et autres supports sans cours** : on les saisit comme une **« ligne à valeur »**. C'est une position sur un titre de type `fonds_euros` (ou `other`) en source `manual`, avec `quantity = 1`, `avg_cost = montant versé`, et un cours égal à la valeur actuelle, mis à jour à la main. Le formulaire propose ce mode (« montant versé » + « valeur actuelle ») au lieu de quantité × PRU. Le fonds euros ne va donc pas dans les liquidités, et ses gains restent visibles.
- **Devises** : le PRU se saisit par défaut **en EUR** (`cost_currency = EUR`), comme l'affichent les courtiers français. La plus-value en € inclut alors l'effet de change. On peut choisir une autre devise de PRU ; dans ce cas, le montant investi est converti au taux du jour, et l'écran le signale (« hors effet de change »).
- **Taux de change manquant** : dans les nouvelles vues, un taux absent de `fx_rates` donne une valeur `null`, signalée « taux de change indisponible ». On ne revient pas à 1 comme le fait `account_view`.
- **Une cotation = un titre** : un même ISIN peut être coté sur plusieurs places et dans plusieurs devises. L'unicité porte sur (`isin`, `source_symbol`), pas sur l'ISIN seul. La recherche propose les différentes places, avec Euronext Paris en EUR en premier.
- **Total du Patrimoine** : comptes bancaires **non masqués** (`hidden = false`) + comptes manuels non masqués. Un compte bancaire dont l'accès a expiré reste compté, avec la date de son dernier solde. Les poches Revolut ne sont pas renvoyées par Enable Banking (vérifié : seuls les comptes EUR, USD et GBP remontent), donc les saisir à la main ne crée pas de double compte.

## Cours : fonction Edge `quotes`

- `GET /quotes/search?q=` (JWT app_user) : recherche Yahoo (ISIN ou nom). Elle renvoie les candidats : nom, ticker, place, devise, type. Si `q` ressemble à un code AMF (12 chiffres), elle cherche dans les données AMF.
- `POST /quotes/refresh` : met à jour les cours des `instruments` dont la source est `yahoo` ou `amf`. Elle est appelée par le cron (secret Vault) et après l'ajout d'un titre (JWT, sur un seul instrument). Elle écrit `last_price`, `last_price_date`, `instrument_prices`, et `price_error` en cas d'échec.
- **Cron** : nouveau job `pg_cron`, ou extension de la logique horaire existante, qui déclenche `refresh` en semaine à 19 h, heure de Paris.
- **Ces appels n'utilisent ni Enable Banking ni `sync_runs`.**

## Écrans (proposition)

```
Onglet Patrimoine                     Compte d'investissement
┌───────────────────────────┐         ┌───────────────────────────┐
│ Patrimoine total          │         │ ‹ Patrimoine              │
│ 48 230 €                  │         │ PEA Fortuneo   12 400 €   │
│ Placements +2 140 € +5,2% │         │ +820 € (+7,1 %)           │
│ ── Comptes bancaires ──   │         │ Liquidités   310 € ✎      │
│ SG, Revolut, BNP   52 €   │         │ ── Positions ──           │
│ ── Épargne ──             │         │ Amundi MSCI World         │
│ Livret A        8 000 € ✎ │         │  42 × 512,3 €  +9,8 %     │
│ ── Placements ──          │         │  cours du 11/11           │
│ PEA Fortuneo   12 400 €   │         │ Air Liquide               │
│  +820 € (+7,1 %)          │         │  10 × 168,0 €  −2,1 %     │
│ CTO IBKR       21 000 €   │         │ + Ajouter une position    │
│ + Ajouter un compte       │         └───────────────────────────┘
└───────────────────────────┘
```

- **Onglet Patrimoine** : total, plus-value globale des placements, puis trois sections. La section des comptes bancaires est une ligne de résumé ; toucher la ligne renvoie vers l'onglet Comptes.
- **Ajouter un compte** : type (épargne ou investissement), enveloppe, nom, établissement, solde ou liquidités.
- **Détail d'un compte d'investissement** : liquidités modifiables, positions avec valeur, plus-value, date et source du cours.
- **Ajouter ou modifier une position** : recherche du titre (ISIN ou nom) → choix du candidat → quantité + PRU. On peut créer un titre « manuel » (nom + cours saisi) quand la recherche ne trouve rien.
- **Cours manuel** : sur un titre `manual`, ou dont le cours est introuvable, on saisit le cours et sa date.
- Suppression d'une position ou d'un compte, avec confirmation.

## Évolutions prévues (à ne pas bloquer)

- **Historique des opérations** : table `operations` (compte, titre, date, type achat/vente/dividende/versement, quantité, prix, frais). Les positions pourront alors être recalculées à partir des opérations, ou rester saisies pour les comptes sans historique.
- **IBKR Flex Web Service** : remplira les positions et les opérations du compte IBKR.

## Laissé au constructeur

- Les endpoints Yahoo exacts (recherche, cours), les en-têtes nécessaires, la gestion des limites de requêtes et le choix de la place de cotation par défaut (préférer Euronext Paris en EUR).
- Le format et la récupération des fichiers AMF (GECO / ROSA). Si ce n'est pas automatisable simplement, livrer d'abord la saisie manuelle pour les FCPE et le noter.
- La présentation exacte des écrans, en restant cohérent avec le thème et les composants existants.
- Le découpage en migrations, fonctions et écrans, ainsi que les tests.
