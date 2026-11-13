# Logos — conception (courte)

Date : 2026-11-13 · Statut : à valider

## Intention
Ambiance « néobanque, sérieuse mais moderne » : une vraie identité pour l'app (icône + écran de
chargement) et les logos réels des banques à la place des pastilles à initiales.

## Objectifs
- **Logos des banques** : logo officiel de chaque banque connectée (CE IDF, BNP, SG, Revolut,
  Fortuneo, Trade Republic, PayPal…) partout où la pastille `BankDot` s'affiche ; comptes manuels :
  logo retrouvé par le nom de l'établissement si possible.
- **Icône de l'app** : logo **B1-a** — « SF » en trait arrondi dégradé bleu `#60A5FA` → violet `#A78BFA`,
  la barre du haut du S se prolonge en barre du F et finit sur un point violet, fond `#0B0D10`.
- **Écran de chargement** : fond `#0B0D10`, logo au centre (sans texte : Android 12+ n'affiche que l'icône).

## Non-objectifs / anti-objectifs
- Dessiner ou embarquer des imitations de logos de marques (on n'affiche que ceux fournis par Enable Banking).
- Un logo manquant ou le réseau coupé ne doit jamais casser l'écran : la pastille actuelle reste en secours.

## Approches (choix de l'utilisateur : 1a)
| | Approche | Pour | Contre |
|---|---|---|---|
| ✅ | **1a** Liste Enable Banking (`bank/aspsps`, déjà utilisée par « Ajouter une banque ») chargée une fois, gardée en mémoire, logo associé par nom de banque | aucun changement serveur ni base, marche pour les banques déjà connectées | une requête de plus au premier affichage |
| | 1b URL du logo enregistrée en base à la connexion | pas de requête en plus | migration + fonction `bank` + remplissage des banques existantes |
| | 1c Images embarquées dans l'app | hors ligne | fichiers de marques dans le dépôt, mise à jour à la main |

## Conception
- `src/lib/logos.ts` (pur, testé) : `logoFor(name, aspsps)` — correspondance exacte du nom, sinon
  nom normalisé (minuscules, sans accents ni ponctuation, préfixe : « Fortuneo » ↔ « Fortuneo Banque »).
- Chargement : `fetchAspsps('FR')` une seule fois par lancement (promesse partagée), échec silencieux.
- `BankDot` : affiche `<Image>` du logo (fond blanc arrondi, même taille) si trouvé, sinon la pastille actuelle ;
  si l'image échoue à charger (`onError`) → pastille.
- Icône : `assets/icon.svg` (B1-a, source versionnée) → script `scripts/make-icons.mjs` (sharp via `npx`, pas de
  dépendance de l'app) qui génère `icon.png` 1024, `android-icon-foreground.png` (logo dans la zone sûre 66 %,
  fond transparent), `android-icon-background.png` (uni `#0B0D10`), `android-icon-monochrome.png` (blanc),
  `favicon.png`, `splash-icon.png`.
- Écran de chargement : plugin `expo-splash-screen` (`backgroundColor` `#0B0D10`, `image` `splash-icon.png`,
  `imageWidth` ≈ 120, même chose en sombre).
- `version` 1.1.0 → **1.2.0**, nouvel APK (confirmation avant le build).

## Laissé au constructeur
Taille exacte du logo dans l'écran de chargement, marge du logo dans la pastille, règles de normalisation des noms.
