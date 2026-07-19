"use client";

// Werkweek-, patroon- en motion-sectie van /design-system:
// - WeekGrid in alle vier de modes, met een containerbreedte-schakelaar die
//   het responsive kantelen (< 640px: dagen als rijen) demonstreert;
// - eenvoudige eigen dialog- en drawer-patronen (uitlegbare transparantie:
//   de frosted laag ligt letterlijk boven de content);
// - tooltips (CSS-only, hover + focus);
// - een klein charts-specimen met pure CSS-staafjes;
// - het motion-specimen met reduced-motion-gedrag en demo-toggle.

import { useEffect, useRef, useState } from "react";
import { Button, Card, cx } from "@/components/ui";
import WeekGrid from "@/components/WeekGrid";
import {
  emptyAvailability,
  emptySchedule,
  type CandidateAvailability,
  type VacancySchedule,
} from "@/domain/taxonomy";

/* --------------------------- voorbeelddata --------------------------- */

function demoBeschikbaarheid(): CandidateAvailability {
  const basis = emptyAvailability();
  basis.ma.ochtend = "preferred";
  basis.ma.middag = "available";
  basis.di.ochtend = "preferred";
  basis.di.middag = "preferred";
  basis.do.middag = "available";
  basis.do.avond = "available";
  basis.vr.ochtend = "available";
  return basis;
}

function demoRooster(): VacancySchedule {
  const basis = emptySchedule();
  basis.ma.ochtend = "required";
  basis.di.ochtend = "required";
  basis.di.middag = "preferred";
  basis.wo.ochtend = "preferred";
  basis.do.middag = "required";
  basis.vr.ochtend = "preferred";
  return basis;
}

function DemoBlok({
  titel,
  uitleg,
  children,
  className,
}: {
  titel: string;
  uitleg?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("glass-strong flex flex-col gap-4 rounded-kaart p-6", className)}>
      <h3 className="text-mw-kop-3 font-semibold">{titel}</h3>
      {children}
      {uitleg ? (
        <p className="text-xs leading-relaxed text-mw-text-muted">{uitleg}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------- export ------------------------------ */

export function PatronenDemo() {
  const [beschikbaarheid, setBeschikbaarheid] = useState(demoBeschikbaarheid);
  const [rooster, setRooster] = useState(demoRooster);
  const [containerBreedte, setContainerBreedte] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* werkweekgrid: interactieve modes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <DemoBlok
          titel="Werkweek — kandidaat (interactief)"
          uitleg="Klikken cyclet voorkeur → beschikbaar → niet beschikbaar. Lege cellen houden een zichtbare gestippelde celbegrenzing als affordance (audit-P1 #3); elke staat draagt icoon + tekst, nooit alleen kleur; de legenda staat vóór het grid."
        >
          <WeekGrid mode="candidate" value={beschikbaarheid} onChange={setBeschikbaarheid} />
        </DemoBlok>
        <DemoBlok
          titel="Werkweek — vacature (interactief)"
          uitleg="Zelfde grid, andere betekenislaag: nodig → gewenst → niet gevraagd. Gewenst gebruikt de roze tint met donkere roze tekst (AA)."
        >
          <WeekGrid mode="vacancy" value={rooster} onChange={setRooster} />
        </DemoBlok>
        <DemoBlok
          titel="Werkweek — alleen-lezen"
          uitleg="Weergavevariant zonder knoppen (role=img per cel), bijvoorbeeld in profielsamenvattingen."
        >
          <WeekGrid mode="readonly" value={demoBeschikbaarheid()} />
        </DemoBlok>
        <DemoBlok
          titel="Werkweek — overlay (kandidaat × vacature)"
          uitleg="De kern van de matchuitleg: match, gedeeltelijk of geen match per dagdeel. 'Geen match' gebruikt de error-statuskleur, bewust geen roze."
        >
          <WeekGrid
            mode="overlay"
            candidateAvailability={demoBeschikbaarheid()}
            vacancySchedule={demoRooster()}
          />
        </DemoBlok>
      </div>

      {/* responsive gedrag */}
      <DemoBlok
        titel="Responsive gedrag: het grid op smalle containers"
        uitleg="Onder 640px containerbreedte kantelt het grid: dagen worden rijen en de drie dagdelen kolommen, zodat elke cel de volle breedte benut en tap-targets ≥ 44px blijven — hetzelfde DOM, alleen CSS (container query op .wg-wrap in globals.css). Kies een breedte om het live te zien."
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-mw-text-muted">Containerbreedte:</span>
          {(
            [
              [null, "Vloeiend"],
              [360, "360px (mobiel)"],
              [600, "600px"],
              [900, "900px"],
            ] as const
          ).map(([breedte, naam]) => (
            <Button
              key={naam}
              size="sm"
              variant={containerBreedte === breedte ? "primary" : "secondary"}
              onClick={() => setContainerBreedte(breedte)}
            >
              {naam}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-kaart border border-dashed border-mw-border-strong bg-mw-canvas p-4">
          <div
            style={containerBreedte ? { maxWidth: containerBreedte } : undefined}
            className="mx-auto"
          >
            <WeekGrid mode="readonly" value={demoBeschikbaarheid()} />
          </div>
        </div>
      </DemoBlok>

      {/* dialog / drawer / tooltip */}
      <div className="grid gap-6 lg:grid-cols-3">
        <DialogDemo />
        <DrawerDemo />
        <TooltipDemo />
      </div>

      {/* charts + motion */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartsDemo />
        <MotionDemo />
      </div>
    </div>
  );
}

/* ------------------------------ dialoog ------------------------------ */

function DialogDemo() {
  const [open, setOpen] = useState(false);
  const sluitKnop = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) sluitKnop.current?.focus();
  }, [open]);

  return (
    <DemoBlok
      titel="Dialoog"
      uitleg="Frosted laag boven de content — de transparantie is uitlegbaar (de laag ligt letterlijk boven). Fade + 12px verplaatsing in --motion-slow; overlay op --z-overlay, paneel op --z-dialog. Escape of de overlay sluit."
    >
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open dialoog
        </Button>
      </div>
      {open ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: "var(--z-overlay)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="Dialoog sluiten"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/30 backdrop-blur-[8px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ds-dialog-titel"
            className="glass-strong relative w-full max-w-md rounded-kaart-lg p-8"
            style={{ zIndex: "var(--z-dialog)" }}
          >
            <h4 id="ds-dialog-titel" className="text-mw-kop-3 font-semibold text-ink">
              Sollicitatie versturen?
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-mw-text-muted">
              Je motivatie en werkweek worden gedeeld met de praktijk. Je kunt
              je sollicitatie daarna niet meer aanpassen.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button ref={sluitKnop} variant="ghost" onClick={() => setOpen(false)}>
                Annuleren
              </Button>
              <Button onClick={() => setOpen(false)}>Verstuur</Button>
            </div>
          </div>
        </div>
      ) : null}
    </DemoBlok>
  );
}

/* ------------------------------- drawer ------------------------------ */

function DrawerDemo() {
  const [open, setOpen] = useState(false);
  const sluitKnop = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) sluitKnop.current?.focus();
  }, [open]);

  return (
    <DemoBlok
      titel="Drawer / sheet"
      uitleg="Zijpaneel voor secundaire flows (filters, details). Zelfde laaglogica als de dialoog; schuift 16px + fade in --motion-slow met --ease-out."
    >
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open drawer
        </Button>
      </div>
      {open ? (
        <div
          className="fixed inset-0"
          style={{ zIndex: "var(--z-overlay)" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <button
            type="button"
            aria-label="Drawer sluiten"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/30 backdrop-blur-[8px]"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ds-drawer-titel"
            className="glass-strong absolute inset-y-0 right-0 flex w-full max-w-sm flex-col gap-4 rounded-l-kaart-lg p-8"
            style={{ zIndex: "var(--z-dialog)" }}
          >
            <div className="flex items-start justify-between gap-4">
              <h4 id="ds-drawer-titel" className="text-mw-kop-3 font-semibold text-ink">
                Filters
              </h4>
              <Button ref={sluitKnop} variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Sluiten
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-mw-text-muted">
              Drawer-inhoud: formulieren of detailinformatie. De achterliggende
              pagina blijft herkenbaar door de doorschijnende dim-laag.
            </p>
            <Card className="p-4">
              <p className="text-sm text-ink">Voorbeeldinhoud in de drawer.</p>
            </Card>
          </div>
        </div>
      ) : null}
    </DemoBlok>
  );
}

/* ------------------------------ tooltip ------------------------------ */

function TooltipDemo() {
  return (
    <DemoBlok
      titel="Tooltip"
      uitleg="CSS-only: zichtbaar bij hover én toetsenbordfocus, op --z-tooltip. Alleen voor korte verduidelijking — nooit voor essentiële informatie."
    >
      <div className="flex flex-wrap gap-6 py-4">
        {[
          ["Wat is een dagdeel?", "Ochtend, middag of avond — de kleinste roostereenheid."],
          ["Waarom deze score?", "De score telt vijf gewogen dimensies op."],
        ].map(([labelTekst, uitlegTekst]) => (
          <span key={labelTekst} className="group relative inline-flex">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-mw-border-strong bg-white px-4 text-sm font-medium text-ink hover:border-blauw-400"
            >
              {labelTekst}
              <span
                aria-hidden="true"
                className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-light text-[10px] font-bold text-blauw-700"
              >
                ?
              </span>
            </button>
            <span
              role="tooltip"
              style={{ zIndex: "var(--z-tooltip)" }}
              className={cx(
                "pointer-events-none absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-veld bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-(--shadow-mw-2)",
                "opacity-0 transition-opacity duration-(--motion-fast) motion-reduce:transition-none",
                "group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {uitlegTekst}
            </span>
          </span>
        ))}
      </div>
    </DemoBlok>
  );
}

/* ------------------------------- charts ------------------------------ */

const STAAFJES = [
  { naam: "Ma", waarde: 82, mens: false },
  { naam: "Di", waarde: 95, mens: true },
  { naam: "Wo", waarde: 41, mens: false },
  { naam: "Do", waarde: 68, mens: false },
  { naam: "Vr", waarde: 55, mens: false },
] as const;

function ChartsDemo() {
  return (
    <DemoBlok
      titel="Charts-specimen (pure CSS)"
      uitleg="Merkblauw is de datakleur; roze markeert het ene menselijke datapunt (voorkeur) — nooit meer dan één roze reeks. Elke grafiek beantwoordt één vraag; anders is het een getal met een label."
    >
      <figure>
        <figcaption className="mb-3 text-sm font-medium text-ink">
          Beschikbare kandidaten per dag (voorbeelddata)
        </figcaption>
        <div className="flex h-40 gap-4 border-b border-mw-border">
          {STAAFJES.map((s) => (
            <div key={s.naam} className="flex flex-1 flex-col items-center justify-end gap-2">
              <span className="text-xs font-semibold tabular-nums text-mw-text-muted">
                {s.waarde}
              </span>
              <div
                role="img"
                aria-label={`${s.naam}: ${s.waarde}${s.mens ? " (voorkeursdag)" : ""}`}
                className={cx(
                  "w-full max-w-12 rounded-t-md",
                  s.mens ? "bg-roze-400" : "bg-blauw-600",
                )}
                style={{ height: `${Math.round(s.waarde * 1.2)}px` }}
              />
            </div>
          ))}
        </div>
        <div className="flex gap-4">
          {STAAFJES.map((s) => (
            <span
              key={s.naam}
              className="flex-1 pt-1 text-center text-xs font-semibold text-ink"
            >
              {s.naam}
            </span>
          ))}
        </div>
      </figure>
    </DemoBlok>
  );
}

/* ------------------------------- motion ------------------------------ */

function MotionDemo() {
  const [reducedDemo, setReducedDemo] = useState(false);
  const [gespeeld, setGespeeld] = useState(0);

  return (
    <DemoBlok
      titel="Motion-specimen"
      uitleg="Verschijnen duurt langer dan verdwijnen; geen bounce, geen parallax, geen ambient-loops. Bij prefers-reduced-motion: reduce wordt alles een directe wissel of korte fade — volwaardig, niet uitgekleed. De toggle hieronder simuleert dat gedrag voor deze demo; het echte gedrag volgt je systeeminstelling (OS: 'beweging verminderen')."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setGespeeld((n) => n + 1)}>
          Speel overgangen af
        </Button>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={reducedDemo}
            onChange={(e) => setReducedDemo(e.target.checked)}
            className="h-4 w-4 accent-blauw-600"
          />
          Simuleer reduced motion
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["instant", "80 ms"],
          ["fast", "160 ms"],
          ["base", "240 ms"],
          ["slow", "400 ms"],
        ].map(([naam, duur]) => (
          <div
            key={naam}
            className="flex flex-col items-center gap-2 rounded-veld border border-mw-border bg-white p-4"
          >
            <div
              aria-hidden="true"
              key={`${naam}-${gespeeld}`}
              className="h-8 w-8 rounded-full bg-blauw-600"
              style={
                reducedDemo
                  ? undefined
                  : {
                      animation: gespeeld
                        ? `mz-motion-demo var(--motion-${naam}) var(--ease-out) both`
                        : undefined,
                    }
              }
            />
            <code className="text-[11px] text-blauw-700">--motion-{naam}</code>
            <span className="text-[11px] tabular-nums text-mw-text-muted">{duur}</span>
          </div>
        ))}
      </div>
      {/* lokale keyframes voor de demo — bewust simpel: opacity + scale */}
      <style>{`@keyframes mz-motion-demo { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }`}</style>
    </DemoBlok>
  );
}
