import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIsFocused } from 'expo-router';
import { isNetworkError, RETRY_SECONDS } from '@/lib/loader';
import { createOfflineStore } from '@/lib/offline';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { bankMeta, bankShortName, useTheme } from '@/lib/theme';
import { dayLabel, money } from '@/lib/format';
import { Tx, txSubtitle, txTitle, useBankLogo } from '@/lib/data';
import { LogoLoader } from '@/components/LogoLoader';

/** Logo officiel de la banque (Enable Banking), sinon pastille à initiales (logo absent ou en erreur). */
export function BankDot({ bank, size = 36 }: { bank: string; size?: number }) {
  const m = bankMeta(bank);
  const logo = useBankLogo(bank);
  const [broken, setBroken] = useState<string | null>(null);
  if (logo && broken !== logo) {
    // fond blanc : les logos transparents restent lisibles en mode sombre
    return (
      <View style={[s.logoBox, { width: size, height: size, borderRadius: size * 0.3, padding: size * 0.12 }]}>
        <Image source={{ uri: logo }} style={s.logoImg} resizeMode="contain" onError={() => setBroken(logo)}
          accessibilityLabel={bank} />
      </View>
    );
  }
  return (
    <View style={[s.dot, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: m.color }]}>
      <Text style={[s.dotText, { fontSize: m.short.length > 2 ? size * 0.3 : size * 0.36 }]}>{m.short}</Text>
    </View>
  );
}

export function DayHeader({ iso }: { iso: string }) {
  const t = useTheme();
  return <Text style={[s.day, { color: t.muted, backgroundColor: t.bg }]}>{dayLabel(iso)}</Text>;
}

export const TxRow = memo(function TxRow({ tx, showBank }: { tx: Tx; showBank?: boolean }) {
  const t = useTheme();
  const sub = showBank ? [bankShortName(tx.bank), txSubtitle(tx)].filter(Boolean).join(' · ') : txSubtitle(tx);
  const positive = tx.amount > 0;
  return (
    <View style={[s.row, { backgroundColor: t.card, borderColor: t.border }, tx.is_internal && s.internal]}>
      {showBank && <BankDot bank={tx.bank} size={32} />}
      <View style={s.grow}>
        <View style={s.titleLine}>
          <Text style={[s.title, { color: t.text }]} numberOfLines={1}>{txTitle(tx)}</Text>
          {tx.is_internal && <Text style={[s.tag, { backgroundColor: t.tag, color: t.muted }]}>interne</Text>}
          {tx.status === 'PDNG' && <Text style={[s.tag, { backgroundColor: t.tag, color: t.muted }]}>en cours</Text>}
        </View>
        {!!sub && <Text style={[s.sub, { color: t.muted }]} numberOfLines={1}>{sub}</Text>}
      </View>
      <View style={s.amountBox}>
        <Text style={[s.amount, { color: positive ? t.success : t.text }]}>{money(tx.amount, tx.currency, { sign: true })}</Text>
        {tx.currency !== 'EUR' && tx.amount_eur != null && <Text style={[s.sub, { color: t.muted }]}>≈ {money(tx.amount_eur, 'EUR', { sign: true })}</Text>}
      </View>
    </View>
  );
});

/** Virement entre deux de mes banques, sur une ligne : « SG → BNP », montant sans signe (ni gagné ni perdu). */
export const TransferRow = memo(function TransferRow({ out, in: inn }: { out: Tx; in: Tx }) {
  const t = useTheme();
  const amount = Math.abs(out.amount);
  const late = inn.booking_date !== out.booking_date;
  return (
    <View style={[s.row, { backgroundColor: t.card, borderColor: t.border }, s.internal]}>
      <BankDot bank={out.bank} size={32} />
      <View style={s.grow}>
        <View style={s.titleLine}>
          <Text style={[s.title, { color: t.text }]} numberOfLines={1}>
            {bankShortName(out.bank)} → {bankShortName(inn.bank)}
          </Text>
          <Text style={[s.tag, { backgroundColor: t.tag, color: t.muted }]}>interne</Text>
        </View>
        <Text style={[s.sub, { color: t.muted }]} numberOfLines={1}>
          Virement entre mes comptes{late ? ` · reçu le ${dayLabel(inn.booking_date).toLowerCase()}` : ''}
        </Text>
      </View>
      <View style={s.amountBox}>
        <Text style={[s.amount, { color: t.muted }]}>{money(amount, out.currency)}</Text>
      </View>
    </View>
  );
});

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : 'transparent' }]}>
      <Text style={{ color: on ? t.primaryText : t.text, fontSize: 13, fontWeight: on ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return <View style={s.centered}>{children}</View>;
}

/** Chargement : le logo SF se trace en boucle ; `compact` pour une liste (plus petit, sans texte). */
export function Loading({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  if (compact) return <View style={s.compact}><LogoLoader size={64} /></View>;
  return (
    <Centered>
      <LogoLoader />
      <Text style={{ color: t.muted, fontSize: 13, marginTop: 10 }}>Chargement…</Text>
    </Centered>
  );
}

// Hors connexion : un seul écran par page (voir src/lib/offline.ts), les autres blocs en échec s'effacent.
const offlineStore = createOfflineStore();
let nextOfflineId = 0;

/** Coupure réseau : écran « Pas de connexion », nouvel essai toutes les 5 s, contenu de retour dès que ça passe. */
function Offline({ onRetry }: { onRetry?: () => unknown }) {
  const focused = useIsFocused();
  const [id] = useState(() => ++nextOfflineId);
  const retry = useRef(onRetry);
  useLayoutEffect(() => { retry.current = onRetry; });
  useEffect(() => {
    offlineStore.register(id, () => retry.current?.(), false);
    return () => offlineStore.unregister(id);
  }, [id]);
  useEffect(() => { offlineStore.setFocused(id, focused); }, [id, focused]);
  const leader = useSyncExternalStore(offlineStore.subscribe, offlineStore.leader, offlineStore.leader);
  return leader === id ? <OfflinePanel /> : null;
}

function OfflinePanel() {
  const t = useTheme();
  const [left, setLeft] = useState(RETRY_SECONDS);
  const [trying, setTrying] = useState(false);
  const busy = useRef(false);
  const remaining = useRef(RETRY_SECONDS);
  const alive = useRef(true);

  const run = useCallback(async () => {
    if (busy.current) return; // jamais deux essais en même temps
    busy.current = true;
    setTrying(true);
    try {
      await offlineStore.retryAll();
    } finally {
      busy.current = false;
      remaining.current = RETRY_SECONDS;
      if (alive.current) { setTrying(false); setLeft(RETRY_SECONDS); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => {
      if (busy.current) return;
      remaining.current -= 1;
      if (remaining.current <= 0) run();
      else setLeft(remaining.current);
    }, 1000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [run]);

  return (
    <View style={s.offline}>
      <LogoLoader size={96} offline />
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', marginTop: 8 }}>Pas de connexion</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {trying ? 'Nouvel essai…' : `Nouvel essai automatique dans ${left} s`}
      </Text>
      <Pressable onPress={run} disabled={trying} hitSlop={8} style={[s.retry, { borderColor: t.primary }]}>
        <Text style={{ color: t.primary, fontWeight: '600' }}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => unknown }) {
  const t = useTheme();
  if (isNetworkError(message)) return <Offline onRetry={onRetry} />;
  return (
    <View style={[s.error, { borderColor: t.danger }]}>
      <Text style={{ color: t.danger }}>{message}</Text>
      {onRetry && <Text onPress={() => { onRetry(); }} style={{ color: t.primary, marginTop: 6, fontWeight: '600' }}>Réessayer</Text>}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, textAlign: 'center', padding: 32 }}>{text}</Text>;
}

const s = StyleSheet.create({
  dot: { alignItems: 'center', justifyContent: 'center' },
  logoBox: { backgroundColor: '#FFFFFF', overflow: 'hidden' },
  logoImg: { width: '100%', height: '100%' },
  dotText: { color: '#fff', fontWeight: '700' },
  day: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, marginHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  internal: { opacity: 0.45 },
  grow: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  tag: { fontSize: 10, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  sub: { fontSize: 12, marginTop: 2 },
  amountBox: { alignItems: 'flex-end' },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  compact: { alignItems: 'center', paddingVertical: 32 },
  offline: { alignItems: 'center', gap: 6, paddingVertical: 32, paddingHorizontal: 24 },
  retry: { marginTop: 10, borderWidth: 1, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8 },
  error: { borderWidth: 1, borderRadius: 12, padding: 14, margin: 16 },
});
