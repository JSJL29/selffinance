// Courbe de l'historique (react-native-svg). Toute la géométrie vient de src/lib/chart.ts (testé).
import { useMemo, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { compactEuro, linePath, nearestIndex, niceTicks, scale, yDomain } from '@/lib/chart';
import { money, shortDate } from '@/lib/format';
import { PERIODS, type Period, type Point } from '@/lib/history';
import { useTheme } from '@/lib/theme';

export type Series = { points: Point[]; dashed?: boolean; label: string };

const PAD = { left: 48, right: 8, top: 10, bottom: 22 };

export function LineChart({ series, height = 180 }: { series: Series[]; height?: number }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  // Axe X : les dates de la 1re série ; les autres séries s'alignent sur ces dates.
  const dates = useMemo(() => series[0]?.points.map((p) => p.date) ?? [], [series]);
  const known = series[0]?.points.filter((p) => p.value != null).length ?? 0;

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points.map((p) => p.value));
    const [lo, hi] = yDomain(all);
    const x = scale([0, Math.max(dates.length - 1, 1)], [PAD.left, Math.max(width - PAD.right, PAD.left + 1)]);
    const y = scale([lo, hi], [height - PAD.bottom, PAD.top]);
    const xs = dates.map((_, i) => x(i));
    const paths = series.map((s) => {
      const byDate = new Map(s.points.map((p) => [p.date, p.value]));
      return linePath(dates.map((d, i) => {
        const v = byDate.get(d);
        return { x: xs[i], y: v == null ? null : y(v) };
      }));
    });
    return { xs, y, paths, ticks: niceTicks(lo, hi) };
  }, [series, dates, width, height]);

  // Le doigt sur la courbe : point le plus proche (sans bloquer le défilement vertical de l'écran).
  const xs = geo.xs;
  const responder = useMemo(() => {
    const pick = (x: number) => setActive(nearestIndex(xs, x));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: (e) => pick(e.nativeEvent.locationX),
      onPanResponderMove: (e) => pick(e.nativeEvent.locationX),
      onPanResponderRelease: () => setActive(null),
      onPanResponderTerminate: () => setActive(null),
    });
  }, [xs]);

  if (known < 2) {
    return (
      <View style={[s.empty, { height: height / 2, borderColor: t.border }]}>
        <Text style={{ color: t.muted, fontSize: 13 }}>La courbe se remplit chaque soir à 22 h.</Text>
      </View>
    );
  }

  const colors = [t.primary, t.muted];
  const at = active != null && active >= 0 ? active : null;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {geo.ticks.map((v) => (
            <Line key={`g${v}`} x1={PAD.left} x2={width - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke={t.border} strokeWidth={1} />
          ))}
          {geo.ticks.map((v) => (
            <SvgText key={`l${v}`} x={PAD.left - 6} y={geo.y(v) + 4} fontSize={10} fill={t.muted} textAnchor="end">
              {compactEuro(v)}
            </SvgText>
          ))}
          <SvgText x={PAD.left} y={height - 6} fontSize={10} fill={t.muted}>{shortDate(dates[0])}</SvgText>
          <SvgText x={width - PAD.right} y={height - 6} fontSize={10} fill={t.muted} textAnchor="end">
            {shortDate(dates[dates.length - 1])}
          </SvgText>
          {geo.paths.map((d, i) => (
            <Path key={series[i].label} d={d} fill="none" stroke={colors[i % colors.length]} strokeWidth={2}
              strokeDasharray={series[i].dashed ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {at != null && (
            <Line x1={geo.xs[at]} x2={geo.xs[at]} y1={PAD.top} y2={height - PAD.bottom} stroke={t.text} strokeWidth={1} />
          )}
        </Svg>
      )}
      {at != null && (
        <View pointerEvents="none" style={[s.bubble, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[s.bubbleText, { color: t.text }]}>{bubble(series, dates[at])}</Text>
        </View>
      )}
    </View>
  );
}

/** « 12 nov. : 47 980 € » (+ libellé si plusieurs séries, « · incomplet » si un cours ou un taux manquait). */
function bubble(series: Series[], date: string): string {
  const lines = series.map((sr) => {
    const p = sr.points.find((x) => x.date === date);
    const amount = p?.value == null ? '—' : money(p.value);
    const label = series.length > 1 ? `${sr.label} ` : '';
    return `${label}${amount}${p?.doubtful ? ' · incomplet' : ''}`;
  });
  return `${shortDate(date)} : ${lines.join('\n')}`;
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useTheme();
  return (
    <View style={s.periods}>
      {PERIODS.map((p) => (
        <Pressable key={p} onPress={() => onChange(p)} hitSlop={6}
          style={[s.period, p === value && { backgroundColor: t.tag }]}>
          <Text style={{ color: p === value ? t.primary : t.muted, fontWeight: '600', fontSize: 13 }}>{p}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, borderStyle: 'dashed' },
  bubble: { position: 'absolute', top: 0, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  bubbleText: { fontSize: 13, fontWeight: '600' },
  periods: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  period: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
});
