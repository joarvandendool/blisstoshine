"use client";

// Match Studio — de interactieve kern van het praktijkproduct.
//
// LINKS: de gevraagde werkweek (WeekGrid, mode vacancy). In de volledige modus
// simuleert elke klik op een dagdeel (nodig → gewenst → niet gevraagd), samen
// met de urenrange en de begeleiding-toggle. Zolang er wijzigingen zijn staat
// er een simulatiebanner met "Wijzigingen opslaan" (na expliciete bevestiging
// van wat er verandert) en "Herstel origineel".
//
// RECHTS: de kandidatenpool. De teller en alle kaarten werken bij elke
// simulatie direct bij via POST /api/praktijk/studio/simulate (gedebounced);
// extra matchbare kandidaten krijgen een opvallende delta-melding. Klik op een
// kaart opent het kandidaatdetail (zijpaneel) met categoriescores, sterke en
// aandachtspunten, de werkweek-overlay, opportunity-voorstellen en de primaire
// actie "Nodig uit".
//
// BEPERKTE MODUS (trial/essential): pool en scores blijven volledig zichtbaar;
// simulatie en opportunities zijn vergrendeld met een eerlijke uitleg van wat
// Growth toevoegt — geen dark patterns.
//
// Toegankelijkheid: geen staat alleen met kleur (delta's hebben pijl + tekst,
// geselecteerde filters een vinkje), tellers met aria-live, dialogen sluiten
// met Escape en matchpercentages staan nooit zonder concrete uitleg.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DAYPARTS,
  WEEKDAYS,
  label,
  type CandidateAvailability,
  type ScheduleRequirement,
  type VacancySchedule,
} from "@/domain/taxonomy";
import {
  LABEL_THRESHOLDS,
  type CategoryScores,
  type MatchCategory,
  type MatchLabel,
  type MatchOpportunity,
  type MatchResult,
} from "@/domain/matching";
import { MatchShape, type MatchShapeDimensions } from "@/components/MatchShape";
import { WeekGrid } from "@/components/WeekGrid";
import {
  Badge,
  Button,
  Card,
  Chip,
  Field,
  ProgressBar,
  ScoreBadge,
  Select,
  Textarea,
  cx,
} from "@/components/ui";
import {
  inviteCandidateAction,
  saveScheduleChanges,
  trackOpportunityViewedAction,
  type UitnodigResultaat,
} from "./actions";
import type {
  SimulatieFoutWire,
  SimulatiePoolWire,
} from "../../../../../../api/praktijk/studio/simulate/route";

/* ------------------------------- contracten ------------------------------- */

export type StudioMode = "volledig" | "beperkt";

export interface StudioVacature {
  id: string;
  title: string;
  role: string;
  stad: string;
  schedule: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  mentorship: boolean;
}

export interface StudioKandidaat {
  candidateUserId: string;
  profileId: string;
  /** Naam volgens de privacy-instelling (anonymous → geanonimiseerd). */
  displayName: string;
  isAnoniem: boolean;
  role: string;
  experienceLevel: string;
  availability: CandidateAvailability;
  /** Basisresultaat (huidige vacature-instellingen), incl. opportunities. */
  result: MatchResult;
}

export interface StudioClientProps {
  slug: string;
  mode: StudioMode;
  planCode: string | null;
  vacature: StudioVacature;
  kandidaten: StudioKandidaat[];
  /** candidateUserId's die al zijn uitgenodigd voor deze vacature. */
  uitgenodigd: string[];
}

/** De simuleerbare vacature-instellingen. */
interface Instellingen {
  schedule: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  mentorship: boolean;
}

/** Effectieve kaartgegevens: gesimuleerd zodra er een simulatie actief is. */
interface KaartGegevens {
  kandidaat: StudioKandidaat;
  score: number;
  matchLabel: MatchLabel;
  eligible: boolean;
  categoryScores: CategoryScores;
  topSterkte: string | null;
  samenvatting: string;
  /** Scoreverandering t.o.v. de basis; null buiten simulatie. */
  delta: number | null;
  nieuwMatchbaar: boolean;
}

/* ------------------------------ hulpfuncties ------------------------------ */

const STERK_VANAF = LABEL_THRESHOLDS.good;

const CATEGORIEEN: ReadonlyArray<{ sleutel: MatchCategory; naam: string }> = [
  { sleutel: "availability", naam: "Beschikbaarheid" },
  { sleutel: "roleAndExperience", naam: "Rol en ervaring" },
  { sleutel: "travel", naam: "Reisafstand" },
  { sleutel: "employment", naam: "Contract en uren" },
  { sleutel: "equipmentAndSoftware", naam: "Apparatuur en software" },
  { sleutel: "specializations", naam: "Specialisaties en behandelingen" },
  { sleutel: "workplacePreferences", naam: "Werkplekvoorkeuren" },
];

/** Categoriescores (0–100) → de vijf visuele dimensies (0–1) van MatchShape. */
function shapeDimensies(scores: CategoryScores): MatchShapeDimensions {
  return {
    availability: scores.availability / 100,
    location: scores.travel / 100,
    content: scores.specializations / 100,
    technology: scores.equipmentAndSoftware / 100,
    culture: scores.workplacePreferences / 100,
  };
}

function kopieerRooster(rooster: VacancySchedule): VacancySchedule {
  const uit = {} as VacancySchedule;
  for (const dag of WEEKDAYS) uit[dag] = { ...rooster[dag] };
  return uit;
}

function zijnGelijk(a: Instellingen, b: Instellingen): boolean {
  if (a.hoursMin !== b.hoursMin || a.hoursMax !== b.hoursMax) return false;
  if (a.mentorship !== b.mentorship) return false;
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      if (a.schedule[dag][dagdeel] !== b.schedule[dag][dagdeel]) return false;
    }
  }
  return true;
}

function eisTekst(eis: ScheduleRequirement): string {
  if (eis === "required") return "nodig";
  if (eis === "preferred") return "gewenst";
  return "niet gevraagd";
}

/** Nederlandse opsomming van wat er precies verandert (voor de bevestiging). */
function beschrijfWijzigingen(basis: Instellingen, huidig: Instellingen): string[] {
  const uit: string[] = [];
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      const oud = basis.schedule[dag][dagdeel];
      const nieuw = huidig.schedule[dag][dagdeel];
      if (oud !== nieuw) {
        uit.push(`${label(dag)} ${dagdeel}: ${eisTekst(oud)} → ${eisTekst(nieuw)}`);
      }
    }
  }
  if (basis.hoursMin !== huidig.hoursMin || basis.hoursMax !== huidig.hoursMax) {
    uit.push(
      `Urenrange: ${basis.hoursMin}–${basis.hoursMax} uur → ${huidig.hoursMin}–${huidig.hoursMax} uur per week`,
    );
  }
  if (basis.mentorship !== huidig.mentorship) {
    uit.push(
      `Begeleiding door een ervaren collega: ${basis.mentorship ? "ja" : "nee"} → ${huidig.mentorship ? "ja" : "nee"}`,
    );
  }
  return uit;
}

/** Wie moet instemmen met een opportunity-voorstel? */
function instemmingTekst(kans: MatchOpportunity): string {
  if (kans.requiresCandidateApproval && kans.requiresPracticeApproval) {
    return "de kandidaat én jullie praktijk";
  }
  if (kans.requiresCandidateApproval) return "de kandidaat";
  if (kans.requiresPracticeApproval) return "jullie praktijk";
  return "niemand — direct toepasbaar";
}

/* --------------------------------- iconen --------------------------------- */

function VinkIcoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AandachtIcoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-3.5 w-3.5 shrink-0", className)}>
      <path d="M8 3v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="12.25" r="1.25" fill="currentColor" />
    </svg>
  );
}

function SlotIcoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-4 w-4 shrink-0", className)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="currentColor" />
      <path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function KruisIcoon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className={cx("h-4 w-4 shrink-0", className)}>
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------- kleine componenten --------------------------- */

/** Scoreverandering t.o.v. de basis, bv. "▲ +10%" — nooit alleen met kleur. */
function DeltaChip({ delta }: { delta: number }) {
  const afgerond = Math.round(Math.abs(delta));
  if (afgerond === 0) return null;
  const stijgt = delta > 0;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
        stijgt ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900",
      )}
    >
      <span aria-hidden="true">{stijgt ? "▲" : "▼"}</span>
      <span aria-hidden="true">
        {stijgt ? "+" : "−"}
        {afgerond}%
      </span>
      <span className="sr-only">
        {stijgt
          ? `score stijgt met ${afgerond} procentpunt door deze simulatie`
          : `score daalt met ${afgerond} procentpunt door deze simulatie`}
      </span>
    </span>
  );
}

/** Link opgemaakt als knop (navigatie hoort bij een <a>). */
function LinkKnop({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold",
        "transition-colors duration-150 motion-reduce:transition-none",
        variant === "primary"
          ? "bg-blauw-600 text-white shadow-(--shadow-knop-blauw) hover:bg-blauw-700"
          : "glass text-ink hover:bg-white/90",
      )}
    >
      {children}
    </Link>
  );
}

function RedenLijst({
  redenen,
  toon,
}: {
  redenen: Array<{ code: string; message: string }>;
  toon: "sterk" | "aandacht" | "blokkade";
}) {
  const stijl =
    toon === "sterk"
      ? { chip: "bg-emerald-100 text-emerald-900", icoon: <VinkIcoon /> }
      : toon === "aandacht"
        ? { chip: "bg-amber-100 text-amber-900", icoon: <AandachtIcoon /> }
        : { chip: "bg-red-100 text-red-900", icoon: <AandachtIcoon /> };

  return (
    <ul className="flex flex-col gap-2">
      {redenen.map((reden) => (
        <li key={reden.code} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className={cx(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              stijl.chip,
            )}
          >
            {stijl.icoon}
          </span>
          <span className="text-[15px] leading-relaxed text-ink/85">{reden.message}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ hoofdcomponent ----------------------------- */

export function StudioClient({
  slug,
  mode,
  planCode,
  vacature,
  kandidaten,
  uitgenodigd,
}: StudioClientProps) {
  const router = useRouter();
  const volledig = mode === "volledig";

  // ---- simuleerbare instellingen -----------------------------------------
  const basis = useMemo<Instellingen>(
    () => ({
      schedule: vacature.schedule,
      hoursMin: vacature.hoursMin,
      hoursMax: vacature.hoursMax,
      mentorship: vacature.mentorship,
    }),
    [vacature],
  );
  const [instellingen, setInstellingen] = useState<Instellingen>(() => ({
    schedule: kopieerRooster(vacature.schedule),
    hoursMin: vacature.hoursMin,
    hoursMax: vacature.hoursMax,
    mentorship: vacature.mentorship,
  }));
  const isGewijzigd = !zijnGelijk(basis, instellingen);

  // ---- simulatie via /api/praktijk/studio/simulate (gedebounced) ---------
  const [sim, setSim] = useState<SimulatiePoolWire | null>(null);
  const [simBezig, setSimBezig] = useState(false);
  const [simFout, setSimFout] = useState<string | null>(null);
  const volgnummer = useRef(0);

  useEffect(() => {
    if (!volledig) return;
    if (!isGewijzigd) {
      volgnummer.current += 1;
      setSim(null);
      setSimFout(null);
      setSimBezig(false);
      return;
    }

    const nr = ++volgnummer.current;
    setSimBezig(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const antwoord = await fetch("/api/praktijk/studio/simulate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              slug,
              vacancyId: vacature.id,
              overrides: {
                schedule: instellingen.schedule,
                hoursMin: instellingen.hoursMin,
                hoursMax: instellingen.hoursMax,
                mentorship: instellingen.mentorship,
              },
            }),
          });
          const data: unknown = await antwoord.json().catch(() => null);
          if (nr !== volgnummer.current) return;
          if (!antwoord.ok) {
            setSim(null);
            setSimFout(
              (data as SimulatieFoutWire | null)?.fout ??
                "De simulatie is niet gelukt. Probeer het opnieuw.",
            );
          } else {
            setSim(data as SimulatiePoolWire);
            setSimFout(null);
          }
        } catch {
          if (nr === volgnummer.current) {
            setSim(null);
            setSimFout("De simulatie is niet gelukt. Controleer je verbinding.");
          }
        } finally {
          if (nr === volgnummer.current) setSimBezig(false);
        }
      })();
    }, 350);
    return () => clearTimeout(timer);
  }, [volledig, isGewijzigd, instellingen, slug, vacature.id]);

  const simulatieActief = volledig && isGewijzigd && sim !== null;
  const simPerProfiel = useMemo(
    () => new Map((sim?.kandidaten ?? []).map((k) => [k.profileId, k])),
    [sim],
  );

  // ---- effectieve kaartgegevens (basis of gesimuleerd) --------------------
  const kaarten = useMemo<KaartGegevens[]>(
    () =>
      kandidaten.map((kandidaat) => {
        const simulatie = simulatieActief
          ? simPerProfiel.get(kandidaat.profileId)
          : undefined;
        if (simulatie) {
          return {
            kandidaat,
            score: simulatie.score,
            matchLabel: simulatie.label,
            eligible: simulatie.eligible,
            categoryScores: simulatie.categoryScores,
            topSterkte: simulatie.topStrength,
            samenvatting: simulatie.summary,
            delta: simulatie.scoreDelta,
            nieuwMatchbaar: simulatie.becameEligible,
          };
        }
        return {
          kandidaat,
          score: kandidaat.result.score,
          matchLabel: kandidaat.result.label,
          eligible: kandidaat.result.eligible,
          categoryScores: kandidaat.result.categoryScores,
          topSterkte: kandidaat.result.strengths[0]?.message ?? null,
          samenvatting: kandidaat.result.summary,
          delta: null,
          nieuwMatchbaar: false,
        };
      }),
    [kandidaten, simPerProfiel, simulatieActief],
  );

  const matchbaar = kaarten.filter((k) => k.eligible).length;
  const sterk = kaarten.filter((k) => k.eligible && k.score >= STERK_VANAF).length;
  const extraMatchbaar = simulatieActief && sim ? sim.extraEligibleCount : 0;

  // ---- filters -------------------------------------------------------------
  const [minScore, setMinScore] = useState(0);
  const [alleenMatchbaar, setAlleenMatchbaar] = useState(false);
  const [focus, setFocus] = useState<MatchCategory | "">("");
  const focusNaam = CATEGORIEEN.find((c) => c.sleutel === focus)?.naam ?? null;

  const zichtbaar = useMemo(() => {
    let lijst = kaarten;
    if (minScore > 0) lijst = lijst.filter((k) => k.score >= minScore);
    if (alleenMatchbaar) lijst = lijst.filter((k) => k.eligible);
    return [...lijst].sort((a, b) => {
      const perEligible = Number(b.eligible) - Number(a.eligible);
      if (perEligible !== 0) return perEligible;
      if (focus) {
        const perFocus = b.categoryScores[focus] - a.categoryScores[focus];
        if (perFocus !== 0) return perFocus;
      }
      return b.score - a.score;
    });
  }, [kaarten, minScore, alleenMatchbaar, focus]);

  // ---- uitgenodigd (props + lokale successen) ------------------------------
  const [lokaalUitgenodigd, setLokaalUitgenodigd] = useState<string[]>([]);
  const uitgenodigdSet = useMemo(
    () => new Set([...uitgenodigd, ...lokaalUitgenodigd]),
    [uitgenodigd, lokaalUitgenodigd],
  );

  // ---- kandidaatdetail ------------------------------------------------------
  const [geselecteerd, setGeselecteerd] = useState<string | null>(null);
  const geselecteerdeKaart =
    kaarten.find((k) => k.kandidaat.candidateUserId === geselecteerd) ?? null;
  const getrackteOpportunities = useRef<Set<string>>(new Set());

  function openPaneel(kaart: KaartGegevens) {
    setGeselecteerd(kaart.kandidaat.candidateUserId);
    // opportunity_viewed: één keer per kandidaat per sessie, alleen wanneer
    // er daadwerkelijk voorstellen te zien zijn (volledige modus).
    const kansen = kaart.kandidaat.result.opportunities;
    if (
      volledig &&
      kansen.length > 0 &&
      !getrackteOpportunities.current.has(kaart.kandidaat.profileId)
    ) {
      getrackteOpportunities.current.add(kaart.kandidaat.profileId);
      void trackOpportunityViewedAction(
        slug,
        vacature.id,
        kaart.kandidaat.profileId,
        kansen.map((kans) => kans.code),
      );
    }
  }

  // ---- opslaan (met expliciete bevestiging) ---------------------------------
  const [bevestiging, setBevestiging] = useState(false);
  const [opslaanBezig, setOpslaanBezig] = useState(false);
  const [opslaanFout, setOpslaanFout] = useState<string | null>(null);

  function herstelOrigineel() {
    setInstellingen({
      schedule: kopieerRooster(basis.schedule),
      hoursMin: basis.hoursMin,
      hoursMax: basis.hoursMax,
      mentorship: basis.mentorship,
    });
  }

  async function bevestigOpslaan() {
    setOpslaanBezig(true);
    setOpslaanFout(null);
    const resultaat = await saveScheduleChanges(slug, vacature.id, {
      schedule: instellingen.schedule,
      hoursMin: instellingen.hoursMin,
      hoursMax: instellingen.hoursMax,
      mentorship: instellingen.mentorship,
    });
    if (resultaat.ok) {
      // De pagina herlaadt de serverdata; via de key op deze component start
      // de studio daarna met een schone (niet-gesimuleerde) staat.
      router.refresh();
    } else {
      setOpslaanBezig(false);
      setOpslaanFout(resultaat.melding);
    }
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* ============================ LINKS: werkweek ============================ */}
      <section aria-labelledby="werkweek-kop" className="flex min-w-0 flex-col gap-4">
        <Card strong className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <h2 id="werkweek-kop" className="text-xl font-semibold tracking-tight text-ink">
              De gevraagde{" "}
              <em className="font-serif italic font-bold text-blauw-600">werkweek</em>
            </h2>
            <p className="text-[15px] leading-relaxed text-ink/70">
              {volledig
                ? "Klik op een dagdeel om te simuleren: nodig → gewenst → niet gevraagd. Rechts zie je direct wat elke aanpassing met de kandidatenpool doet — er wordt niets opgeslagen tot jij dat bevestigt."
                : "Zo staat het rooster nu in de vacature. Simuleren van aanpassingen is onderdeel van het Growth-plan."}
            </p>
          </div>

          {/* simulatiebanner — boven de grid, zodra er wijzigingen zijn */}
          {volledig && isGewijzigd ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 rounded-kaart border border-roze-300 bg-roze-50/80 px-4 py-3"
            >
              <p className="flex items-center gap-2.5 text-sm font-semibold text-roze-800">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-roze-500 motion-safe:animate-puls-zacht"
                />
                Simulatie — nog niets opgeslagen
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => setBevestiging(true)}>
                  Wijzigingen opslaan
                </Button>
                <Button size="sm" variant="ghost" onClick={herstelOrigineel}>
                  Herstel origineel
                </Button>
              </div>
            </div>
          ) : null}

          {volledig ? (
            <WeekGrid
              mode="vacancy"
              value={instellingen.schedule}
              onChange={(nieuw) =>
                setInstellingen((vorige) => ({ ...vorige, schedule: nieuw }))
              }
            />
          ) : (
            <WeekGrid mode="readonly" variant="vacancy" value={instellingen.schedule} />
          )}

          {/* urenrange en begeleiding — ook simuleerbaar */}
          <div className="flex flex-col gap-5 border-t border-ink/10 pt-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="uren-min" className="text-sm font-semibold text-ink">
                    Minimum uren per week
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-blauw-700">
                    {instellingen.hoursMin} uur
                  </span>
                </div>
                <input
                  id="uren-min"
                  type="range"
                  min={4}
                  max={40}
                  step={1}
                  value={instellingen.hoursMin}
                  disabled={!volledig}
                  onChange={(e) => {
                    const waarde = Number(e.target.value);
                    setInstellingen((vorige) => ({
                      ...vorige,
                      hoursMin: Math.min(waarde, vorige.hoursMax),
                    }));
                  }}
                  className="w-full accent-blauw-600 disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="uren-max" className="text-sm font-semibold text-ink">
                    Maximum uren per week
                  </label>
                  <span className="text-sm font-semibold tabular-nums text-blauw-700">
                    {instellingen.hoursMax} uur
                  </span>
                </div>
                <input
                  id="uren-max"
                  type="range"
                  min={4}
                  max={40}
                  step={1}
                  value={instellingen.hoursMax}
                  disabled={!volledig}
                  onChange={(e) => {
                    const waarde = Number(e.target.value);
                    setInstellingen((vorige) => ({
                      ...vorige,
                      hoursMax: Math.max(waarde, vorige.hoursMin),
                    }));
                  }}
                  className="w-full accent-blauw-600 disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={instellingen.mentorship}
              disabled={!volledig}
              onClick={() =>
                setInstellingen((vorige) => ({
                  ...vorige,
                  mentorship: !vorige.mentorship,
                }))
              }
              className="flex items-center gap-3 self-start disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                  instellingen.mentorship ? "bg-blauw-600" : "bg-ink/20",
                )}
              >
                <span
                  className={cx(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-150 motion-reduce:transition-none",
                    instellingen.mentorship ? "left-[calc(100%-1.375rem)]" : "left-0.5",
                  )}
                />
              </span>
              <span className="text-sm font-semibold text-ink">
                Begeleiding door een ervaren collega
              </span>
              <Badge tone={instellingen.mentorship ? "blauw" : "neutraal"}>
                {instellingen.mentorship ? "Aan" : "Uit"}
              </Badge>
            </button>

            {!volledig ? (
              <p className="flex items-center gap-2 text-sm text-ink/60">
                <SlotIcoon className="text-ink/50" />
                Urenrange en begeleiding zijn hier vergrendeld — simuleren hoort bij Growth.
              </p>
            ) : null}
          </div>
        </Card>

        {!volledig ? <UpgradeKaart slug={slug} planCode={planCode} /> : null}
      </section>

      {/* ========================== RECHTS: kandidatenpool ========================== */}
      <section aria-labelledby="pool-kop" className="flex min-w-0 flex-col gap-4">
        {/* teller */}
        <Card strong className="flex flex-col gap-3">
          <h2
            id="pool-kop"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-blauw-700"
          >
            De kandidatenpool
          </h2>
          <p aria-live="polite" className="text-ink">
            <span className="text-4xl font-semibold tabular-nums tracking-tight">
              {matchbaar}
            </span>{" "}
            <span className="text-lg font-medium">
              {matchbaar === 1 ? "kandidaat" : "kandidaten"}, waarvan{" "}
            </span>
            <span className="text-4xl font-semibold tabular-nums tracking-tight text-blauw-600">
              {sterk}
            </span>
            <span className="text-lg font-medium"> sterk</span>
          </p>
          <p className="text-sm leading-relaxed text-ink/60">
            Op basis van {kandidaten.length} actieve{" "}
            {kandidaten.length === 1 ? "profiel" : "profielen"}. Sterk = matchscore van{" "}
            {STERK_VANAF}% of hoger.
          </p>

          {simBezig ? (
            <p role="status" className="flex items-center gap-2 text-sm font-medium text-blauw-700">
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-blauw-300 border-t-blauw-600 motion-safe:animate-spin"
              />
              Simulatie wordt doorgerekend…
            </p>
          ) : simulatieActief ? (
            <p className="text-sm font-medium text-ink/70">
              Doorgerekend met je simulatie — sla op om dit vast te leggen.
            </p>
          ) : null}

          {/* opvallende delta-melding bij extra kandidaten */}
          {simulatieActief && extraMatchbaar > 0 ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-2xl border border-roze-300 bg-roze-100 px-4 py-3 text-[15px] font-bold text-roze-800"
            >
              <span aria-hidden="true" className="text-lg leading-none">▲</span>
              +{extraMatchbaar}{" "}
              {extraMatchbaar === 1 ? "kandidaat" : "kandidaten"} beschikbaar door deze
              aanpassing
            </p>
          ) : null}
          {simulatieActief && extraMatchbaar < 0 ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-2xl bg-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-900"
            >
              <span aria-hidden="true">▼</span>
              {extraMatchbaar}{" "}
              {Math.abs(extraMatchbaar) === 1 ? "kandidaat" : "kandidaten"} door deze
              aanpassing
            </p>
          ) : null}

          {simFout ? (
            <p role="alert" className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm font-medium text-red-800">
              {simFout}
            </p>
          ) : null}
        </Card>

        {/* filterbalk */}
        <div className="glass rounded-kaart p-4">
          <fieldset className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <legend className="sr-only">Filter de kandidatenpool</legend>
            <div className="flex flex-col gap-1">
              <label htmlFor="filter-score" className="text-xs font-semibold text-ink/70">
                Minimale score
              </label>
              <div className="w-36">
                <Select
                  id="filter-score"
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="py-2 text-sm"
                >
                  <option value={0}>Alle scores</option>
                  <option value={50}>Vanaf 50%</option>
                  <option value={70}>Vanaf 70%</option>
                  <option value={85}>Vanaf 85%</option>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="filter-categorie" className="text-xs font-semibold text-ink/70">
                Categorie-focus
              </label>
              <div className="w-52">
                <Select
                  id="filter-categorie"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value as MatchCategory | "")}
                  className="py-2 text-sm"
                >
                  <option value="">Alle categorieën</option>
                  {CATEGORIEEN.map((categorie) => (
                    <option key={categorie.sleutel} value={categorie.sleutel}>
                      {categorie.naam}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Chip
              selected={alleenMatchbaar}
              onClick={() => setAlleenMatchbaar((v) => !v)}
            >
              Alleen matchbaar
            </Chip>
          </fieldset>
        </div>

        {/* kandidaatkaarten */}
        {zichtbaar.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {zichtbaar.map((kaart) => (
              <li key={kaart.kandidaat.candidateUserId}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => openPaneel(kaart)}
                  className={cx(
                    "glass w-full rounded-kaart p-4 text-left",
                    "transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none",
                    "hover:bg-white/90 motion-safe:hover:-translate-y-px",
                    !kaart.eligible && "opacity-75",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <MatchShape
                      score={kaart.score}
                      dimensions={shapeDimensies(kaart.categoryScores)}
                      size="compact"
                      showScore={false}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate font-semibold text-ink">
                          {kaart.kandidaat.displayName}
                        </span>
                        {kaart.delta !== null ? <DeltaChip delta={kaart.delta} /> : null}
                        {kaart.nieuwMatchbaar ? (
                          <Badge tone="roze">Nieuw matchbaar</Badge>
                        ) : null}
                        {uitgenodigdSet.has(kaart.kandidaat.candidateUserId) ? (
                          <Badge tone="neutraal">Al uitgenodigd</Badge>
                        ) : null}
                      </div>
                      <span className="text-sm font-medium text-ink/60">
                        {label(kaart.kandidaat.role)} · {label(kaart.kandidaat.experienceLevel)}
                      </span>
                      {kaart.topSterkte ? (
                        <span className="line-clamp-2 text-sm leading-relaxed text-ink/80">
                          {kaart.topSterkte}
                        </span>
                      ) : (
                        <span className="line-clamp-2 text-sm leading-relaxed text-ink/60">
                          {kaart.samenvatting}
                        </span>
                      )}
                      {focus && focusNaam ? (
                        <span className="text-sm font-medium text-blauw-700">
                          {focusNaam}:{" "}
                          <span className="tabular-nums">
                            {Math.round(kaart.categoryScores[focus])}%
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <ScoreBadge
                      score={kaart.score}
                      label={kaart.matchLabel}
                      className="shrink-0"
                    />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="flex flex-col items-center gap-3 py-10 text-center">
            <h3 className="text-lg font-semibold text-ink">
              Geen kandidaten binnen deze filters
            </h3>
            <p className="max-w-sm text-[15px] leading-relaxed text-ink/70">
              Verruim de minimale score of zet het matchbaar-filter uit om de hele pool
              te zien.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setMinScore(0);
                setAlleenMatchbaar(false);
                setFocus("");
              }}
            >
              Herstel filters
            </Button>
          </Card>
        )}
      </section>

      {/* ============================ overlays/dialogen ============================ */}
      {geselecteerdeKaart ? (
        <KandidaatPaneel
          kaart={geselecteerdeKaart}
          slug={slug}
          vacancyId={vacature.id}
          volledig={volledig}
          simulatieActief={simulatieActief}
          roosterVoorOverlay={instellingen.schedule}
          alUitgenodigd={uitgenodigdSet.has(geselecteerdeKaart.kandidaat.candidateUserId)}
          onUitgenodigd={(candidateUserId) =>
            setLokaalUitgenodigd((vorige) => [...vorige, candidateUserId])
          }
          onSluit={() => setGeselecteerd(null)}
        />
      ) : null}

      {bevestiging ? (
        <BevestigDialoog
          wijzigingen={beschrijfWijzigingen(basis, instellingen)}
          bezig={opslaanBezig}
          fout={opslaanFout}
          onBevestig={() => void bevestigOpslaan()}
          onAnnuleer={() => {
            if (!opslaanBezig) {
              setBevestiging(false);
              setOpslaanFout(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

/* --------------------------- beperkte modus: upsell ------------------------ */

function UpgradeKaart({ slug, planCode }: { slug: string; planCode: string | null }) {
  const planNaam =
    planCode === "trial"
      ? "de proefperiode"
      : planCode === "essential"
        ? "het Essential-plan"
        : "je huidige abonnement";

  const voordelen = [
    "Dagdelen, urenrange en begeleiding aanpassen en direct zien hoeveel kandidaten dat oplevert — zonder iets te wijzigen aan de vacature.",
    "Per kandidaat maximaal drie concrete voorstellen (“Maak deze match mogelijk”) met de verwachte nieuwe score en wie ermee moet instemmen.",
    "Gesimuleerde wijzigingen met één bevestiging doorvoeren in de vacature.",
  ];

  return (
    <Card className="flex flex-col gap-4 border border-blauw-200">
      <div className="flex items-center gap-2">
        <Badge tone="blauw">Onderdeel van Growth</Badge>
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-ink">
        Simuleren en opportunity-voorstellen
      </h3>
      <p className="text-[15px] leading-relaxed text-ink/75">
        Je gebruikt de Match Studio nu met {planNaam}: de volledige kandidatenpool en
        alle matchscores zijn zichtbaar — en dat blijft zo. Met Growth komt daar bij:
      </p>
      <ul className="flex flex-col gap-2.5">
        {voordelen.map((voordeel) => (
          <li key={voordeel} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-blauw-700"
            >
              <VinkIcoon />
            </span>
            <span className="text-[15px] leading-relaxed text-ink/85">{voordeel}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm leading-relaxed text-ink/60">
        Upgraden verandert niets aan je bestaande gegevens of scores — het voegt alleen
        deze gereedschappen toe. Je kunt maandelijks opzeggen.
      </p>
      <LinkKnop href={`/praktijk/${slug}/abonnement`}>Bekijk het Growth-plan</LinkKnop>
    </Card>
  );
}

/* ------------------------------ kandidaatdetail ---------------------------- */

interface KandidaatPaneelProps {
  kaart: KaartGegevens;
  slug: string;
  vacancyId: string;
  volledig: boolean;
  simulatieActief: boolean;
  /** Actueel (mogelijk gesimuleerd) rooster voor de overlay. */
  roosterVoorOverlay: VacancySchedule;
  alUitgenodigd: boolean;
  onUitgenodigd: (candidateUserId: string) => void;
  onSluit: () => void;
}

function KandidaatPaneel({
  kaart,
  slug,
  vacancyId,
  volledig,
  simulatieActief,
  roosterVoorOverlay,
  alUitgenodigd,
  onUitgenodigd,
  onSluit,
}: KandidaatPaneelProps) {
  const { kandidaat } = kaart;
  const basisResult = kandidaat.result;
  const sluitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    sluitRef.current?.focus();
    const opToets = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSluit();
    };
    document.addEventListener("keydown", opToets);
    const vorigeOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", opToets);
      document.body.style.overflow = vorigeOverflow;
    };
  }, [onSluit]);

  const verbeterkansen = basisResult.opportunities.filter(
    (kans) => kans.projectedScore > basisResult.score,
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Sluit kandidaatdetail"
        onClick={onSluit}
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="kandidaat-paneel-titel"
        className="relative z-10 flex h-full w-full max-w-xl flex-col gap-6 overflow-y-auto bg-white/95 p-6 shadow-2xl backdrop-blur-2xl sm:rounded-l-kaart-lg sm:border-l sm:border-white"
      >
        {/* kop */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="kandidaat-paneel-titel"
              className="text-2xl font-semibold tracking-tight text-ink"
            >
              {kandidaat.displayName}
            </h2>
            <p className="text-sm font-medium text-ink/60">
              {label(kandidaat.role)} · {label(kandidaat.experienceLevel)}
            </p>
            {kandidaat.isAnoniem ? (
              <p className="text-sm text-ink/60">
                Deze kandidaat blijft anoniem tot er contact is gelegd.
              </p>
            ) : null}
          </div>
          <button
            ref={sluitRef}
            type="button"
            onClick={onSluit}
            className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            <KruisIcoon />
            Sluiten
          </button>
        </div>

        {/* score */}
        <div className="flex flex-col items-center gap-3 rounded-kaart bg-surface/70 p-4 text-center">
          <MatchShape
            score={kaart.score}
            dimensions={shapeDimensies(kaart.categoryScores)}
            size="hero"
          />
          <ScoreBadge score={kaart.score} label={kaart.matchLabel} />
          {simulatieActief && kaart.delta !== null ? (
            <p className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-ink/70">
              Basis {Math.round(basisResult.score)}% → simulatie{" "}
              <span className="tabular-nums">{Math.round(kaart.score)}%</span>
              <DeltaChip delta={kaart.delta} />
            </p>
          ) : null}
          <p className="max-w-md text-[15px] leading-relaxed text-ink/80">
            {kaart.samenvatting}
          </p>
        </div>

        {/* harde blokkades */}
        {!kaart.eligible && basisResult.hardMismatchReasons.length > 0 ? (
          <section aria-label="Waarom nu geen match" className="flex flex-col gap-2.5">
            <h3 className="text-base font-semibold text-ink">Waarom nu geen match</h3>
            <RedenLijst redenen={basisResult.hardMismatchReasons} toon="blokkade" />
          </section>
        ) : null}

        {/* categoriescores */}
        <section aria-label="Score per categorie" className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-ink">Opbouw van de score</h3>
          {simulatieActief ? (
            <p className="text-sm text-ink/60">Inclusief je huidige simulatie.</p>
          ) : null}
          <div className="flex flex-col gap-3">
            {CATEGORIEEN.map(({ sleutel, naam }) => (
              <div key={sleutel} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{naam}</span>
                  <span className="text-sm font-semibold tabular-nums text-ink/70">
                    {Math.round(kaart.categoryScores[sleutel])}%
                  </span>
                </div>
                <ProgressBar value={kaart.categoryScores[sleutel]} label={naam} />
              </div>
            ))}
          </div>
        </section>

        {/* sterke punten en aandachtspunten */}
        <section aria-label="Sterke punten en aandachtspunten" className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <h3 className="text-base font-semibold text-ink">Sterke punten</h3>
            {basisResult.strengths.length > 0 ? (
              <RedenLijst redenen={basisResult.strengths} toon="sterk" />
            ) : (
              <p className="text-[15px] text-ink/70">
                Geen uitgesproken sterke punten bij de huidige vacature-instellingen.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-base font-semibold text-ink">Aandachtspunten</h3>
            {basisResult.attentionPoints.length > 0 ? (
              <RedenLijst redenen={basisResult.attentionPoints} toon="aandacht" />
            ) : (
              <p className="text-[15px] text-ink/70">Geen aandachtspunten gevonden.</p>
            )}
          </div>
          {simulatieActief ? (
            <p className="text-sm text-ink/60">
              Deze punten horen bij de opgeslagen vacature; de score hierboven is wél
              doorgerekend met je simulatie.
            </p>
          ) : null}
        </section>

        {/* werkweek-overlay */}
        <section aria-label="Werkweek-overlay" className="flex flex-col gap-2.5">
          <h3 className="text-base font-semibold text-ink">
            Beschikbaarheid naast het rooster
          </h3>
          {simulatieActief ? (
            <p className="text-sm text-ink/60">
              De overlay gebruikt je gesimuleerde rooster.
            </p>
          ) : null}
          <WeekGrid
            mode="overlay"
            candidateAvailability={kandidaat.availability}
            vacancySchedule={roosterVoorOverlay}
            compact
          />
        </section>

        {/* opportunities */}
        <section aria-label="Maak deze match mogelijk" className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-ink">
            Maak deze match{" "}
            <em className="font-serif italic font-bold text-blauw-600">mogelijk</em>
          </h3>
          {volledig ? (
            verbeterkansen.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {verbeterkansen.map((kans) => (
                  <li
                    key={kans.code}
                    className="flex flex-col gap-1.5 rounded-kaart border border-ink/10 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-[15px] font-semibold text-ink">{kans.title}</h4>
                      <Badge tone="roze">
                        naar {Math.round(kans.projectedScore)}%
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed text-ink/75">
                      {kans.explanation}
                    </p>
                    <p className="text-sm font-medium text-ink/60">
                      Instemming nodig van {instemmingTekst(kans)}.
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink/70">
                Geen voorstellen gevonden die deze match aantoonbaar verbeteren.
              </p>
            )
          ) : (
            <div className="flex flex-col gap-3 rounded-kaart border border-dashed border-blauw-300 bg-blauw-50/70 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-blauw-900">
                <SlotIcoon className="text-blauw-700" />
                Onderdeel van Growth
              </p>
              <p className="text-sm leading-relaxed text-ink/75">
                De opportunity-engine doet per kandidaat maximaal drie concrete
                voorstellen — met de verwachte nieuwe score erbij en wie ermee moet
                instemmen.
              </p>
              <Link
                href={`/praktijk/${slug}/abonnement`}
                className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
              >
                Ontdek wat Growth toevoegt →
              </Link>
            </div>
          )}
        </section>

        {/* primaire actie: uitnodigen */}
        <section aria-label="Kandidaat uitnodigen" className="mt-auto flex flex-col gap-3 border-t border-ink/10 pt-5">
          {alUitgenodigd ? (
            <p
              role="status"
              className="rounded-2xl bg-brand-light/60 px-4 py-3 text-[15px] font-medium text-blauw-900"
            >
              Deze kandidaat is al uitgenodigd voor deze vacature.
            </p>
          ) : (
            <UitnodigFormulier
              slug={slug}
              vacancyId={vacancyId}
              kandidaat={kandidaat}
              eligible={kaart.eligible}
              onUitgenodigd={onUitgenodigd}
            />
          )}
        </section>
      </aside>
    </div>
  );
}

/* ---------------------------- uitnodigformulier ---------------------------- */

interface UitnodigFormulierProps {
  slug: string;
  vacancyId: string;
  kandidaat: StudioKandidaat;
  eligible: boolean;
  onUitgenodigd: (candidateUserId: string) => void;
}

function UitnodigFormulier({
  slug,
  vacancyId,
  kandidaat,
  eligible,
  onUitgenodigd,
}: UitnodigFormulierProps) {
  const [bericht, setBericht] = useState("");
  const [bezig, setBezig] = useState(false);
  const [resultaat, setResultaat] = useState<UitnodigResultaat | null>(null);

  async function verstuur() {
    setBezig(true);
    try {
      const antwoord = await inviteCandidateAction(
        slug,
        vacancyId,
        kandidaat.candidateUserId,
        bericht.trim(),
      );
      setResultaat(antwoord);
      if (antwoord.ok) onUitgenodigd(kandidaat.candidateUserId);
    } finally {
      setBezig(false);
    }
  }

  if (resultaat?.ok) {
    return (
      <div
        role="status"
        className="flex flex-col gap-3 rounded-kaart bg-brand-light/60 p-4"
      >
        <p className="text-[15px] font-semibold text-blauw-900">
          Uitnodiging verstuurd naar {kandidaat.displayName}.
        </p>
        {resultaat.score !== null && resultaat.label !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <ScoreBadge score={resultaat.score} label={resultaat.label} />
            <span className="text-sm text-blauw-900">
              is als snapshot vastgelegd bij deze uitnodiging.
            </span>
          </div>
        ) : (
          <p className="text-sm text-blauw-900">
            De matchscore van dit moment is als snapshot vastgelegd bij de uitnodiging.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verstuur();
      }}
      className="flex flex-col gap-3"
    >
      {resultaat && !resultaat.ok && resultaat.soort === "limiet" ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-kaart border border-roze-200 bg-roze-50 p-4"
        >
          <p className="text-sm font-semibold text-roze-800">{resultaat.melding}</p>
          <p className="text-sm text-roze-800">{resultaat.upgradeHint}</p>
          <Link
            href={`/praktijk/${slug}/abonnement`}
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Bekijk de abonnementen →
          </Link>
        </div>
      ) : null}
      {resultaat && !resultaat.ok && resultaat.soort === "fout" ? (
        <p
          role="alert"
          className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
        >
          {resultaat.melding}
        </p>
      ) : null}

      {!eligible ? (
        <p className="text-sm leading-relaxed text-ink/60">
          Let op: deze kandidaat is op dit moment geen match. Bekijk eerst de
          voorstellen hierboven, of nodig toch uit als je in gesprek wilt.
        </p>
      ) : null}

      <Field
        label={`Persoonlijk bericht aan ${kandidaat.displayName}`}
        htmlFor="uitnodig-bericht"
        hint="Optioneel — een korte, persoonlijke uitnodiging wordt vaker beantwoord."
      >
        <Textarea
          id="uitnodig-bericht"
          rows={4}
          maxLength={1000}
          value={bericht}
          onChange={(e) => setBericht(e.target.value)}
          placeholder="Bijvoorbeeld: we zoeken versterking op dinsdag en donderdag en je profiel past opvallend goed bij ons team…"
          disabled={bezig}
        />
      </Field>

      <Button type="submit" size="lg" disabled={bezig} className="self-start">
        {bezig ? "Bezig met versturen…" : "Nodig uit"}
      </Button>
      <p className="text-sm leading-relaxed text-ink/60">
        Bij het versturen wordt de matchscore van dit moment vastgelegd in een
        snapshot, zodat jullie later precies zien waarop de uitnodiging was gebaseerd.
      </p>
    </form>
  );
}

/* ---------------------------- bevestigingsdialoog -------------------------- */

interface BevestigDialoogProps {
  wijzigingen: string[];
  bezig: boolean;
  fout: string | null;
  onBevestig: () => void;
  onAnnuleer: () => void;
}

function BevestigDialoog({
  wijzigingen,
  bezig,
  fout,
  onBevestig,
  onAnnuleer,
}: BevestigDialoogProps) {
  const annuleerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    annuleerRef.current?.focus();
    const opToets = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnnuleer();
    };
    document.addEventListener("keydown", opToets);
    return () => document.removeEventListener("keydown", opToets);
  }, [onAnnuleer]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Annuleer opslaan"
        onClick={onAnnuleer}
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bevestig-titel"
        className="relative z-10 flex w-full max-w-lg flex-col gap-4 rounded-kaart-lg bg-white/95 p-6 shadow-2xl backdrop-blur-2xl"
      >
        <h2 id="bevestig-titel" className="text-xl font-semibold tracking-tight text-ink">
          Dit verandert er aan de vacature
        </h2>
        <p className="text-[15px] leading-relaxed text-ink/70">
          Na het opslaan is dit het nieuwe rooster van de vacature: kandidaten en hun
          matchscores rekenen vanaf dan met deze instellingen.
        </p>
        {wijzigingen.length > 0 ? (
          <ul className="flex flex-col gap-2 rounded-kaart bg-surface/80 p-4">
            {wijzigingen.map((wijziging) => (
              <li key={wijziging} className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-light text-blauw-700"
                >
                  <VinkIcoon />
                </span>
                <span className="text-[15px] leading-relaxed text-ink">{wijziging}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-ink/70">Er zijn geen wijzigingen gevonden.</p>
        )}
        {fout ? (
          <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {fout}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button ref={annuleerRef} variant="ghost" onClick={onAnnuleer} disabled={bezig}>
            Annuleer
          </Button>
          <Button onClick={onBevestig} disabled={bezig || wijzigingen.length === 0}>
            {bezig ? "Bezig met opslaan…" : "Ja, sla deze wijzigingen op"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default StudioClient;
