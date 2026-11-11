# Installer ta propre copie de SelfFinance

Ce guide installe **ta propre instance** de SelfFinance : ta base de données, ton accès aux banques et ton app. Rien n'est partagé avec qui que ce soit, chacun a sa copie.

> **Durée** : environ 1 h la première fois, en grande partie de l'attente (création du projet, compilation de l'app).
> **Coût** : 0 €. Supabase, Enable Banking (usage personnel), Expo et Yahoo Finance sont gratuits dans ce cadre.

## Sommaire

1. [Ce qu'il te faut](#1-ce-quil-te-faut)
2. [Récupérer le code](#2-récupérer-le-code)
3. [Créer le projet Supabase](#3-créer-le-projet-supabase)
4. [Créer l'application Enable Banking](#4-créer-lapplication-enable-banking)
5. [Mettre en ligne la base et les fonctions](#5-mettre-en-ligne-la-base-et-les-fonctions)
6. [Ranger les secrets](#6-ranger-les-secrets)
7. [Créer ton compte utilisateur](#7-créer-ton-compte-utilisateur)
8. [Lancer l'app sur ton téléphone](#8-lancer-lapp-sur-ton-téléphone)
9. [Connecter tes banques](#9-connecter-tes-banques)
10. [Patrimoine : livrets, PEA, CTO…](#10-patrimoine--livrets-pea-cto)
11. [IBKR (facultatif)](#11-ibkr-facultatif)
12. [Installer la vraie app (APK)](#12-installer-la-vraie-app-apk)
13. [Personnaliser](#13-personnaliser)
14. [Entretien](#14-entretien)
15. [Dépannage](#15-dépannage)

---

## 1. Ce qu'il te faut

**Sur ton ordinateur** (Windows, macOS ou Linux) :
- [Git](https://git-scm.com/downloads) ;
- [Node.js](https://nodejs.org) en version LTS (22 ou plus récent). Vérifie avec `node -v`.

**Sur ton téléphone** : un Android et l'app **Expo Go** (Play Store) pour les premiers essais.

**Des comptes gratuits** :
| Service | Pour quoi | Lien |
|---|---|---|
| GitHub | récupérer le code | [github.com](https://github.com) |
| Supabase | base de données + serveur | [supabase.com](https://supabase.com) |
| Enable Banking | accès Open Banking à tes banques | [enablebanking.com](https://enablebanking.com) |
| Expo | compiler la vraie app (étape 12) | [expo.dev](https://expo.dev) |

> **Banques compatibles** : celles de ton pays disponibles chez Enable Banking (en France : BNP, SG, Crédit Agricole, LCL, Caisse d'Épargne, Banque Populaire, Crédit Mutuel, CIC, La Banque Postale, Boursorama, Fortuneo, Revolut, N26, Trade Republic…). L'Open Banking ne couvre **que les comptes de paiement** : les livrets, PEA, CTO et assurances-vie se gèrent dans l'onglet Patrimoine (étape 10).

## 2. Récupérer le code

Demande l'accès au dépôt, puis :

```bash
git clone https://github.com/JSJL29/selffinance.git
cd selffinance/app
npm install
cd ..
```

Toutes les commandes suivantes se lancent **depuis le dossier `selffinance`**, sauf mention contraire.

## 3. Créer le projet Supabase

1. Sur [supabase.com/dashboard](https://supabase.com/dashboard), clique sur **New project**.
2. **Name** : `selffinance`. **Region** : la plus proche de toi (en France : *West EU (Paris)*). Choisis un **mot de passe de base de données** et note-le.
3. Attends 1 à 2 minutes que le projet soit prêt.
4. Note la **référence du projet** : c'est la suite de lettres dans l'adresse du dashboard (`supabase.com/dashboard/project/<ref>`). L'URL de ton projet est `https://<ref>.supabase.co`.

## 4. Créer l'application Enable Banking

1. Crée un compte sur [enablebanking.com](https://enablebanking.com) et ouvre le **Control Panel**.
2. **Applications → Add a new application** :
   | Champ | Valeur |
   |---|---|
   | Environment | **Production** |
   | Keys | **Generate in the browser** |
   | Application name | `SelfFinance` |
   | Allowed redirect URLs | `https://<ref>.supabase.co/functions/v1/bank/callback` |
   | Application description | `Application perso de suivi de mes comptes` |
   | Email for data protection matters | ton e-mail |
   | Privacy URL / Terms URL | n'importe quelle URL valide, par ex. `https://github.com` |
3. Clique sur **Register**. Ton navigateur télécharge un fichier **`<uuid>.pem`** : c'est la **clé privée** de ton app. Garde-le précieusement, il ne se télécharge qu'une fois. Le nom du fichier (sans `.pem`) est l'**ID de l'application**.
4. **Active l'app en liant tes comptes** : dans le Control Panel, sur ton app, utilise **« Activate by linking accounts »** (ou équivalent) et connecte **chacune des banques** que tu veux suivre, en cochant les comptes voulus.

> ⚠️ **Règle importante de l'offre gratuite** : l'app ne peut lire **que les comptes liés ici**. Pour ajouter une banque plus tard, lie-la d'abord dans le Control Panel, puis connecte-la dans l'app en cochant **les mêmes comptes**.

## 5. Mettre en ligne la base et les fonctions

On utilise la ligne de commande Supabase via `npx` (rien à installer).

```bash
npx supabase login                          # ouvre le navigateur pour te connecter
npx supabase link --project-ref <ref>       # demande le mot de passe de la base (étape 3)
npx supabase db push                        # crée les tables, vues, règles de sécurité et tâches automatiques
npx supabase functions deploy --use-api     # déploie les 4 fonctions : sync, bank, quotes, ibkr
```

- `db push` applique, dans l'ordre, les fichiers de `supabase/migrations/`.
- Les 4 fonctions sont déclarées dans `supabase/config.toml` avec `verify_jwt = false` : c'est voulu, elles vérifient elles-mêmes qui les appelle (secret du cron ou compte du propriétaire).

## 6. Ranger les secrets

### 6.1 Les secrets du coffre (Vault)

1. Copie `supabase/setup/secrets.example.sql` en **`supabase/setup/secrets.sql`** (ce nom est exclu de git).
2. Remplace :
   - `<ref-du-projet>` par ta référence (étape 3) ;
   - `<uuid-de-l-app-enable-banking>` par l'ID de ton app (étape 4.3) ;
   - supprime les deux lignes IBKR si tu n'as pas IBKR (tu pourras les ajouter à l'étape 11).
3. Dans Supabase : **SQL Editor → New query**, colle le contenu, puis **Run**.

### 6.2 La clé privée Enable Banking

Dans Supabase : **Edge Functions → Secrets → Add new secret** :
- **Name** : `EB_PRIVATE_KEY`
- **Value** : tout le contenu du fichier `.pem` (ouvre-le avec un éditeur de texte), y compris les lignes `-----BEGIN PRIVATE KEY-----` et `-----END PRIVATE KEY-----`.

> La clé ne doit **jamais** se retrouver dans le code, dans git ou dans l'app : elle reste sur le serveur.

## 7. Créer ton compte utilisateur

1. Supabase : **Authentication → Users → Add user → Create new user**.
2. Ton e-mail, un mot de passe, et coche **Auto Confirm User**.
3. **Le premier compte créé devient automatiquement le propriétaire** : lui seul voit les données. Les comptes créés ensuite n'ont accès à rien.
4. Recommandé : **Authentication → Sign In / Providers**, désactive **Allow new users to sign up**.

## 8. Lancer l'app sur ton téléphone

1. Crée le fichier **`app/.env.local`** (exclu de git) :
   ```bash
   EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clé publishable>
   ```
   La clé se trouve dans **Project Settings → API Keys** (celle qui commence par `sb_publishable_`). Elle est faite pour être dans une app : elle ne donne accès à rien sans ton mot de passe.
2. Lance le serveur de développement :
   ```bash
   cd app
   npx expo start --lan
   ```
3. Ton téléphone doit être sur **le même Wi-Fi** que l'ordinateur. Ouvre **Expo Go** et scanne le QR code affiché dans le terminal.
4. Connecte-toi avec l'e-mail et le mot de passe de l'étape 7.

> Si le chargement ne démarre pas, c'est souvent le pare-feu de l'ordinateur qui bloque le port **8081**.

## 9. Connecter tes banques

1. Onglet **Comptes** → en bas, **« + Ajouter une banque »**.
2. Choisis ta banque, confirme, connecte-toi sur le site de la banque et valide dans son app.
3. Coche **les mêmes comptes** que dans le Control Panel Enable Banking (étape 4.4).
4. Tu reviens dans SelfFinance ; **90 jours d'historique** arrivent dans la minute (tire l'écran vers le bas pour rafraîchir).

> Dans Expo Go, la page de la banque ne se ferme pas toujours toute seule à la fin : ferme-la, l'app affiche quand même le résultat.

**Synchronisation** :
- Automatique aux heures choisies dans **⚙ Réglages** (onglet Comptes, roue dentée), par défaut 6 h, 12 h et 19 h.
- Bouton **« Synchroniser maintenant »** sur l'accueil.
- Les banques limitent l'accès à **4 synchros par jour au total** (automatiques comprises) : l'app gère ce budget toute seule.

**Accès bancaire** : chaque banque demande de se reconnecter tous les **90 à 180 jours**. 15 jours avant, l'app affiche « à reconnecter » ; ouvre la banque et appuie sur **Reconnecter**. Ton historique est conservé.

## 10. Patrimoine : livrets, PEA, CTO…

Onglet **Patrimoine** → **« Ajouter un compte »** :
- **Livret A, LDDS, LEP, Livret…** : tu saisis le solde (€ ou $).
- **PEA, CTO, assurance-vie, PER, épargne salariale, crypto** : tu saisis les liquidités, puis **« Ajouter une position »** :
  - **Titre coté** : recherche par **ISIN** ou par nom, puis quantité et **PRU** (prix de revient unitaire, affiché par ton courtier). Le cours se met à jour tout seul chaque jour ouvré à 19 h (source : Yahoo Finance).
  - **Fonds euros / montant** : montant versé + valeur actuelle, que tu mets à jour de temps en temps.
  - **Non coté** (FCPE d'épargne salariale…) : quantité, PRU et valeur d'une part, saisie à la main.

L'app calcule pour chaque ligne et chaque compte la valeur, le montant investi et la **plus ou moins-value**. Le total du Patrimoine inclut aussi tes comptes bancaires.

**Ventes, dividendes et bilan fiscal** :
- Sur une position, **« Vendre »** : quantité, prix de vente, frais et date. L'app affiche la plus-value avant de valider, diminue la position (le PRU des titres restants ne change pas) et **ajoute le produit aux liquidités**.
- Sur un compte, **« Ajouter un dividende »** : montant brut et impôt déjà prélevé par le courtier ; le net s'ajoute aux liquidités.
- Une vente ou un dividende saisi se supprime par **appui long** : tout revient comme avant.
- **« Bilan fiscal »** (onglet Patrimoine) : plus et moins-values réalisées de l'année, **tous CTO confondus**, moins-values reportées, dividendes, **impôt estimé à la flat tax** (taux réglable, 31,4 % en 2026), déjà prélevé et reste à payer. Le PEA est affiché à part : il n'est pas imposé tant que tu ne retires rien. C'est une **estimation** : le relevé fiscal (IFU) de tes courtiers français fait foi.

> **Devise** : un PRU saisi en **€** donne une plus-value qui inclut l'effet de change ; en **$**, elle est calculée au taux du jour (« hors effet de change »).

## 11. IBKR (facultatif)

Si tu as un compte Interactive Brokers, ses positions et liquidités peuvent se remplir toutes seules (API officielle **Flex Web Service**, lecture seule).

1. **Client Portal** (mode *En direct*, pas *Simulé*) → menu **☰ → Performance et rapports → Flex Queries**.
2. Bloc **Activité Flex Query → +** :
   - **Nom** : `selffinance` ;
   - section **Positions ouvertes / Open Positions** : niveau **Résumé / Summary**, coche *Symbol, Description, Conid, ISIN, Asset Class, Currency, Quantity, Mark Price, Cost Basis Price, Listing Exchange* ;
   - section **Rapport de liquidités / Cash Report** : coche *Currency, Ending Cash* ;
   - section **Transactions / Trades** (niveau *Execution*) : coche *Trade ID, Conid, Symbol, ISIN, Description, Asset Class, Currency, FX Rate To Base, Trade Date, Quantity, Trade Price, IB Commission, Buy/Sell, FIFO Realized P&L* — pour les **ventes et plus-values réalisées** ;
   - section **Transactions en espèces / Cash Transactions** : coche *Type, Conid, Description, Currency, FX Rate To Base, Date/Time, Amount, Transaction ID* — pour les **dividendes et retenues à la source** ;
   - **Format** : XML ; **Période** : *Last 365 Calendar Days* (toute l'année est couverte ; les opérations déjà importées ne sont pas dupliquées) ;
   - **Continuer → Créer**. Le **Query ID** s'affiche avec l'icône ⓘ à côté de la requête.
3. Bloc **Flex Web Service Configuration → ⚙** : active le service, **Generate New Token** (durée max, **sans** restriction d'IP). Copie le jeton : il ne s'affiche qu'une fois.
4. Supabase → **SQL Editor** :
   ```sql
   select vault.create_secret('<query-id>', 'ibkr_query_id');
   select vault.create_secret('<jeton>', 'ibkr_token');
   ```
5. Dans l'app, onglet **Patrimoine → « Connecter IBKR »**. Le compte « CTO IBKR » se crée et se remplit (jusqu'à 1 min). Ensuite : synchro auto **chaque jour à 7 h** + bouton **Synchroniser** sur la page du compte.

> Le jeton expire au bout d'un an au plus : régénère-le chez IBKR et mets-le à jour avec `vault.update_secret` (voir l'en-tête de `secrets.example.sql`).

## 12. Installer la vraie app (APK)

Expo Go sert au développement : l'app ne tourne que tant que ton ordinateur lance `npx expo start`. Pour une vraie app installée sur ton téléphone :

1. Dans `app/app.json`, remplace `android.package` (`com.jsjl29.selffinance`) par un identifiant à toi, par ex. `com.<ton-pseudo>.selffinance`.
2. Connecte-toi à Expo et relie le projet **à ton compte** (le dépôt contient l'identifiant de projet de l'auteur : `init --force` le remplace par le tien) :
   ```bash
   cd app
   npx eas-cli login
   npx eas-cli init --force         # écrit ton projectId et ton owner dans app.json
   npx eas-cli update:configure     # adresse des mises à jour de TON projet
   ```
   `app/eas.json` est déjà fourni : profil `preview` = **APK** installable, canal de mises à jour `preview`.
3. `.env.local` n'est pas envoyé au cloud d'Expo : déclare les deux variables (valeurs de l'étape 8), pour `preview` (et `production` si tu l'utilises) :
   ```bash
   npx eas-cli env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co
   npx eas-cli env:create --environment preview --visibility plaintext --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <clé publishable>
   ```
4. Lance la compilation (10 à 20 min dans le cloud d'Expo) :
   ```bash
   npx eas-cli build --platform android --profile preview
   ```
5. Ouvre le lien donné à la fin sur ton téléphone, télécharge l'**APK** et installe-le (autorise l'installation depuis cette source).

**Continuer à développer après l'installation** :
- **Développer** : comme avant, `npx expo start` + Expo Go (ou le navigateur sur `http://localhost:8081`). L'APK installé n'est pas touché.
- **Envoyer une nouvelle version à l'APK sans le réinstaller** (EAS Update) : une commande, l'app la récupère à son prochain lancement (en général au 2ᵉ lancement) :
  ```bash
  npx eas-cli update --channel preview --environment preview --message "Ce qui change"
  ```
- **Recompiler l'APK** seulement si on ajoute un module natif (ex. un nouveau `expo-…` avec du code natif) : augmente `version` dans `app.json` (ex. `1.0.0` → `1.1.0`), puis refais l'étape 4. Les mises à jour ne s'appliquent qu'aux APK de la même version (`runtimeVersion: appVersion`).

> La vraie app ouvre directement l'adresse de retour `selffinance://` : la reconnexion des banques y est plus fluide que dans Expo Go.

## 13. Personnaliser

**Virements internes** : les virements entre tes propres comptes sont grisés et exclus des dépenses grâce à des règles (expressions régulières sur la contrepartie et le libellé). Des règles génériques sont fournies (Revolut, Fortuneo, IBKR…). Pour ajouter les tiennes (SQL Editor) :

```sql
insert into public.internal_rules (pattern, label, direction) values
  ('MON NOM.*PRENOM', 'Virement entre comptes', 'in'),   -- 'in', 'out' ou null (les deux)
  ('BQ XXXX',         'Mon autre banque',       null);
select public.reclassify_all();   -- réapplique les règles à tout l'historique
```

Garde ces règles personnelles hors de git, par ex. dans `supabase/private/rules.sql` (dossier exclu).

## 14. Entretien

| Quand | Quoi |
|---|---|
| Tous les 90 à 180 jours | Reconnecter chaque banque (bouton **Reconnecter**, l'app prévient 15 jours avant) |
| Chaque année | Régénérer le jeton IBKR |
| Nouvelle banque | La lier dans le Control Panel Enable Banking, puis **« + Ajouter une banque »** |
| Mise à jour du code | `git pull`, puis `npx supabase db push`, `npx supabase functions deploy --use-api`, et pour l'app `npx eas-cli update` (ou un nouveau build) |

> **Supabase gratuit** : un projet sans aucune activité pendant une longue période peut être mis en pause. Il se réactive en un clic (**Restore**) dans le dashboard.

## 15. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « *Banque* n'a partagé aucun compte » | Banque non liée dans le Control Panel Enable Banking | Lie-la (étape 4.4), puis reconnecte en cochant les mêmes comptes |
| Erreur `invalid_request` à la connexion | Compte coché différent de celui lié dans le Control Panel | Recommence en cochant exactement les mêmes comptes |
| « Clé Enable Banking invalide ou absente » | Secret `EB_PRIVATE_KEY` manquant ou incomplet | Refais l'étape 6.2 avec tout le contenu du `.pem` |
| Solde différent de celui de ta banque | Selon les banques, le solde renvoyé est celui de la veille ou exclut les opérations en cours. Un solde à 0,00 € est en général réel (compte de passage vidé aussitôt) | Vérifie dans l'app de ta banque ; s'il est vraiment faux, ouvre le compte et saisis le solde à la main : il est ensuite tenu à jour par les opérations |
| « Plus de synchro manuelle disponible » | Budget de 4 accès/jour atteint | Attends le lendemain, ou retire une heure automatique dans ⚙ Réglages |
| Les paiements carte récents n'apparaissent pas | Opérations encore « en attente » côté banque | Elles arrivent une fois comptabilisées (1 à 3 jours) |
| « cours introuvable » sur un titre | Yahoo ne connaît pas ce titre | Ouvre la position et saisis la valeur à la main |
| L'app ne se charge pas dans Expo Go | Pas le même Wi-Fi, ou pare-feu | Même réseau ; autorise le port 8081 |
| Rien ne se met à jour | Voir l'historique des synchros | SQL Editor : `select * from sync_runs order by id desc limit 5;` et **Edge Functions → Logs** |

---

**Sécurité, en résumé** : la clé Enable Banking et les secrets restent sur ton serveur Supabase ; toutes les tables sont protégées par des règles d'accès (seul le propriétaire lit ses données) ; l'accès aux banques et à IBKR est en **lecture seule** ; les fichiers sensibles (`*.pem`, `.env*`, sessions, `secrets.sql`, `supabase/private/`) sont exclus de git.
