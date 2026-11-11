import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { PrimaryButton } from '@/components/form';

/**
 * Résultat de la connexion d'une banque. C'est aussi l'adresse de retour de la banque
 * (selffinance://bank-connected?status=…&bank=…) : un seul écran, quel que soit le chemin.
 */
export default function BankConnected() {
  const t = useTheme();
  const { status, bank, accounts, new: fresh, message } =
    useLocalSearchParams<{ status?: string; bank?: string; accounts?: string; new?: string; message?: string }>();

  // Ouvert sans résultat (lien incomplet) : rien à montrer, retour à l'accueil.
  useEffect(() => {
    if (!status) router.replace('/');
  }, [status]);
  if (!status) return null;

  const ok = status === 'ok';
  const nAccounts = Number(accounts ?? 0);
  const nNew = Number(fresh ?? 0);
  const name = bank ?? 'La banque';

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: t.bg }]}>
      <View style={s.center}>
        <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={72} color={ok ? t.success : t.danger} />
        <Text style={[s.title, { color: t.text }]}>{ok ? `${name} connectée` : 'Connexion impossible'}</Text>
        <Text style={[s.body, { color: t.muted }]}>
          {ok
            ? nNew > 0
              ? `${nNew} compte${nNew > 1 ? 's' : ''} ajouté${nNew > 1 ? 's' : ''}. L’historique des 90 derniers jours arrive dans la minute.`
              : `Accès renouvelé (${nAccounts} compte${nAccounts > 1 ? 's' : ''}). La synchro reprend normalement.`
            : message ?? 'La banque n’a pas validé la connexion.'}
        </Text>
        <View style={s.button}>
          <PrimaryButton label="Voir mes comptes" onPress={() => router.dismissTo('/')} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 21, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: 12 },
});
