import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

export function BackLink({ label }: { label: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
      <Ionicons name="chevron-back" size={18} color={t.primary} />
      <Text style={{ color: t.primary, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: t.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.muted}
        {...input}
        style={[s.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }, input.style]}
      />
      {hint && <Text style={[s.hint, { color: t.muted }]}>{hint}</Text>}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, busy }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean;
}) {
  const t = useTheme();
  const off = disabled || busy;
  return (
    <Pressable onPress={onPress} disabled={off} style={[s.button, { backgroundColor: t.primary, opacity: off ? 0.45 : 1 }]}>
      {busy ? <ActivityIndicator color={t.primaryText} /> : <Text style={[s.buttonText, { color: t.primaryText }]}>{label}</Text>}
    </Pressable>
  );
}

export function DangerLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return <Text onPress={onPress} style={[s.danger, { color: t.danger }]}>{label}</Text>;
}

const s = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16 },
  hint: { fontSize: 12 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  danger: { textAlign: 'center', padding: 16, fontSize: 14, fontWeight: '600' },
});
