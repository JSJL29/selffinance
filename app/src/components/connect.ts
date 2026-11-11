import { useState } from 'react';
import { router } from 'expo-router';
import { connectBank } from '@/lib/data';

/**
 * Connecte ou reconnecte une banque, puis affiche l'écran de résultat (/bank-connected).
 * Le retour de la banque peut déjà avoir ouvert cet écran : `navigate` le réutilise au lieu
 * d'en empiler un second. Abandon par l'utilisateur : on reste où l'on est.
 */
export function useConnectBank(onDone?: () => void | Promise<void>) {
  const [busy, setBusy] = useState<string | null>(null);

  async function connect(bank: string) {
    setBusy(bank);
    try {
      const r = await connectBank(bank);
      if (r.status === 'cancel') return false;
      if (r.status === 'ok') await onDone?.();
      router.navigate({
        pathname: '/bank-connected',
        params: r.status === 'ok'
          ? { status: 'ok', bank, accounts: String(r.accounts), new: String(r.newAccounts) }
          : { status: 'error', bank, message: r.message },
      });
      return r.status === 'ok';
    } finally {
      setBusy(null);
    }
  }

  return { busy, connect };
}
