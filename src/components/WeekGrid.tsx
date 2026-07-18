"use client";

// WeekGrid — interactieve werkweek (7 dagen × 3 dagdelen) van Mondzorgwerkt.
//
// Wordt gebruikt in de kandidaat-onboarding (mode="candidate"), de
// vacaturewizard (mode="vacancy"), als weergave (mode="readonly") en in de
// Match Studio als overlay van kandidaat × vacature (mode="overlay").
//
// Toegankelijkheid:
// - elke cel is een <button> met aria-pressed en een volledige Nederlandse
//   aria-label ("Dinsdag ochtend: voorkeur");
// - een staat wordt nooit alléén met kleur getoond: altijd icoon + tekst;
// - tap-targets zijn minimaal 48px hoog; tab-volgorde volgt de leesrichting.

import type { ReactElement } from "react";
import { cx } from "@/components/ui";
import {
  DAYPARTS,
  WEEKDAYS,
  label,
  type AvailabilityLevel,
  type CandidateAvailability,
  type Daypart,
  type ScheduleRequirement,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";

/* ------------------------------- props ------------------------------- */

interface BasisProps {
  compact?: boolean;
  className?: string;
}

export type WeekGridProps = BasisProps &
  (
    | {
        mode: "candidate";
        value: CandidateAvailability;
        onChange: (waarde: CandidateAvailability) => void;
      }
    | {
        mode: "vacancy";
        value: VacancySchedule;
        onChange: (waarde: VacancySchedule) => void;
      }
    | {
        mode: "readonly";
        value: CandidateAvailability | VacancySchedule;
        /** Bepaalt hoe de waarden gelezen worden; default "candidate". */
        variant?: "candidate" | "vacancy";
      }
    | {
        mode: "overlay";
        candidateAvailability: CandidateAvailability;
        vacancySchedule: VacancySchedule;
      }
  );

/* ------------------------------ iconen ------------------------------- */

type IcoonProps = { className?: string };

function SterIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path
        d="M8 1.8l1.86 3.77 4.16.6-3.01 2.94.71 4.14L8 11.29l-3.72 1.96.71-4.14-3.01-2.94 4.16-.6L8 1.8z"
        fill="currentColor"
      />
    </svg>
  );
}

function VinkIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StreepIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SlotIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function KruisIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function HalfIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </svg>
  );
}

/* --------------------------- celdefinities --------------------------- */

interface CelStijl {
  tekst: string;
  /** Tekst voor de aria-label (kleine letters). */
  aria: string;
  icoon: (props: IcoonProps) => ReactElement;
  klasse: string;
}

const KANDIDAAT_STATEN: Record<AvailabilityLevel, CelStijl> = {
  preferred: {
    tekst: "Voorkeur",
    aria: "voorkeur",
    icoon: SterIcoon,
    klasse:
      "border-transparent bg-blauw-600 text-white shadow-(--shadow-knop-blauw)",
  },
  available: {
    tekst: "Beschikbaar",
    aria: "beschikbaar",
    icoon: VinkIcoon,
    klasse: "border-blauw-200 bg-brand-light text-blauw-900",
  },
  unavailable: {
    tekst: "",
    aria: "niet beschikbaar",
    icoon: StreepIcoon,
    klasse: "border-white/70 bg-white/45 text-ink/45",
  },
};

const VACATURE_STATEN: Record<"required" | "preferred" | "leeg", CelStijl> = {
  required: {
    tekst: "Nodig",
    aria: "nodig",
    icoon: SlotIcoon,
    klasse:
      "border-transparent bg-blauw-600 text-white shadow-(--shadow-knop-blauw)",
  },
  preferred: {
    tekst: "Gewenst",
    aria: "gewenst",
    icoon: SterIcoon,
    klasse: "border-roze-200 bg-roze-100 text-roze-800",
  },
  leeg: {
    tekst: "",
    aria: "niet gevraagd",
    icoon: StreepIcoon,
    klasse: "border-white/70 bg-white/45 text-ink/45",
  },
};

type OverlayStaat = "match" | "deels" | "mismatch" | "nietGevraagd";

const OVERLAY_STATEN: Record<OverlayStaat, CelStijl> = {
  match: {
    tekst: "Match",
    aria: "match",
    icoon: VinkIcoon,
    klasse: "border-transparent bg-blauw-600 text-white",
  },
  deels: {
    tekst: "Deels",
    aria: "gedeeltelijke match",
    icoon: HalfIcoon,
    klasse: "border-roze-200 bg-roze-100 text-roze-800",
  },
  mismatch: {
    tekst: "Mis",
    aria: "geen match",
    icoon: KruisIcoon,
    klasse: "border-red-200 bg-red-50 text-red-700",
  },
  nietGevraagd: {
    tekst: "",
    aria: "niet gevraagd",
    icoon: StreepIcoon,
    klasse: "border-white/60 bg-white/35 text-ink/35",
  },
};

/** Overlaylogica: mismatch alleen als "nodig" niet gedekt is; "gewenst"
 * zonder beschikbaarheid telt als gedeeltelijk. */
function overlayStaat(
  beschikbaarheid: AvailabilityLevel,
  eis: ScheduleRequirement,
): OverlayStaat {
  if (eis === null) return "nietGevraagd";
  if (beschikbaarheid !== "unavailable") return "match";
  return eis === "required" ? "mismatch" : "deels";
}

/* ------------------------------ cycli -------------------------------- */

function volgendeBeschikbaarheid(niveau: AvailabilityLevel): AvailabilityLevel {
  if (niveau === "preferred") return "available";
  if (niveau === "available") return "unavailable";
  return "preferred";
}

function volgendeEis(eis: ScheduleRequirement): ScheduleRequirement {
  if (eis === "required") return "preferred";
  if (eis === "preferred") return null;
  return "required";
}

/* ----------------------------- component ----------------------------- */

const WEEKEND: ReadonlySet<Weekday> = new Set(["za", "zo"]);

export function WeekGrid(props: WeekGridProps) {
  const { compact = false, className } = props;

  const celStijl = (dag: Weekday, deel: Daypart): CelStijl => {
    switch (props.mode) {
      case "candidate":
        return KANDIDAAT_STATEN[props.value[dag][deel]];
      case "vacancy":
        return VACATURE_STATEN[props.value[dag][deel] ?? "leeg"];
      case "readonly": {
        if (props.variant === "vacancy") {
          const waarde = (props.value as VacancySchedule)[dag][deel];
          return VACATURE_STATEN[waarde ?? "leeg"];
        }
        const waarde = (props.value as CandidateAvailability)[dag][deel];
        return KANDIDAAT_STATEN[waarde];
      }
      case "overlay":
        return OVERLAY_STATEN[
          overlayStaat(
            props.candidateAvailability[dag][deel],
            props.vacancySchedule[dag][deel],
          )
        ];
    }
  };

  const klikCel = (dag: Weekday, deel: Daypart): void => {
    if (props.mode === "candidate") {
      const volgend = volgendeBeschikbaarheid(props.value[dag][deel]);
      props.onChange({
        ...props.value,
        [dag]: { ...props.value[dag], [deel]: volgend },
      });
    } else if (props.mode === "vacancy") {
      const volgend = volgendeEis(props.value[dag][deel]);
      props.onChange({
        ...props.value,
        [dag]: { ...props.value[dag], [deel]: volgend },
      });
    }
  };

  const interactief = props.mode === "candidate" || props.mode === "vacancy";

  const celBasis = cx(
    "flex w-full items-center justify-center gap-1.5 rounded-xl border backdrop-blur-sm",
    "transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none",
    compact ? "min-h-10 px-1 py-1" : "min-h-12 px-1.5 py-2",
  );

  return (
    <div
      role="group"
      aria-label="Werkweek: dagen en dagdelen"
      className={cx("w-full", className)}
    >
      <div
        className={cx(
          "grid gap-1.5",
          "grid-cols-[auto_repeat(7,minmax(0,1fr))]",
        )}
      >
        {/* kopregel */}
        <div aria-hidden="true" />
        {WEEKDAYS.map((dag) => (
          <div
            key={dag}
            className={cx(
              "pb-1 text-center text-xs font-semibold",
              WEEKEND.has(dag) ? "text-ink/60" : "text-ink",
            )}
          >
            <span className="hidden lg:inline">{label(dag)}</span>
            <span aria-hidden="true" className="capitalize lg:hidden">
              {dag}
            </span>
          </div>
        ))}

        {/* rijen per dagdeel */}
        {DAYPARTS.map((deel) => (
          <RijVoorDagdeel
            key={deel}
            deel={deel}
            compact={compact}
            interactief={interactief}
            celBasis={celBasis}
            celStijl={celStijl}
            klikCel={klikCel}
          />
        ))}
      </div>

      {!compact ? <Legenda mode={props.mode} /> : null}
    </div>
  );
}

interface RijProps {
  deel: Daypart;
  compact: boolean;
  interactief: boolean;
  celBasis: string;
  celStijl: (dag: Weekday, deel: Daypart) => CelStijl;
  klikCel: (dag: Weekday, deel: Daypart) => void;
}

function RijVoorDagdeel({
  deel,
  compact,
  interactief,
  celBasis,
  celStijl,
  klikCel,
}: RijProps) {
  return (
    <>
      <div
        className={cx(
          "flex items-center pr-2 text-xs font-semibold text-ink/70",
          compact ? "min-h-10" : "min-h-12",
        )}
      >
        {label(deel)}
      </div>
      {WEEKDAYS.map((dag) => {
        const stijl = celStijl(dag, deel);
        const Icoon = stijl.icoon;
        const ariaLabel = `${label(dag)} ${deel}: ${stijl.aria}`;
        const inhoud = (
          <>
            <Icoon />
            {!compact && stijl.tekst ? (
              <span className="hidden text-[11px] font-semibold xl:inline">
                {stijl.tekst}
              </span>
            ) : null}
          </>
        );

        if (!interactief) {
          return (
            <div
              key={dag}
              role="img"
              aria-label={ariaLabel}
              className={cx(
                celBasis,
                stijl.klasse,
                WEEKEND.has(dag) && "opacity-80",
              )}
            >
              {inhoud}
            </div>
          );
        }

        const geselecteerd = stijl.aria !== "niet beschikbaar" && stijl.aria !== "niet gevraagd";
        return (
          <button
            key={dag}
            type="button"
            aria-pressed={geselecteerd}
            aria-label={ariaLabel}
            onClick={() => klikCel(dag, deel)}
            className={cx(
              celBasis,
              "cursor-pointer",
              stijl.klasse,
              WEEKEND.has(dag) && "opacity-80 hover:opacity-100",
              "motion-safe:active:scale-95",
            )}
          >
            {inhoud}
          </button>
        );
      })}
    </>
  );
}

/* ------------------------------ legenda ------------------------------ */

function Legenda({ mode }: { mode: WeekGridProps["mode"] }) {
  const items: Array<{ icoon: (p: IcoonProps) => ReactElement; tekst: string; klasse: string }> =
    mode === "vacancy"
      ? [
          { icoon: SlotIcoon, tekst: "Nodig", klasse: "bg-blauw-600 text-white" },
          { icoon: SterIcoon, tekst: "Gewenst", klasse: "bg-roze-100 text-roze-800" },
          { icoon: StreepIcoon, tekst: "Niet gevraagd", klasse: "bg-white/60 text-ink/60" },
        ]
      : mode === "overlay"
        ? [
            { icoon: VinkIcoon, tekst: "Match", klasse: "bg-blauw-600 text-white" },
            { icoon: HalfIcoon, tekst: "Gedeeltelijk", klasse: "bg-roze-100 text-roze-800" },
            { icoon: KruisIcoon, tekst: "Geen match", klasse: "bg-red-50 text-red-700" },
          ]
        : [
            { icoon: SterIcoon, tekst: "Voorkeur", klasse: "bg-blauw-600 text-white" },
            { icoon: VinkIcoon, tekst: "Beschikbaar", klasse: "bg-brand-light text-blauw-900" },
            { icoon: StreepIcoon, tekst: "Niet beschikbaar", klasse: "bg-white/60 text-ink/60" },
          ];

  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map(({ icoon: Icoon, tekst, klasse }) => (
        <li key={tekst} className="flex items-center gap-1.5 text-xs font-medium text-ink/80">
          <span
            aria-hidden="true"
            className={cx(
              "flex h-5 w-5 items-center justify-center rounded-md",
              klasse,
            )}
          >
            <Icoon className="h-3 w-3" />
          </span>
          {tekst}
        </li>
      ))}
    </ul>
  );
}

export default WeekGrid;
