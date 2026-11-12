# AGENTS.md — guide pour les assistants IA

Ce fichier s'adresse à un **assistant IA** (Claude Code, Codex, Cursor, Copilot…) chargé d'**installer une nouvelle copie de SelfFinance** pour son utilisateur, puis de la faire évoluer. Le guide humain détaillé est [`docs/SETUP.md`](docs/SETUP.md) : suis-le étape par étape. Ce fichier ajoute ce dont un assistant a besoin pour le faire **seul, proprement et sans fuite de secrets**.

> Langue : l'utilisateur et l'interface sont en **français**. Réponds-lui en français, écris les textes de l'app en français.

## 1. Ce qu'est le projet

App perso de suivi de patrimoine, **une personne = une copie** (pas de multi-utilisateurs) :

- **App** : Expo SDK 58 + Expo Router, TypeScript (`app/`). Android d'abord, marche aussi sur le web (PC). Règles Expo spécifiques : [`app/AGENTS.md`](app/AGENTS.md) (lis-le avant de toucher à `app/`).
- **Serveur** : Supabase (Postgres + RLS, Edge Functions Deno, `pg_cron`, `pg_net`, Vault) dans `supabase/`.
- **Sources de données** :
  - comptes bancaires via **Enable Banking** (Open Banking DSP2) → fonction `sync` (synchro) et `bank` (connexion depuis l'app) ;
  - cours des titres via **Yahoo Finance** (non officiel) → fonction `quotes` ;
  - **IBKR** (facultatif) via le Flex Web Service → fonction `ibkr` ;
  - le reste (livrets, PEA, CTO, FCPE, fonds euros) est **saisi à la main** dans l'onglet Patrimoine.
- **Fonctionnalités** : comptes et opérations, virements internes détectés, synchro automatique à heures réglables (budget DSP2 de 4 accès/jour), Patrimoine (positions, PRU, plus-values), ventes/dividendes, **bilan fiscal annuel estimé** (CTO, flat tax).

## 2. Carte du dépôt

```
app/                      app Expo
  src/app/                écrans (Expo Router) : (tabs)/, account/, patrimoine/, settings, add-bank, bank-connected
  src/lib/                données (data.ts, patrimoine.ts), calculs purs testés (networth, sale, positions, format)
  tests/                  tests unitaires purs : npm test (node --test, Node ≥ 23)
  eas.json                profils EAS : preview = APK, canal de mises à jour « preview »
supabase/
  migrations/             schéma complet, à appliquer dans l'ordre (npx supabase db push)
  functions/              sync · bank · quotes · ibkr (verify_jwt=false : elles authentifient elles-mêmes)
  setup/secrets.example.sql  modèle des secrets Vault (copier en secrets.sql, jamais versionné)
  tests/                  vérifications SQL (transaction annulée, renvoient 'OK')
docs/SETUP.md             guide d'installation humain, de A à Z
docs/open-banking.md      notes de recherche (banques, IBKR, FCPE)
docs/superpowers/         conceptions et plans des fonctionnalités
scripts/eb.ps1            client Enable Banking en ligne de commande (facultatif, PowerShell 5.1)
```

## 3. Installer une nouvelle copie — déroulé pour l'assistant

Légende : 🤖 l'assistant le fait · 🧑 l'utilisateur doit le faire (compte, navigateur, secret) · ✅ comment vérifier.

| # | Étape | Qui | Détail | Vérification |
|---|---|---|---|---|
| 0 | Prérequis | 🤖 | `node -v` (≥ 22 ; ≥ 23 pour `npm test`), `git --version` | versions affichées |
| 1 | Code | 🤖 | cloner, `cd app && npm install` | `npx tsc --noEmit` → 0 |
| 2 | Comptes | 🧑 | créer : Supabase, Enable Banking, Expo (+ IBKR facultatif) | l'utilisateur confirme |
| 3 | Projet Supabase | 🧑 puis 🤖 | l'utilisateur crée le projet (région proche) et donne la **ref** ; ou l'assistant le crée s'il a un accès Supabase (MCP) | ref connue |
| 4 | App Enable Banking | 🧑 | Production, redirect URL `https://<ref>.supabase.co/functions/v1/bank/callback`, télécharger le `.pem`, **lier les comptes** dans le Control Panel (SETUP §4) | fichier `<uuid>.pem` présent |
| 5 | Base + fonctions | 🤖 | `npx supabase login` (🧑 navigateur), `npx supabase link --project-ref <ref>`, `npx supabase db push`, `npx supabase functions deploy --use-api` | 4 fonctions listées dans le dashboard |
| 6 | Secrets Vault | 🤖 | remplir `supabase/setup/secrets.sql` depuis l'exemple, l'exécuter (SQL Editor ou MCP) | `select name from vault.secrets` → project_url, sync_secret, eb_app_id |
| 7 | Clé Enable Banking | 🧑 | secret de fonction `EB_PRIVATE_KEY` = contenu du `.pem` (dashboard → Edge Functions → Secrets) | une synchro ne renvoie pas « Clé Enable Banking invalide » |
| 8 | Compte propriétaire | 🧑 | Authentication → Add user (Auto Confirm) ; **le premier compte créé est le propriétaire** ; puis désactiver les inscriptions | `select count(*) from app_users` → 1 |
| 9 | App locale | 🤖 | créer `app/.env.local` (URL + clé `sb_publishable_…`), `npx expo start --lan` | l'écran de connexion s'affiche |
| 10 | Banques | 🧑 | dans l'app : Comptes → « + Ajouter une banque », cocher **les mêmes comptes** que dans le Control Panel | écran « … connectée » ; `sync_runs` trigger `connect` ok |
| 11 | IBKR (facultatif) | 🧑 puis 🤖 | Flex Query (sections et champs : SETUP §11), jeton → Vault `ibkr_query_id`, `ibkr_token` | Patrimoine → « Connecter IBKR » |
| 12 | APK | 🤖 + 🧑 | `android.package` à soi, `eas init --force`, `eas update:configure`, variables EAS, `eas build -p android --profile preview` (SETUP §12) | lien d'installation de l'APK |

**Remplacer tout ce qui appartient à l'auteur** (tableau complet : SETUP « Ce qui est propre à chaque copie ») : `android.package`, `owner` / `extra.eas.projectId` / `updates.url` dans `app/app.json` (via `eas init --force` + `eas update:configure`), la ref Supabase, les secrets.

## 4. Règles de sécurité (non négociables)

- **Ne jamais versionner** : `*.pem`, `.env*`, `app/.env.local`, `scripts/sessions*.json`, `scripts/data/`, `supabase/setup/secrets.sql`, `supabase/private/`. Vérifie `git status` et `git diff --cached` avant chaque commit (cherche `BEGIN PRIVATE KEY`, `sb_secret`, IBAN, jetons).
- **Secrets** : demande-les à l'utilisateur par un canal sûr (formulaire de secret de ton outil, dashboard Supabase) plutôt que dans la conversation. S'il en colle un quand même, range-le dans Vault ou en secret de fonction, jamais dans un fichier du dépôt.
- La clé Enable Banking reste **côté serveur**. L'app ne contient que l'URL Supabase et la clé *publishable* (publique par nature).
- Accès bancaires et IBKR en **lecture seule** ; ne jamais ajouter d'initiation de paiement.
- RLS sur toutes les tables (`public.is_app_user()`), fonctions SQL `security invoker` sauf besoin explicite, `revoke execute … from anon`. Lance `get_advisors` (sécurité) après chaque migration.

## 5. Pièges connus (déjà rencontrés)

- **Enable Banking, offre perso gratuite** : l'app ne lit **que les comptes liés dans le Control Panel**. Banque non liée → session à 0 compte (« n'a partagé aucun compte »). Compte coché différent → `error=invalid_request`.
- **Lier dans le Control Panel ≠ connecter** : il faut ensuite « + Ajouter une banque » dans l'app.
- **Budget DSP2** : 4 accès/jour/compte sans l'utilisateur. `sync_budget()` le gère ; une synchro de connexion (`trigger = 'connect'`) n'est pas comptée.
- **Trade Republic** : validation dans l'app TR ; ne pas fermer la page avant le retour. Compte espèces seulement, sans libellés.
- **Solde à 0 €** peut être réel (compte de passage) ; le solde manuel ne sert que si la banque renvoie un faux solde.
- **Yahoo Finance** est non officiel : `quotes` isole le fournisseur (`PriceProvider`) pour pouvoir le remplacer.
- **FCPE (épargne salariale)** : pas de cours public automatisable (codes `QS…` = pseudo-ISIN, code officiel = code AMF `9900…`) → saisie « Non coté » + valeur de part à la main.
- **IBKR** : plus-values en FIFO (calcul IBKR) alors que la France retient le PRU moyen → le bilan reste une **estimation**. Conversions de devises et dérivés exclus de l'import. Le relevé Activity s'arrête **à la veille** ; les ordres du jour viennent d'une 2ᵉ requête facultative (Trade Confirmation, Vault `ibkr_confirm_query_id`, niveau Exécution seulement), fusionnée par `applyTodayTrades`.
- **`pg_net`** : la requête HTTP part à la **fin de la transaction** ; lis `net._http_response` dans une requête suivante.
- **supabase-js `upsert`** de lignes hétérogènes : passer `defaultToNull: false` pour garder les valeurs par défaut.
- **PowerShell 5.1** (`scripts/eb.ps1`) : relire les réponses en UTF-8, fichiers en UTF-8 avec BOM, attention aux tableaux JSON imbriqués.
- **Expo Go** ne gère pas toujours le retour `selffinance://` ; l'APK, si. L'écran `/bank-connected` est le seul écran de résultat de connexion.
- **Web** : `Alert.alert` ne marche pas → utiliser `showAlert` (`src/lib/dialog.ts`) ; retour arrière → `goBack(fallback)` (`src/lib/nav.ts`).

## 6. Faire évoluer l'app

- **Avant de coder** : lis `docs/superpowers/specs/` (conceptions existantes) et `app/AGENTS.md`.
- **Migrations** : nouveau fichier `supabase/migrations/AAAAMMJJHHMMSS_nom.sql`, puis `npx supabase db push` (ou MCP `apply_migration`). Ajoute un test dans `supabase/tests/` (transaction annulée, `raise exception` au premier écart, `select 'OK'`).
- **Fonctions** : `npx supabase functions deploy <nom> --use-api`. Logique pure isolée et testée (ex. `supabase/functions/ibkr/flex.ts` + `flex.test.ts`, `node --test supabase/functions/ibkr/`).
- **App**, avant chaque commit :
  ```bash
  cd app && npx tsc --noEmit && npx eslint src tests && npm test
  npx expo export --platform android --output-dir <dossier temporaire>   # compile tout
  ```
- **Livrer à l'APK sans réinstaller** (changement JavaScript uniquement) :
  ```bash
  cd app && npx eas-cli update --channel preview --environment preview --message "…"
  ```
  Module natif ajouté → augmenter `version` dans `app.json` et refaire un build EAS.
- **Données** : montants en EUR via `fx_rates` (1 EUR = `per_eur` devise) ; ne jamais replier un taux manquant sur 1.

## 7. Quand t'arrêter pour demander

Création de comptes, connexion à une banque, saisie de secrets, opérations irréversibles (suppression de données, `drop`), partage public du dépôt ou de l'APK, et toute action qui coûte de l'argent : **demande d'abord à l'utilisateur**.
