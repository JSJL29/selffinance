// Le logo « SF » qui se trace en boucle (chargement) ou reste à mi-chemin en gris (hors connexion).
// Toute la géométrie vient de src/lib/loader.ts (testé) ; ici, seulement l'animation.
import { useEffect, useId, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { F_LEN, F_PATH, OFFLINE_PROGRESS, S_LEN, S_PATH, cycle, drawState } from '@/lib/loader';
import { useTheme } from '@/lib/theme';

const APath = Animated.createAnimatedComponent(Path);
const ACircle = Animated.createAnimatedComponent(Circle);

const CYCLE_MS = 2200;
const SAMPLES = 44; // une valeur toutes les 50 ms : la courbe d'avancement reste lisse

// Trait encore vide : on pousse le tiret hors du tracé, sinon l'extrémité ronde laisse un point au départ.
const CAP = 4;
const hide = (offset: number, len: number) => (offset >= len - 1e-6 ? len + CAP : offset);

// L'avancement n'est pas linéaire (accéléré puis freiné) : on échantillonne cycle()/drawState() une fois
// pour toutes et Animated interpole entre les points, sans rendu React à chaque image.
const table = (() => {
  const input: number[] = [];
  const s: number[] = [];
  const f: number[] = [];
  const dot: number[] = [];
  const opacity: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const c = cycle(i === SAMPLES ? CYCLE_MS / 1000 - 1e-9 : (i / SAMPLES) * (CYCLE_MS / 1000));
    const d = drawState(c.progress);
    input.push(i / SAMPLES);
    s.push(hide(d.sOffset, S_LEN));
    f.push(hide(d.fOffset, F_LEN));
    dot.push(d.dotR);
    opacity.push(c.opacity);
  }
  return { input, s, f, dot, opacity };
})();

export function LogoLoader({ size = 120, offline = false }: { size?: number; offline?: boolean }) {
  const t = useTheme();
  const gradId = `sf${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [reduceMotion, setReduceMotion] = useState(false);
  const [clock] = useState(() => new Animated.Value(0));
  const [breath] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v); }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const anim = offline
      ? Animated.loop(Animated.sequence([
        Animated.timing(breath, { toValue: 0.55, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(breath, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]))
      : Animated.loop(Animated.timing(clock, { toValue: 1, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: false }));
    anim.start();
    return () => { anim.stop(); clock.setValue(0); breath.setValue(1); };
  }, [offline, reduceMotion, clock, breath]);

  const anim = useMemo(() => {
    const at = (out: number[]) => clock.interpolate({ inputRange: table.input, outputRange: out });
    return { s: at(table.s), f: at(table.f), dot: at(table.dot), opacity: at(table.opacity) };
  }, [clock]);

  // Hors connexion ou animations réduites : tracé fixe (à mi-chemin, ou complet).
  const still = offline || reduceMotion ? drawState(offline ? OFFLINE_PROGRESS : 1) : null;
  const stroke = offline ? t.muted : `url(#${gradId})`;
  const dotFill = offline ? t.muted : '#A78BFA';

  return (
    <Animated.View
      accessibilityRole="progressbar" accessibilityLabel={offline ? 'Pas de connexion' : 'Chargement'}
      style={{ width: size, height: size, opacity: offline ? breath : still ? 1 : anim.opacity }}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="10" y1="48" x2="54" y2="16">
            <Stop offset="0" stopColor="#60A5FA" />
            <Stop offset="1" stopColor="#A78BFA" />
          </LinearGradient>
        </Defs>
        {/* Tracé « fantôme » : la forme complète, discrète, sous le trait qui avance. */}
        <Path d={`${S_PATH} ${F_PATH}`} fill="none" stroke={t.border} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
        <APath d={S_PATH} fill="none" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={[S_LEN, S_LEN + 2 * CAP]} strokeDashoffset={still ? hide(still.sOffset, S_LEN) : anim.s} />
        <APath d={F_PATH} fill="none" stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={[F_LEN, F_LEN + 2 * CAP]} strokeDashoffset={still ? hide(still.fOffset, F_LEN) : anim.f} />
        <ACircle cx={52.5} cy={20} r={still ? still.dotR : anim.dot} fill={dotFill} />
      </Svg>
    </Animated.View>
  );
}
