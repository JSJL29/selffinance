import { memo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { bankMeta, bankShortName, useTheme } from '@/lib/theme';
import { dayLabel, money } from '@/lib/format';
import { Tx, txSubtitle, txTitle, useBankLogo } from '@/lib/data';

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

export function Loading() {
  const t = useTheme();
  return <Centered><ActivityIndicator color={t.primary} /></Centered>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={[s.error, { borderColor: t.danger }]}>
      <Text style={{ color: t.danger }}>{message}</Text>
      {onRetry && <Text onPress={onRetry} style={{ color: t.primary, marginTop: 6, fontWeight: '600' }}>Réessayer</Text>}
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
  error: { borderWidth: 1, borderRadius: 12, padding: 14, margin: 16 },
});
