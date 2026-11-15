// Registre des blocs « Pas de connexion » (module pur, testé dans tests/offline.test.ts).
// Hors connexion, chaque bloc d'une page échoue (comptes, courbe, opérations…) : un seul écran s'affiche,
// celui du premier bloc de la page affichée, et son nouvel essai relance tous les blocs de cette page.

type Entry = { retry: () => unknown; focused: boolean };

export function createOfflineStore() {
  const entries = new Map<number, Entry>(); // ordre d'inscription conservé
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    register(id: number, retry: () => unknown, focused: boolean) {
      entries.set(id, { retry, focused });
      emit();
    },
    /** Le chargement à relancer change (nouvelle fonction) sans changer l'ordre ni prévenir. */
    setRetry(id: number, retry: () => unknown) {
      const e = entries.get(id);
      if (e) e.retry = retry;
    },
    setFocused(id: number, focused: boolean) {
      const e = entries.get(id);
      if (!e || e.focused === focused) return;
      e.focused = focused;
      emit();
    },
    unregister(id: number) {
      if (entries.delete(id)) emit();
    },
    /** Bloc qui affiche l'écran : le premier inscrit de la page affichée ; null s'il n'y en a pas. */
    leader(): number | null {
      for (const [id, e] of entries) if (e.focused) return id;
      return null;
    },
    /** Relance les chargements de la page affichée ; un échec n'empêche pas les autres. */
    async retryAll(): Promise<void> {
      const due = [...entries.values()].filter((e) => e.focused).map((e) => e.retry);
      await Promise.allSettled(due.map((r) => Promise.resolve().then(r)));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type OfflineStore = ReturnType<typeof createOfflineStore>;
