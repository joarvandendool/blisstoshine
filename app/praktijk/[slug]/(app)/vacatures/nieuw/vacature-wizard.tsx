"use client";

// Vacaturewizard — zelfde samenstel-gevoel als de kandidaat-onboarding: één
// vraaggroep per stap, grote tap-targets, veel witruimte en de werkweek
// (WeekGrid, mode "vacancy") groot en centraal. Vijf stappen:
// 1 basis · 2 werkweek · 3 eisen & aanbod · 4 Talent Radar-preview ·
// 5 publiceren (primaire actie) of als concept bewaren.
//
// Stap 1 maakt het concept aan via startVacatureAction (de servicelaag trackt
// daar vacancy_started); elke volgende stap wordt direct opgeslagen via
// bewaarStapAction. Geselecteerde staten worden nooit alléén met kleur
// getoond (vinkje/badge + kleur).

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Chip,
  Field,
  Input,
  ProgressBar,
  Select,
  Stat,
  Textarea,
  cx,
} from "@/components/ui";
import WeekGrid from "@/components/WeekGrid";
import {
  CONTRACT_TYPES,
  CULTURE,
  DAYPARTS,
  DEVELOPMENT,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PATIENT_POPULATION,
  REGISTRATIONS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  TREATMENTS,
  WEEKDAYS,
  emptySchedule,
  label,
  type CriterionLevel,
  type VacancySchedule,
} from "@/domain/taxonomy";
import {
  bewaarStapAction,
  publiceerVacatureAction,
  radarPreviewAction,
  startVacatureAction,
  type RadarPreview,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Types en constanten                                                 */
/* ------------------------------------------------------------------ */

export interface WizardLocatie {
  id: string;
  name: string;
  city: string;
}

export interface VacatureWizardProps {
  slug: string;
  locaties: WizardLocatie[];
}

interface CriteriaGroepWaarde {
  values: string[];
  level: CriterionLevel;
}

interface VacatureWaarden {
  locationId: string;
  role: string;
  title: string;
  experienceLevel: string | null;
  description: string;
  schedule: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  /** yyyy-mm-dd of null (per direct / in overleg). */
  startBy: string | null;
  startByHard: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Maximaal geboden omzetpercentage bij zzp (geheel getal, 0–100). */
  revenueShareMax: number | null;
  registrations: CriteriaGroepWaarde;
  equipment: CriteriaGroepWaarde;
  software: CriteriaGroepWaarde;
  specializations: CriteriaGroepWaarde;
  treatments: CriteriaGroepWaarde;
  population: CriteriaGroepWaarde;
  culture: string[];
  mentorship: boolean;
  development: string[];
}

const STAPPEN = [
  { id: "basis", kort: "Basis" },
  { id: "werkweek", kort: "Werkweek" },
  { id: "eisen", kort: "Eisen & aanbod" },
  { id: "radar", kort: "Talent Radar" },
  { id: "publiceren", kort: "Publiceren" },
] as const;

type StapId = (typeof STAPPEN)[number]["id"];

const UREN_OPTIES = Array.from({ length: 40 }, (_, i) => i + 1);

const ERVARING_UITLEG: Record<string, string> = {
  starter: "Ook starters zijn welkom",
  medior: "Minimaal 2 jaar ervaring",
  senior: "Minimaal 7 jaar ervaring",
};

const NIVEAU_OPTIES: ReadonlyArray<{
  waarde: CriterionLevel;
  titel: string;
  uitleg: string;
}> = [
  {
    waarde: "required",
    titel: "Vereist",
    uitleg: "Harde eis — kandidaten zonder dit vallen af als match.",
  },
  {
    waarde: "preferred",
    titel: "Gewenst",
    uitleg: "Telt positief mee in de matchscore, maar sluit niemand uit.",
  },
  {
    waarde: "informational",
    titel: "Ter info",
    uitleg: "Alleen ter informatie — telt niet mee in de matchscore.",
  },
];

const CRITERIA_GROEPEN: ReadonlyArray<{
  sleutel: keyof Pick<
    VacatureWaarden,
    | "registrations"
    | "equipment"
    | "software"
    | "specializations"
    | "treatments"
    | "population"
  >;
  titel: string;
  hint?: string;
  opties: readonly string[];
}> = [
  {
    sleutel: "registrations",
    titel: "Registraties en bevoegdheden",
    hint: "Bijvoorbeeld een BIG-registratie of röntgenbevoegdheid.",
    opties: REGISTRATIONS,
  },
  { sleutel: "equipment", titel: "Apparatuur", opties: EQUIPMENT },
  { sleutel: "software", titel: "Software", opties: SOFTWARE },
  { sleutel: "specializations", titel: "Specialisaties", opties: SPECIALIZATIONS },
  { sleutel: "treatments", titel: "Behandelingen", opties: TREATMENTS },
  { sleutel: "population", titel: "Patiëntgroepen", opties: PATIENT_POPULATION },
];

function legeGroep(): CriteriaGroepWaarde {
  return { values: [], level: "preferred" };
}

function beginWaarden(locaties: WizardLocatie[]): VacatureWaarden {
  return {
    locationId: locaties[0]?.id ?? "",
    role: "",
    title: "",
    experienceLevel: null,
    description: "",
    schedule: emptySchedule(),
    hoursMin: 24,
    hoursMax: 32,
    contractTypes: [],
    startBy: null,
    startByHard: false,
    salaryMin: null,
    salaryMax: null,
    revenueShareMax: null,
    registrations: legeGroep(),
    equipment: legeGroep(),
    software: legeGroep(),
    specializations: legeGroep(),
    treatments: legeGroep(),
    population: legeGroep(),
    culture: [],
    mentorship: false,
    development: [],
  };
}

function toggleIn(lijst: string[], sleutel: string): string[] {
  return lijst.includes(sleutel)
    ? lijst.filter((s) => s !== sleutel)
    : [...lijst, sleutel];
}

/** Automatisch titelvoorstel op basis van functie en locatie. */
function titelVoorstel(role: string, locatie: WizardLocatie | undefined): string {
  if (!role) return "";
  return locatie ? `${label(role)} in ${locatie.city}` : label(role);
}

/** Minstens één gevraagd dagdeel in het rooster? */
function heeftGevraagdDagdeel(schedule: VacancySchedule): boolean {
  return WEEKDAYS.some((dag) =>
    DAYPARTS.some((deel) => schedule[dag][deel] !== null),
  );
}

/** Clientvalidatie vóór opslaan — de server valideert daarna nogmaals. */
function valideerStap(id: StapId, w: VacatureWaarden): string | null {
  switch (id) {
    case "basis":
      if (!w.locationId) return "Kies eerst een locatie.";
      if (!w.role) return "Kies de functie waarvoor je iemand zoekt.";
      if (w.title.trim().length < 3) return "Geef de vacature een titel.";
      return null;
    case "werkweek":
      if (!heeftGevraagdDagdeel(w.schedule)) {
        return "Tik minstens één dagdeel aan dat je nodig hebt of gewenst vindt.";
      }
      if (w.hoursMax < w.hoursMin) {
        return "Het maximum aantal uren ligt onder het minimum.";
      }
      if (w.contractTypes.length === 0) return "Kies minstens één contractvorm.";
      if (w.salaryMin !== null && w.salaryMax !== null && w.salaryMax < w.salaryMin) {
        return "Het maximumsalaris ligt onder het minimum.";
      }
      return null;
    default:
      return null;
  }
}

/** Payload voor de server actions, per stap. */
function stapPayload(id: StapId, w: VacatureWaarden): unknown {
  switch (id) {
    case "basis":
      return {
        stap: "basis",
        locationId: w.locationId,
        role: w.role,
        title: w.title.trim(),
        experienceLevel: w.experienceLevel,
        description: w.description.trim() === "" ? null : w.description.trim(),
      };
    case "werkweek":
      return {
        stap: "werkweek",
        schedule: w.schedule,
        hoursMin: w.hoursMin,
        hoursMax: w.hoursMax,
        contractTypes: w.contractTypes,
        startBy: w.startBy,
        startByHard: w.startBy === null ? false : w.startByHard,
        salaryMin: w.salaryMin,
        salaryMax: w.salaryMax,
        revenueShareMax: w.revenueShareMax,
      };
    case "eisen":
      return {
        stap: "eisen",
        registrations: w.registrations,
        equipment: w.equipment,
        software: w.software,
        specializations: w.specializations,
        treatments: w.treatments,
        population: w.population,
        culture: w.culture,
        mentorship: w.mentorship,
        development: w.development,
      };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Kleine presentatiehulpen                                            */
/* ------------------------------------------------------------------ */

function StapKop({
  kopRef,
  titel,
  accent,
  intro,
}: {
  kopRef: React.RefObject<HTMLHeadingElement | null>;
  titel: string;
  accent: string;
  intro: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h1
        ref={kopRef}
        tabIndex={-1}
        className="text-3xl font-semibold tracking-tight text-ink outline-none sm:text-4xl"
      >
        {titel}{" "}
        <em className="font-serif italic font-bold text-blauw-600">{accent}</em>
      </h1>
      <p className="max-w-xl text-[16px] leading-relaxed text-ink/70">{intro}</p>
    </div>
  );
}

function Vraag({
  titel,
  hint,
  children,
}: {
  titel: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{titel}</h2>
        {hint ? <p className="mt-0.5 text-sm text-ink/60">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function ChipGroep({
  opties,
  waarde,
  onToggle,
  groepLabel,
  groot = false,
}: {
  opties: readonly string[];
  waarde: string[];
  onToggle: (sleutel: string) => void;
  groepLabel: string;
  groot?: boolean;
}) {
  return (
    <div role="group" aria-label={groepLabel} className="flex flex-wrap gap-2">
      {opties.map((sleutel) => (
        <Chip
          key={sleutel}
          selected={waarde.includes(sleutel)}
          onClick={() => onToggle(sleutel)}
          className={groot ? "px-5 py-3 text-base" : undefined}
        >
          {label(sleutel)}
        </Chip>
      ))}
    </div>
  );
}

/** Grote keuzekaart (titel + uitleg) — selectie via rand, badge én vinkje. */
function KeuzeKaart({
  actief,
  titel,
  uitleg,
  onKies,
}: {
  actief: boolean;
  titel: string;
  uitleg: string;
  onKies: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={actief}
      onClick={onKies}
      className={cx(
        "w-full rounded-kaart border-2 p-5 text-left backdrop-blur",
        "transition-[border-color,background-color,box-shadow] duration-150 motion-reduce:transition-none",
        actief
          ? "border-blauw-600 bg-blauw-50/90 shadow-(--shadow-glass-strong)"
          : "border-ink/10 bg-white/70 hover:border-ink/25 hover:bg-white/90",
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">{titel}</span>
        {actief ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-blauw-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3">
              <path
                d="M3 8.5 6.5 12 13 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Gekozen
          </span>
        ) : null}
      </span>
      <span className="mt-1.5 block text-sm leading-relaxed text-ink/70">{uitleg}</span>
    </button>
  );
}

/** Criteriagroep: chips + niveaukeuze (vereist/gewenst/ter info) met uitleg. */
function CriteriaGroep({
  titel,
  hint,
  opties,
  waarde,
  onChange,
}: {
  titel: string;
  hint?: string;
  opties: readonly string[];
  waarde: CriteriaGroepWaarde;
  onChange: (waarde: CriteriaGroepWaarde) => void;
}) {
  const actieveUitleg = NIVEAU_OPTIES.find((o) => o.waarde === waarde.level)?.uitleg;
  return (
    <div className="glass flex flex-col gap-3 rounded-kaart p-5">
      <Vraag titel={titel} hint={hint}>
        <ChipGroep
          opties={opties}
          waarde={waarde.values}
          onToggle={(sleutel) =>
            onChange({ ...waarde, values: toggleIn(waarde.values, sleutel) })
          }
          groepLabel={titel}
        />
      </Vraag>
      {waarde.values.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-ink/10 pt-3">
          <p className="text-sm font-semibold text-ink">
            Hoe zwaar telt dit voor jullie?
          </p>
          <div
            role="group"
            aria-label={`Niveau voor ${titel}`}
            className="flex flex-wrap gap-2"
          >
            {NIVEAU_OPTIES.map((optie) => (
              <Chip
                key={optie.waarde}
                selected={waarde.level === optie.waarde}
                onClick={() => onChange({ ...waarde, level: optie.waarde })}
              >
                {optie.titel}
              </Chip>
            ))}
          </div>
          {actieveUitleg ? (
            <p className="text-sm text-ink/60">{actieveUitleg}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* De wizard zelf                                                      */
/* ------------------------------------------------------------------ */

export function VacatureWizard({ slug, locaties }: VacatureWizardProps) {
  const router = useRouter();
  const [waarden, setWaarden] = useState<VacatureWaarden>(() =>
    beginWaarden(locaties),
  );
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const [stapIndex, setStapIndex] = useState(0);
  const [fout, setFout] = useState<string | null>(null);
  const [titelZelfAangepast, setTitelZelfAangepast] = useState(false);
  const [radar, setRadar] = useState<RadarPreview | null>(null);
  const [radarFout, setRadarFout] = useState<string | null>(null);
  const [limietMelding, setLimietMelding] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  const kopRef = useRef<HTMLHeadingElement | null>(null);
  const eersteWeergave = useRef(true);

  useEffect(() => {
    if (eersteWeergave.current) {
      eersteWeergave.current = false;
      return;
    }
    kopRef.current?.focus();
  }, [stapIndex]);

  const stap = STAPPEN[stapIndex];
  const basisRoute = `/praktijk/${slug}`;
  const locatie = locaties.find((l) => l.id === waarden.locationId);

  // Talent Radar-preview laden bij het openen van stap 4 — telkens opnieuw,
  // zodat aanpassingen uit eerdere stappen direct doorwerken in de cijfers.
  useEffect(() => {
    if (stap.id !== "radar" || vacancyId === null) return;
    let actueel = true;
    setRadar(null);
    setRadarFout(null);
    void radarPreviewAction(slug, vacancyId).then((res) => {
      if (!actueel) return;
      if (res.ok) setRadar({ teaser: res.teaser, rapport: res.rapport });
      else setRadarFout(res.fout);
    });
    return () => {
      actueel = false;
    };
  }, [stap.id, vacancyId, slug]);

  const zet = <K extends keyof VacatureWaarden>(
    veld: K,
    waarde: VacatureWaarden[K],
  ) => setWaarden((w) => ({ ...w, [veld]: waarde }));

  /** Functie of locatie gekozen → titelvoorstel bijwerken (tenzij zelf aangepast). */
  function kiesRolOfLocatie(veld: "role" | "locationId", nieuw: string) {
    setWaarden((w) => {
      const volgende = { ...w, [veld]: nieuw };
      if (!titelZelfAangepast) {
        const loc = locaties.find((l) => l.id === volgende.locationId);
        volgende.title = titelVoorstel(volgende.role, loc);
      }
      return volgende;
    });
  }

  function verder() {
    setFout(null);
    const melding = valideerStap(stap.id, waarden);
    if (melding) {
      setFout(melding);
      return;
    }

    if (stap.id === "radar") {
      setStapIndex((i) => Math.min(i + 1, STAPPEN.length - 1));
      return;
    }

    startTransition(async () => {
      if (stap.id === "basis" && vacancyId === null) {
        // Eerste keer voorbij stap 1: concept aanmaken (dit trackt
        // vacancy_started in de servicelaag).
        const res = await startVacatureAction(slug, stapPayload("basis", waarden));
        if (!res.ok) {
          setFout(res.fout);
          return;
        }
        setVacancyId(res.vacancyId);
      } else if (vacancyId !== null) {
        const res = await bewaarStapAction(
          slug,
          vacancyId,
          stapPayload(stap.id, waarden),
        );
        if (!res.ok) {
          setFout(res.fout);
          return;
        }
      }
      setStapIndex((i) => Math.min(i + 1, STAPPEN.length - 1));
    });
  }

  function terug() {
    setFout(null);
    setStapIndex((i) => Math.max(0, i - 1));
  }

  function publiceer() {
    setFout(null);
    setLimietMelding(null);
    if (vacancyId === null) return;
    startTransition(async () => {
      const res = await publiceerVacatureAction(slug, vacancyId);
      // Bij succes stuurt de server action door naar het dashboard; alleen
      // fouten bereiken deze regel.
      if (res && !res.ok) {
        if (res.limietBereikt) {
          setLimietMelding(
            res.upgradeHint ? `${res.fout} ${res.upgradeHint}` : res.fout,
          );
        } else {
          setFout(res.fout);
        }
      }
    });
  }

  function bewaarConcept() {
    // Alle stappen zijn al opgeslagen; het concept staat veilig in de lijst.
    router.push(basisRoute);
  }

  const laatsteStap = stapIndex === STAPPEN.length - 1;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {/* voortgang bovenin */}
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-ink/70">
            Nieuwe vacature · Stap {stapIndex + 1} van {STAPPEN.length}
            <span className="hidden sm:inline"> · {stap.kort}</span>
          </p>
        </div>
        <ProgressBar
          value={stapIndex + 1}
          max={STAPPEN.length}
          label={`Vacaturewizard: stap ${stapIndex + 1} van ${STAPPEN.length} — ${stap.kort}`}
        />
      </header>

      <section aria-label={stap.kort} className="flex flex-col gap-7">
        {stap.id === "basis" ? (
          <>
            <StapKop
              kopRef={kopRef}
              titel="Wie zoeken"
              accent="jullie?"
              intro="Begin met de basis: de functie, de locatie en een herkenbare titel. In de volgende stappen stel je de werkweek en de eisen samen."
            />
            <Vraag titel="Functie">
              <ChipGroep
                groot
                opties={ROLES}
                waarde={waarden.role ? [waarden.role] : []}
                onToggle={(sleutel) => kiesRolOfLocatie("role", sleutel)}
                groepLabel="Functie"
              />
            </Vraag>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Locatie" htmlFor="locatie" required>
                <Select
                  id="locatie"
                  value={waarden.locationId}
                  onChange={(e) => kiesRolOfLocatie("locationId", e.target.value)}
                >
                  {locaties.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {l.city}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Titel van de vacature"
                htmlFor="titel"
                required
                hint="We doen automatisch een voorstel; pas hem gerust aan."
              >
                <Input
                  id="titel"
                  placeholder="bijv. Mondhygiënist in Utrecht"
                  value={waarden.title}
                  onChange={(e) => {
                    setTitelZelfAangepast(true);
                    zet("title", e.target.value);
                  }}
                />
              </Field>
            </div>
            <Vraag
              titel="Minimaal ervaringsniveau"
              hint="Kies het niveau dat past — of laat het open als iedereen welkom is."
            >
              <div role="group" aria-label="Ervaringsniveau" className="flex flex-wrap gap-2">
                <Chip
                  selected={waarden.experienceLevel === null}
                  onClick={() => zet("experienceLevel", null)}
                >
                  Geen voorkeur
                </Chip>
                {EXPERIENCE_LEVELS.map((niveau) => (
                  <Chip
                    key={niveau}
                    selected={waarden.experienceLevel === niveau}
                    onClick={() => zet("experienceLevel", niveau)}
                  >
                    {label(niveau)}
                    {ERVARING_UITLEG[niveau] ? ` — ${ERVARING_UITLEG[niveau]}` : ""}
                  </Chip>
                ))}
              </div>
            </Vraag>
            <Field
              label="Korte omschrijving"
              htmlFor="omschrijving"
              hint="Een paar zinnen over de rol en jullie praktijk. Optioneel."
            >
              <Textarea
                id="omschrijving"
                rows={4}
                placeholder="bijv. Wegens groei zoeken we een collega voor drie dagen per week. Je werkt in een modern team met veel ruimte voor eigen inbreng."
                value={waarden.description}
                onChange={(e) => zet("description", e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {stap.id === "werkweek" ? (
          <>
            <StapKop
              kopRef={kopRef}
              titel="Welke werkweek"
              accent="vragen jullie?"
              intro={
                <>
                  Tik op een dagdeel om te wisselen tussen{" "}
                  <strong className="font-semibold text-ink">nodig</strong>,{" "}
                  <strong className="font-semibold text-ink">gewenst</strong> en niet
                  gevraagd. Hoe flexibeler het rooster, hoe meer kandidaten passen.
                </>
              }
            />
            <div className="glass-strong rounded-kaart-lg p-4 sm:p-6">
              <WeekGrid
                mode="vacancy"
                value={waarden.schedule}
                onChange={(waarde) => zet("schedule", waarde)}
              />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Uren per week (minimaal)" htmlFor="uren-min" required>
                <Select
                  id="uren-min"
                  value={String(waarden.hoursMin)}
                  onChange={(e) => zet("hoursMin", Number(e.target.value))}
                >
                  {UREN_OPTIES.map((uren) => (
                    <option key={uren} value={uren}>
                      {uren} uur
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Uren per week (maximaal)" htmlFor="uren-max" required>
                <Select
                  id="uren-max"
                  value={String(waarden.hoursMax)}
                  onChange={(e) => zet("hoursMax", Number(e.target.value))}
                >
                  {UREN_OPTIES.map((uren) => (
                    <option key={uren} value={uren}>
                      {uren} uur
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Vraag titel="Contractvorm" hint="Meerdere keuzes vergroten je bereik.">
              <ChipGroep
                opties={CONTRACT_TYPES}
                waarde={waarden.contractTypes}
                onToggle={(s) => zet("contractTypes", toggleIn(waarden.contractTypes, s))}
                groepLabel="Contractvorm"
              />
            </Vraag>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Gewenste startdatum"
                htmlFor="startdatum"
                hint="Laat leeg voor 'in overleg'."
              >
                <Input
                  id="startdatum"
                  type="date"
                  value={waarden.startBy ?? ""}
                  onChange={(e) => zet("startBy", e.target.value || null)}
                />
              </Field>
            </div>
            {waarden.startBy !== null ? (
              <Vraag titel="Hoe hard is die startdatum?">
                <div className="flex flex-col gap-3">
                  <KeuzeKaart
                    actief={!waarden.startByHard}
                    titel="Flexibel"
                    uitleg="Iets later starten is bespreekbaar — kandidaten die net na deze datum kunnen, blijven matchen."
                    onKies={() => zet("startByHard", false)}
                  />
                  <KeuzeKaart
                    actief={waarden.startByHard}
                    titel="Harde deadline"
                    uitleg="De startdatum staat vast — kandidaten die pas later kunnen, vallen af als match."
                    onKies={() => zet("startByHard", true)}
                  />
                </div>
              </Vraag>
            ) : null}
            <Vraag
              titel="Salaris of omzetpercentage (optioneel)"
              hint="Een indicatie helpt kandidaten inschatten of het past."
            >
              <div className="grid gap-5 sm:grid-cols-2">
                {waarden.contractTypes.includes("loondienst") ||
                waarden.contractTypes.length === 0 ? (
                  <>
                    <Field label="Bruto per maand, vanaf" htmlFor="salaris-min">
                      <Input
                        id="salaris-min"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={50}
                        placeholder="bijv. 3400"
                        value={waarden.salaryMin ?? ""}
                        onChange={(e) =>
                          zet("salaryMin", e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Bruto per maand, tot" htmlFor="salaris-max">
                      <Input
                        id="salaris-max"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={50}
                        placeholder="bijv. 4300"
                        value={waarden.salaryMax ?? ""}
                        onChange={(e) =>
                          zet("salaryMax", e.target.value === "" ? null : Number(e.target.value))
                        }
                      />
                    </Field>
                  </>
                ) : null}
                {waarden.contractTypes.includes("zzp") ? (
                  <Field
                    label="Omzetpercentage (zzp)"
                    htmlFor="omzetpercentage"
                    hint="Gebruikelijk is 40–55% van de gedraaide omzet."
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        id="omzetpercentage"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={1}
                        placeholder="bijv. 45"
                        value={waarden.revenueShareMax ?? ""}
                        onChange={(e) =>
                          zet(
                            "revenueShareMax",
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                      <span aria-hidden="true" className="text-sm font-semibold text-ink/70">
                        %
                      </span>
                    </div>
                  </Field>
                ) : null}
              </div>
            </Vraag>
          </>
        ) : null}

        {stap.id === "eisen" ? (
          <>
            <StapKop
              kopRef={kopRef}
              titel="Eisen én"
              accent="aanbod"
              intro="Kies per groep wat jullie zoeken en hoe zwaar het telt. Denk ook aan wat júllie bieden — begeleiding en ontwikkelaanbod leveren extra matches op met kandidaten die willen leren."
            />
            <div className="flex flex-col gap-4">
              {CRITERIA_GROEPEN.map((groep) => (
                <CriteriaGroep
                  key={groep.sleutel}
                  titel={groep.titel}
                  hint={groep.hint}
                  opties={groep.opties}
                  waarde={waarden[groep.sleutel]}
                  onChange={(waarde) => zet(groep.sleutel, waarde)}
                />
              ))}
            </div>
            <Vraag
              titel="Praktijkcultuur"
              hint="Hoe zouden jullie de sfeer omschrijven?"
            >
              <ChipGroep
                opties={CULTURE}
                waarde={waarden.culture}
                onToggle={(s) => zet("culture", toggleIn(waarden.culture, s))}
                groepLabel="Praktijkcultuur"
              />
            </Vraag>
            <Vraag titel="Begeleiding">
              <div className="flex flex-col gap-3">
                <KeuzeKaart
                  actief={waarden.mentorship}
                  titel="Ja, wij bieden begeleiding"
                  uitleg="Mentorschap of inwerkbegeleiding — jullie matchen hiermee ook met kandidaten die een techniek nog willen leren."
                  onKies={() => zet("mentorship", true)}
                />
                <KeuzeKaart
                  actief={!waarden.mentorship}
                  titel="Nee, zelfstandig werken"
                  uitleg="De kandidaat werkt vanaf de start zelfstandig."
                  onKies={() => zet("mentorship", false)}
                />
              </div>
            </Vraag>
            <Vraag titel="Ontwikkelaanbod" hint="Wat bieden jullie aan groei en opleiding?">
              <ChipGroep
                opties={DEVELOPMENT}
                waarde={waarden.development}
                onToggle={(s) => zet("development", toggleIn(waarden.development, s))}
                groepLabel="Ontwikkelaanbod"
              />
            </Vraag>
          </>
        ) : null}

        {stap.id === "radar" ? (
          <>
            <StapKop
              kopRef={kopRef}
              titel="Talent Radar:"
              accent="je potentieel"
              intro="Nog vóór je publiceert zie je hoeveel kandidaten in de regio bij deze vacature kunnen passen. Zo weet je of je eisen realistisch zijn."
            />
            <RadarWeergave
              slug={slug}
              radar={radar}
              radarFout={radarFout}
            />
          </>
        ) : null}

        {stap.id === "publiceren" ? (
          <>
            <StapKop
              kopRef={kopRef}
              titel="Klaar om te"
              accent="publiceren?"
              intro="Controleer de samenvatting. Na publicatie zien passende kandidaten deze vacature direct in hun matchfeed."
            />
            <div className="glass-strong flex flex-col gap-5 rounded-kaart-lg p-6">
              <h2 className="text-lg font-semibold text-ink">Samenvatting</h2>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <SamenvattingRij term="Titel" waarde={waarden.title || "—"} />
                <SamenvattingRij
                  term="Functie en locatie"
                  waarde={
                    waarden.role
                      ? `${label(waarden.role)}${locatie ? ` · ${locatie.city}` : ""}`
                      : "—"
                  }
                />
                <SamenvattingRij
                  term="Werkweek"
                  waarde={samenvattingRooster(waarden.schedule)}
                />
                <SamenvattingRij
                  term="Uren en contract"
                  waarde={`${waarden.hoursMin}–${waarden.hoursMax} uur · ${
                    waarden.contractTypes.length > 0
                      ? waarden.contractTypes.map(label).join(", ")
                      : "geen contractvorm gekozen"
                  }`}
                />
                <SamenvattingRij
                  term="Eisen"
                  waarde={samenvattingEisen(waarden)}
                />
                <SamenvattingRij
                  term="Aanbod"
                  waarde={
                    [
                      waarden.mentorship ? "begeleiding" : null,
                      waarden.development.length > 0
                        ? `${waarden.development.length} ontwikkelmogelijkheden`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Nog niets aangegeven"
                  }
                />
              </dl>

              {limietMelding ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-veld bg-roze-100 px-4 py-3"
                >
                  <p className="text-sm font-medium text-roze-800">{limietMelding}</p>
                  <Link
                    href={`${basisRoute}/abonnement`}
                    className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
                  >
                    Bekijk je abonnement en upgrade-opties
                  </Link>
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                <Button size="lg" className="w-full" onClick={publiceer} disabled={bezig}>
                  {bezig ? "Publiceren…" : "Publiceer vacature"}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={bewaarConcept}
                  disabled={bezig}
                >
                  Bewaar als concept
                </Button>
                <p className="text-sm text-ink/60">
                  Een concept telt niet mee voor je vacaturelimiet en is voor
                  kandidaten onzichtbaar. Je vindt het terug op je dashboard.
                </p>
              </div>
            </div>
          </>
        ) : null}

        {fout ? (
          <p
            role="alert"
            className="rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800"
          >
            {fout}
          </p>
        ) : null}

        {/* navigatie */}
        {!laatsteStap ? (
          <div className="mt-2 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            {stapIndex > 0 ? (
              <Button variant="ghost" size="lg" onClick={terug} disabled={bezig}>
                <span aria-hidden="true">←</span> Terug
              </Button>
            ) : (
              <span aria-hidden="true" />
            )}
            <Button size="lg" onClick={verder} disabled={bezig} className="sm:min-w-44">
              {bezig ? "Opslaan…" : "Verder"}
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex">
            <Button variant="ghost" size="lg" onClick={terug} disabled={bezig}>
              <span aria-hidden="true">←</span> Terug
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Talent Radar-weergave                                               */
/* ------------------------------------------------------------------ */

function RadarWeergave({
  slug,
  radar,
  radarFout,
}: {
  slug: string;
  radar: RadarPreview | null;
  radarFout: string | null;
}) {
  if (radarFout) {
    return (
      <p
        role="alert"
        className="rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800"
      >
        {radarFout}
      </p>
    );
  }
  if (radar === null) {
    return (
      <div className="glass flex items-center gap-3 rounded-kaart p-6" aria-live="polite">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-pulse rounded-full bg-blauw-600"
        />
        <p className="text-[15px] font-medium text-ink/70">
          We tellen de kandidaten in jouw regio…
        </p>
      </div>
    );
  }

  const { teaser, rapport } = radar;

  return (
    <div className="flex flex-col gap-4">
      {/* teaser: totaal potentieel — voor iedereen */}
      <div className="glass-strong flex flex-col gap-3 rounded-kaart-lg p-6">
        {teaser.totalPotential !== null ? (
          <>
            <Stat
              value={teaser.totalPotential}
              label="potentiële kandidaten: actieve profielen met deze functie binnen hun eigen maximale reistijd van jouw locatie"
            />
          </>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink/80">
            Er zijn op dit moment minder dan {teaser.minGroupSize} potentiële
            kandidaten in de regio. Om kandidaten te beschermen tonen we dan
            geen exacte aantallen — versoepel je eisen of rooster om je bereik
            te vergroten.
          </p>
        )}
      </div>

      {rapport !== null ? (
        <div className="glass flex flex-col gap-5 rounded-kaart-lg p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-ink">Volledig rapport</h2>
            <Badge tone={rapport.difficulty === "hoog" ? "roze" : "blauw"}>
              Wervingsmoeilijkheid: {rapport.difficulty}
            </Badge>
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <SamenvattingRij
              term={`Sterke matches (score ≥ 70%)`}
              waarde={
                rapport.strongMatches !== null
                  ? String(rapport.strongMatches)
                  : `minder dan ${rapport.minGroupSize} — niet getoond`
              }
            />
            <SamenvattingRij
              term="Gedeeltelijke matches (score 50–69%)"
              waarde={
                rapport.partialMatches !== null
                  ? String(rapport.partialMatches)
                  : `minder dan ${rapport.minGroupSize} — niet getoond`
              }
            />
          </dl>

          {rapport.perDay.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-[15px] font-semibold text-ink">
                Beschikbare kandidaten per gevraagde dag
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {rapport.perDay.map((dag) => (
                  <li
                    key={dag.day}
                    className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-ink">{label(dag.day)}</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {dag.count !== null ? dag.count : "—"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink/60">
                Een streepje betekent: minder dan {rapport.minGroupSize}{" "}
                kandidaten — te weinig om veilig te tonen.
              </p>
            </div>
          ) : null}

          {rapport.mostLimiting ? (
            <div className="rounded-kaart border-2 border-roze-200 bg-roze-50/70 p-4">
              <p className="text-sm leading-relaxed text-ink/85">
                <strong className="font-semibold text-ink">
                  Meest beperkend:
                </strong>{" "}
                {rapport.mostLimiting.label}.{" "}
                {rapport.mostLimiting.extraEligible !== null
                  ? `Versoepelen levert ongeveer ${rapport.mostLimiting.extraEligible} extra passende kandidaten op.`
                  : "Versoepelen vergroot je pool — het precieze aantal ligt onder de privacydrempel."}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="glass flex flex-col gap-3 rounded-kaart-lg p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">
              Wil je het volledige rapport?
            </h2>
            <Badge tone="roze">Talent Radar</Badge>
          </div>
          <p className="text-[15px] leading-relaxed text-ink/70">
            Met Talent Radar zie je per dag hoeveel kandidaten beschikbaar
            zijn, hoeveel sterke matches er nu al zijn en welke eis je pool het
            meest beperkt. Beschikbaar vanaf het Growth-plan.
          </p>
          <Link
            href={`/praktijk/${slug}/abonnement`}
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Bekijk de abonnementen
          </Link>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Samenvattingshulpjes                                                */
/* ------------------------------------------------------------------ */

function SamenvattingRij({ term, waarde }: { term: string; waarde: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/50">
        {term}
      </dt>
      <dd className="font-medium text-ink">{waarde}</dd>
    </div>
  );
}

function samenvattingRooster(schedule: VacancySchedule): string {
  let nodig = 0;
  let gewenst = 0;
  for (const dag of WEEKDAYS) {
    for (const deel of DAYPARTS) {
      if (schedule[dag][deel] === "required") nodig += 1;
      else if (schedule[dag][deel] === "preferred") gewenst += 1;
    }
  }
  if (nodig + gewenst === 0) return "Nog geen dagdelen gevraagd";
  const delen: string[] = [];
  if (nodig > 0) delen.push(`${nodig} dagde${nodig === 1 ? "el" : "len"} nodig`);
  if (gewenst > 0) {
    delen.push(`${gewenst} dagde${gewenst === 1 ? "el" : "len"} gewenst`);
  }
  return delen.join(" · ");
}

function samenvattingEisen(w: VacatureWaarden): string {
  const groepen = [
    w.registrations,
    w.equipment,
    w.software,
    w.specializations,
    w.treatments,
    w.population,
  ];
  const vereist = groepen.filter(
    (g) => g.values.length > 0 && g.level === "required",
  ).length;
  const totaal = groepen.reduce((som, g) => som + g.values.length, 0);
  if (totaal === 0) return "Geen specifieke eisen";
  return `${totaal} criteria${vereist > 0 ? ` · ${vereist} ${vereist === 1 ? "groep" : "groepen"} vereist` : ""}`;
}
