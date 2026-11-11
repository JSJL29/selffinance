import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';

export default function Login() {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : error.message);
    setBusy(false);
  }

  const input = [s.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }];

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView style={[s.flex, s.center]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.form}>
          <Text style={[s.title, { color: t.text }]}>SelfFinance</Text>
          <Text style={[s.sub, { color: t.muted }]}>Tous mes comptes, au même endroit.</Text>
          <TextInput
            style={input} placeholder="E-mail" placeholderTextColor={t.muted}
            autoCapitalize="none" autoComplete="email" keyboardType="email-address"
            value={email} onChangeText={setEmail}
          />
          <TextInput
            style={input} placeholder="Mot de passe" placeholderTextColor={t.muted}
            secureTextEntry autoComplete="password" value={password} onChangeText={setPassword}
            onSubmitEditing={signIn}
          />
          {error && <Text style={{ color: t.danger }}>{error}</Text>}
          <Pressable
            onPress={signIn} disabled={busy || !email || !password}
            style={[s.button, { backgroundColor: t.primary, opacity: busy || !email || !password ? 0.5 : 1 }]}>
            {busy ? <ActivityIndicator color={t.primaryText} /> : <Text style={[s.buttonText, { color: t.primaryText }]}>Se connecter</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  center: { justifyContent: 'center' },
  form: { paddingHorizontal: 24, gap: 12 },
  title: { fontSize: 30, fontWeight: '700' },
  sub: { fontSize: 15, marginBottom: 16 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
