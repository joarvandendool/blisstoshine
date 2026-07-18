"use client";

// Praktijkbezetting — clientkant. Bovenaan de visuele week (7 kolommen ×
// 3 dagdelen) met per cel kleur ÉN icoon per status (nooit alleen kleur):
// volledig ✓, gedeeltelijk ◐, open ○ (met kandidaten-teller), tekort
// verwacht ⚠ (met datum). Daaronder het gewenste minimum, het paneel bij een
// aangeklikt gat (passende kandidaten bekijken of een personeelsbehoefte
// samenstellen uit meerdere gaten) en de teamsectie met kaarten en een
// formulier in een modal/sheet.
//
// Mobile-first: de weekcellen zijn tap-targets van minimaal 48px, het
// formulier is een schuifpaneel dat op kleine schermen de volle breedte pakt.

import { useMemo, useState, useTransition, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SectionHeading,
  Select,
  cx,
} from "@/components/ui";
import {
  DAYPARTS,
  ROLES,
  WEEKDAYS,
  label,
  type Daypart,
  type Weekday,
} from "@/domain/taxonomy";
import type { CapacityStatus, StaffingTarget, TeamSchedule } from "@/server/capacity";
import {
  bewaarMinimumAction,
  bewaarTeamlidAction,
  maakPersoneelsbehoefteAction,
  verwijderTeamlidAction,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Props (geserialiseerd door page.tsx)                                */
/* ------------------------------------------------------------------ */

export interface BezettingLocatie {
  id: string;
  name: string;
  city: string;
}

export interface BezettingCel {
  day: Weekday;
  daypart: Daypart;
  present: number;
  target: number;
  status: CapacityStatus;
  /** ISO-datum van het eerste verwachte tekort (alleen bij tekort_verwacht). */
  shortageExpectedOn: string | null;
  /** Eligible kandidaten voor dit gat; null = n.v.t. of onder de privacydrempel. */
  availableCandidates: number | null;
}

export interface BezettingTeamlid {
  id: string;
  name: string;
  role: string;
  schedule: TeamSchedule;
  absentFrom: string | null; // ISO
  absentUntil: string | null; // ISO
  note: string | null;
}

export interface BezettingVacature {
  id: string;
  title: string;
  role: string;
  status: string;
}

export interface BezettingClientProps {
  slug: string;
  locaties: BezettingLocatie[];
  locatie: BezettingLocatie;
  /** ISO-datum van de maandag van de getoonde week. */
  weekStart: string;
  candidateRole: string;
  cells: BezettingCel[];
  target: StaffingTarget;
  minGroupSize: number;
  teamleden: BezettingTeamlid[];
  /** Concept- en gepubliceerde vacatures van deze locatie (voor de Match Studio-link). */
  vacatures: BezettingVacature[];
}

/* ------------------------------------------------------------------ */
/* Iconen (decoratief — betekenis zit in tekst en aria-labels)         */
/* ------------------------------------------------------------------ */

type IcoonProps = { className?: string };

function VinkIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

function CirkelIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2.4" />
    </svg>
  );
}

function WaarschuwingIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M8 2.2 14.6 13.4H1.4L8 2.2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 6.4v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" />
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

function KruisIcoon({ className }: IcoonProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Statusdefinities                                                    */
/* ------------------------------------------------------------------ */

interface StatusStijl {
  tekst: string;
  aria: string;
  icoon: (props: IcoonProps) => ReactElement;
  klasse: string;
  legenda: string;
}

const STATUS_STIJLEN: Record<CapacityStatus, StatusStijl> = {
  volledig: {
    tekst: "Volledig",
    aria: "volledig bezet",
    icoon: VinkIcoon,
    klasse: "border-emerald-200 bg-emerald-50 text-emerald-900",
    legenda: "Volledig bezet",
  },
  gedeeltelijk: {
    tekst: "Gedeeltelijk",
    aria: "gedeeltelijk bezet",
    icoon: HalfIcoon,
    klasse: "border-roze-200 bg-roze-100 text-roze-800",
    legenda: "Gedeeltelijk bezet",
  },
  open: {
    tekst: "Open",
    aria: "open — niemand ingepland",
    icoon: CirkelIcoon,
    klasse: "border-2 border-dashed border-ink/30 bg-white/60 text-ink/80",
    legenda: "Open dagdeel",
  },
  tekort_verwacht: {
    tekst: "Tekort verwacht",
    aria: "tekort verwacht door geplande afwezigheid",
    icoon: WaarschuwingIcoon,
    klasse: "border-amber-300 bg-amber-50 text-amber-900",
    legenda: "Tekort verwacht (binnen 4 weken)",
  },
};

const ONDERBEZET: ReadonlySet<CapacityStatus> = new Set([
  "open",
  "gedeeltelijk",
  "tekort_verwacht",
]);

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function celSleutel(day: Weekday, daypart: Daypart): string {
  return `${day}:${daypart}`;
}

function datumTekst(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "long" });
}

function korteDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function leegTeamRooster(): TeamSchedule {
  const uit = {} as TeamSchedule;
  for (const dag of WEEKDAYS) {
    uit[dag] = { ochtend: false, middag: false, avond: false };
  }
  return uit;
}

/** ISO-timestamp → "YYYY-MM-DD" voor een date-input. */
function naarDatumVeld(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function kandidatenTekst(aantal: number | null, minGroupSize: number): string {
  if (aantal === null) {
    return `Minder dan ${minGroupSize} passende kandidaten — uit privacyoverwegingen tonen we dan geen exact aantal.`;
  }
  return `${aantal} ${aantal === 1 ? "kandidaat" : "kandidaten"} beschikbaar`;
}

/* ------------------------------------------------------------------ */
/* Hoofdcomponent                                                      */
/* ------------------------------------------------------------------ */

export function BezettingClient({
  slug,
  locaties,
  locatie,
  weekStart,
  candidateRole,
  cells,
  target,
  minGroupSize,
  teamleden,
  vacatures,
}: BezettingClientProps) {
  const router = useRouter();
  const basis = `/praktijk/${slug}`;

  const celMap = useMemo(() => {
    const map = new Map<string, BezettingCel>();
    for (const cel of cells) map.set(celSleutel(cel.day, cel.daypart), cel);
    return map;
  }, [cells]);

  // Paneel en selectiemodus voor de personeelsbehoefte.
  const [openCel, setOpenCel] = useState<string | null>(null);
  const [selectiemodus, setSelectiemodus] = useState(false);
  const [selectie, setSelectie] = useState<ReadonlySet<string>>(new Set());
  const [behoefteRol, setBehoefteRol] = useState<string>(
    (ROLES as readonly string[]).includes(candidateRole) ? candidateRole : ROLES[0],
  );
  const [behoefteFout, setBehoefteFout] = useState<string | null>(null);
  const [succes, setSucces] = useState<{ vacancyId: string; titel: string } | null>(null);
  const [bezig, startTransition] = useTransition();

  // Teamformulier (modal/sheet).
  const [formulier, setFormulier] = useState<
    | { open: false }
    | { open: true; teamlid: BezettingTeamlid | null }
  >({ open: false });

  const geselecteerdeCel = openCel ? (celMap.get(openCel) ?? null) : null;

  const klikCel = (cel: BezettingCel): void => {
    const sleutel = celSleutel(cel.day, cel.daypart);
    if (selectiemodus) {
      if (!ONDERBEZET.has(cel.status)) return;
      setSelectie((huidig) => {
        const volgend = new Set(huidig);
        if (volgend.has(sleutel)) volgend.delete(sleutel);
        else volgend.add(sleutel);
        return volgend;
      });
      return;
    }
    setOpenCel((huidig) => (huidig === sleutel ? null : sleutel));
  };

  const startSelectie = (): void => {
    setSelectiemodus(true);
    setBehoefteFout(null);
    setSucces(null);
    setSelectie(new Set(openCel ? [openCel] : []));
    setOpenCel(null);
  };

  const stopSelectie = (): void => {
    setSelectiemodus(false);
    setSelectie(new Set());
    setBehoefteFout(null);
  };

  const maakConcept = (): void => {
    const gaps = [...selectie].map((sleutel) => {
      const [day, daypart] = sleutel.split(":");
      return { day, daypart };
    });
    startTransition(async () => {
      const res = await maakPersoneelsbehoefteAction(slug, {
        locationId: locatie.id,
        role: behoefteRol,
        gaps,
      });
      if (!res.ok) {
        setBehoefteFout(res.fout);
        return;
      }
      // Succesmelding + concept: de vacature staat als concept klaar en is
      // direct te verfijnen in de Match Studio.
      setSucces({ vacancyId: res.vacancyId, titel: res.titel });
      stopSelectie();
      router.refresh();
    });
  };

  const passendeVacature =
    vacatures.find((v) => v.role === behoefteRol && v.status === "published") ??
    vacatures.find((v) => v.role === behoefteRol) ??
    null;

  return (
    <div className="flex flex-col gap-10">
      {/* locatiekeuze bij meerdere locaties */}
      {locaties.length > 1 ? (
        <Card className="flex flex-col gap-2 sm:max-w-md">
          <Field label="Locatie" htmlFor="bezetting-locatie">
            <Select
              id="bezetting-locatie"
              value={locatie.id}
              onChange={(e) => router.push(`${basis}/bezetting?locatie=${e.target.value}`)}
            >
              {locaties.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.city}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      ) : null}

      {/* succesmelding na personeelsbehoefte → concept */}
      {succes ? (
        <Card
          strong
          role="status"
          className="flex flex-col gap-3 border border-emerald-200 bg-emerald-50/80"
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white"
            >
              <VinkIcoon />
            </span>
            <h3 className="text-base font-semibold text-ink">
              Conceptvacature aangemaakt: “{succes.titel}”
            </h3>
          </div>
          <p className="text-sm leading-relaxed text-ink/70">
            De geselecteerde dagdelen staan als verplicht in het rooster van het
            concept. Werk het verder uit en publiceer wanneer je klaar bent.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`${basis}/vacatures/${succes.vacancyId}/studio`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-sm font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Werk het concept uit in de Match Studio
            </Link>
            <Link
              href={basis}
              className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
            >
              Naar het dashboard
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setSucces(null)}>
              Sluiten
            </Button>
          </div>
        </Card>
      ) : null}

      {/* visuele week */}
      <section aria-labelledby="week-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Deze week"
          title="Bezetting in de week van"
          accent={datumTekst(weekStart)}
          description={
            selectiemodus
              ? "Selectiemodus: tik de open of onderbezette dagdelen aan die je in de personeelsbehoefte wilt opnemen."
              : "Tik op een dagdeel met een gat voor kandidaten en acties."
          }
        />
        <h2 id="week-titel" className="sr-only">
          Bezettingsstatus per weekdag en dagdeel
        </h2>

        <Card strong className="flex flex-col gap-4">
          <WeekRooster
            celMap={celMap}
            selectiemodus={selectiemodus}
            selectie={selectie}
            openCel={openCel}
            onKlik={klikCel}
          />
          <Legenda />
        </Card>

        {/* selectiebalk personeelsbehoefte */}
        {selectiemodus ? (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Functie" htmlFor="behoefte-rol" className="w-full sm:w-64">
                <Select
                  id="behoefte-rol"
                  value={behoefteRol}
                  onChange={(e) => setBehoefteRol(e.target.value)}
                >
                  {ROLES.map((rol) => (
                    <option key={rol} value={rol}>
                      {label(rol)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex flex-wrap items-center gap-3 pb-1">
                <Button onClick={maakConcept} disabled={bezig || selectie.size === 0}>
                  {bezig
                    ? "Bezig met aanmaken …"
                    : `Maak conceptvacature (${selectie.size} ${
                        selectie.size === 1 ? "dagdeel" : "dagdelen"
                      })`}
                </Button>
                <Button variant="ghost" onClick={stopSelectie} disabled={bezig}>
                  Annuleer
                </Button>
              </div>
            </div>
            {behoefteFout ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                {behoefteFout}
              </p>
            ) : null}
            <p className="text-sm text-ink/60">
              Geselecteerde dagdelen komen als <strong>verplicht</strong> in het
              vacatuurrooster; je kunt alles daarna nog aanpassen.
            </p>
          </Card>
        ) : null}

        {/* paneel bij een aangeklikt dagdeel */}
        {geselecteerdeCel && !selectiemodus ? (
          <CelPaneel
            basis={basis}
            cel={geselecteerdeCel}
            minGroupSize={minGroupSize}
            candidateRole={candidateRole}
            passendeVacature={passendeVacature}
            onSelectieStart={startSelectie}
            onSluit={() => setOpenCel(null)}
          />
        ) : null}
      </section>

      {/* gewenst minimum */}
      <MinimumFormulier slug={slug} locationId={locatie.id} target={target} />

      {/* teamsectie */}
      <section aria-labelledby="team-titel" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionHeading
            eyebrow="Team"
            title="Teamleden van"
            accent={locatie.name}
            description="Vaste werkdagen en geplande afwezigheid bepalen samen de bezetting hierboven."
          />
          <Button onClick={() => setFormulier({ open: true, teamlid: null })}>
            Teamlid toevoegen
          </Button>
        </div>
        <h2 id="team-titel" className="sr-only">
          Teamleden en hun roosters
        </h2>

        {teamleden.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
                <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
            title="Nog geen teamleden"
            description="Voeg je huidige team toe met hun vaste werkdagen — de bezettingsweek laat dan direct zien waar de gaten vallen."
            action={
              <Button onClick={() => setFormulier({ open: true, teamlid: null })}>
                Voeg je eerste teamlid toe
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {teamleden.map((teamlid) => (
              <li key={teamlid.id}>
                <TeamlidKaart
                  slug={slug}
                  teamlid={teamlid}
                  onBewerk={() => setFormulier({ open: true, teamlid })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* privacyvoetnoot */}
      <p className="text-sm leading-relaxed text-ink/60">
        Privacy: kandidaat-tellingen zijn geaggregeerd. Groepen kleiner dan{" "}
        {minGroupSize} kandidaten worden nooit als exact aantal getoond.
      </p>

      {/* modal/sheet: teamlid toevoegen of bewerken */}
      {formulier.open ? (
        <TeamlidFormulier
          slug={slug}
          locationId={locatie.id}
          teamlid={formulier.teamlid}
          onSluit={() => setFormulier({ open: false })}
          onKlaar={() => {
            setFormulier({ open: false });
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Weekrooster (7 kolommen × 3 dagdelen)                               */
/* ------------------------------------------------------------------ */

function WeekRooster({
  celMap,
  selectiemodus,
  selectie,
  openCel,
  onKlik,
}: {
  celMap: Map<string, BezettingCel>;
  selectiemodus: boolean;
  selectie: ReadonlySet<string>;
  openCel: string | null;
  onKlik: (cel: BezettingCel) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Bezetting per weekdag en dagdeel"
      className="grid gap-1.5 grid-cols-[auto_repeat(7,minmax(0,1fr))]"
    >
      <div aria-hidden="true" />
      {WEEKDAYS.map((dag) => (
        <div key={dag} className="pb-1 text-center text-xs font-semibold text-ink">
          <span className="hidden lg:inline">{label(dag)}</span>
          <span aria-hidden="true" className="capitalize lg:hidden">
            {dag}
          </span>
        </div>
      ))}

      {DAYPARTS.map((dagdeel) => (
        <RoosterRij
          key={dagdeel}
          dagdeel={dagdeel}
          celMap={celMap}
          selectiemodus={selectiemodus}
          selectie={selectie}
          openCel={openCel}
          onKlik={onKlik}
        />
      ))}
    </div>
  );
}

function RoosterRij({
  dagdeel,
  celMap,
  selectiemodus,
  selectie,
  openCel,
  onKlik,
}: {
  dagdeel: Daypart;
  celMap: Map<string, BezettingCel>;
  selectiemodus: boolean;
  selectie: ReadonlySet<string>;
  openCel: string | null;
  onKlik: (cel: BezettingCel) => void;
}) {
  return (
    <>
      <div className="flex min-h-12 items-center pr-2 text-xs font-semibold text-ink/70">
        {label(dagdeel)}
      </div>
      {WEEKDAYS.map((dag) => {
        const cel = celMap.get(celSleutel(dag, dagdeel));
        if (!cel) return <div key={dag} />;

        // Cel zonder gewenste bezetting en zonder ingepland team: neutraal.
        const nietVanToepassing = cel.target === 0 && cel.present === 0;
        if (nietVanToepassing) {
          return (
            <div
              key={dag}
              role="img"
              aria-label={`${label(dag)} ${dagdeel}: geen bezetting nodig`}
              className="flex min-h-12 w-full items-center justify-center rounded-xl border border-white/70 bg-white/40 text-ink/40"
            >
              <StreepIcoon />
            </div>
          );
        }

        const stijl = STATUS_STIJLEN[cel.status];
        const Icoon = stijl.icoon;
        const sleutel = celSleutel(dag, dagdeel);
        const isGeselecteerd = selectie.has(sleutel);
        const isOpenPaneel = openCel === sleutel;
        const selecteerbaar = !selectiemodus || ONDERBEZET.has(cel.status);

        const ariaDelen = [
          `${label(dag)} ${dagdeel}: ${stijl.aria}`,
          `${cel.present} van ${cel.target} aanwezig`,
        ];
        if (cel.status === "tekort_verwacht" && cel.shortageExpectedOn) {
          ariaDelen.push(`tekort vanaf ${datumTekst(cel.shortageExpectedOn)}`);
        }
        if (cel.availableCandidates !== null) {
          ariaDelen.push(`${cel.availableCandidates} kandidaten beschikbaar`);
        }
        if (selectiemodus) {
          ariaDelen.push(isGeselecteerd ? "geselecteerd" : "niet geselecteerd");
        }

        return (
          <button
            key={dag}
            type="button"
            aria-pressed={selectiemodus ? isGeselecteerd : isOpenPaneel}
            aria-label={ariaDelen.join(", ")}
            disabled={!selecteerbaar}
            onClick={() => onKlik(cel)}
            className={cx(
              "flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 backdrop-blur-sm",
              "transition-[background-color,color,box-shadow] duration-150 motion-reduce:transition-none",
              "cursor-pointer motion-safe:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
              stijl.klasse,
              // Geselecteerd/paneel-open: ring + vinkje — nooit alleen kleur.
              (isGeselecteerd || isOpenPaneel) && "ring-2 ring-blauw-600 ring-offset-1",
            )}
          >
            <span className="flex items-center gap-1">
              {isGeselecteerd ? <VinkIcoon className="text-blauw-700" /> : <Icoon />}
              <span className="hidden text-[10px] font-semibold xl:inline">
                {isGeselecteerd ? "Gekozen" : stijl.tekst}
              </span>
            </span>
            <span className="text-[10px] font-semibold tabular-nums">
              {cel.present}/{cel.target}
            </span>
            {cel.status === "tekort_verwacht" && cel.shortageExpectedOn ? (
              <span className="hidden text-[9px] font-medium lg:inline">
                vanaf {korteDatum(cel.shortageExpectedOn)}
              </span>
            ) : null}
            {cel.status === "open" && cel.availableCandidates !== null ? (
              <span className="hidden text-[9px] font-medium lg:inline">
                {cel.availableCandidates} kandidaten
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}

function Legenda() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {(Object.keys(STATUS_STIJLEN) as CapacityStatus[]).map((status) => {
        const stijl = STATUS_STIJLEN[status];
        const Icoon = stijl.icoon;
        return (
          <li key={status} className="flex items-center gap-1.5 text-xs font-medium text-ink/80">
            <span
              aria-hidden="true"
              className={cx("flex h-5 w-5 items-center justify-center rounded-md border", stijl.klasse)}
            >
              <Icoon className="h-3 w-3" />
            </span>
            {stijl.legenda}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5 text-xs font-medium text-ink/80">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-md border border-white/70 bg-white/40 text-ink/40"
        >
          <StreepIcoon className="h-3 w-3" />
        </span>
        Geen bezetting nodig
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Paneel bij een aangeklikt dagdeel                                   */
/* ------------------------------------------------------------------ */

function CelPaneel({
  basis,
  cel,
  minGroupSize,
  candidateRole,
  passendeVacature,
  onSelectieStart,
  onSluit,
}: {
  basis: string;
  cel: BezettingCel;
  minGroupSize: number;
  candidateRole: string;
  passendeVacature: BezettingVacature | null;
  onSelectieStart: () => void;
  onSluit: () => void;
}) {
  const stijl = STATUS_STIJLEN[cel.status];
  const Icoon = stijl.icoon;
  const onderbezet = ONDERBEZET.has(cel.status);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-7 w-7 items-center justify-center rounded-full border",
                stijl.klasse,
              )}
            >
              <Icoon />
            </span>
            <h3 className="text-lg font-semibold text-ink">
              {label(cel.day)} · {label(cel.daypart).toLowerCase()}
            </h3>
            <Badge tone={cel.status === "volledig" ? "blauw" : "roze"}>{stijl.tekst}</Badge>
          </div>
          <p className="text-sm text-ink/70">
            {cel.present} van de gewenste {cel.target}{" "}
            {cel.target === 1 ? "teamlid" : "teamleden"} aanwezig
            {cel.status === "tekort_verwacht" && cel.shortageExpectedOn
              ? ` — tekort verwacht vanaf ${datumTekst(cel.shortageExpectedOn)} door geplande afwezigheid`
              : ""}
            .
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSluit} aria-label="Paneel sluiten">
          <KruisIcoon />
          <span>Sluiten</span>
        </Button>
      </div>

      {onderbezet ? (
        <>
          <div className="flex flex-col gap-1 rounded-2xl bg-brand-light/40 p-4">
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blauw-700">
              Passende kandidaten ({label(candidateRole).toLowerCase()})
            </span>
            <p className="text-[15px] font-semibold text-ink">
              {kandidatenTekst(cel.availableCandidates, minGroupSize)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {passendeVacature ? (
              <Link
                href={`${basis}/vacatures/${passendeVacature.id}/studio`}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-sm font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
              >
                Bekijk passende kandidaten
              </Link>
            ) : null}
            <Button
              variant={passendeVacature ? "secondary" : "primary"}
              onClick={onSelectieStart}
            >
              Maak personeelsbehoefte
            </Button>
          </div>
          {passendeVacature ? (
            <p className="text-sm text-ink/60">
              “Bekijk passende kandidaten” opent de Match Studio van{" "}
              <strong className="font-semibold text-ink">{passendeVacature.title}</strong>.
            </p>
          ) : (
            <p className="text-sm text-ink/60">
              Er is nog geen vacature voor deze functie op deze locatie — maak
              een personeelsbehoefte om met een concept te starten.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-ink/70">
          Dit dagdeel is volledig bezet — geen actie nodig.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Gewenst minimum                                                     */
/* ------------------------------------------------------------------ */

const WERKDAGEN: readonly Weekday[] = ["ma", "di", "wo", "do", "vr"];

function MinimumFormulier({
  slug,
  locationId,
  target,
}: {
  slug: string;
  locationId: string;
  target: StaffingTarget;
}) {
  const router = useRouter();
  const [bezig, startTransition] = useTransition();
  const [fout, setFout] = useState<string | null>(null);
  const [opgeslagen, setOpgeslagen] = useState(false);
  // Startwaarden: het huidige minimum van de maandag (representatief voor
  // ma–vr; het formulier schrijft naar alle werkdagen tegelijk).
  const [waarden, setWaarden] = useState<Record<Daypart, string>>({
    ochtend: String(target.ma.ochtend),
    middag: String(target.ma.middag),
    avond: String(target.ma.avond),
  });

  const opslaan = (): void => {
    setFout(null);
    setOpgeslagen(false);
    const aantallen = {} as Record<Daypart, number>;
    for (const dagdeel of DAYPARTS) {
      const aantal = Number.parseInt(waarden[dagdeel], 10);
      if (!Number.isInteger(aantal) || aantal < 0 || aantal > 99) {
        setFout("Vul per dagdeel een aantal tussen 0 en 99 in");
        return;
      }
      aantallen[dagdeel] = aantal;
    }
    const nieuw = structuredClone(target) as StaffingTarget;
    for (const dag of WERKDAGEN) {
      for (const dagdeel of DAYPARTS) nieuw[dag][dagdeel] = aantallen[dagdeel];
    }
    startTransition(async () => {
      const res = await bewaarMinimumAction(slug, { locationId, target: nieuw });
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      setOpgeslagen(true);
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="minimum-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Gewenst minimum"
        title="Hoeveel teamleden wil je"
        accent="per dagdeel?"
        description="Het standaard minimum geldt voor maandag t/m vrijdag; weekenddagen blijven zoals ze zijn."
      />
      <h2 id="minimum-titel" className="sr-only">
        Gewenste minimumbezetting per dagdeel
      </h2>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          {DAYPARTS.map((dagdeel) => (
            <Field
              key={dagdeel}
              label={label(dagdeel)}
              htmlFor={`minimum-${dagdeel}`}
              className="w-24"
            >
              <Input
                id={`minimum-${dagdeel}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                value={waarden[dagdeel]}
                onChange={(e) =>
                  setWaarden((huidig) => ({ ...huidig, [dagdeel]: e.target.value }))
                }
              />
            </Field>
          ))}
          <div className="pb-1">
            <Button onClick={opslaan} disabled={bezig}>
              {bezig ? "Opslaan …" : "Minimum opslaan"}
            </Button>
          </div>
        </div>
        {fout ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {fout}
          </p>
        ) : null}
        {opgeslagen && !fout ? (
          <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
            <VinkIcoon />
            Minimum opgeslagen — de week hierboven is bijgewerkt.
          </p>
        ) : null}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Teamkaart                                                           */
/* ------------------------------------------------------------------ */

function TeamlidKaart({
  slug,
  teamlid,
  onBewerk,
}: {
  slug: string;
  teamlid: BezettingTeamlid;
  onBewerk: () => void;
}) {
  const router = useRouter();
  const [bevestigVerwijderen, setBevestigVerwijderen] = useState(false);
  const [bezig, startTransition] = useTransition();
  const [fout, setFout] = useState<string | null>(null);

  const verwijder = (): void => {
    startTransition(async () => {
      const res = await verwijderTeamlidAction(slug, teamlid.id);
      if (!res.ok) {
        setFout(res.fout);
        setBevestigVerwijderen(false);
        return;
      }
      router.refresh();
    });
  };

  const afwezigheid = afwezigheidTekst(teamlid.absentFrom, teamlid.absentUntil);

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-base font-semibold text-ink">{teamlid.name}</h3>
          <span className="text-sm text-ink/60">{label(teamlid.role)}</span>
        </div>
        {afwezigheid ? <Badge tone="roze">Afwezig {afwezigheid}</Badge> : null}
      </div>

      <MiniWeek schedule={teamlid.schedule} naam={teamlid.name} />

      {teamlid.note ? (
        <p className="text-sm leading-relaxed text-ink/70">{teamlid.note}</p>
      ) : null}

      {fout ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {fout}
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onBewerk}>
          Bewerken
        </Button>
        {bevestigVerwijderen ? (
          <>
            <Button variant="danger" size="sm" onClick={verwijder} disabled={bezig}>
              {bezig ? "Verwijderen …" : "Ja, verwijder"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBevestigVerwijderen(false)}>
              Annuleer
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setBevestigVerwijderen(true)}>
            Verwijderen
          </Button>
        )}
      </div>
    </Card>
  );
}

function afwezigheidTekst(van: string | null, tot: string | null): string | null {
  if (van && tot) return `${korteDatum(van)} – ${korteDatum(tot)}`;
  if (van) return `vanaf ${korteDatum(van)}`;
  if (tot) return `t/m ${korteDatum(tot)}`;
  return null;
}

/** Compacte weergave van de vaste werkdagen: 7 kolommen × 3 stipjes. */
function MiniWeek({ schedule, naam }: { schedule: TeamSchedule; naam: string }) {
  const werkt = WEEKDAYS.flatMap((dag) =>
    DAYPARTS.filter((dagdeel) => schedule[dag][dagdeel]).map(
      (dagdeel) => `${label(dag)} ${dagdeel}`,
    ),
  );
  return (
    <div
      role="img"
      aria-label={
        werkt.length > 0
          ? `Werkdagen van ${naam}: ${werkt.join(", ")}`
          : `${naam} heeft nog geen vaste werkdagen`
      }
      className="grid grid-cols-7 gap-1"
    >
      {WEEKDAYS.map((dag) => (
        <div key={dag} className="flex flex-col items-center gap-0.5">
          <span aria-hidden="true" className="text-[10px] font-semibold capitalize text-ink/50">
            {dag}
          </span>
          {DAYPARTS.map((dagdeel) => (
            <span
              key={dagdeel}
              aria-hidden="true"
              className={cx(
                "h-1.5 w-full max-w-6 rounded-full",
                schedule[dag][dagdeel] ? "bg-blauw-600" : "bg-ink/10",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teamlid-formulier (modal/sheet)                                     */
/* ------------------------------------------------------------------ */

function TeamlidFormulier({
  slug,
  locationId,
  teamlid,
  onSluit,
  onKlaar,
}: {
  slug: string;
  locationId: string;
  teamlid: BezettingTeamlid | null;
  onSluit: () => void;
  onKlaar: () => void;
}) {
  const [naam, setNaam] = useState(teamlid?.name ?? "");
  const [rol, setRol] = useState<string>(teamlid?.role ?? ROLES[0]);
  const [rooster, setRooster] = useState<TeamSchedule>(
    teamlid ? structuredClone(teamlid.schedule) : leegTeamRooster(),
  );
  const [afwezigVan, setAfwezigVan] = useState(naarDatumVeld(teamlid?.absentFrom ?? null));
  const [afwezigTot, setAfwezigTot] = useState(naarDatumVeld(teamlid?.absentUntil ?? null));
  const [notitie, setNotitie] = useState(teamlid?.note ?? "");
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  const wisselDagdeel = (dag: Weekday, dagdeel: Daypart): void => {
    setRooster((huidig) => ({
      ...huidig,
      [dag]: { ...huidig[dag], [dagdeel]: !huidig[dag][dagdeel] },
    }));
  };

  const opslaan = (): void => {
    setFout(null);
    startTransition(async () => {
      const res = await bewaarTeamlidAction(slug, {
        id: teamlid?.id,
        locationId,
        name: naam,
        role: rol,
        schedule: rooster,
        absentFrom: afwezigVan || null,
        absentUntil: afwezigTot || null,
        note: notitie.trim() || null,
      });
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      onKlaar();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onSluit}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="teamlid-formulier-titel"
        onClick={(e) => e.stopPropagation()}
        className="glass-strong flex max-h-[92dvh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-t-kaart-lg bg-white/95 p-6 sm:rounded-kaart-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="teamlid-formulier-titel" className="text-xl font-semibold text-ink">
            {teamlid ? `${teamlid.name} bewerken` : "Teamlid toevoegen"}
          </h3>
          <Button variant="ghost" size="sm" onClick={onSluit} aria-label="Formulier sluiten">
            <KruisIcoon />
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Naam" htmlFor="teamlid-naam" required>
            <Input
              id="teamlid-naam"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="Bijvoorbeeld: Esther Willems"
              autoFocus
            />
          </Field>
          <Field label="Functie" htmlFor="teamlid-rol" required>
            <Select id="teamlid-rol" value={rol} onChange={(e) => setRol(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {label(r)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* vaste werkdagen: 7 × 3 toggle-cellen (vinkje + kleur) */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">Vaste werkdagen</legend>
          <div className="grid gap-1 grid-cols-[auto_repeat(7,minmax(0,1fr))]">
            <div aria-hidden="true" />
            {WEEKDAYS.map((dag) => (
              <div key={dag} className="pb-0.5 text-center text-[11px] font-semibold capitalize text-ink/70">
                {dag}
              </div>
            ))}
            {DAYPARTS.map((dagdeel) => (
              <RoosterInvoerRij
                key={dagdeel}
                dagdeel={dagdeel}
                rooster={rooster}
                onWissel={wisselDagdeel}
              />
            ))}
          </div>
        </fieldset>

        {/* afwezigheid plannen */}
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold text-ink">
            Afwezigheid plannen{" "}
            <span className="font-normal text-ink/60">(vakantie, verlof — optioneel)</span>
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Afwezig van" htmlFor="teamlid-afwezig-van">
              <Input
                id="teamlid-afwezig-van"
                type="date"
                value={afwezigVan}
                onChange={(e) => setAfwezigVan(e.target.value)}
              />
            </Field>
            <Field label="Tot en met" htmlFor="teamlid-afwezig-tot">
              <Input
                id="teamlid-afwezig-tot"
                type="date"
                value={afwezigTot}
                onChange={(e) => setAfwezigTot(e.target.value)}
              />
            </Field>
          </div>
        </fieldset>

        <Field label="Notitie" htmlFor="teamlid-notitie" hint="Bijvoorbeeld: werkt om de week op vrijdag.">
          <Input
            id="teamlid-notitie"
            value={notitie}
            onChange={(e) => setNotitie(e.target.value)}
            maxLength={300}
          />
        </Field>

        {fout ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {fout}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="ghost" onClick={onSluit} disabled={bezig}>
            Annuleer
          </Button>
          <Button onClick={opslaan} disabled={bezig || naam.trim().length < 2}>
            {bezig ? "Opslaan …" : teamlid ? "Wijzigingen opslaan" : "Teamlid toevoegen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RoosterInvoerRij({
  dagdeel,
  rooster,
  onWissel,
}: {
  dagdeel: Daypart;
  rooster: TeamSchedule;
  onWissel: (dag: Weekday, dagdeel: Daypart) => void;
}) {
  return (
    <>
      <div className="flex min-h-10 items-center pr-2 text-[11px] font-semibold text-ink/70">
        {label(dagdeel)}
      </div>
      {WEEKDAYS.map((dag) => {
        const aan = rooster[dag][dagdeel];
        return (
          <button
            key={dag}
            type="button"
            aria-pressed={aan}
            aria-label={`${label(dag)} ${dagdeel}: ${aan ? "werkt" : "werkt niet"}`}
            onClick={() => onWissel(dag, dagdeel)}
            className={cx(
              "flex min-h-10 w-full items-center justify-center rounded-lg border",
              "transition-colors duration-150 motion-reduce:transition-none motion-safe:active:scale-95",
              aan
                ? "border-transparent bg-blauw-600 text-white shadow-(--shadow-knop-blauw)"
                : "border-ink/10 bg-white/70 text-ink/40 hover:bg-white",
            )}
          >
            {aan ? <VinkIcoon /> : <StreepIcoon />}
          </button>
        );
      })}
    </>
  );
}
