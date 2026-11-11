import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MAX_AUTO_SYNCS, fetchAutoHours, saveAutoHours, useLoad } from '@/lib/data';
import { useTheme } from '@/lib/theme';
import { ErrorBox, Loading } from '@/components/ui';
import { showAlert } from '@/lib/dialog';

const DAILY_LIMIT = 4; // accès bancaires par jour (DSP2), automatiques + manuels
const DEFAULT_HOURS = [6, 12, 19];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Réglages de synchro : automatique ou non, et à quelles heures (heure de Paris). */
export default function Settings() {
  const t = useTheme();
  const saved = useLoad(fetchAutoHours, []);
  // Brouillon local : null tant que rien n'est modifié (on affiche alors la valeur enregistrée).
  const [draft, setDraft] = useState<number[] | null>(null);
  const [lastDraft, setLastDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);

  const current = draft ?? saved.data;
  if (!current) return saved.error ? <ErrorBox message={saved.error} onRetry={saved.reload} /> : <Loading />;
  const hours: number[] = current;

  // Heures à remettre quand on réactive la synchro automatique.
  const lastHours = lastDraft ?? (saved.data?.length ? saved.data : DEFAULT_HOURS);
  const setHours = setDraft;
  const setLastHours = setLastDraft;

  const auto = hours.length > 0;
  const sorted = [...hours].sort((a, b) => a - b);
  const changed = sorted.join(',') !== [...(saved.data ?? [])].sort((a, b) => a - b).join(',');
  const manual = DAILY_LIMIT - hours.length;

  function toggleAuto(on: boolean) {
    if (on) setHours(lastHours.length ? lastHours : DEFAULT_HOURS);
    else {
      setLastHours(hours!);
      setHours([]);
    }
  }

  function toggleHour(h: number) {
    if (hours!.includes(h)) {
      const next = hours!.filter((x) => x !== h);
      setHours(next);
      if (next.length) setLastHours(next);
    } else if (hours!.length < MAX_AUTO_SYNCS) {
      const next = [...hours!, h];
      setHours(next);
      setLastHours(next);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await saveAutoHours(hours);
      router.back();
    } catch (e) {
      showAlert('Réglages', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[s.flex, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={18} color={t.primary} />
          <Text style={{ color: t.primary, fontSize: 15 }}>Comptes</Text>
        </Pressable>
        <Text style={[s.title, { color: t.text }]}>Synchronisation</Text>

        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={s.row}>
            <View style={s.grow}>
              <Text style={[s.label, { color: t.text }]}>Synchro automatique</Text>
              <Text style={[s.small, { color: t.muted }]}>
                {auto ? 'Les banques sont interrogées aux heures choisies.' : 'Les données ne bougent que quand tu synchronises.'}
              </Text>
            </View>
            <Switch value={auto} onValueChange={toggleAuto} trackColor={{ true: t.primary }} />
          </View>

          {auto && (
            <>
              <Text style={[s.section, { color: t.muted }]}>
                HEURES (HEURE DE PARIS) · {hours.length}/{MAX_AUTO_SYNCS}
              </Text>
              <View style={s.grid}>
                {HOURS.map((h) => {
                  const on = hours.includes(h);
                  const full = !on && hours.length >= MAX_AUTO_SYNCS;
                  return (
                    <Pressable
                      key={h} onPress={() => toggleHour(h)} disabled={full}
                      style={[s.hour, {
                        backgroundColor: on ? t.primary : 'transparent',
                        borderColor: on ? t.primary : t.border,
                        opacity: full ? 0.35 : 1,
                      }]}>
                      <Text style={{ color: on ? t.primaryText : t.text, fontWeight: on ? '700' : '400', fontVariant: ['tabular-nums'] }}>
                        {h} h
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </View>

        <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[s.label, { color: t.text }]}>
            {hours.length} automatique{hours.length > 1 ? 's' : ''} + {manual} manuelle{manual > 1 ? 's' : ''} par jour
          </Text>
          <Text style={[s.small, { color: t.muted }]}>
            Les banques limitent l&apos;accès à tes comptes à {DAILY_LIMIT} fois par jour. Les synchros automatiques en
            font partie : chaque heure retirée ici te donne une synchro manuelle de plus.
          </Text>
          {auto && sorted.length > 0 && (
            <Text style={[s.small, { color: t.muted, marginTop: 6 }]}>Prévu : {sorted.map((h) => `${h} h`).join(', ')}</Text>
          )}
        </View>

        <Pressable
          onPress={save} disabled={!changed || busy}
          style={[s.button, { backgroundColor: t.primary, opacity: !changed || busy ? 0.45 : 1 }]}>
          {busy ? <ActivityIndicator color={t.primaryText} /> : <Text style={[s.buttonText, { color: t.primaryText }]}>Enregistrer</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingTop: 8 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  section: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hour: { width: '22%', flexGrow: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
