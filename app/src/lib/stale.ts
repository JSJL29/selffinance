// Données affichées hors connexion (module pur, testé dans tests/stale.test.ts).
// Chaque chargement dit s'il montre une copie périmée et de quand ; la pastille donne la plus ancienne
// de la page affichée et relance ces chargements.

type Entry = { retry: () => unknown; focused: boolean; at: string | null };

export function createStaleStore() {
  const entries = new Map<number, Entry>();
  const listeners = new Set<() => void>();
  let last: string | null = null;
  const compute = (): string | null => {
    let oldest: string | null = null;
    for (const e of entries.values()) if (e.focused && e.at && (!oldest || e.at < oldest)) oldest = e.at;
    return oldest;
  };
  // Prévenir seulement quand ce qui s'affiche change.
  const emit = () => {
    const next = compute();
    if (next === last) return;
    last = next;
    listeners.forEach((l) => l());
  };
  const patch = (id: number, p: Partial<Entry>) => {
    const e = entries.get(id);
    if (!e) return;
    Object.assign(e, p);
    emit();
  };

  return {
    register(id: number, retry: () => unknown) {
      entries.set(id, { retry, focused: false, at: null });
    },
    setFocused(id: number, focused: boolean) { patch(id, { focused }); },
    /** `at` : date de la copie affichée faute de réseau ; null quand les données sont fraîches. */
    setStale(id: number, at: string | null) { patch(id, { at }); },
    remove(id: number) {
      if (entries.delete(id)) emit();
    },
    oldest: (): string | null => last,
    async retryAll(): Promise<void> {
      const due = [...entries.values()].filter((e) => e.focused && e.at).map((e) => e.retry);
      await Promise.allSettled(due.map((r) => Promise.resolve().then(r)));
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const PARIS = 'Europe/Paris';
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: PARIS });
const keyFmt = new Intl.DateTimeFormat('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: PARIS });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: PARIS });

/** « Hors connexion · données de 14:32 » (aujourd'hui) ou « … du 14 nov. à 14:32 », heure de Paris. */
export function staleLabel(at: string, now: Date = new Date()): string {
  const d = new Date(at);
  const time = timeFmt.format(d);
  return keyFmt.format(d) === keyFmt.format(now)
    ? `Hors connexion · données de ${time}`
    : `Hors connexion · données du ${dayFmt.format(d)} à ${time}`;
}
