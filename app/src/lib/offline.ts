// Registre des blocs « Pas de connexion » (module pur, testé dans tests/offline.test.ts).
// Hors connexion, chaque bloc d'une page échoue (comptes, courbe, opérations…) : un seul écran s'affiche,
// celui du premier bloc de la page affichée, et son nouvel essai relance tous les blocs de cette page.

/** `retry` null : le bloc ne sait pas se recharger (pas de bouton « Réessayer » fourni). */
type Entry = { retry: (() => unknown) | null; focused: boolean };

export function createOfflineStore() {
  const entries = new Map<number, Entry>(); // ordre d'inscription conservé
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  return {
    register(id: number, retry: (() => unknown) | null, focused: boolean) {
      entries.set(id, { retry, focused });
      emit();
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
    /** Un bloc de la page affichée sait se recharger : sinon, ni compte à rebours ni bouton. */
    canRetry(): boolean {
      for (const e of entries.values()) if (e.focused && e.retry) return true;
      return false;
    },
    /** Relance les chargements de la page affichée ; un échec n'empêche pas les autres. */
    async retryAll(): Promise<void> {
      const due = [...entries.values()].filter((e) => e.focused && e.retry).map((e) => e.retry as () => unknown);
      await Promise.allSettled(due.map((r) => Promise.resolve().then(r)));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type OfflineStore = ReturnType<typeof createOfflineStore>;
