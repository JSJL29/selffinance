import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useLoad } from '@/lib/data';
import {
  ENVELOPES, Envelope, ManualAccount, deleteManualAccount, envelopeLabel, fetchManualAccount, saveManualAccount,
} from '@/lib/patrimoine';
import { parseAmount } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Chip, ErrorBox, Loading } from '@/components/ui';
import { BackLink, DangerLink, Field, PrimaryButton } from '@/components/form';

/** Création (sans `id`) ou modification d'un compte manuel. */
export default function AccountEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useLoad(() => (id ? fetchManualAccount(id) : Promise.resolve(null)), [id]);
  if (!id) return <AccountForm key="new" account={null} />;
  if (existing.error) return <Gone message={existing.error} />;
  if (!existing.data) return <Loading />;
  return <AccountForm key={existing.data.id} account={existing.data} />;
}

/** Compte introuvable (supprimé) : message + retour à l'onglet. */
function Gone({ message }: { message: string }) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <View style={s.content}>
        <ErrorBox message={message} />
        <PrimaryButton label="Retour au Patrimoine" onPress={() => router.dismissTo('/patrimoine')} />
      </View>
    </SafeAreaView>
  );
}

function AccountForm({ account }: { account: ManualAccount | null }) {
  const t = useTheme();
  const [envelope, setEnvelope] = useState<Envelope>(account?.envelope ?? 'livret_a');
  const [name, setName] = useState(account?.name ?? '');
  const [institution, setInstitution] = useState(account?.institution ?? '');
  const [cash, setCash] = useState(account ? String(account.cash_balance).replace('.', ',') : '');
  const [busy, setBusy] = useState(false);

  const kind = ENVELOPES.find((e) => e.value === envelope)!.kind;
  const amount = cash.trim() === '' ? 0 : parseAmount(cash);
  const finalName = name.trim() || [envelopeLabel(envelope), institution.trim()].filter(Boolean).join(' ');
  const valid = amount != null && finalName.length > 0;

  async function save() {
    setBusy(true);
    try {
      const newId = await saveManualAccount({
        id: account?.id, name: finalName, institution, kind, envelope, cash_balance: amount ?? 0,
      });
      if (account) router.back();
      else router.replace({ pathname: '/patrimoine/account/[id]', params: { id: newId } });
    } catch (e) {
      Alert.alert('Compte', e instanceof Error ? e.message : String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    Alert.alert(`Supprimer « ${account!.name} » ?`, 'Ses positions seront supprimées aussi.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          try {
            await deleteManualAccount(account!.id);
            // Ferme le formulaire et le détail du compte supprimé (navigate empilerait un nouvel onglet).
            router.dismissTo('/patrimoine');
          } catch (e) {
            Alert.alert('Compte', e instanceof Error ? e.message : String((e as { message?: string }).message ?? e));
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <BackLink label={account ? account.name : 'Patrimoine'} />
          <Text style={[s.title, { color: t.text }]}>{account ? 'Modifier le compte' : 'Nouveau compte'}</Text>

          <Text style={[s.label, { color: t.muted }]}>TYPE</Text>
          <View style={s.chips}>
            {ENVELOPES.map((e) => (
              <Chip key={e.value} label={e.label} on={envelope === e.value} onPress={() => setEnvelope(e.value)} />
            ))}
          </View>

          <Field label="Établissement" value={institution} onChangeText={setInstitution} placeholder="Fortuneo, Boursorama, Natixis…" />
          <Field label="Nom" value={name} onChangeText={setName} placeholder={finalName || 'Ex. PEA Fortuneo'} />
          {!account?.sync_source && <Field
            label={kind === 'savings' ? 'Solde' : 'Liquidités'}
            hint={kind === 'savings' ? undefined : 'Argent non investi sur le compte. Les titres s’ajoutent ensuite.'}
            value={cash} onChangeText={setCash} keyboardType="decimal-pad" placeholder="0,00"
          />}
          {amount == null && <Text style={{ color: t.danger }}>Montant invalide.</Text>}

          <PrimaryButton label={account ? 'Enregistrer' : 'Créer le compte'} onPress={save} disabled={!valid} busy={busy} />
          {account && <DangerLink label="Supprimer ce compte" onPress={remove} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  title: { fontSize: 28, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
