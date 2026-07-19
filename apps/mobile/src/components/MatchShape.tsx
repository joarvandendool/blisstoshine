// MatchShape — dé visuele signatuur van Mondzorgwerkt, geport naar native
// iOS. Twee vloeibare blobvormen (kandidaat = blauw, praktijk = roze/cloud)
// naderen elkaar naarmate de serverscore stijgt; vijf dimensies moduleren de
// compositie subtiel. De geometrie is identiek aan de webversie
// (src/components/MatchShape.tsx) en deterministisch.
//
// Motion: uitsluitend transform/opacity via Reanimated (native driver),
// pauzeert wanneer het scherm niet gefocust is (prop `actief`) en staat
// volledig uit bij "Verminder beweging". De vorm zelf is altijd correct —
// de score en uitleg staan ook als tekst in de UI, de vorm vervangt nooit
// functionele informatie.

import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { kleur, motion, typo } from "@/theme/tokens";
import { useReducedMotion } from "@/lib/motion";

export interface MatchShapeDimensions {
  availability?: number;
  location?: number;
  content?: number;
  technology?: number;
  culture?: number;
}

export interface MatchShapeProps {
  /** Matchscore 0–100 (serveruitkomst). */
  score: number;
  dimensions?: MatchShapeDimensions;
  size?: "compact" | "hero";
  showScore?: boolean;
  /** false = animatie gepauzeerd (scherm niet zichtbaar). */
  actief?: boolean;
}

/* ---------------------------- geometrie (identiek aan web) -------------- */

const clamp = (w: number, min: number, max: number) => Math.min(max, Math.max(min, w));
const clamp01 = (w: number) => clamp(w, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Punt = readonly [number, number];

function blobPad(straal: number, golving: readonly number[], ronding: number): string {
  const n = golving.length;
  const punten: Punt[] = [];
  for (let i = 0; i < n; i++) {
    const hoek = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = straal * (1 + golving[i] * (1 - ronding));
    punten.push([Math.cos(hoek) * r, Math.sin(hoek) * r]);
  }
  const f = (x: number) => x.toFixed(2);
  let d = `M ${f(punten[0][0])} ${f(punten[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = punten[(i - 1 + n) % n];
    const p1 = punten[i];
    const p2 = punten[(i + 1) % n];
    const p3 = punten[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const GOLVING_A = [0.1, -0.06, 0.14, -0.04, 0.08, -0.1, 0.12, -0.02] as const;
const GOLVING_B = [-0.08, 0.12, -0.05, 0.1, -0.12, 0.06, -0.04, 0.09] as const;

const KIJKDOOS = { breedte: 240, hoogte: 180 } as const;

/** Pure compositieberekening — apart geëxporteerd voor unit tests. */
export function berekenCompositie(score: number, dimensions?: MatchShapeDimensions) {
  const scoreRond = Math.round(clamp(score, 0, 100));
  const s = scoreRond / 100;
  const availability = clamp01(dimensions?.availability ?? 0.5);
  const location = clamp01(dimensions?.location ?? 0.5);
  const content = clamp01(dimensions?.content ?? 0.5);
  const technology = clamp01(dimensions?.technology ?? 0.5);
  const culture = clamp01(dimensions?.culture ?? 0.5);

  const basisAfstand = lerp(58, 8, s);
  const afstand = basisAfstand * lerp(1.08, 0.92, location);
  const verticaleAfwijking = (1 - availability) * lerp(18, 4, s);
  const rotatie = (technology - 0.5) * 14;
  const verhouding = 1 + (culture - 0.5) * 0.18;
  const ronding = 0.3 + content * 0.5;

  return { scoreRond, afstand, verticaleAfwijking, rotatie, verhouding, ronding };
}

/* ------------------------------ drift-animatie -------------------------- */

function useDrift(duurMs: number, amplitude: number, aan: boolean) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (aan) {
      t.value = withRepeat(
        withSequence(
          withTiming(1, { duration: duurMs / 2, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: duurMs / 2, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
      );
    } else {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 200 });
    }
    return () => cancelAnimation(t);
  }, [aan, duurMs, t]);

  return useAnimatedStyle(() => ({
    transform: [
      { translateY: t.value * amplitude },
      { rotate: `${t.value * 1.6}deg` },
    ],
  }));
}

/* -------------------------------- component ----------------------------- */

export function MatchShape({
  score,
  dimensions,
  size = "compact",
  showScore,
  actief = true,
}: MatchShapeProps) {
  const verminderdeBeweging = useReducedMotion();
  const animatieAan = actief && !verminderdeBeweging;

  const c = berekenCompositie(score, dimensions);
  const basisStraal = 52;
  const padA = blobPad(basisStraal * c.verhouding, GOLVING_A, c.ronding);
  const padB = blobPad(basisStraal / c.verhouding, GOLVING_B, c.ronding);

  const hero = size === "hero";
  const breedte = hero ? 280 : 72;
  const hoogte = Math.round(breedte * (KIJKDOOS.hoogte / KIJKDOOS.breedte));
  const toonScore = showScore ?? hero;

  const middenX = KIJKDOOS.breedte / 2;
  const middenY = KIJKDOOS.hoogte / 2;

  // Twee tempi zodat de vormen onafhankelijk lijken te "ademen".
  const driftA = useDrift(motion.blobA, -4, animatieAan);
  const driftB = useDrift(motion.blobB, 3, animatieAan);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Match van ${c.scoreRond} procent`}
      style={[stijlen.wrapper, hero ? stijlen.wrapperHero : stijlen.wrapperCompact]}
    >
      <View style={{ width: breedte, height: hoogte }}>
        {/* Twee gestapelde SVG's zodat elke blob zijn eigen native
            transform-animatie krijgt (alleen transform/opacity). */}
        <Animated.View style={[StyleSheet.absoluteFill, driftA]}>
          <Svg
            width={breedte}
            height={hoogte}
            viewBox={`0 0 ${KIJKDOOS.breedte} ${KIJKDOOS.hoogte}`}
          >
            <Defs>
              <LinearGradient id="mzBlauw" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={kleur.blauw400} />
                <Stop offset="1" stopColor={kleur.blauw600} />
              </LinearGradient>
            </Defs>
            <G
              transform={`translate(${(middenX - c.afstand).toFixed(2)} ${(
                middenY - c.verticaleAfwijking / 2
              ).toFixed(2)}) rotate(${(-c.rotatie).toFixed(2)})`}
            >
              <Path d={padA} fill="url(#mzBlauw)" fillOpacity={0.55} />
            </G>
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, driftB]}>
          <Svg
            width={breedte}
            height={hoogte}
            viewBox={`0 0 ${KIJKDOOS.breedte} ${KIJKDOOS.hoogte}`}
          >
            <Defs>
              <LinearGradient id="mzRoze" x1="1" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={kleur.roze400} />
                <Stop offset="1" stopColor={kleur.cloud} />
              </LinearGradient>
            </Defs>
            <G
              transform={`translate(${(middenX + c.afstand).toFixed(2)} ${(
                middenY + c.verticaleAfwijking / 2
              ).toFixed(2)}) rotate(${c.rotatie.toFixed(2)})`}
            >
              <Path d={padB} fill="url(#mzRoze)" fillOpacity={0.55} />
            </G>
          </Svg>
        </Animated.View>
      </View>

      {toonScore ? (
        <View style={stijlen.scoreRij} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={[stijlen.scoreTekst, hero ? stijlen.scoreHero : stijlen.scoreCompact]}>
            {c.scoreRond}
          </Text>
          <Text
            style={[
              typo.serifItalic,
              stijlen.procent,
              hero ? stijlen.procentHero : stijlen.procentCompact,
            ]}
          >
            %
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const stijlen = StyleSheet.create({
  wrapper: { alignItems: "center" },
  wrapperHero: { flexDirection: "column", gap: 8 },
  wrapperCompact: { flexDirection: "row", gap: 12 },
  scoreRij: { flexDirection: "row", alignItems: "flex-end" },
  scoreTekst: {
    color: kleur.inkt,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  scoreHero: { fontSize: 56, lineHeight: 60 },
  scoreCompact: { fontSize: 18, lineHeight: 22 },
  procent: { color: kleur.blauw600, fontWeight: "700" },
  procentHero: { fontSize: 32, lineHeight: 44, marginLeft: 4 },
  procentCompact: { fontSize: 12, lineHeight: 18, marginLeft: 2 },
});

export default MatchShape;
