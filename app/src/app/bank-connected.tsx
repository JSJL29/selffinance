import { useEffect } from 'react';
import { router } from 'expo-router';
import { Loading } from '@/components/ui';

/**
 * Adresse de retour après la connexion à une banque (selffinance://bank-connected).
 * Le résultat est lu par `connectBank` ; si le système ouvre quand même cet écran,
 * on revient simplement là où on était.
 */
export default function BankConnected() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  return <Loading />;
}
