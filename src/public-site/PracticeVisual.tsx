// PracticeVisual — abstracte praktijkbeeld-placeholder in de eigen
// vormtaal (VISUAL_PRINCIPLES.md §3 en §6, PHOTOGRAPHY_DIRECTION):
// zolang er geen eigen fotografie is tonen we een rustige, organische
// compositie in het merk-kleurenpaar — nadrukkelijk géén stockfoto's.
// Deterministisch per seed (slug) zodat elke praktijk een herkenbare,
// stabiele eigen variant heeft. Server-compatibel, puur SVG.

import { cx } from "@/components/ui";

/** Drie vaste, met de hand gezette organische paden (boonvormige lobben). */
const VORMEN = [
  "M78 128c-20-26-8-62 24-74s72 0 84 28-2 60-34 70-54 2-74-24z",
  "M64 110c-8-34 18-62 54-64s70 18 68 50-30 52-64 52-50-8-58-38z",
  "M86 138c-28-14-36-52-16-76s60-30 86-10 26 58 2 78-44 22-72 8z",
] as const;

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function PracticeVisual({
  seed,
  className,
}: {
  /** Bijv. de praktijk-slug: bepaalt de variant deterministisch. */
  seed: string;
  className?: string;
}) {
  const h = hash(seed);
  const pad = VORMEN[h % VORMEN.length];
  const spiegel = h % 2 === 1;

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-kaart-lg bg-brand-light/60",
        className,
      )}
    >
      <svg
        viewBox="0 0 260 200"
        role="img"
        aria-label="Abstracte praktijkweergave — eigen fotografie volgt"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
      >
        <rect width="260" height="200" fill="#cddfee" opacity="0.55" />
        {/* raster: de 'precision'-laag, heel subtiel */}
        <g stroke="#0120ec" strokeOpacity="0.08" strokeWidth="1">
          {[52, 104, 156, 208].map((x) => (
            <line key={`v${x}`} x1={x} y1="0" x2={x} y2="200" />
          ))}
          {[50, 100, 150].map((y) => (
            <line key={`h${y}`} x1="0" y1={y} x2="260" y2={y} />
          ))}
        </g>
        {/* de ene organische vorm: de 'flow'-laag */}
        <g transform={spiegel ? "translate(260 0) scale(-1 1)" : undefined}>
          <path d={pad} fill="#0120ec" opacity="0.16" />
          <path
            d={pad}
            fill="none"
            stroke="#0120ec"
            strokeOpacity="0.35"
            strokeWidth="2"
            transform="translate(10 -8)"
          />
        </g>
      </svg>
      <p className="absolute bottom-3 left-4 text-mw-micro font-semibold uppercase tracking-[0.12em] text-blauw-800/70">
        Praktijkbeeld volgt
      </p>
    </div>
  );
}
