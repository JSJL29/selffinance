# Chargement animé et hors connexion — plan de mise en œuvre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** le « SF » du logo se trace en boucle pendant les chargements ; une coupure réseau affiche un écran « Pas de connexion » qui réessaie seul.

**Architecture :** géométrie et règles pures dans `src/lib/loader.ts` (testées) ; un composant `LogoLoader` anime deux `Path` SVG (`strokeDashoffset`) et le point avec `Animated` ; `Loading` et `ErrorBox` (`src/components/ui.tsx`) s'appuient dessus, donc les 12 écrans en profitent sans être modifiés.

**Tech Stack :** Expo SDK 58, React Native `Animated`, `react-native-svg` 15.16, `node --test`.

**Spec :** `docs/superpowers/specs/2026-11-15-chargement-anime-design.md`

## Global Constraints

- JavaScript seul : aucune dépendance ajoutée, livraison par `eas update` (runtime 1.2.0).
- Tracés exacts : S `M11 44 H22.5 a6 6 0 0 0 0 -12 h-4 a6 6 0 0 1 0 -12 H48`, F `M37 20 V44 M37 32 H45`, point `cx 52.5 cy 20 r 4`, repère 64 × 64, trait 5,5, extrémités rondes, dégradé `#60A5FA` → `#A78BFA` (x1 10 y1 48 → x2 54 y2 16, `userSpaceOnUse`).
- Cycle de chargement 2,2 s : tracé 0 → 1,4 s (ease in-out), plein jusqu'à 1,8 s, fondu jusqu'à 2,2 s.
- Hors connexion : tracé figé à 55 %, gris, opacité qui respire ; nouvel essai toutes les 5 s.
- Réduire les animations : logo complet et fixe.
- Textes en français : « Chargement… », « Pas de connexion », « Nouvel essai automatique dans N s », « Réessayer ».

## Review Focus

- L'écran se ferme pendant l'animation ou le compte à rebours : boucle et minuteur arrêtés, aucun setState après démontage (Task 2, Task 3 : nettoyage dans les `useEffect`).
- Un nouvel essai échoue encore : le compte à rebours repart à 5 s, sans essais empilés (Task 3).
- Erreur qui n'est pas réseau (RLS, 500, « Clé Enable Banking invalide ») : l'encadré rouge habituel reste (Task 1, test `isNetworkError`).
- Thème clair : tracé fantôme et textes lisibles (Task 2 : couleurs du thème, pas de `#0B0D10` en dur hors dégradé).
- Patrimoine hors connexion : un seul écran, pas deux empilés (Task 3).

---

### Task 1 : géométrie et règles pures

**Files :** Create `app/src/lib/loader.ts` · Test `app/tests/loader.test.ts`

**Interfaces — Produces :**
- `S_PATH: string`, `F_PATH: string`, `S_LEN: number` (≈ 82,70 = 11,5 + 6π + 4 + 6π + 29,5), `F_LEN: number` (32)
- `drawState(p: number): { sOffset: number; fOffset: number; dotR: number }` : p ∈ [0, 1] borné ; S tracé d'abord, puis F ; le point grandit de 0 à 4 sur les 3 dernières unités du S.
- `cycle(t: number): { progress: number; opacity: number }` : t en secondes, modulo 2,2.
- `isNetworkError(message: string | null): boolean`
- `RETRY_SECONDS = 5`, `OFFLINE_PROGRESS = 0.55`

- [ ] **Step 1 : tests** (`tests/loader.test.ts`)
  - `drawState(0)` → `sOffset === S_LEN`, `fOffset === F_LEN`, `dotR === 0` ; `drawState(1)` → offsets 0 et `dotR === 4` ; `drawState(-1)` égal à `drawState(0)`, `drawState(2)` à `drawState(1)`.
  - `drawState(S_LEN / (S_LEN + F_LEN))` → `sOffset ≈ 0`, `fOffset === F_LEN`, `dotR === 4`.
  - `cycle(0).progress === 0`, `cycle(0.7).progress ≈ 0.5`, `cycle(1.5)` → progress 1, opacity 1 ; `cycle(2.0).opacity ≈ 0.5` ; `cycle(2.2 + 0.7)` égal à `cycle(0.7)`.
  - `isNetworkError` vrai pour « TypeError: Network request failed », « Failed to fetch », « NetworkError when attempting to fetch resource. », « fetch failed », « The request timed out » ; faux pour `null`, « permission denied for table accounts », « Clé Enable Banking invalide », « Edge Function returned a non-2xx status code ».
- [ ] **Step 2 :** `cd app && npm test` → échec (module absent).
- [ ] **Step 3 :** implémenter `src/lib/loader.ts` (ease in-out `(1 − cos πx) / 2`).
- [ ] **Step 4 :** `npm test` → tout passe.
- [ ] **Step 5 :** commit `feat(chargement): géométrie du logo animé et détection hors connexion`.

### Task 2 : `LogoLoader` et nouveau `Loading`

**Files :** Create `app/src/components/LogoLoader.tsx` · Modify `app/src/components/ui.tsx` (`Loading`), `app/src/app/(tabs)/transactions.tsx`, `app/src/app/account/[id].tsx` (chargements de liste)

**Interfaces :**
- Consumes : tout le module de la Task 1.
- Produces : `LogoLoader({ size = 120, offline = false }: { size?: number; offline?: boolean })` ; `Loading({ compact = false }: { compact?: boolean })` : plein écran centré, logo 120 et « Chargement… » ; `compact` → logo 64, sans texte, marge verticale 32.

- [ ] **Step 1 :** `LogoLoader` : un `Animated.Value` piloté par `Animated.loop(Animated.timing(…, { duration: 2200, easing: Easing.linear, useNativeDriver: false }))` ; un listener appelle `drawState(cycle(t).progress)` et met à jour les `setNativeProps` des deux `Path` et du `Circle` (évite un rendu React par image) ; opacité via `Animated.View`. Tracé fantôme sous les traits (`t.border`). `offline` : `drawState(OFFLINE_PROGRESS)` figé, trait `t.muted`, opacité 0,55 ↔ 1 en boucle (1,2 s aller-retour). `AccessibilityInfo.isReduceMotionEnabled()` vrai → `drawState(1)` fixe. Arrêt de l'animation et retrait du listener au démontage. `accessibilityRole="progressbar"`, `accessibilityLabel="Chargement"`.
- [ ] **Step 2 :** `Loading` utilise `LogoLoader` ; dans `transactions.tsx` et `account/[id].tsx`, les `ListEmptyComponent` passent `<Loading compact />`.
- [ ] **Step 3 :** `npx tsc --noEmit && npx eslint src tests && npm test` → 0 erreur.
- [ ] **Step 4 :** aperçu à l'œil sur le web (`npx expo start --web`, onglet Patrimoine avec réseau ralenti) ou capture du rendu ; le tracé part du bas du S et le point apparaît au bout de la barre.
- [ ] **Step 5 :** commit `feat(chargement): le logo SF se trace pendant les chargements`.

### Task 3 : écran hors connexion

**Files :** Modify `app/src/components/ui.tsx` (`ErrorBox`), `app/src/app/(tabs)/patrimoine.tsx`

**Interfaces :**
- Consumes : `isNetworkError`, `RETRY_SECONDS` (Task 1), `LogoLoader` (Task 2).
- Produces : `ErrorBox({ message, onRetry })` inchangé à l'appel ; `isNetworkError(message)` → rend `Offline` (logo `offline`, « Pas de connexion », « Nouvel essai automatique dans N s » si `onRetry`, bouton « Réessayer »).

- [ ] **Step 1 :** `Offline` : compte à rebours 5 → 1 (un `setInterval` d'1 s, nettoyé au démontage) ; à 0, `await onRetry()` puis repart à 5 ; pas de nouvel essai tant que le précédent n'est pas fini (drapeau `busy` dans un `useRef`) ; « Réessayer » lance l'essai tout de suite et remet le compte à 5.
- [ ] **Step 2 :** Patrimoine : si `bank.error` et `manual.error` sont tous deux réseau, une seule `ErrorBox` dont le `onRetry` recharge les deux.
- [ ] **Step 3 :** `npx tsc --noEmit && npx eslint src tests && npm test` puis `npx expo export --platform android --output-dir <tmp>` → OK.
- [ ] **Step 4 :** essai web en coupant le réseau (DevTools « Offline ») : l'écran apparaît, le compte à rebours tourne, réseau rétabli → le contenu revient seul.
- [ ] **Step 5 :** commit `feat(chargement): écran « Pas de connexion » avec nouvel essai automatique`.

### Livraison

- [ ] Relecture indépendante de la branche (sous-agent, modèle le plus capable).
- [ ] `npx eas-cli update --channel preview --environment preview --message "Chargement animé et hors connexion"` (jeton Expo via `request_secret` si la session a expiré), `git push`. Aucune mention de Claude dans les commits.
