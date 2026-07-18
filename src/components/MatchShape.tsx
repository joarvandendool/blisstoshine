"use client";

// MatchShape — dé visuele signatuur van Mondzorgwerkt.
//
// Twee transparante, vloeibare blobvormen (kandidaat = blauw, praktijk =
// roze/lichtblauw) bewegen naar elkaar toe naarmate de matchscore stijgt:
// bij score 0 staan ze ver uit elkaar, bij score 100 overlappen ze zo sterk
// dat ze visueel bijna één vorm worden. Vijf matchdimensies moduleren de
// compositie subtiel; de score domineert altijd.
//
// Techniek: puur SVG + CSS (geen canvas, geen 3D-engine). De compositie is
// deterministisch berekend uit de props en rendert dus identiek op server
// en client — zonder JavaScript staat er een correcte statische vorm en is
// er geen layout shift. De zachte float-animatie is pure CSS (globals.css)
// en staat volledig achter prefers-reduced-motion: no-preference.

import { useId } from "react";
import { cx } from "@/components/ui";

export interface MatchShapeDimensions {
  /** 0–1: beschikbaarheid → verticale uitlijning van de vormen. */
  availability?: number;
  /** 0–1: reisafstand → extra horizontale nadering. */
  location?: number;
  /** 0–1: inhoudelijke match → ronding van de vormen. */
  content?: number;
  /** 0–1: apparatuur/techniek → onderlinge rotatie. */
  technology?: number;
  /** 0–1: cultuur → schaalverhouding tussen de vormen. */
  culture?: number;
}

export interface MatchShapeProps {
  /** Matchscore 0–100. */
  score: number;
  dimensions?: MatchShapeDimensions;
  /** compact ≈ 72px (kaarten/lijsten), hero ≈ 280px (detailpagina's). */
  size?: "compact" | "hero";
  /** Toon de score als groot cijfer naast/onder de vorm. Default: alleen bij hero. */
  showScore?: boolean;
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
 * Organisch blobpad rond de oorsprong: punten op een cirkel met vaste,
 * per vorm verschillende radiusvariatie, verbonden met vloeiende cubic
 * beziers (gesloten Catmull-Rom). `ronding` 0–1: hoger = ronder.
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

// Vaste golvingsprofielen: de twee vormen zijn herkenbaar verschillend
// maar altijd hetzelfde (deterministisch, geen hydration-verschillen).
const GOLVING_A = [0.1, -0.06, 0.14, -0.04, 0.08, -0.1, 0.12, -0.02] as const;
const GOLVING_B = [-0.08, 0.12, -0.05, 0.1, -0.12, 0.06, -0.04, 0.09] as const;

/* ------------------------------ component ---------------------------- */

const KIJKDOOS = { breedte: 240, hoogte: 180 } as const;

export function MatchShape({
  score,
  dimensions,
  size = "compact",
  showScore,
  className,
}: MatchShapeProps) {
  const uid = useId();
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
  // location: subtiele extra nadering of afstand (±8%).
  const afstand = basisAfstand * lerp(1.08, 0.92, location);
  // availability: verticale uitlijning — misalignment krimpt met de score.
  const verticaleAfwijking = (1 - availability) * lerp(18, 4, s);
  // technology: tegengestelde rotatie van de vormen (subtiel, max ±7°).
  const rotatie = (technology - 0.5) * 14;
  // culture: schaalverhouding tussen de twee vormen (max ±9%).
  const verhouding = 1 + (culture - 0.5) * 0.18;
  // content: vormronding — hogere inhoudelijke match = zachtere vorm.
  const ronding = 0.3 + content * 0.5;

  const middenX = KIJKDOOS.breedte / 2;
  const middenY = KIJKDOOS.hoogte / 2;
  const basisStraal = 52;

  const padA = blobPad(basisStraal * verhouding, GOLVING_A, ronding);
  const padB = blobPad(basisStraal / verhouding, GOLVING_B, ronding);

  const f = (x: number) => x.toFixed(2);
  const transformA = `translate(${f(middenX - afstand)} ${f(
    middenY - verticaleAfwijking / 2,
  )}) rotate(${f(-rotatie)})`;
  const transformB = `translate(${f(middenX + afstand)} ${f(
    middenY + verticaleAfwijking / 2,
  )}) rotate(${f(rotatie)})`;

  const idBlauw = `${uid}-grad-blauw`;
  const idRoze = `${uid}-grad-roze`;
  const idZacht = `${uid}-zacht`;

  const hero = size === "hero";
  const breedte = hero ? 280 : 72;
  const hoogte = Math.round(breedte * (KIJKDOOS.hoogte / KIJKDOOS.breedte));
  const toonScore = showScore ?? hero;

  return (
    <div
      role="img"
      aria-label={`Match van ${scoreRond} procent`}
      className={cx(
        "inline-flex items-center",
        hero ? "flex-col gap-2" : "gap-3",
        className,
      )}
    >
      <svg
        width={breedte}
        height={hoogte}
        viewBox={`0 0 ${KIJKDOOS.breedte} ${KIJKDOOS.hoogte}`}
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        <defs>
          <linearGradient id={idBlauw} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5c7dff" />
            <stop offset="100%" stopColor="#0120ec" />
          </linearGradient>
          <linearGradient id={idRoze} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ed6ca5" />
            <stop offset="100%" stopColor="#cddfee" />
          </linearGradient>
          <filter id={idZacht} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {/* multiply laat de overlap oplichten als een diepere mengkleur —
            bij hoge scores versmelten de vormen visueel tot één. */}
        <g style={{ mixBlendMode: "multiply" }} filter={`url(#${idZacht})`}>
          <g transform={transformA}>
            {/* animatie-wrapper: CSS-drift uit globals.css, alleen bij
                prefers-reduced-motion: no-preference (anders statisch). */}
            <g className="mz-blob-a">
              <path d={padA} fill={`url(#${idBlauw})`} fillOpacity={0.55} />
            </g>
          </g>
          <g transform={transformB}>
            <g className="mz-blob-b">
              <path d={padB} fill={`url(#${idRoze})`} fillOpacity={0.55} />
            </g>
          </g>
        </g>
      </svg>

      {toonScore ? (
        <div
          aria-hidden="true"
          className={cx(
            "flex items-baseline font-semibold tracking-tight text-ink",
            hero ? "text-6xl" : "text-lg",
          )}
        >
          <span className="tabular-nums">{scoreRond}</span>
          <em
            className={cx(
              "font-serif italic font-bold text-blauw-600",
              hero ? "ml-1 text-4xl" : "ml-0.5 text-sm",
            )}
          >
            %
          </em>
        </div>
      ) : null}
    </div>
  );
}

export default MatchShape;
