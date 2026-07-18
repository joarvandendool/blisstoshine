"use client";

// Onboarding-flow van de kandidaat — het paradepaardje van Mondzorgwerkt.
// Voelt als je ideale werkweek samenstellen, niet als een formulier invullen:
// één vraaggroep per stap, grote tap-targets, veel witruimte en de werkweek
// (WeekGrid) groot en centraal als kern van de merkbelofte.
//
// Elke stap wordt direct opgeslagen via saveProfileStepAction; afronden loopt
// via activateProfileAction (die doorstuurt naar /kandidaat). Geselecteerde
// staten worden nooit alléén met kleur getoond (vinkje/badge + kleur).

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  Button,
  Chip,
  Field,
  Input,
  ProgressBar,
  Select,
  cx,
} from "@/components/ui";
import WeekGrid from "@/components/WeekGrid";
import {
  CONTRACT_TYPES,
  DAYPARTS,
  DEVELOPMENT,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PATIENT_POPULATION,
  PRACTICE_SIZES,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  TEAM_PREFERENCES,
  TREATMENTS,
  WEEKDAYS,
  WORK_PACES,
  label,
  type CandidateAvailability,
} from "@/domain/taxonomy";
import { activateProfileAction, saveProfileStepAction } from "./actions";

/* ------------------------------------------------------------------ */
/* Gedeelde types en hulpjes (ook gebruikt door de profielpagina)      */
/* ------------------------------------------------------------------ */

export type Zichtbaarheid = "visible" | "anonymous" | "hidden";

/** Plat, serialiseerbaar profielmodel voor de client (geld in hele euro's). */
export interface ProfielWaarden {
  role: string;
  experienceLevel: string;
  availability: CandidateAvailability;
  postcode: string;
  maxTravelMinutes: number;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  /** yyyy-mm-dd of null. */
  availableFrom: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  hourlyRateMin: number | null;
  equipmentExperience: string[];
  techniquesWantsToLearn: string[];
  softwareSkills: string[];
  specializations: string[];
  treatmentInterests: string[];
  preferredPopulation: string[];
  preferredPracticeSize: string | null;
  workPace: string | null;
  teamPreferences: string[];
  mentorshipNeeded: boolean;
  developmentGoals: string[];
  visibility: Zichtbaarheid;
}

export const REISTIJD_OPTIES = [10, 15, 20, 30, 45, 60, 90] as const;

export const ZICHTBAARHEID_OPTIES: ReadonlyArray<{
  waarde: Zichtbaarheid;
  titel: string;
  uitleg: string;
  aanbevolen?: boolean;
}> = [
  {
    waarde: "anonymous",
    titel: "Anoniem zichtbaar",
    aanbevolen: true,
    uitleg:
      "Praktijken met een goede match zien je profiel zónder naam of contactgegevens. Pas als jij op een uitnodiging ingaat, zien ze wie je bent.",
  },
  {
    waarde: "visible",
    titel: "Zichtbaar met naam",
    uitleg:
      "Praktijken met een goede match zien je naam bij je profiel en kunnen je direct uitnodigen. Handig als je actief zoekt.",
  },
  {
    waarde: "hidden",
    titel: "Verborgen",
    uitleg:
      "Praktijken kunnen je niet vinden. Je blijft zelf matches zien en kunt altijd zelf solliciteren.",
  },
];

/** Minstens één dagdeel waarop de kandidaat kan werken? */
export function heeftDagdeel(availability: CandidateAvailability): boolean {
  return WEEKDAYS.some((dag) =>
    DAYPARTS.some((deel) => availability[dag][deel] !== "unavailable"),
  );
}

/**
 * Clientspiegel van de volledigheidsscore (zes kerngroepen) — puur voor
 * directe weergave; de server (src/server/candidates) blijft de bron van
 * waarheid en rekent bij elke opslag opnieuw.
 */
export function berekenVolledigheidClient(
  w: ProfielWaarden,
  zichtbaarheidBevestigd: boolean,
): number {
  const groepen = [
    w.role.length > 0 && w.experienceLevel.length > 0 && w.postcode.length > 0,
    heeftDagdeel(w.availability),
    w.maxTravelMinutes > 0 && w.hoursMin > 0 && w.hoursMax >= w.hoursMin,
    w.equipmentExperience.length > 0 ||
      w.softwareSkills.length > 0 ||
      w.specializations.length > 0 ||
      w.treatmentInterests.length > 0,
    w.preferredPracticeSize !== null ||
      w.workPace !== null ||
      w.teamPreferences.length > 0 ||
      w.preferredPopulation.length > 0 ||
      w.developmentGoals.length > 0 ||
      w.mentorshipNeeded,
    zichtbaarheidBevestigd,
  ];
  return Math.round((groepen.filter(Boolean).length / groepen.length) * 100);
}

/** Meerkeuze-chipgroep op basis van taxonomiesleutels. */
export function ChipGroep({
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

/** Enkelkeuze-chipgroep (radio-gedrag): opnieuw klikken deselecteert niet. */
export function EnkeleKeuzeChips({
  opties,
  waarde,
  onKies,
  groepLabel,
  groot = false,
}: {
  opties: readonly string[];
  waarde: string | null;
  onKies: (sleutel: string) => void;
  groepLabel: string;
  groot?: boolean;
}) {
  return (
    <div role="group" aria-label={groepLabel} className="flex flex-wrap gap-2">
      {opties.map((sleutel) => (
        <Chip
          key={sleutel}
          selected={waarde === sleutel}
          onClick={() => onKies(sleutel)}
          className={groot ? "px-5 py-3 text-base" : undefined}
        >
          {label(sleutel)}
        </Chip>
      ))}
    </div>
  );
}

/** Grote keuzekaart (titel + uitleg) — selectie via rand, badge én vinkje. */
export function KeuzeKaart({
  actief,
  titel,
  uitleg,
  badge,
  onKies,
}: {
  actief: boolean;
  titel: string;
  uitleg: string;
  badge?: string;
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
        {badge ? (
          <span className="rounded-full bg-roze-100 px-2.5 py-0.5 text-xs font-semibold text-roze-800">
            {badge}
          </span>
        ) : null}
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

/* ------------------------------------------------------------------ */
/* Stappen                                                             */
/* ------------------------------------------------------------------ */

const STAPPEN = [
  { id: "functie", kort: "Functie" },
  { id: "werkweek", kort: "Werkweek" },
  { id: "locatie", kort: "Waar en hoeveel" },
  { id: "vakinhoud", kort: "Vakinhoud" },
  { id: "werkplek", kort: "Werkplek" },
  { id: "zichtbaarheid", kort: "Zichtbaarheid" },
] as const;

type StapId = (typeof STAPPEN)[number]["id"];

const ERVARING_UITLEG: Record<string, string> = {
  starter: "Net begonnen, of minder dan 2 jaar ervaring",
  medior: "2 tot 7 jaar ervaring",
  senior: "Meer dan 7 jaar ervaring",
};

const UREN_OPTIES = Array.from({ length: 40 }, (_, i) => i + 1);

/** Clientvalidatie vóór opslaan — de server valideert daarna nogmaals. */
function valideerStap(id: StapId, w: ProfielWaarden): string | null {
  switch (id) {
    case "functie":
      if (!w.role) return "Kies eerst je functie.";
      if (!w.experienceLevel) return "Kies ook je ervaringsniveau.";
      return null;
    case "werkweek":
      return heeftDagdeel(w.availability)
        ? null
        : "Tik minstens één dagdeel aan waarop je kunt werken.";
    case "locatie":
      if (!/^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/.test(w.postcode.trim())) {
        return "Vul een geldige postcode in, bijvoorbeeld 3511 AB.";
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

/** Payload voor saveProfileStepAction, per stap. */
function stapPayload(id: StapId, w: ProfielWaarden): unknown {
  switch (id) {
    case "functie":
      return { stap: "functie", role: w.role, experienceLevel: w.experienceLevel };
    case "werkweek":
      return { stap: "werkweek", availability: w.availability };
    case "locatie":
      return {
        stap: "locatie",
        postcode: w.postcode.trim(),
        maxTravelMinutes: w.maxTravelMinutes,
        hoursMin: w.hoursMin,
        hoursMax: w.hoursMax,
        contractTypes: w.contractTypes,
        availableFrom: w.availableFrom,
        salaryMin: w.salaryMin,
        salaryMax: w.salaryMax,
        hourlyRateMin: w.hourlyRateMin,
      };
    case "vakinhoud":
      return {
        stap: "vakinhoud",
        equipmentExperience: w.equipmentExperience,
        techniquesWantsToLearn: w.techniquesWantsToLearn,
        softwareSkills: w.softwareSkills,
        specializations: w.specializations,
        treatmentInterests: w.treatmentInterests,
      };
    case "werkplek":
      return {
        stap: "werkplek",
        preferredPopulation: w.preferredPopulation,
        preferredPracticeSize: w.preferredPracticeSize,
        workPace: w.workPace,
        teamPreferences: w.teamPreferences,
        mentorshipNeeded: w.mentorshipNeeded,
        developmentGoals: w.developmentGoals,
      };
    case "zichtbaarheid":
      return { stap: "zichtbaarheid", visibility: w.visibility };
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

function Vraag({ titel, hint, children }: { titel: string; hint?: string; children: ReactNode }) {
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

function toggleIn(lijst: string[], sleutel: string): string[] {
  return lijst.includes(sleutel)
    ? lijst.filter((s) => s !== sleutel)
    : [...lijst, sleutel];
}

/* ------------------------------------------------------------------ */
/* De flow zelf                                                        */
/* ------------------------------------------------------------------ */

export interface OnboardingFlowProps {
  initieel: ProfielWaarden;
  /** Laatst bekende serverscore (0–100). */
  volledigheid: number;
  /** Heeft de kandidaat de zichtbaarheidskeuze al eens bevestigd? */
  zichtbaarheidBevestigd: boolean;
  voornaam: string;
}

export function OnboardingFlow({
  initieel,
  volledigheid: initieleVolledigheid,
  zichtbaarheidBevestigd: bevestigdInitieel,
  voornaam,
}: OnboardingFlowProps) {
  const [waarden, setWaarden] = useState<ProfielWaarden>(initieel);
  const [stapIndex, setStapIndex] = useState(0);
  const [fout, setFout] = useState<string | null>(null);
  const [volledigheid, setVolledigheid] = useState(initieleVolledigheid);
  const [zichtbaarheidGekozen, setZichtbaarheidGekozen] = useState(bevestigdInitieel);
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
  const laatsteStap = stapIndex === STAPPEN.length - 1;

  const zet = <K extends keyof ProfielWaarden>(veld: K, waarde: ProfielWaarden[K]) =>
    setWaarden((w) => ({ ...w, [veld]: waarde }));

  function verder() {
    setFout(null);
    const melding = valideerStap(stap.id, waarden);
    if (melding) {
      setFout(melding);
      return;
    }
    startTransition(async () => {
      const res = await saveProfileStepAction(stapPayload(stap.id, waarden));
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      setVolledigheid(res.volledigheid);
      setStapIndex((i) => Math.min(i + 1, STAPPEN.length - 1));
    });
  }

  function terug() {
    setFout(null);
    setStapIndex((i) => Math.max(0, i - 1));
  }

  function activeer() {
    setFout(null);
    if (!zichtbaarheidGekozen) {
      setFout("Kies eerst hoe zichtbaar je profiel mag zijn.");
      return;
    }
    startTransition(async () => {
      const res = await activateProfileAction({
        stap: "zichtbaarheid",
        visibility: waarden.visibility,
      });
      // Bij succes stuurt de server action door naar /kandidaat en komen we
      // hier niet meer; alleen fouten bereiken deze regel.
      if (res && !res.ok) setFout(res.fout);
    });
  }

  const clientVolledigheid = berekenVolledigheidClient(waarden, zichtbaarheidGekozen);

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-surface text-ink">
      {/* dromerige achtergrond-orbs — puur decoratief */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb orb-blauw animate-zweef-traag -top-44 -right-40 h-[32rem] w-[32rem]" />
        <div className="orb orb-roze animate-zweef -bottom-32 -left-36 h-[28rem] w-[28rem] opacity-35" />
        <div className="orb orb-paars top-1/3 -left-52 h-[22rem] w-[22rem]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        {/* voortgang bovenin */}
        <header className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight text-ink"
              aria-label="mondzorgwerkt — naar de homepage"
            >
              mondzorg<em className="font-serif italic font-bold">werkt</em>
            </Link>
            <p className="text-sm font-semibold text-ink/70">
              Stap {stapIndex + 1} van {STAPPEN.length}
              <span className="hidden sm:inline"> · {stap.kort}</span>
            </p>
          </div>
          <ProgressBar
            value={stapIndex + 1}
            max={STAPPEN.length}
            label={`Onboarding: stap ${stapIndex + 1} van ${STAPPEN.length} — ${stap.kort}`}
          />
        </header>

        {/* één vraaggroep per stap */}
        <section aria-label={stap.kort} className="mt-8 flex flex-1 flex-col gap-7 sm:mt-10">
          {stap.id === "functie" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Wat"
                accent="doe je?"
                intro={`Welkom ${voornaam}. In zes korte stappen stel je samen hoe jouw ideale werkweek eruitziet — praktijken matchen daarna op wat jij belangrijk vindt.`}
              />
              <Vraag titel="Jouw functie">
                <ChipGroep
                  groot
                  opties={ROLES}
                  waarde={waarden.role ? [waarden.role] : []}
                  onToggle={(sleutel) => zet("role", sleutel)}
                  groepLabel="Functie"
                />
              </Vraag>
              <Vraag titel="Jouw ervaringsniveau">
                <div className="flex flex-col gap-3">
                  {EXPERIENCE_LEVELS.map((niveau) => (
                    <KeuzeKaart
                      key={niveau}
                      actief={waarden.experienceLevel === niveau}
                      titel={label(niveau)}
                      uitleg={ERVARING_UITLEG[niveau] ?? ""}
                      onKies={() => zet("experienceLevel", niveau)}
                    />
                  ))}
                </div>
              </Vraag>
            </>
          ) : null}

          {stap.id === "werkweek" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Jouw ideale"
                accent="werkweek"
                intro={
                  <>
                    Tik op een dagdeel om te wisselen tussen{" "}
                    <strong className="font-semibold text-ink">voorkeur</strong>,{" "}
                    <strong className="font-semibold text-ink">beschikbaar</strong> en niet
                    beschikbaar. Dagdelen met voorkeur tellen zwaarder mee in je matches — zo
                    vind je werk dat écht in jouw week past.
                  </>
                }
              />
              <div className="glass-strong rounded-kaart-lg p-4 sm:p-6">
                <WeekGrid
                  mode="candidate"
                  value={waarden.availability}
                  onChange={(waarde) => zet("availability", waarde)}
                />
              </div>
            </>
          ) : null}

          {stap.id === "locatie" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Waar en"
                accent="hoeveel?"
                intro="We rekenen met reistijd vanaf jouw postcode — je adres blijft privé en praktijken zien alleen of je binnen bereik woont."
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Postcode" htmlFor="postcode" required>
                  <Input
                    id="postcode"
                    name="postcode"
                    autoComplete="postal-code"
                    placeholder="3511 AB"
                    value={waarden.postcode}
                    onChange={(e) => zet("postcode", e.target.value)}
                  />
                </Field>
                <Field label="Maximale reistijd" htmlFor="reistijd" required>
                  <Select
                    id="reistijd"
                    value={String(waarden.maxTravelMinutes)}
                    onChange={(e) => zet("maxTravelMinutes", Number(e.target.value))}
                  >
                    {[...new Set([...REISTIJD_OPTIES, waarden.maxTravelMinutes])]
                      .sort((a, b) => a - b)
                      .map((minuten) => (
                        <option key={minuten} value={minuten}>
                          {minuten} minuten
                        </option>
                      ))}
                  </Select>
                </Field>
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
              <Vraag titel="Contractvorm" hint="Meerdere keuzes mogelijk.">
                <ChipGroep
                  opties={CONTRACT_TYPES}
                  waarde={waarden.contractTypes}
                  onToggle={(s) => zet("contractTypes", toggleIn(waarden.contractTypes, s))}
                  groepLabel="Contractvorm"
                />
              </Vraag>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Beschikbaar vanaf"
                  htmlFor="startdatum"
                  hint="Laat leeg als je per direct kunt starten."
                >
                  <Input
                    id="startdatum"
                    type="date"
                    value={waarden.availableFrom ?? ""}
                    onChange={(e) => zet("availableFrom", e.target.value || null)}
                  />
                </Field>
              </div>
              <Vraag
                titel="Salarisindicatie (optioneel)"
                hint="Alleen zichtbaar in de match-berekening, nooit letterlijk bij praktijken."
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
                          placeholder="bijv. 3200"
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
                          placeholder="bijv. 4100"
                          value={waarden.salaryMax ?? ""}
                          onChange={(e) =>
                            zet("salaryMax", e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </Field>
                    </>
                  ) : null}
                  {waarden.contractTypes.includes("zzp") ? (
                    <Field label="Uurtarief vanaf (zzp)" htmlFor="uurtarief">
                      <Input
                        id="uurtarief"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={5}
                        placeholder="bijv. 85"
                        value={waarden.hourlyRateMin ?? ""}
                        onChange={(e) =>
                          zet(
                            "hourlyRateMin",
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                    </Field>
                  ) : null}
                </div>
              </Vraag>
            </>
          ) : null}

          {stap.id === "vakinhoud" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Jouw"
                accent="vakinhoud"
                intro="Waar heb je ervaring mee — en minstens zo belangrijk: wat wil je nog leren? Alles is optioneel, maar hoe meer je aangeeft, hoe scherper je matches."
              />
              <Vraag titel="Apparatuur waar je ervaring mee hebt">
                <ChipGroep
                  opties={EQUIPMENT}
                  waarde={waarden.equipmentExperience}
                  onToggle={(s) =>
                    zet("equipmentExperience", toggleIn(waarden.equipmentExperience, s))
                  }
                  groepLabel="Apparatuurervaring"
                />
              </Vraag>
              <div className="rounded-kaart border-2 border-roze-200 bg-roze-50/70 p-5 backdrop-blur">
                <Vraag
                  titel="Wil je leren?"
                  hint="Kies apparatuur of technieken die je nog niet beheerst maar graag onder de knie krijgt. Praktijken die begeleiding bieden zien dit als een pluspunt — leren levert je hier juist matches op."
                >
                  <ChipGroep
                    opties={EQUIPMENT}
                    waarde={waarden.techniquesWantsToLearn}
                    onToggle={(s) =>
                      zet("techniquesWantsToLearn", toggleIn(waarden.techniquesWantsToLearn, s))
                    }
                    groepLabel="Wil ik leren"
                  />
                </Vraag>
              </div>
              <Vraag titel="Praktijksoftware die je kent">
                <ChipGroep
                  opties={SOFTWARE}
                  waarde={waarden.softwareSkills}
                  onToggle={(s) => zet("softwareSkills", toggleIn(waarden.softwareSkills, s))}
                  groepLabel="Software"
                />
              </Vraag>
              <Vraag titel="Specialisaties">
                <ChipGroep
                  opties={SPECIALIZATIONS}
                  waarde={waarden.specializations}
                  onToggle={(s) => zet("specializations", toggleIn(waarden.specializations, s))}
                  groepLabel="Specialisaties"
                />
              </Vraag>
              <Vraag titel="Behandelingen die je graag doet">
                <ChipGroep
                  opties={TREATMENTS}
                  waarde={waarden.treatmentInterests}
                  onToggle={(s) =>
                    zet("treatmentInterests", toggleIn(waarden.treatmentInterests, s))
                  }
                  groepLabel="Behandelinteresses"
                />
              </Vraag>
            </>
          ) : null}

          {stap.id === "werkplek" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Jouw ideale"
                accent="werkplek"
                intro="Werkplezier zit ook in de omgeving: het team, het tempo en de ruimte om te groeien. Vertel wat bij jou past."
              />
              <Vraag titel="Patiëntgroepen waar je energie van krijgt">
                <ChipGroep
                  opties={PATIENT_POPULATION}
                  waarde={waarden.preferredPopulation}
                  onToggle={(s) =>
                    zet("preferredPopulation", toggleIn(waarden.preferredPopulation, s))
                  }
                  groepLabel="Patiëntgroepen"
                />
              </Vraag>
              <Vraag titel="Praktijkgrootte">
                <EnkeleKeuzeChips
                  opties={PRACTICE_SIZES}
                  waarde={waarden.preferredPracticeSize}
                  onKies={(s) => zet("preferredPracticeSize", s)}
                  groepLabel="Praktijkgrootte"
                />
              </Vraag>
              <Vraag titel="Werktempo">
                <EnkeleKeuzeChips
                  opties={WORK_PACES}
                  waarde={waarden.workPace}
                  onKies={(s) => zet("workPace", s)}
                  groepLabel="Werktempo"
                />
              </Vraag>
              <Vraag titel="Team">
                <ChipGroep
                  opties={TEAM_PREFERENCES}
                  waarde={waarden.teamPreferences}
                  onToggle={(s) => zet("teamPreferences", toggleIn(waarden.teamPreferences, s))}
                  groepLabel="Teamvoorkeuren"
                />
              </Vraag>
              <Vraag titel="Begeleiding">
                <div className="flex flex-col gap-3">
                  <KeuzeKaart
                    actief={waarden.mentorshipNeeded}
                    titel="Ja, graag begeleiding"
                    uitleg="Je matcht sterker met praktijken die mentorschap of inwerkbegeleiding bieden."
                    onKies={() => zet("mentorshipNeeded", true)}
                  />
                  <KeuzeKaart
                    actief={!waarden.mentorshipNeeded}
                    titel="Niet nodig"
                    uitleg="Je werkt het liefst direct zelfstandig."
                    onKies={() => zet("mentorshipNeeded", false)}
                  />
                </div>
              </Vraag>
              <Vraag titel="Ontwikkelambities">
                <ChipGroep
                  opties={DEVELOPMENT}
                  waarde={waarden.developmentGoals}
                  onToggle={(s) => zet("developmentGoals", toggleIn(waarden.developmentGoals, s))}
                  groepLabel="Ontwikkelambities"
                />
              </Vraag>
            </>
          ) : null}

          {stap.id === "zichtbaarheid" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Wie mag jou"
                accent="zien?"
                intro="Jij bepaalt wie je profiel ziet — en je kunt dit op elk moment aanpassen. Je adres en contactgegevens zijn nooit zichtbaar voor praktijken."
              />
              <div className="flex flex-col gap-3" role="group" aria-label="Zichtbaarheid van je profiel">
                {ZICHTBAARHEID_OPTIES.map((optie) => (
                  <KeuzeKaart
                    key={optie.waarde}
                    actief={zichtbaarheidGekozen && waarden.visibility === optie.waarde}
                    titel={optie.titel}
                    uitleg={optie.uitleg}
                    badge={optie.aanbevolen ? "Aanbevolen" : undefined}
                    onKies={() => {
                      zet("visibility", optie.waarde);
                      setZichtbaarheidGekozen(true);
                    }}
                  />
                ))}
              </div>

              {/* samenvatting + volledigheid */}
              <div className="glass-strong flex flex-col gap-5 rounded-kaart-lg p-6">
                <h2 className="text-lg font-semibold text-ink">
                  Jouw profiel in het kort
                </h2>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <SamenvattingRij
                    term="Functie"
                    waarde={
                      waarden.role
                        ? `${label(waarden.role)} · ${label(waarden.experienceLevel)}`
                        : "Nog niet ingevuld"
                    }
                  />
                  <SamenvattingRij
                    term="Werkweek"
                    waarde={samenvattingWerkweek(waarden.availability)}
                  />
                  <SamenvattingRij
                    term="Regio"
                    waarde={
                      waarden.postcode
                        ? `${waarden.postcode.toUpperCase()} · max ${waarden.maxTravelMinutes} min reizen`
                        : "Nog niet ingevuld"
                    }
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
                    term="Vakinhoud"
                    waarde={samenvattingVakinhoud(waarden)}
                  />
                  <SamenvattingRij
                    term="Zichtbaarheid"
                    waarde={
                      zichtbaarheidGekozen
                        ? ZICHTBAARHEID_OPTIES.find((o) => o.waarde === waarden.visibility)
                            ?.titel ?? "—"
                        : "Nog geen keuze gemaakt"
                    }
                  />
                </dl>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-semibold text-ink">Profielvolledigheid</p>
                  <ProgressBar
                    value={Math.max(clientVolledigheid, volledigheid)}
                    label="Profielvolledigheid"
                    showValue
                  />
                  <p className="text-sm text-ink/60">
                    Een vollediger profiel levert scherpere matches op. Je kunt alles later
                    bijwerken op je profielpagina.
                  </p>
                </div>
                <Button size="lg" className="w-full" onClick={activeer} disabled={bezig}>
                  {bezig ? "Profiel activeren…" : "Activeer mijn profiel"}
                </Button>
              </div>
            </>
          ) : null}

          {fout ? (
            <p role="alert" className="rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800">
              {fout}
            </p>
          ) : null}

          {/* navigatie */}
          <div className="mt-auto flex flex-col-reverse items-stretch gap-3 pb-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
            {stapIndex > 0 ? (
              <Button variant="ghost" size="lg" onClick={terug} disabled={bezig}>
                <span aria-hidden="true">←</span> Terug
              </Button>
            ) : (
              <span aria-hidden="true" />
            )}
            {!laatsteStap ? (
              <Button size="lg" onClick={verder} disabled={bezig} className="sm:min-w-44">
                {bezig ? "Opslaan…" : "Verder"}
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Samenvattingshulpjes                                                */
/* ------------------------------------------------------------------ */

function SamenvattingRij({ term, waarde }: { term: string; waarde: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/50">{term}</dt>
      <dd className="font-medium text-ink">{waarde}</dd>
    </div>
  );
}

function samenvattingWerkweek(availability: CandidateAvailability): string {
  let voorkeur = 0;
  let beschikbaar = 0;
  for (const dag of WEEKDAYS) {
    for (const deel of DAYPARTS) {
      if (availability[dag][deel] === "preferred") voorkeur += 1;
      else if (availability[dag][deel] === "available") beschikbaar += 1;
    }
  }
  if (voorkeur + beschikbaar === 0) return "Nog geen dagdelen gekozen";
  const delen: string[] = [];
  if (voorkeur > 0) delen.push(`${voorkeur} dagde${voorkeur === 1 ? "el" : "len"} voorkeur`);
  if (beschikbaar > 0) {
    delen.push(`${beschikbaar} dagde${beschikbaar === 1 ? "el" : "len"} beschikbaar`);
  }
  return delen.join(" · ");
}

function samenvattingVakinhoud(w: ProfielWaarden): string {
  const totaal =
    w.equipmentExperience.length +
    w.softwareSkills.length +
    w.specializations.length +
    w.treatmentInterests.length;
  const leren = w.techniquesWantsToLearn.length;
  if (totaal === 0 && leren === 0) return "Nog niets aangegeven";
  const delen: string[] = [];
  if (totaal > 0) delen.push(`${totaal} vaardigheden`);
  if (leren > 0) delen.push(`${leren} om te leren`);
  return delen.join(" · ");
}
