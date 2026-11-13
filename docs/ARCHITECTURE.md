# 🧭 Architecture de SelfFinance

Ce document explique **comment l'app est construite** : les briques, les flux de données, le modèle
de données, la sécurité et la façon dont on teste et livre. Pour installer ta propre copie, voir
[`SETUP.md`](SETUP.md) ; pour les choix liés à l'Open Banking, [`open-banking.md`](open-banking.md).

> Principe directeur : **une personne = une copie**. Pas de multi-utilisateurs, pas de serveur à
> maintenir : une app Expo + un projet Supabase (Postgres, fonctions Edge, tâches planifiées, coffre à secrets).

---

## 1. Vue d'ensemble

```mermaid
flowchart LR
    subgraph Ext["🌍 Services externes"]
      BANKS["🏦 Banques<br/>(SG, BNP, CE, Revolut…)"]
      EB["Enable Banking<br/>(Open Banking DSP2)"]
      IBKR["IBKR<br/>Flex Web Service"]
      YAHOO["Yahoo Finance<br/>(cours, non officiel)"]
      FX["Frankfurter<br/>(taux BCE)"]
    end

    subgraph SB["☁️ Supabase"]
      direction TB
      subgraph EF["Fonctions Edge (Deno)"]
        SYNC["sync"]
        BANK["bank"]
        QUOTES["quotes"]
        FIBKR["ibkr"]
      end
      DB[("Postgres<br/>RLS partout")]
      CRON["pg_cron<br/>(tâches horaires)"]
      VAULT["Vault<br/>(secrets)"]
      NET["pg_net<br/>(appels HTTP)"]
    end

    APP["📱 App Expo<br/>Android + web"]

    BANKS -- DSP2 --> EB
    EB --> SYNC & BANK
    IBKR --> FIBKR
    YAHOO --> QUOTES
    FX --> SYNC
    SYNC & BANK & QUOTES & FIBKR --> DB
    CRON --> NET --> SYNC & QUOTES & FIBKR
    VAULT -. secrets .-> EF
    CRON -. "photo 22 h (SQL)" .-> DB
    APP -- "lecture (RLS) + RPC" --> DB
    APP -- "JWT utilisateur" --> EF
```

| Brique | Rôle |
|---|---|
| **App Expo** (`app/`) | Interface (Expo Router, TypeScript). Lit la base directement (règles RLS) et appelle les fonctions Edge pour tout ce qui touche l'extérieur. |
| **Postgres** (`supabase/migrations/`) | Données, vues de calcul (soldes en €, plus-values), fonctions SQL (ventes, bilan fiscal, photo du patrimoine). |
| **Fonctions Edge** (`supabase/functions/`) | Seul endroit qui parle aux services externes, avec les secrets. |
| **pg_cron + pg_net** | Déclenchent les synchros aux heures prévues (heure de Paris, été comme hiver). |
| **Vault** | Secrets (URL du projet, secret des tâches planifiées, ID Enable Banking, jeton IBKR). La clé privée Enable Banking est un secret de fonction. |

---

## 2. Organisation du dépôt

```mermaid
flowchart TB
    R["selffinance/"] --> A["app/ — app Expo"]
    R --> S["supabase/"]
    R --> D["docs/"]
    R --> SC["scripts/"]
    A --> A1["src/app/ — écrans (Expo Router)"]
    A --> A2["src/lib/ — données + calculs purs"]
    A --> A3["src/components/ — UI partagée (courbe, pastilles…)"]
    A --> A4["tests/ — tests unitaires (node --test)"]
    S --> S1["migrations/ — schéma complet, dans l'ordre"]
    S --> S2["functions/ — sync · bank · quotes · ibkr"]
    S --> S3["tests/ — vérifications SQL (transaction annulée)"]
    D --> D1["SETUP · ARCHITECTURE · open-banking"]
    D --> D2["superpowers/ — conceptions et plans de chaque fonctionnalité"]
    SC --> SC1["make-icons.mjs — icône + écran de chargement"]
    SC --> SC2["eb.ps1 — client Enable Banking en ligne de commande"]
```

---

## 3. L'app

### Écrans

```mermaid
flowchart LR
    L["login"] --> T
    subgraph T["Onglets"]
      C["🏦 Comptes<br/>(tabs)/index"]
      P["🥧 Patrimoine<br/>(tabs)/patrimoine"]
      TR["🔀 Transactions<br/>(tabs)/transactions"]
    end
    C --> AD["account/[id]<br/>opérations + courbe du compte"]
    C --> AB["add-bank → navigateur banque → bank-connected"]
    C --> ST["settings<br/>heures de synchro"]
    P --> PA["patrimoine/account/[id]<br/>positions, opérations, courbe valeur/investi"]
    PA --> PE["position-edit · sell · dividend"]
    P --> AE["account-edit"]
    P --> TX["tax — bilan fiscal"]
```

### Couches de code

```mermaid
flowchart TB
    UI["Écrans + composants<br/>src/app · src/components"] --> DATA["Accès aux données<br/>data.ts · patrimoine.ts"]
    UI --> PURE["Calculs purs, testés<br/>networth · history · chart · sale · positions · logos · format"]
    DATA --> PURE
    DATA --> SUPA["supabase.ts<br/>client + session"]
    SUPA --> NETWORK(("Supabase"))
```

- **Calculs purs** : aucune dépendance à Supabase ni à React Native, donc testables avec `node --test`
  (`app/tests/`). Exemples : total du patrimoine, séries de la courbe, géométrie SVG, aperçu d'une vente,
  correspondance banque → logo.
- **`useLoad`** (`data.ts`) : charge un écran, recharge au retour sur l'écran et au « tirer pour rafraîchir »,
  et ignore les réponses arrivées trop tard (changement de mois rapide).
- **Courbe** : `LineChart` (react-native-svg) dessine ce que `chart.ts` calcule ; toucher → point le plus proche.
- **Logos des banques** : liste officielle d'Enable Banking chargée une fois, partagée par toutes les pastilles ;
  à défaut, pastille à initiales.

---

## 4. Modèle de données

```mermaid
erDiagram
    bank_sessions ||--o{ accounts : "consentement"
    accounts ||--o{ transactions : "opérations"
    accounts ||--o{ wealth_snapshots : "photo du jour"
    manual_accounts ||--o{ positions : "titres détenus"
    manual_accounts ||--o{ operations : "ventes, dividendes"
    manual_accounts ||--o{ wealth_snapshots : "photo du jour"
    instruments ||--o{ positions : "cotation"
    instruments ||--o{ instrument_prices : "historique des cours"
    instruments ||--o{ operations : "titre"

    bank_sessions {
      text session_id PK
      text bank
      timestamptz valid_until
    }
    accounts {
      text uid PK
      text bank
      text iban
      text currency
      numeric balance
      numeric manual_balance
    }
    transactions {
      bigint id PK
      text account_uid FK
      date booking_date
      numeric amount
      bool is_internal
    }
    manual_accounts {
      uuid id PK
      text kind
      text envelope
      numeric cash_balance
      text sync_source
    }
    instruments {
      uuid id PK
      text isin
      text price_source
      text source_symbol
      numeric last_price
    }
    instrument_prices {
      uuid instrument_id PK
      date day PK
      numeric price
    }
    positions {
      uuid id PK
      uuid account_id FK
      uuid instrument_id FK
      numeric quantity
      numeric avg_cost
    }
    operations {
      uuid id PK
      text kind
      date day
      numeric realized
      numeric fx_per_eur
      bool provisional
    }
    wealth_snapshots {
      date day
      text bank_uid FK
      uuid manual_id FK
      numeric value_eur
      numeric invested_eur
    }
```

Tables de service : `app_users` (le propriétaire), `fx_rates` (1 EUR = x devise), `internal_rules`
(détection des virements internes), `sync_runs` + `sync_settings` (journal et heures des synchros),
`bank_auth_requests` (connexions en cours), `tax_settings` (taux, moins-values reportées).

**Vues de calcul** (lues par l'app, `security_invoker`) : `account_view`, `transaction_view`
(montants en €), `position_view`, `manual_account_view` (valeur, investi, plus-value),
`operation_view`. Règle : **un taux de change manquant donne `null`, jamais un repli à 1**.

---

## 5. Les flux principaux

### Connexion d'une banque

```mermaid
sequenceDiagram
    actor U as Utilisateur
    participant A as App
    participant B as Fonction bank
    participant EB as Enable Banking
    participant DB as Postgres
    U->>A: « + Ajouter une banque »
    A->>B: POST /bank/start (JWT)
    B->>DB: demande (state, 30 min, usage unique)
    B->>EB: POST /auth
    B-->>A: URL de la banque
    A->>EB: navigateur in-app → authentification forte
    EB->>B: GET /bank/callback?code&state
    B->>EB: POST /sessions → comptes
    B->>DB: adopt_bank_session (garde l'historique si l'uid change)
    B--)B: synchro initiale 90 j (hors budget)
    B-->>A: selffinance://bank-connected?status=ok
```

### Synchronisation bancaire (budget DSP2 : 4 accès / jour)

```mermaid
sequenceDiagram
    participant C as pg_cron (chaque heure)
    participant S as Fonction sync
    participant EB as Enable Banking
    participant DB as Postgres
    C->>C: run_scheduled_sync : heure prévue ? budget restant ?
    C->>S: POST /sync (secret Vault)
    S->>DB: sync_runs (début)
    S->>S: taux BCE → fx_rates
    loop chaque compte
      S->>EB: soldes + transactions (≤ 60 j hors connexion)
      Note over S,EB: période refusée (ex. CE : 62 j) → un nouvel essai dans la limite
      S->>DB: replace_transactions (remplace la fenêtre)
    end
    S->>DB: sync_runs (fin, journal)
```

Le bouton « Synchroniser » de l'app suit le même chemin avec le JWT de l'utilisateur, dans la limite
du budget du jour (`sync_budget()`).

### IBKR et cours des titres

```mermaid
flowchart LR
    C7["pg_cron 7 h"] --> I["fonction ibkr"]
    I -->|SendRequest / GetStatement| F["Flex Web Service"]
    I -->|"positions (replace_positions, une transaction)"| DB[(Postgres)]
    I -->|"achats, ventes, dividendes (idempotent)"| DB
    I -->|"ordres du jour = provisoires"| DB
    I --> Q["fonction quotes"]
    C19["pg_cron 19 h (jours ouvrés)"] --> Q
    APP["App : ouverture du Patrimoine / tirer pour rafraîchir"] --> Q
    Q -->|cotation par ISIN puis ticker, même devise que le PRU| Y["Yahoo Finance"]
    Q --> DB
```

### Historique du patrimoine (la courbe)

```mermaid
flowchart LR
    CR["pg_cron (chaque heure)"] --> R{"22 h à Paris ?"}
    R -- non --> X["rien"]
    R -- oui --> T["take_wealth_snapshot()"]
    T -->|"1 ligne par compte et par jour<br/>(mêmes vues que l'écran)"| W[("wealth_snapshots")]
    W -->|"lecture par pages<br/>(limite 1000 lignes)"| H["history.ts<br/>total / compte / période"]
    H --> LC["LineChart"]
```

---

## 6. Tâches planifiées

| Tâche | Fréquence | Agit si… | Fait |
|---|---|---|---|
| `sync-banks` | chaque heure | l'heure fait partie des heures choisies et le budget le permet | appelle `sync` |
| `sync-ibkr` | chaque heure | il est 7 h et la Flex Query est configurée | appelle `ibkr` |
| `refresh-quotes` | chaque heure | il est 19 h un jour ouvré | appelle `quotes/refresh` |
| `wealth-snapshot` | chaque heure | il est 22 h | photo du patrimoine en SQL (aucun accès bancaire) |

Toutes comparent l'heure **de Paris** : pas de décalage au changement d'heure.

---

## 7. Sécurité

- **RLS sur toutes les tables** : lecture réservée à `is_app_user()` (le premier compte créé) ;
  l'app n'écrit que ce qui est saisi à la main (solde manuel, comptes, positions, opérations manuelles).
- **Fonctions Edge** : `verify_jwt = false` mais authentification faite par chaque fonction
  (JWT d'un `app_user`, ou secret Vault pour les tâches planifiées ; jamais accepté si le secret est absent).
- **Secrets** : jamais dans le dépôt (`.gitignore` : `*.pem`, `.env*`, `secrets.sql`…). Clé Enable Banking
  côté serveur uniquement ; l'app ne contient que l'URL Supabase et la clé *publishable*.
- **Lecture seule** : aucun accès bancaire ou IBKR ne peut initier de paiement ni d'ordre.
- **Connexion bancaire** : `state` à usage unique (30 min), adresse de retour limitée au schéma de l'app.
- Fonctions SQL sensibles (`sync_config`, `ibkr_token`, `take_wealth_snapshot`, `replace_positions`…) :
  exécutables par `service_role` seulement.

---

## 8. Tests et livraison

```mermaid
flowchart LR
    DEV["Changement"] --> CHK["tsc · eslint · npm test<br/>node --test supabase/functions"]
    CHK --> SQL["tests SQL<br/>supabase/tests/*.sql → 'OK'"]
    SQL --> MIG["migration<br/>db push / MCP"]
    MIG --> FN["fonctions Edge<br/>functions deploy"]
    FN --> JS{"Changement natif ?"}
    JS -- non --> UPD["eas update<br/>(sans réinstaller)"]
    JS -- oui --> BLD["version +1<br/>eas build → APK"]
```

| Niveau | Où | Lancer |
|---|---|---|
| Calculs de l'app | `app/tests/*.test.ts` | `cd app && npm test` |
| Logique des fonctions | `supabase/functions/**/*.test.ts` | `node --test supabase/functions/` |
| Base de données | `supabase/tests/*.sql` | SQL Editor ou MCP : chaque fichier renvoie `OK` |
| Types et style | — | `npx tsc --noEmit && npx eslint src tests` |

Le numéro de version de l'app (`app.json`) sert aussi de « runtime » pour les mises à jour sans
réinstallation : un module natif ajouté ⇒ nouvelle version ⇒ nouvel APK.

---

## 9. Choix importants

| Choix | Pourquoi |
|---|---|
| Enable Banking plutôt qu'un agrégateur payant | Offre perso gratuite, DSP2 officiel ; contrainte : comptes liés dans le Control Panel. |
| Budget de 4 accès/jour calculé en base | Limite DSP2 sans l'utilisateur ; la synchro de connexion n'est pas comptée. |
| Fenêtre de synchro ≤ 60 jours | Certaines banques (Caisse d'Épargne) refusent au-delà de 62 jours hors connexion. |
| Plus-values au PRU moyen (règle française) | IBKR calcule en FIFO : le bilan fiscal reste une estimation. |
| Courbe faite maison (react-native-svg) | Un seul module natif, thème clair/sombre, calculs testés. |
| Logos officiels Enable Banking | Pas d'imitation de marques ; pastille de secours si absent. |
| Une ligne par compte et par jour pour l'historique | Total, détail par compte et futures vues (par catégorie) avec les mêmes données. |
