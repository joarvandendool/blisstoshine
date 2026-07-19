"use client";

// Match Shape v2-demo op /design-system: score-slider (0–100) plus sliders
// voor de vijf dimensies, alle groottes en varianten (static, animated,
// light/dark, share-compositie 1200×630).

import { useId, useState } from "react";
import { cx } from "@/components/ui";
import {
  MatchShape,
  MatchShapeShare,
  type MatchShapeDimensions,
} from "@/components/MatchShape";

const DIMENSIES: Array<{
  sleutel: keyof MatchShapeDimensions;
  naam: string;
  effect: string;
}> = [
  { sleutel: "availability", naam: "Werkdagen", effect: "verticale uitlijning" },
  { sleutel: "location", naam: "Locatie", effect: "extra nadering" },
  { sleutel: "content", naam: "Vakinhoud", effect: "ronding van de vormen" },
  { sleutel: "technology", naam: "Technologie", effect: "onderlinge rotatie" },
  { sleutel: "culture", naam: "Cultuur", effect: "schaalbalans" },
];

export function ShapeDemo() {
  const uid = useId();
  const [score, setScore] = useState(78);
  const [dimensies, setDimensies] = useState<Required<MatchShapeDimensions>>({
    availability: 0.7,
    location: 0.6,
    content: 0.65,
    technology: 0.5,
    culture: 0.5,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* hero met sliders */}
      <div className="glass-strong grid gap-8 rounded-kaart-lg p-8 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col items-center justify-center gap-4">
          <MatchShape score={score} dimensions={dimensies} size="hero" />
          <p className="max-w-md text-center text-xs leading-relaxed text-mw-text-muted">
            De kandidaat (vloeibaar, roze/cloud) en de praktijk (stabiel,
            cobalt/cloud) naderen elkaar met de score; het iriserende accent
            bestaat exact waar ze overlappen en wordt sterker naarmate de
            match sterker is. Die uitleg zit ook in het aria-label.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <label htmlFor={`${uid}-score`} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between text-sm font-semibold text-ink">
              Score
              <span className="tabular-nums text-blauw-700">{score}%</span>
            </span>
            <input
              id={`${uid}-score`}
              type="range"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
              className="h-11 w-full accent-blauw-600"
            />
          </label>
          <div className="flex flex-col gap-2 border-t border-mw-border pt-4">
            {DIMENSIES.map(({ sleutel, naam, effect }) => (
              <label key={sleutel} htmlFor={`${uid}-${sleutel}`} className="flex flex-col">
                <span className="flex items-baseline justify-between text-xs font-semibold text-ink">
                  {naam}
                  <span className="font-normal text-mw-text-muted">{effect}</span>
                </span>
                <input
                  id={`${uid}-${sleutel}`}
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(dimensies[sleutel] * 100)}
                  onChange={(e) =>
                    setDimensies((d) => ({
                      ...d,
                      [sleutel]: Number(e.target.value) / 100,
                    }))
                  }
                  className="h-8 w-full accent-blauw-600"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* varianten */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-strong flex flex-col gap-4 rounded-kaart p-6">
          <h3 className="text-mw-kop-3 font-semibold">Groottes & scoreweergave</h3>
          <div className="flex flex-wrap items-end gap-8">
            {(
              [
                ["compact", "compact ≈ 64px"],
                ["card", "card ≈ 120px"],
                ["hero", "hero ≈ 280px"],
              ] as const
            ).map(([maat, naam]) => (
              <figure key={maat} className="flex flex-col items-center gap-1">
                <MatchShape
                  score={score}
                  dimensions={dimensies}
                  size={maat}
                  showScore={maat !== "hero"}
                />
                <figcaption className="text-[11px] text-mw-text-muted">{naam}</figcaption>
              </figure>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-mw-text-muted">
            De tekstuele score is optioneel (<code>showScore</code>) en bij
            hero standaard aan: de vorm illustreert, het getal blijft de
            leesbare waarheid.
          </p>
        </div>

        <div className="glass-strong flex flex-col gap-4 rounded-kaart p-6">
          <h3 className="text-mw-kop-3 font-semibold">Static, animated & tonen</h3>
          <div className="grid grid-cols-2 gap-4">
            <figure className="flex flex-col items-center gap-1 rounded-kaart border border-mw-border bg-white p-4">
              <MatchShape score={score} dimensions={dimensies} size="card" animated={false} />
              <figcaption className="text-[11px] text-mw-text-muted">
                static (SSR, geen JS-animatie)
              </figcaption>
            </figure>
            <figure className="flex flex-col items-center gap-1 rounded-kaart border border-mw-border bg-white p-4">
              <MatchShape score={score} dimensions={dimensies} size="card" />
              <figcaption className="text-[11px] text-mw-text-muted">
                animated (CSS-drift; statisch bij reduced motion)
              </figcaption>
            </figure>
            <figure className="col-span-2 flex flex-col items-center gap-1 rounded-kaart bg-blauw-900 p-4">
              <MatchShape score={score} dimensions={dimensies} size="card" tone="dark" showScore />
              <figcaption className="text-[11px] text-blauw-200">
                tone=&quot;dark&quot; — aangepaste tinten op donkere vlakken
              </figcaption>
            </figure>
          </div>
          <p className="text-xs leading-relaxed text-mw-text-muted">
            Reduced motion is volwaardig: exact dezelfde compositie, alleen
            zonder drift. De animatie is pure CSS (geen continue JS) en
            gebruikt will-change uitsluitend binnen de motion-media-query.
          </p>
        </div>
      </div>

      {/* share-variant */}
      <div className="glass-strong flex flex-col gap-4 rounded-kaart p-6">
        <h3 className="text-mw-kop-3 font-semibold">
          Deelbare compositie (1200×630)
        </h3>
        <div className={cx("overflow-hidden rounded-kaart border border-mw-border")}>
          <MatchShapeShare
            score={score}
            dimensions={dimensies}
            caption="match tussen kandidaat en praktijk"
            className="block h-auto w-full"
          />
        </div>
        <p className="text-xs leading-relaxed text-mw-text-muted">
          <code>MatchShapeShare</code>: vaste, altijd statische compositie op
          og-formaat voor de social-share-fase — dezelfde SVG-vormtaal, met
          wordmark en tekstuele score zodat het beeld zonder context
          uitlegbaar blijft.
        </p>
      </div>
    </div>
  );
}
