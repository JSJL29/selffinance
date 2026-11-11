import { useState } from 'react';
import { Alert } from 'react-native';
import { connectBank } from '@/lib/data';

/**
 * Connecte ou reconnecte une banque et affiche le résultat.
 * `onDone` est appelé après une connexion réussie (pour recharger les données).
 */
export function useConnectBank(onDone?: () => void | Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(bank: string) {
    setBusy(bank);
    try {
      const r = await connectBank(bank);
      if (r.status === 'ok') {
        await onDone?.();
        Alert.alert(
          `${bank} connectée`,
          r.newAccounts > 0
            ? `${r.newAccounts} nouveau${r.newAccounts > 1 ? 'x' : ''} compte${r.newAccounts > 1 ? 's' : ''}. L'historique arrive dans une minute.`
            : 'Connexion renouvelée, la synchro reprend normalement.',
        );
        return true;
      }
      if (r.status === 'error') Alert.alert('Connexion à ' + bank, r.message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { busy, connect };
}
