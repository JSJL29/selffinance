// Dernières données connues, gardées sur le téléphone (module pur, testé dans tests/cache.test.ts).
// Sert hors connexion et pour un affichage immédiat ; effacé à la déconnexion.

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const PREFIX = 'cache.v1.';
const INDEX = `${PREFIX}__keys`;

/** Stockage indisponible ou copie illisible : on fait comme s'il n'y avait pas de copie, sans jamais lever d'erreur. */
export function createCache(storage: KeyValueStorage, now: () => string = () => new Date().toISOString()) {
  let generation = 0;
  const keys = (): string[] => {
    try {
      const raw = storage.getItem(INDEX);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  };

  return {
    read<T>(key: string): { at: string; data: T } | null {
      try {
        const raw = storage.getItem(PREFIX + key);
        if (!raw) return null;
        const v = JSON.parse(raw) as { at?: unknown; data?: T };
        return typeof v?.at === 'string' && 'data' in v ? { at: v.at, data: v.data as T } : null;
      } catch {
        return null;
      }
    },
    /** Numéro qui change à chaque effacement : à relever au départ d'une requête, à rendre à `write`. */
    generation: () => generation,
    /** `gen` : génération au départ de la requête ; si la session a été effacée depuis, rien n'est écrit. */
    write<T>(key: string, data: T, gen: number = generation): void {
      if (gen !== generation) return;
      try {
        // L'index d'abord : une copie écrite est toujours connue de clear().
        const list = keys();
        if (!list.includes(key)) storage.setItem(INDEX, JSON.stringify([...list, key]));
        storage.setItem(PREFIX + key, JSON.stringify({ at: now(), data }));
      } catch { /* stockage plein ou indisponible : pas de copie */ }
    },
    clear(): void {
      generation++;
      try {
        for (const k of keys()) storage.removeItem(PREFIX + k);
        storage.removeItem(INDEX);
      } catch { /* rien à effacer */ }
    },
  };
}
