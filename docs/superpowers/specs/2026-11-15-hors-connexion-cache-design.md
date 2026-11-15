# Dernières données hors connexion — conception (courte)

Validée le 15/11/2026 (« fais alors », après la proposition en conversation). Suite de
`2026-11-15-chargement-anime-design.md`, qui excluait le cache : ce document lève cette exclusion.

## Intention

Sans réseau, voir les dernières infos connues plutôt qu'un écran vide ; avec réseau, afficher tout de suite
la copie locale puis la remplacer par les données fraîches (l'app paraît instantanée).

## Décisions

- **Où** : `useLoad(fn, deps, key?)` (`src/lib/data.ts`). Avec une clé, chaque succès est copié dans le stockage
  local déjà présent (`expo-sqlite/localStorage`, celui de la session) ; au montage ou au changement de clé,
  la copie s'affiche aussitôt. JavaScript seul, livraison par `eas update`.
- **Quoi** : écrans de consultation seulement (Comptes, Transactions, Patrimoine, fiches, courbes, bilan fiscal).
  Pas les formulaires (modifier, vendre, dividende, réglages, ajout de banque) : saisir sur une copie périmée induirait en erreur.
- **Hors connexion avec données** : pas d'écran « Pas de connexion » ; les données restent, avec une pastille
  flottante en bas « Hors connexion · données du 14 nov. à 14:32 » (« de 14:32 » si c'est aujourd'hui, heure de Paris).
  Toucher la pastille relance ; nouvel essai automatique toutes les 10 s ; elle disparaît au premier succès.
  Seuls les chargements de la page affichée comptent (même principe que le registre hors connexion).
- **Hors connexion sans données** : l'écran « Pas de connexion » existant.
- **Erreur serveur** (pas réseau) : inchangé, encadré rouge, même si une copie existe.
- **Sécurité** : copie en clair sur le téléphone (comme la session) ; effacée à la déconnexion.
- **Format** : clé `cache.v1.<clé>` → `{ at, data }` ; index `cache.v1.__keys` pour tout effacer ; lecture illisible ou
  stockage indisponible → comme sans copie, jamais d'erreur.

## Approches écartées

- Cache par requête Supabase (intercepter `fetch`) : invisible pour l'écran, donc impossible d'afficher la date des données.
- Base locale synchronisée (SQLite + réplication) : bien trop lourd pour une app de consultation perso.

## Tâches (TDD)

1. `src/lib/cache.ts` (pur, stockage injecté) : `createCache(storage, now)` → `read`, `write`, `clear` ; tests `tests/cache.test.ts`.
2. `src/lib/stale.ts` (pur) : `createStaleStore()` (données périmées par chargement, page affichée, plus ancienne date,
   relance) et `staleLabel(at, now)` ; tests `tests/stale.test.ts`.
3. `useLoad` + clés aux écrans de consultation + `StaleBanner` dans `_layout.tsx` + effacement à la déconnexion.
4. Relecture indépendante, `eas update`, push.
