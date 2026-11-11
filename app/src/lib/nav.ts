import { Href, router } from 'expo-router';

/**
 * Revient à l'écran précédent, ou ouvre `fallback` s'il n'y en a pas
 * (page ouverte directement par son adresse ou rechargée dans le navigateur).
 */
export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
