# Chargement animé et écran hors connexion — conception

Validée le 15/11/2026 (aperçu animé montré et approuvé : « c'est super »).

## Intention

Remplacer le rond qui tourne par une animation à l'image de l'app : le « SF » du logo B1-a se trace petit à petit.
Quand il n'y a pas de connexion, le dire clairement (au lieu du message d'erreur réseau brut en rouge) et
reprendre tout seul dès que le réseau revient.

## Objectifs

- **Chargement** (`Loading`, 12 écrans) : le S se trace du bas vers le haut (≈ 1,4 s, accéléré puis freiné),
  le point violet apparaît au bout de la barre, puis le F ; pause, fondu, boucle (cycle ≈ 2,2 s).
  Trait au dégradé bleu → violet du logo, sur un tracé « fantôme » discret.
- **Hors connexion** : même logo en gris, tracé arrêté à mi-chemin (55 %), qui « respire » (opacité lente) ;
  « Pas de connexion », « Nouvel essai automatique dans N s » (compte à rebours de 5 s, en boucle) et « Réessayer ».
  Le contenu revient seul dès qu'un essai réussit.
- **Démarrage** : le logo de l'écran de lancement (même taille, 120 dp) s'enchaîne sur l'animation
  du premier onglet tant que ses données ne sont pas là.
- Taille réduite (64 dp) pour les chargements dans une liste (transactions, opérations d'un compte).

## Non-objectifs

- Pas de module natif de détection réseau (NetInfo) : il imposerait un nouvel APK. La coupure est reconnue
  au message d'erreur.
- Pas de mode hors connexion avec données en cache.

## Contraintes

- Livrable par `eas update` (JavaScript seul) : `react-native-svg` et `Animated` de React Native, déjà présents.
- « Réduire les animations » activé (accessibilité) : logo complet, fixe.
- Thème clair et sombre : le tracé fantôme et les textes suivent le thème.

## Approches

1. **Retenue : tracé SVG animé** (`strokeDashoffset` d'un `Path` animé avec `Animated`). Fidèle au logo
   (même tracé que `scripts/make-icons.mjs`), léger, sans dépendance.
2. Animation Lottie : demande un module natif (nouvel APK) et un fichier d'animation à produire à part. Écartée.
3. Images successives (sprite) : lourd, flou selon la densité d'écran, deux thèmes à générer. Écartée.

## Décisions

- Le S est tracé du bas vers le haut : même chemin que le logo, sous-tracé inversé
  `M11 44 H22.5 a6 6 0 0 0 0 -12 h-4 a6 6 0 0 1 0 -12 H48` ; puis le F `M37 20 V44 M37 32 H45`.
- La géométrie (longueurs, avancement, rayon du point) est un module pur testé (`src/lib/loader.ts`).
- Une erreur réseau est reconnue par `isNetworkError(message)` (« Network request failed », « Failed to fetch »,
  « NetworkError », « timeout »/« timed out », « fetch failed »…). `ErrorBox` bascule alors sur l'écran hors connexion
  et appelle `onRetry` toutes les 5 s. Sans `onRetry`, pas de compte à rebours.

## Laissé au constructeur

- Durées exactes et courbe d'accélération, à ajuster à l'œil sur téléphone.
- Patrimoine affiche deux `ErrorBox` (comptes bancaires, comptes manuels) : hors connexion, n'en montrer qu'une.
