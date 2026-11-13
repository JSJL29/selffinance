# Historique du patrimoine — conception

Date : 2026-11-13 · Statut : à valider

## Intention

Voir l'évolution de son patrimoine dans le temps : le total, et le détail de chaque compte
(compte bancaire, livret, compte titres). Aujourd'hui l'app ne connaît que la valeur actuelle :
rien n'est mémorisé d'un jour sur l'autre.

## Objectifs

- Une photo par jour à **22 h (heure de Paris)** de la valeur de chaque compte.
- **Courbe du total** en haut de l'onglet Patrimoine.
- **Courbe par compte** sur sa page de détail :
  - compte titres / placement : *valeur* (trait plein) et *investi* (pointillés) → l'écart est la plus-value ;
  - livret : valeur seule ;
  - compte bancaire (page groupée par IBAN, ex. Revolut EUR/USD/GBP) : valeur du groupe.
- Choix de période : **1S · 1M · 3M · 1A · Tout**.
- Doigt posé sur la courbe → date et montant du point le plus proche.

## Non-objectifs

- Reconstituer le passé (avant la mise en service) : la courbe démarre au premier point.
- Vue empilée par catégorie (option B/C écartée, possible plus tard sans nouveau build : les données le permettent).
- Prévisions, objectifs, comparaison à un indice.

## Anti-objectifs (ce qui serait un échec)

- Une photo qui consomme un accès bancaire DSP2 (budget 4/jour) : la photo ne lit que la base.
- Un total de courbe différent du « Patrimoine total » affiché au même moment.
- Un montant inventé : taux de change ou cours manquant → valeur absente, jamais un repli à 1.

## Contraintes

- Postgres + RLS (`public.is_app_user()`), fonctions `security invoker`, `revoke … from anon`.
- `pg_cron` en UTC : même modèle que les tâches existantes (tâche horaire qui ne fait rien hors de
  22 h heure de Paris → juste été comme hiver).
- `react-native-svg` est un module natif : `version` 1.0.0 → **1.1.0** et nouveau build EAS
  (`runtimeVersion.policy = appVersion` : l'APK 1.0.0 ne reçoit plus de mises à jour, il faut installer le nouveau).
- Web (PC) : doit marcher aussi (`react-native-svg` le gère).

## Approches considérées

| | Approche | Pour | Contre |
|---|---|---|---|
| ✅ | **Courbe maison** avec `react-native-svg` + module pur testé (échelles, tracé, point le plus proche), toucher via `PanResponder` (React Native, sans module en plus) | 1 seul module natif, apparence et thème clair/sombre maîtrisés, formatage FR, testable | ~150-200 lignes de composant |
| | `react-native-gifted-charts` | moins de code | 2 modules natifs (`svg` + `linear-gradient`), personnalisation par props, dépendance tierce |
| | `victory-native` (Skia, Reanimated, Gesture Handler) | très fluide | 3 gros modules natifs pour quelques courbes, APK alourdi |

Choix de l'utilisateur : **courbe maison**. Affichage : **option A** (courbe du total + courbe sur chaque page de compte).

## Conception

### Données — table `wealth_snapshots`

Une ligne **par compte et par jour** ; le total se recalcule à partir des lignes.

| colonne | type | sens |
|---|---|---|
| `date` | date | jour de la photo (heure de Paris) |
| `bank_uid` | text → `accounts(uid)` **on update cascade on delete cascade** | compte bancaire (une reconnexion change l'uid : l'historique suit) |
| `manual_id` | uuid → `manual_accounts(id)` on delete cascade | compte manuel / IBKR |
| `value_eur` | numeric, null | valeur en € (null = taux ou cours manquant) |
| `invested_eur` | numeric, null | placements seulement |
| `missing` | int, défaut 0 | nb de positions sans cours/taux ce jour-là (point douteux) |
| `created_at` | timestamptz | |

- Contrainte : exactement un de `bank_uid` / `manual_id` renseigné ; unicité `(date, bank_uid)` et `(date, manual_id)`.
- Sources (mêmes chiffres que l'écran) : `account_view.balance_eur` (bancaire) ;
  `manual_account_view.value_eur`, `invested_eur`, `missing_prices` (manuel).
- Comptes masqués : **photographiés quand même** ; c'est l'affichage qui les écarte (voir Total).
- RLS : lecture pour `is_app_user()` ; aucune écriture depuis l'app.

### Prise de photo

- `public.take_wealth_snapshot(p_date date default (now() at time zone 'Europe/Paris')::date) returns integer` :
  supprime les lignes de `p_date` puis réinsère (idempotent : relançable sans doublon). Exécutable par `service_role` seulement.
- `public.run_wealth_snapshot()` (security definer, comme `run_scheduled_sync`) : ne fait rien hors de 22 h Paris.
- `cron.schedule('wealth-snapshot', '0 * * * *', 'select public.run_wealth_snapshot()')`.
- **Première photo à la mise en service** (la courbe a un point dès le premier jour).
- La photo prend l'état de la base à 22 h : si la dernière synchro bancaire est plus ancienne, ce sont ces soldes-là.

### Total

- Total d'un jour = somme des `value_eur` connus des comptes **non masqués aujourd'hui**
  (même règle que `netWorth()` : un compte masqué disparaît aussi de son passé, donc la courbe colle au total affiché).
- Un jour où un compte a `value_eur` null ou `missing > 0` est marqué douteux (mention au toucher).

### App

- `src/lib/history.ts` : lecture (`fetchWealthHistory(from)`) et calculs purs testés (`tests/history.test.ts`) :
  total par jour, somme d'un groupe bancaire (plusieurs `bank_uid`), découpage par période.
- `src/lib/chart.ts` (pur, testé `tests/chart.test.ts`) : échelles X/Y avec marge, graduations lisibles en €,
  tracé SVG (`M … L …`, trou si valeur null), point le plus proche d'une abscisse.
- `src/components/LineChart.tsx` : `react-native-svg`, une ou plusieurs séries (plein / pointillés),
  couleurs du thème, `PanResponder` → curseur + bulle « 12 nov. : 47 980 € ».
  Moins de 2 points : message « La courbe se remplit chaque soir à 22 h. »
- Écrans :
  - `(tabs)/patrimoine.tsx` : courbe du total + sélecteur de période sous le montant total ;
  - `patrimoine/account/[id].tsx` : courbe du compte (valeur, + investi si placement) ;
  - `account/[id].tsx` : courbe du groupe bancaire (somme de ses `uid`).
- Période par défaut **3M** à chaque ouverture (pas de mémorisation).

### Livraison

1. Migration + test SQL `supabase/tests/snapshots.sql` (idempotence, uid renommé suivi, taux absent → null, droits).
2. `npx expo install react-native-svg`, `version` → 1.1.0.
3. Vérifs : `tsc`, `eslint`, `npm test`, `expo export`.
4. `eas build -p android --profile preview` → nouvel APK à installer (confirmation de l'utilisateur avant le build).

## Laissé au constructeur

- Graduations (nombre, arrondis), couleurs exactes, hauteur du graphique (~180 px), animation éventuelle.
- Format des dates sur l'axe selon la période (jour, mois).
- Index : un index sur `date` suffit (quelques dizaines de lignes par jour).
