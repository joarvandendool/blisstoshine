"use client";

// MatchShape v2 — dé visuele signatuur van Mondzorgwerkt (Workstream B, fase 4).
//
// Twee originele, transparante organische vormen:
// - de KANDIDAAT-vorm: vloeibaarder en zachter (roze/cloud-tint) — voorkeur,
//   beweging, mens;
// - de PRAKTIJK-vorm: stabieler en preciezer (cobalt/cloud-tint) — vakmanschap,
//   betrouwbaarheid.
// Afstand, balans en overlapping reageren op de matchscore 0–100; de vijf
// matchdimensies (werkdagen, locatie, vakinhoud, technologie, cultuur)
// moduleren subtiel rotatie, ronding en schaal. In de overlap ligt een licht
// iriserend accent: hoe meer overlap, hoe sterker de match — uitlegbare
// transparantie (VISUAL_PRINCIPLES.md §4), ook vastgelegd in het aria-label.
//
// Techniek: puur SVG + CSS-gradients/clips (geen canvas, geen 3D). De
// compositie is deterministisch berekend uit de props en rendert identiek op
// server en client: zonder JavaScript staat er een correcte statische vorm
// (variant `animated={false}` is expliciet statisch). De zachte drift is pure
// CSS (globals.css), staat volledig achter prefers-reduced-motion:
// no-preference en gebruikt will-change alleen dáár. Geen continue
// JS-animatie.

import { useId } from "react";
import { cx } from "@/components/ui";

export interface MatchShapeDimensions {
  /** 0–1: werkdagen/beschikbaarheid → verticale uitlijning van de vormen. */
  availability?: number;
  /** 0–1: locatie/reisafstand → extra horizontale nadering. */
  location?: number;
  /** 0–1: vakinhoudelijke match → ronding van de vormen. */
  content?: number;
  /** 0–1: apparatuur/technologie → onderlinge rotatie. */
  technology?: number;
  /** 0–1: cultuur → schaalverhouding tussen de vormen. */
  culture?: number;
}

export interface MatchShapeProps {
  /** Matchscore 0–100. */
  score: number;
  dimensions?: MatchShapeDimensions;
  /** compact ≈ 64px (lijsten), card ≈ 120px (kaarten), hero ≈ 280px (detail). */
  size?: "compact" | "card" | "hero";
  /** Toon de score als tekstueel cijfer naast/onder de vorm. Default: alleen bij hero. */
  showScore?: boolean;
  /**
   * true (default): langzame CSS-drift (automatisch statisch bij
   * prefers-reduced-motion). false: gegarandeerd statische compositie,
   * SSR-correct zonder JS.
   */
  animated?: boolean;
  /** Achtergrondtoon: "light" (default, lichte canvassen) of "dark" (op cobalt/ink-vlakken). */
  tone?: "light" | "dark";
  className?: string;
}

/* ---------------------------- rekenhulpen ---------------------------- */

function clamp(waarde: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, waarde));
}

function clamp01(waarde: number): number {
  return clamp(waarde, 0, 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type Punt = readonly [number, number];

/**
 * Organisch blobpad rond de oorsprong: punten op een cirkel met een vast,
 * per vorm verschillend golvingsprofiel, verbonden met vloeiende cubic
 * beziers (gesloten Catmull-Rom). `ronding` 0–1: hoger = ronder/strakker.
 */
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

// Twee originele golvingsprofielen (deterministisch, geen hydration-
// verschillen, geen tandvorm):
// - kandidaat: 10 punten, ruime amplitude → vloeibaar, zacht;
// - praktijk: 8 punten, kleine amplitude → stabiel, precies.
const GOLVING_KANDIDAAT = [
  0.17, -0.09, 0.21, -0.05, 0.12, -0.15, 0.19, -0.07, 0.1, -0.13,
] as const;
const GOLVING_PRAKTIJK = [
  0.05, -0.03, 0.06, -0.02, 0.045, -0.05, 0.055, -0.025,
] as const;

/* --------------------------- compositie ------------------------------ */

const KIJKDOOS = { breedte: 240, hoogte: 180 } as const;

interface Compositie {
  scoreRond: number;
  /** 0–1: aandeel van de score. */
  s: number;
  padKandidaat: string;
  padPraktijk: string;
  transformKandidaat: string;
  transformPraktijk: string;
}

function berekenCompositie(
  score: number,
  dimensions?: MatchShapeDimensions,
): Compositie {
  const scoreRond = Math.round(clamp(score, 0, 100));
  const s = scoreRond / 100;

  const availability = clamp01(dimensions?.availability ?? 0.5);
  const location = clamp01(dimensions?.location ?? 0.5);
  const content = clamp01(dimensions?.content ?? 0.5);
  const technology = clamp01(dimensions?.technology ?? 0.5);
  const culture = clamp01(dimensions?.culture ?? 0.5);

  // Score domineert: horizontale afstand van ver uit elkaar (score 0)
  // naar sterk overlappend (score 100).
  const basisAfstand = lerp(58, 8, s);
  // locatie: subtiele extra nadering of afstand (±8%).
  const afstand = basisAfstand * lerp(1.08, 0.92, location);
  // werkdagen: verticale uitlijning — misalignment krimpt met de score.
  const verticaleAfwijking = (1 - availability) * lerp(18, 4, s);
  // technologie: tegengestelde rotatie (subtiel, max ±7°).
  const rotatie = (technology - 0.5) * 14;
  // cultuur: schaalverhouding/balans tussen de twee vormen (max ±9%).
  const verhouding = 1 + (culture - 0.5) * 0.18;
  // vakinhoud: ronding — hogere inhoudelijke match = zachtere vormen.
  // De kandidaat blijft altijd vloeibaarder dan de praktijk.
  const rondingKandidaat = 0.15 + content * 0.45;
  const rondingPraktijk = 0.55 + content * 0.35;

  const middenX = KIJKDOOS.breedte / 2;
  const middenY = KIJKDOOS.hoogte / 2;
  const basisStraal = 52;

  const f = (x: number) => x.toFixed(2);
  return {
    scoreRond,
    s,
    padKandidaat: blobPad(
      basisStraal * verhouding,
      GOLVING_KANDIDAAT,
      rondingKandidaat,
    ),
    padPraktijk: blobPad(
      basisStraal / verhouding,
      GOLVING_PRAKTIJK,
      rondingPraktijk,
    ),
    transformKandidaat: `translate(${f(middenX - afstand)} ${f(
      middenY - verticaleAfwijking / 2,
    )}) rotate(${f(-rotatie)})`,
    transformPraktijk: `translate(${f(middenX + afstand)} ${f(
      middenY + verticaleAfwijking / 2,
    )}) rotate(${f(rotatie)})`,
  };
}

/* --------------------------- kleurthema's ---------------------------- */

interface Toon {
  kandidaatVan: string;
  kandidaatNaar: string;
  praktijkVan: string;
  praktijkNaar: string;
  vulOpacity: number;
  /** multiply op licht (mengkleur wordt dieper), screen op donker. */
  blend: "multiply" | "screen";
}

const TONEN: Record<"light" | "dark", Toon> = {
  light: {
    kandidaatVan: "#ed6ca5",
    kandidaatNaar: "#cddfee",
    praktijkVan: "#0120ec",
    praktijkNaar: "#cddfee",
    vulOpacity: 0.52,
    blend: "multiply",
  },
  dark: {
    kandidaatVan: "#f3a1c5",
    kandidaatNaar: "#fdf2f7",
    praktijkVan: "#8fabff",
    praktijkNaar: "#dbe6ff",
    vulOpacity: 0.62,
    blend: "screen",
  },
};

/* ------------------------- gedeelde SVG-kern ------------------------- */

interface ShapeSvgProps {
  compositie: Compositie;
  toon: Toon;
  uid: string;
  animated: boolean;
  width: number | string;
  height: number | string;
  className?: string;
}

/**
 * De eigenlijke vormcompositie. Overlap-accent: de praktijkvorm wordt
 * geclipt op de kandidaatvorm en gevuld met een subtiele iriserende
 * gradient — het accent bestaat dus exact waar de twee vormen elkaar
 * overlappen en wordt sterker naarmate de score (en dus de overlap) stijgt.
 */
function ShapeSvg({
  compositie,
  toon,
  uid,
  animated,
  width,
  height,
  className,
}: ShapeSvgProps) {
  const {
    s,
    padKandidaat,
    padPraktijk,
    transformKandidaat,
    transformPraktijk,
  } = compositie;

  const idKandidaat = `${uid}-grad-kandidaat`;
  const idPraktijk = `${uid}-grad-praktijk`;
  const idIris = `${uid}-grad-iris`;
  const idClip = `${uid}-clip-kandidaat`;
  const idZacht = `${uid}-zacht`;

  // Iriserend accent in de overlap: subtiel bij lage, duidelijk bij hoge score.
  const irisOpacity = 0.2 + 0.55 * s;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${KIJKDOOS.breedte} ${KIJKDOOS.hoogte}`}
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <defs>
        <linearGradient id={idKandidaat} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={toon.kandidaatVan} />
          <stop offset="100%" stopColor={toon.kandidaatNaar} />
        </linearGradient>
        <linearGradient id={idPraktijk} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={toon.praktijkVan} />
          <stop offset="100%" stopColor={toon.praktijkNaar} />
        </linearGradient>
        {/* Iriserende overgang — alleen decoratief, alleen in de overlap. */}
        <linearGradient id={idIris} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#cddfee" stopOpacity="0" />
          <stop offset="35%" stopColor="#ed6ca5" stopOpacity="0.38" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="78%" stopColor="#0120ec" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#cddfee" stopOpacity="0" />
        </linearGradient>
        <clipPath id={idClip}>
          <path d={padKandidaat} transform={transformKandidaat} />
        </clipPath>
        {/* Beperkte blur: alleen randverzachting, geen glow. */}
        <filter id={idZacht} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      <g style={{ mixBlendMode: toon.blend }} filter={`url(#${idZacht})`}>
        {/* kandidaat: vloeibaar, roze/cloud */}
        <g transform={transformKandidaat}>
          <g className={animated ? "mz-blob-a" : undefined}>
            <path
              d={padKandidaat}
              fill={`url(#${idKandidaat})`}
              fillOpacity={toon.vulOpacity}
            />
          </g>
        </g>
        {/* praktijk: stabiel, cobalt/cloud */}
        <g transform={transformPraktijk}>
          <g className={animated ? "mz-blob-b" : undefined}>
            <path
              d={padPraktijk}
              fill={`url(#${idPraktijk})`}
              fillOpacity={toon.vulOpacity}
            />
          </g>
        </g>
      </g>

      {/* overlap-accent: praktijkvorm geclipt op de kandidaatvorm */}
      <g clipPath={`url(#${idClip})`} opacity={irisOpacity}>
        <g transform={transformPraktijk}>
          <g className={animated ? "mz-blob-b" : undefined}>
            <path d={padPraktijk} fill={`url(#${idIris})`} />
          </g>
        </g>
      </g>
    </svg>
  );
}

/* ------------------------------ component ---------------------------- */

const MATEN: Record<NonNullable<MatchShapeProps["size"]>, number> = {
  compact: 64,
  card: 120,
  hero: 280,
};

export function MatchShape({
  score,
  dimensions,
  size = "compact",
  showScore,
  animated = true,
  tone = "light",
  className,
}: MatchShapeProps) {
  const uid = useId();
  const compositie = berekenCompositie(score, dimensions);
  const toon = TONEN[tone];

  const hero = size === "hero";
  const breedte = MATEN[size];
  const hoogte = Math.round(breedte * (KIJKDOOS.hoogte / KIJKDOOS.breedte));
  const toonScore = showScore ?? hero;

  return (
    <div
      role="img"
      aria-label={`Matchvorm: kandidaat en praktijk overlappen bij een match van ${compositie.scoreRond} procent — hoe groter de overlap, hoe sterker de match.`}
      className={cx(
        "inline-flex items-center",
        hero ? "flex-col gap-2" : "gap-3",
        className,
      )}
    >
      <ShapeSvg
        compositie={compositie}
        toon={toon}
        uid={uid}
        animated={animated}
        width={breedte}
        height={hoogte}
      />

      {toonScore ? (
        <div
          aria-hidden="true"
          className={cx(
            "flex items-baseline font-semibold tracking-tight",
            tone === "dark" ? "text-white" : "text-ink",
            hero ? "text-6xl" : size === "card" ? "text-2xl" : "text-lg",
          )}
        >
          <span className="tabular-nums">{compositie.scoreRond}</span>
          <em
            className={cx(
              "font-serif italic font-bold",
              tone === "dark" ? "text-blauw-200" : "text-blauw-600",
              hero ? "ml-1 text-4xl" : size === "card" ? "ml-1 text-lg" : "ml-0.5 text-sm",
            )}
          >
            %
          </em>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------- share-variant --------------------------- */

export interface MatchShapeShareProps {
  score: number;
  dimensions?: MatchShapeDimensions;
  tone?: "light" | "dark";
  /** Optionele naamregel onder de score, bv. praktijk- of kandidaatnaam. */
  caption?: string;
  className?: string;
}

/**
 * Deelbare vaste compositie op 1200×630 (og-image-verhouding) voor de
 * social-share-fase. Dezelfde SVG-vormtaal, altijd statisch, met wordmark
 * en tekstuele score zodat het beeld ook zonder context uitlegbaar is.
 */
export function MatchShapeShare({
  score,
  dimensions,
  tone = "light",
  caption,
  className,
}: MatchShapeShareProps) {
  const uid = useId();
  const compositie = berekenCompositie(score, dimensions);
  const toon = TONEN[tone];
  const donker = tone === "dark";

  const achtergrondVan = donker ? "#0a1670" : "#f4f8fc";
  const achtergrondNaar = donker ? "#051697" : "#cddfee";
  const tekst = donker ? "#ffffff" : "#0a0d1c";
  const accent = donker ? "#bccfff" : "#0120ec";
  const idAchtergrond = `${uid}-share-bg`;

  return (
    <svg
      width={1200}
      height={630}
      viewBox="0 0 1200 630"
      role="img"
      aria-label={`Matchvorm van mondzorgwerkt: kandidaat en praktijk overlappen bij een match van ${compositie.scoreRond} procent — hoe groter de overlap, hoe sterker de match.`}
      className={className}
    >
      <defs>
        <linearGradient id={idAchtergrond} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={achtergrondVan} />
          <stop offset="100%" stopColor={achtergrondNaar} />
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill={`url(#${idAchtergrond})`} />

      {/* de vorm, gecentreerd rechts van het tekstblok */}
      <g transform="translate(430 45) scale(3)">
        <ShapeSvg
          compositie={compositie}
          toon={toon}
          uid={`${uid}-share`}
          animated={false}
          width={KIJKDOOS.breedte}
          height={KIJKDOOS.hoogte}
        />
      </g>

      {/* wordmark (tekstplaceholder tot de echte vector er is) */}
      <text
        x="72"
        y="120"
        fill={tekst}
        style={{ font: "600 40px var(--font-sans, Archivo, sans-serif)" }}
      >
        mondzorg
        <tspan
          fill={accent}
          style={{
            font: "italic 700 40px var(--font-serif, 'Playfair Display', serif)",
          }}
        >
          werkt
        </tspan>
      </text>

      {/* score + uitleg */}
      <text
        x="72"
        y="472"
        fill={tekst}
        style={{ font: "600 150px var(--font-sans, Archivo, sans-serif)" }}
      >
        <tspan style={{ fontVariantNumeric: "tabular-nums" }}>
          {compositie.scoreRond}
        </tspan>
        <tspan
          dx="6"
          fill={accent}
          style={{
            font: "italic 700 96px var(--font-serif, 'Playfair Display', serif)",
          }}
        >
          %
        </tspan>
      </text>
      <text
        x="72"
        y="530"
        fill={tekst}
        opacity={donker ? 0.85 : 0.7}
        style={{ font: "500 30px var(--font-sans, Archivo, sans-serif)" }}
      >
        {caption ?? "match tussen kandidaat en praktijk"}
      </text>
    </svg>
  );
}

export default MatchShape;
