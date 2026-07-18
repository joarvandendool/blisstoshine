"use client";

// Profiel-editor van de kandidaat: dezelfde secties als de onboarding, maar
// compact bewerkbaar met opslaan per sectie. De werkweek staat prominent
// bovenaan ("Klopt je werkweek nog?") — actuele beschikbaarheid is de kern
// van goede matches en daarmee van retentie.
//
// Herbruikt bewust de bouwstenen van de onboarding-flow (ChipGroep,
// KeuzeKaart, ProfielWaarden) zodat beide schermen nooit uit elkaar lopen.

import { useState } from "react";
import { Badge, Button, Card, Chip, Field, Input, ProgressBar, Select, cx } from "@/components/ui";
import WeekGrid from "@/components/WeekGrid";
import {
  CONTRACT_TYPES,
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
  WORK_PACES,
  label,
} from "@/domain/taxonomy";
import {
  ChipGroep,
  EnkeleKeuzeChips,
  KeuzeKaart,
  REISTIJD_OPTIES,
  ZICHTBAARHEID_OPTIES,
  heeftDagdeel,
  type ProfielWaarden,
} from "../../onboarding/onboarding-flow";
import { updateProfielSectieAction } from "./actions";

/* ------------------------------------------------------------------ */
/* Secties                                                             */
/* ------------------------------------------------------------------ */

type SectieId =
  | "werkweek"
  | "zichtbaarheid"
  | "functie"
  | "locatie"
  | "vakinhoud"
  | "werkplek";

type Melding = { type: "ok" | "fout"; tekst: string };

const UREN_OPTIES = Array.from({ length: 40 }, (_, i) => i + 1);

/** Clientvalidatie per sectie — de server valideert daarna nogmaals. */
function valideerSectie(sectie: SectieId, w: ProfielWaarden): string | null {
  switch (sectie) {
    case "werkweek":
      return heeftDagdeel(w.availability)
        ? null
        : "Kies minstens één dagdeel waarop je kunt werken.";
    case "functie":
      if (!w.role) return "Kies je functie.";
      if (!w.experienceLevel) return "Kies je ervaringsniveau.";
      return null;
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

/** Payload voor updateProfielSectieAction, per sectie. */
function sectiePayload(sectie: SectieId, w: ProfielWaarden): unknown {
  switch (sectie) {
    case "werkweek":
      return { sectie, availability: w.availability };
    case "zichtbaarheid":
      return { sectie, visibility: w.visibility };
    case "functie":
      return { sectie, role: w.role, experienceLevel: w.experienceLevel };
    case "locatie":
      return {
        sectie,
        postcode: w.postcode.trim(),
        maxTravelMinutes: w.maxTravelMinutes,
        hoursMin: w.hoursMin,
        hoursMax: w.hoursMax,
        contractTypes: w.contractTypes,
        availableFrom: w.availableFrom,
        salaryMin: w.salaryMin,
        salaryMax: w.salaryMax,
        revenueShareMin: w.revenueShareMin,
      };
    case "vakinhoud":
      return {
        sectie,
        equipmentExperience: w.equipmentExperience,
        techniquesWantsToLearn: w.techniquesWantsToLearn,
        softwareSkills: w.softwareSkills,
        specializations: w.specializations,
        treatmentInterests: w.treatmentInterests,
      };
    case "werkplek":
      return {
        sectie,
        preferredPopulation: w.preferredPopulation,
        preferredPracticeSize: w.preferredPracticeSize,
        workPace: w.workPace,
        teamPreferences: w.teamPreferences,
        mentorshipNeeded: w.mentorshipNeeded,
        developmentGoals: w.developmentGoals,
      };
  }
}

function toggleIn(lijst: string[], sleutel: string): string[] {
  return lijst.includes(sleutel)
    ? lijst.filter((s) => s !== sleutel)
    : [...lijst, sleutel];
}

/* ------------------------------------------------------------------ */
/* Sectiekaart met eigen opslaanknop en statusmelding                  */
/* ------------------------------------------------------------------ */

function SectieVoet({
  bezig,
  melding,
  onOpslaan,
  primair = false,
}: {
  bezig: boolean;
  melding?: Melding;
  onOpslaan: () => void;
  primair?: boolean;
}) {
  return (
    <div className="mt-auto flex flex-wrap items-center gap-3 pt-1">
      <Button
        variant={primair ? "primary" : "secondary"}
        onClick={onOpslaan}
        disabled={bezig}
      >
        {bezig ? "Opslaan…" : "Opslaan"}
      </Button>
      {melding?.type === "ok" ? (
        <span role="status" className="text-sm font-semibold text-blauw-700">
          Opgeslagen
        </span>
      ) : null}
      {melding?.type === "fout" ? (
        <span role="alert" className="text-sm font-medium text-red-700">
          {melding.tekst}
        </span>
      ) : null}
    </div>
  );
}

function SectieKaart({
  titel,
  beschrijving,
  children,
  className,
}: {
  titel: string;
  beschrijving?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cx("flex flex-col gap-5", className)}>
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-ink">{titel}</h2>
        {beschrijving ? (
          <p className="text-sm leading-relaxed text-ink/70">{beschrijving}</p>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

function Vraagje({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{titel}</h3>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* De editor                                                           */
/* ------------------------------------------------------------------ */

export interface ProfielEditorProps {
  initieel: ProfielWaarden;
  volledigheid: number;
  /** Profielstatus (active | paused | archived) voor de statusbadge. */
  status: string;
}

export function ProfielEditor({
  initieel,
  volledigheid: initieleVolledigheid,
  status,
}: ProfielEditorProps) {
  const [waarden, setWaarden] = useState<ProfielWaarden>(initieel);
  const [volledigheid, setVolledigheid] = useState(initieleVolledigheid);
  const [bezigSectie, setBezigSectie] = useState<SectieId | null>(null);
  const [meldingen, setMeldingen] = useState<Partial<Record<SectieId, Melding>>>({});

  const zet = <K extends keyof ProfielWaarden>(veld: K, waarde: ProfielWaarden[K]) =>
    setWaarden((w) => ({ ...w, [veld]: waarde }));

  const zetMelding = (sectie: SectieId, melding: Melding | undefined) =>
    setMeldingen((m) => ({ ...m, [sectie]: melding }));

  async function slaOp(sectie: SectieId) {
    zetMelding(sectie, undefined);
    const fout = valideerSectie(sectie, waarden);
    if (fout) {
      zetMelding(sectie, { type: "fout", tekst: fout });
      return;
    }
    setBezigSectie(sectie);
    try {
      const res = await updateProfielSectieAction(sectiePayload(sectie, waarden));
      if (res.ok) {
        setVolledigheid(res.volledigheid);
        zetMelding(sectie, { type: "ok", tekst: "Opgeslagen" });
      } else {
        zetMelding(sectie, { type: "fout", tekst: res.fout });
      }
    } finally {
      setBezigSectie(null);
    }
  }

  const voet = (sectie: SectieId, primair = false) => (
    <SectieVoet
      bezig={bezigSectie === sectie}
      melding={meldingen[sectie]}
      onOpslaan={() => slaOp(sectie)}
      primair={primair}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* werkweek prominent bovenaan — retentie */}
      <Card strong className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Klopt je werkweek{" "}
            <em className="font-serif italic font-bold text-blauw-600">nog?</em>
          </h2>
          <p className="max-w-2xl text-[15px] leading-relaxed text-ink/70">
            Je werkweek is de kern van je matches: dagdelen met voorkeur tellen zwaarder mee.
            Is er iets veranderd — een vaste sportavond, een nieuwe oppasdag — werk het dan
            hier bij.
          </p>
        </div>
        <WeekGrid
          mode="candidate"
          value={waarden.availability}
          onChange={(waarde) => zet("availability", waarde)}
        />
        {voet("werkweek", true)}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* zichtbaarheid + volledigheid */}
        <SectieKaart
          titel="Zichtbaarheid en volledigheid"
          beschrijving="Jij bepaalt wie je profiel ziet; je adres en contactgegevens zijn nooit zichtbaar voor praktijken."
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Profielvolledigheid</h3>
              <Badge tone={status === "active" ? "blauw" : "neutraal"}>
                {status === "active"
                  ? "Profiel actief"
                  : status === "paused"
                    ? "Profiel gepauzeerd"
                    : "Profiel niet actief"}
              </Badge>
            </div>
            <ProgressBar value={volledigheid} label="Profielvolledigheid" showValue />
            <p className="text-sm text-ink/60">
              Een vollediger profiel levert scherpere matches op.
            </p>
          </div>
          <div className="flex flex-col gap-3" role="group" aria-label="Zichtbaarheid van je profiel">
            {ZICHTBAARHEID_OPTIES.map((optie) => (
              <KeuzeKaart
                key={optie.waarde}
                actief={waarden.visibility === optie.waarde}
                titel={optie.titel}
                uitleg={optie.uitleg}
                badge={optie.aanbevolen ? "Aanbevolen" : undefined}
                onKies={() => zet("visibility", optie.waarde)}
              />
            ))}
          </div>
          {voet("zichtbaarheid")}
        </SectieKaart>

        {/* functie en ervaring */}
        <SectieKaart
          titel="Functie en ervaring"
          beschrijving="Je functie bepaalt op welke vacatures je matcht."
        >
          <Vraagje titel="Functie">
            <div role="group" aria-label="Functie" className="flex flex-wrap gap-2">
              {ROLES.map((rol) => (
                <Chip key={rol} selected={waarden.role === rol} onClick={() => zet("role", rol)}>
                  {label(rol)}
                </Chip>
              ))}
            </div>
          </Vraagje>
          <Vraagje titel="Ervaringsniveau">
            <EnkeleKeuzeChips
              opties={EXPERIENCE_LEVELS}
              waarde={waarden.experienceLevel || null}
              onKies={(s) => zet("experienceLevel", s)}
              groepLabel="Ervaringsniveau"
            />
          </Vraagje>
          {voet("functie")}
        </SectieKaart>

        {/* waar en hoeveel */}
        <SectieKaart
          titel="Waar en hoeveel"
          beschrijving="Reistijd rekenen we vanaf je postcode; je adres blijft privé."
          className="lg:col-span-2"
        >
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Postcode" htmlFor="p-postcode" required>
              <Input
                id="p-postcode"
                autoComplete="postal-code"
                placeholder="3511 AB"
                value={waarden.postcode}
                onChange={(e) => zet("postcode", e.target.value)}
              />
            </Field>
            <Field label="Maximale reistijd" htmlFor="p-reistijd" required>
              <Select
                id="p-reistijd"
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
            <Field label="Uren per week (min)" htmlFor="p-uren-min" required>
              <Select
                id="p-uren-min"
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
            <Field label="Uren per week (max)" htmlFor="p-uren-max" required>
              <Select
                id="p-uren-max"
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
          <Vraagje titel="Contractvorm">
            <ChipGroep
              opties={CONTRACT_TYPES}
              waarde={waarden.contractTypes}
              onToggle={(s) => zet("contractTypes", toggleIn(waarden.contractTypes, s))}
              groepLabel="Contractvorm"
            />
          </Vraagje>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="Beschikbaar vanaf"
              htmlFor="p-startdatum"
              hint="Leeg = per direct."
            >
              <Input
                id="p-startdatum"
                type="date"
                value={waarden.availableFrom ?? ""}
                onChange={(e) => zet("availableFrom", e.target.value || null)}
              />
            </Field>
            {waarden.contractTypes.includes("loondienst") ? (
              <>
                <Field label="Bruto p/m vanaf (optioneel)" htmlFor="p-salaris-min">
                  <Input
                    id="p-salaris-min"
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
                <Field label="Bruto p/m tot (optioneel)" htmlFor="p-salaris-max">
                  <Input
                    id="p-salaris-max"
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
              <Field
                label="Gewenst omzetpercentage vanaf (optioneel)"
                htmlFor="p-omzetpercentage"
                hint="Gebruikelijk is 40–55% van de gedraaide omzet."
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="p-omzetpercentage"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    placeholder="bijv. 45"
                    value={waarden.revenueShareMin ?? ""}
                    onChange={(e) =>
                      zet("revenueShareMin", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                  <span aria-hidden="true" className="text-sm font-semibold text-ink/70">
                    %
                  </span>
                </div>
              </Field>
            ) : null}
          </div>
          {voet("locatie")}
        </SectieKaart>

        {/* vakinhoud */}
        <SectieKaart
          titel="Vakinhoud"
          beschrijving="Ervaring én leerwensen — bij praktijken met begeleiding levert 'wil ik leren' juist matches op."
          className="lg:col-span-2"
        >
          <Vraagje titel="Apparatuur waar je ervaring mee hebt">
            <ChipGroep
              opties={EQUIPMENT}
              waarde={waarden.equipmentExperience}
              onToggle={(s) => zet("equipmentExperience", toggleIn(waarden.equipmentExperience, s))}
              groepLabel="Apparatuurervaring"
            />
          </Vraagje>
          <div className="rounded-kaart border-2 border-roze-200 bg-roze-50/70 p-4">
            <Vraagje titel="Wil je leren?">
              <ChipGroep
                opties={EQUIPMENT}
                waarde={waarden.techniquesWantsToLearn}
                onToggle={(s) =>
                  zet("techniquesWantsToLearn", toggleIn(waarden.techniquesWantsToLearn, s))
                }
                groepLabel="Wil ik leren"
              />
            </Vraagje>
          </div>
          <Vraagje titel="Praktijksoftware">
            <ChipGroep
              opties={SOFTWARE}
              waarde={waarden.softwareSkills}
              onToggle={(s) => zet("softwareSkills", toggleIn(waarden.softwareSkills, s))}
              groepLabel="Software"
            />
          </Vraagje>
          <Vraagje titel="Specialisaties">
            <ChipGroep
              opties={SPECIALIZATIONS}
              waarde={waarden.specializations}
              onToggle={(s) => zet("specializations", toggleIn(waarden.specializations, s))}
              groepLabel="Specialisaties"
            />
          </Vraagje>
          <Vraagje titel="Behandelinteresses">
            <ChipGroep
              opties={TREATMENTS}
              waarde={waarden.treatmentInterests}
              onToggle={(s) => zet("treatmentInterests", toggleIn(waarden.treatmentInterests, s))}
              groepLabel="Behandelinteresses"
            />
          </Vraagje>
          {voet("vakinhoud")}
        </SectieKaart>

        {/* werkplek */}
        <SectieKaart
          titel="Werkplek"
          beschrijving="Team, tempo en groeimogelijkheden — zo matchen we ook op werkplezier."
          className="lg:col-span-2"
        >
          <Vraagje titel="Patiëntgroepen">
            <ChipGroep
              opties={PATIENT_POPULATION}
              waarde={waarden.preferredPopulation}
              onToggle={(s) => zet("preferredPopulation", toggleIn(waarden.preferredPopulation, s))}
              groepLabel="Patiëntgroepen"
            />
          </Vraagje>
          <div className="grid gap-5 sm:grid-cols-2">
            <Vraagje titel="Praktijkgrootte">
              <EnkeleKeuzeChips
                opties={PRACTICE_SIZES}
                waarde={waarden.preferredPracticeSize}
                onKies={(s) => zet("preferredPracticeSize", s)}
                groepLabel="Praktijkgrootte"
              />
            </Vraagje>
            <Vraagje titel="Werktempo">
              <EnkeleKeuzeChips
                opties={WORK_PACES}
                waarde={waarden.workPace}
                onKies={(s) => zet("workPace", s)}
                groepLabel="Werktempo"
              />
            </Vraagje>
          </div>
          <Vraagje titel="Team">
            <ChipGroep
              opties={TEAM_PREFERENCES}
              waarde={waarden.teamPreferences}
              onToggle={(s) => zet("teamPreferences", toggleIn(waarden.teamPreferences, s))}
              groepLabel="Teamvoorkeuren"
            />
          </Vraagje>
          <Vraagje titel="Begeleiding">
            <div role="group" aria-label="Begeleiding" className="flex flex-wrap gap-2">
              <Chip
                selected={waarden.mentorshipNeeded}
                onClick={() => zet("mentorshipNeeded", true)}
              >
                Ja, graag begeleiding
              </Chip>
              <Chip
                selected={!waarden.mentorshipNeeded}
                onClick={() => zet("mentorshipNeeded", false)}
              >
                Niet nodig
              </Chip>
            </div>
          </Vraagje>
          <Vraagje titel="Ontwikkelambities">
            <ChipGroep
              opties={DEVELOPMENT}
              waarde={waarden.developmentGoals}
              onToggle={(s) => zet("developmentGoals", toggleIn(waarden.developmentGoals, s))}
              groepLabel="Ontwikkelambities"
            />
          </Vraagje>
          {voet("werkplek")}
        </SectieKaart>
      </div>
    </div>
  );
}
