"use client";

// Commerciële praktijkonboarding — één doorlopende flow in zeven stappen.
// Zelfde ontwerptaal als de kandidaat-onboarding: één vraaggroep per stap,
// grote tap-targets, autosave per stap en zichtbare voortgang. De MatchShape
// beweegt met de voortgang mee (score = voortgangspercentage): hoe verder je
// komt, hoe dichter praktijk en kandidaat visueel bij elkaar komen.
//
// Stap 6 is het "directe waarde"-moment: Talent Radar op de ingevoerde
// behoefte, met maximaal drie aanbevelingen die je direct kunt toepassen.

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  Field,
  Input,
  ProgressBar,
  Select,
  cx,
} from "@/components/ui";
import MatchShape from "@/components/MatchShape";
import WeekGrid from "@/components/WeekGrid";
import {
  CONTRACT_TYPES,
  DAYPARTS,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  WEEKDAYS,
  emptySchedule,
  label,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";
import type {
  OnboardingAanbeveling,
  OnboardingRadarData,
  OnboardingStateData,
} from "@/server/onboarding";
import {
  ChipGroep,
  KeuzeKaart,
} from "../../kandidaat/onboarding/onboarding-flow";
import {
  publiceerStartVacatureAction,
  saveStartStapAction,
  startRadarAction,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Props en clientmodel                                                */
/* ------------------------------------------------------------------ */

export interface PraktijkGegevens {
  naam: string;
  plaats: string;
  postcode: string;
  behandelkamers: number;
  telefoon: string;
}

export interface StartFlowProps {
  voornaam: string;
  /** Lengte van de proefperiode in dagen (voor de kop). */
  trialDagen: number;
  /** Resterende trialdagen; null zolang er nog geen organisatie is. */
  trialDagenOver: number | null;
  organisatie: { slug: string } | null;
  praktijkInit: PraktijkGegevens;
  stateInit: OnboardingStateData;
}

const STAPPEN = [
  { id: "praktijk", kort: "Praktijk" },
  { id: "functie", kort: "Functie" },
  { id: "werkdagen", kort: "Werkdagen" },
  { id: "uren", kort: "Uren & contract" },
  { id: "uitrusting", kort: "Uitrusting" },
  { id: "radar", kort: "Talent Radar" },
  { id: "publiceren", kort: "Publiceren" },
] as const;

type StapId = (typeof STAPPEN)[number]["id"];

const ERVARING_UITLEG: Record<string, string> = {
  starter: "Net begonnen, of minder dan 2 jaar ervaring",
  medior: "2 tot 7 jaar ervaring",
  senior: "Meer dan 7 jaar ervaring",
};

const UREN_OPTIES = Array.from({ length: 40 }, (_, i) => i + 1);

/** Minstens één dagdeel gevraagd? */
function heeftGevraagdDagdeel(schedule: VacancySchedule): boolean {
  return WEEKDAYS.some((dag) =>
    DAYPARTS.some((deel) => schedule[dag][deel] !== null),
  );
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

function toggleIn(lijst: string[], sleutel: string): string[] {
  return lijst.includes(sleutel)
    ? lijst.filter((s) => s !== sleutel)
    : [...lijst, sleutel];
}

/** Grote stepper (− / +) voor het aantal behandelkamers. */
function Stepper({
  waarde,
  onChange,
  min = 1,
  max = 50,
  eenheidLabel,
}: {
  waarde: number;
  onChange: (waarde: number) => void;
  min?: number;
  max?: number;
  eenheidLabel: string;
}) {
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        aria-label={`Minder ${eenheidLabel}`}
        onClick={() => onChange(Math.max(min, waarde - 1))}
        disabled={waarde <= min}
        className={cx(
          "flex h-14 w-14 items-center justify-center rounded-full border border-ink/15 bg-white/80 text-2xl font-semibold text-ink backdrop-blur",
          "transition-colors duration-150 hover:bg-white motion-reduce:transition-none",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <span aria-hidden="true">−</span>
      </button>
      <div className="min-w-16 text-center">
        <span className="text-4xl font-semibold tabular-nums tracking-tight text-ink">
          {waarde}
        </span>
      </div>
      <button
        type="button"
        aria-label={`Meer ${eenheidLabel}`}
        onClick={() => onChange(Math.min(max, waarde + 1))}
        disabled={waarde >= max}
        className={cx(
          "flex h-14 w-14 items-center justify-center rounded-full border border-ink/15 bg-white/80 text-2xl font-semibold text-ink backdrop-blur",
          "transition-colors duration-150 hover:bg-white motion-reduce:transition-none",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Radar-presentatie                                                   */
/* ------------------------------------------------------------------ */

const TE_WEINIG = "te weinig kandidaten om veilig te tonen";

/** Samenvattingszinnen: "18 potentiële kandidaten · 6 sterke matches · …" */
function radarZinnen(data: OnboardingRadarData): string[] {
  const zinnen: string[] = [];
  zinnen.push(
    data.totalPotential !== null
      ? `${data.totalPotential} potentiële kandidaten in jouw regio`
      : `Potentiële kandidaten: ${TE_WEINIG}`,
  );
  const rapport = data.rapport;
  if (rapport) {
    zinnen.push(
      rapport.strongMatches !== null
        ? `${rapport.strongMatches} sterke matches`
        : `Sterke matches: ${TE_WEINIG}`,
    );
    // Beste en zwakste gevraagde dag (gemaskeerde dagen tellen als laagste).
    const dagen = rapport.perDay;
    if (dagen.length >= 2) {
      const zichtbaar = dagen.filter((d) => d.count !== null);
      if (zichtbaar.length > 0) {
        const beste = zichtbaar.reduce((a, b) =>
          (b.count ?? 0) > (a.count ?? 0) ? b : a,
        );
        zinnen.push(`${label(beste.day)} is goed beschikbaar`);
        const zwakste = dagen.reduce((a, b) =>
          (b.count ?? -1) < (a.count ?? -1) ? b : a,
        );
        if (zwakste.day !== beste.day) {
          zinnen.push(`${label(zwakste.day)} beperkt je bereik het sterkst`);
        }
      }
    }
  }
  return zinnen;
}

/* ------------------------------------------------------------------ */
/* De flow zelf                                                        */
/* ------------------------------------------------------------------ */

export function StartFlow({
  voornaam,
  trialDagen,
  trialDagenOver,
  organisatie,
  praktijkInit,
  stateInit,
}: StartFlowProps) {
  /* --- stapdata --- */
  const [praktijk, setPraktijk] = useState<PraktijkGegevens>(praktijkInit);
  const [role, setRole] = useState<string>(stateInit.functie?.role ?? "");
  const [ervaring, setErvaring] = useState<string | null>(
    stateInit.functie?.experienceLevel ?? null,
  );
  const [ervaringGekozen, setErvaringGekozen] = useState(
    stateInit.functie !== null,
  );
  const [schedule, setSchedule] = useState<VacancySchedule>(
    stateInit.werkdagen?.schedule ?? emptySchedule(),
  );
  const [hoursMin, setHoursMin] = useState(stateInit.uren?.hoursMin ?? 16);
  const [hoursMax, setHoursMax] = useState(stateInit.uren?.hoursMax ?? 24);
  const [contractTypes, setContractTypes] = useState<string[]>(
    stateInit.uren?.contractTypes ?? [],
  );
  const [revenueShareMax, setRevenueShareMax] = useState<number | null>(
    stateInit.uren?.revenueShareMax ?? null,
  );
  const [equipment, setEquipment] = useState<string[]>(
    stateInit.uitrusting?.equipment ?? [],
  );
  const [software, setSoftware] = useState<string[]>(
    stateInit.uitrusting?.software ?? [],
  );
  const [specialisaties, setSpecialisaties] = useState<string[]>(
    stateInit.uitrusting?.specializations ?? [],
  );
  const [begeleiding, setBegeleiding] = useState<boolean>(
    stateInit.uitrusting?.mentorship ?? false,
  );

  /* --- flowstatus --- */
  const [slug, setSlug] = useState<string | null>(organisatie?.slug ?? null);
  const [stapIndex, setStapIndex] = useState(() =>
    Math.min(stateInit.currentStep, STAPPEN.length - 1),
  );
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  /* --- radar --- */
  const [radar, setRadar] = useState<OnboardingRadarData | null>(null);
  const [radarBezig, setRadarBezig] = useState(false);
  const [radarFout, setRadarFout] = useState<string | null>(null);

  /* --- publicatie --- */
  const [publicatie, setPublicatie] = useState<{
    vacancyId: string;
    titel: string;
  } | null>(
    stateInit.publishedVacancyId
      ? { vacancyId: stateInit.publishedVacancyId, titel: "" }
      : null,
  );
  const [publicatieFout, setPublicatieFout] = useState<{
    fout: string;
    upgradeHint?: string;
    abonnementUrl?: string;
  } | null>(null);

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
  const klaar = publicatie !== null;
  const voortgang = klaar
    ? 100
    : Math.round((stapIndex / (STAPPEN.length - 1)) * 100);

  /* --- radar laden bij het openen van stap 6 --- */
  const laadRadar = () => {
    setRadarBezig(true);
    setRadarFout(null);
    startTransition(async () => {
      const res = await startRadarAction();
      if (res.ok) setRadar(res.data);
      else setRadarFout(res.fout);
      setRadarBezig(false);
    });
  };

  useEffect(() => {
    if (stap.id === "radar" && radar === null && !radarBezig) laadRadar();
    // laadRadar is stabiel genoeg; alleen de stapwissel is relevant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stapIndex]);

  /* --- validatie en payload per stap --- */
  function valideerStap(id: StapId): string | null {
    switch (id) {
      case "praktijk":
        if (praktijk.naam.trim().length < 2) return "Vul de naam van je praktijk in.";
        if (praktijk.plaats.trim().length < 2) return "Vul de plaatsnaam in.";
        if (!/^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/.test(praktijk.postcode.trim())) {
          return "Vul een geldige postcode in, bijvoorbeeld 3511 AB.";
        }
        return null;
      case "functie":
        if (!role) return "Kies eerst welke functie je zoekt.";
        if (!ervaringGekozen) return "Kies ook het gewenste ervaringsniveau.";
        return null;
      case "werkdagen":
        return heeftGevraagdDagdeel(schedule)
          ? null
          : "Tik minstens één dagdeel aan waarop je iemand nodig hebt.";
      case "uren":
        if (hoursMax < hoursMin) {
          return "Het maximum aantal uren ligt onder het minimum.";
        }
        if (contractTypes.length === 0) return "Kies minstens één contractvorm.";
        if (
          contractTypes.includes("zzp") &&
          revenueShareMax !== null &&
          (revenueShareMax < 0 || revenueShareMax > 100)
        ) {
          return "Het omzetpercentage ligt tussen 0 en 100.";
        }
        return null;
      default:
        return null;
    }
  }

  function stapPayload(id: StapId): unknown | null {
    switch (id) {
      case "praktijk":
        return {
          stap: "praktijk",
          name: praktijk.naam.trim(),
          city: praktijk.plaats.trim(),
          postcode: praktijk.postcode.trim(),
          treatmentRooms: praktijk.behandelkamers,
          phone: praktijk.telefoon.trim() === "" ? null : praktijk.telefoon.trim(),
        };
      case "functie":
        return { stap: "functie", role, experienceLevel: ervaring };
      case "werkdagen":
        return { stap: "werkdagen", schedule };
      case "uren":
        return {
          stap: "uren",
          hoursMin,
          hoursMax,
          contractTypes,
          revenueShareMax: contractTypes.includes("zzp") ? revenueShareMax : null,
        };
      case "uitrusting":
        return {
          stap: "uitrusting",
          equipment,
          software,
          specializations: specialisaties,
          mentorship: begeleiding,
        };
      default:
        return null; // radar en publiceren hebben eigen acties
    }
  }

  /* --- navigatie met autosave --- */
  function verder() {
    setFout(null);
    const melding = valideerStap(stap.id);
    if (melding) {
      setFout(melding);
      return;
    }
    const payload = stapPayload(stap.id);
    if (payload === null) {
      // radar-stap: geen opslag nodig, alleen doorlopen
      setStapIndex((i) => Math.min(i + 1, STAPPEN.length - 1));
      return;
    }
    startTransition(async () => {
      const res = await saveStartStapAction(payload);
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      setSlug(res.slug);
      // Behoefte veranderd? Dan is het eerdere radarresultaat verouderd.
      if (stap.id !== "praktijk") setRadar(null);
      setStapIndex((i) => Math.min(i + 1, STAPPEN.length - 1));
    });
  }

  function terug() {
    setFout(null);
    setStapIndex((i) => Math.max(0, i - 1));
  }

  /* --- aanbeveling toepassen: pas lokaal toe, sla op en herbereken --- */
  function pasAanbevelingToe(aanbeveling: OnboardingAanbeveling) {
    const t = aanbeveling.toepassing;
    let payload: unknown;
    if (t.type === "dag_flexibel") {
      const dag = t.dag as Weekday;
      const volgend: VacancySchedule = {
        ...schedule,
        [dag]: {
          ochtend: schedule[dag].ochtend === "required" ? "preferred" : schedule[dag].ochtend,
          middag: schedule[dag].middag === "required" ? "preferred" : schedule[dag].middag,
          avond: schedule[dag].avond === "required" ? "preferred" : schedule[dag].avond,
        },
      };
      setSchedule(volgend);
      payload = { stap: "werkdagen", schedule: volgend };
    } else if (t.type === "uren_verlagen") {
      setHoursMin(t.hoursMin);
      payload = {
        stap: "uren",
        hoursMin: t.hoursMin,
        hoursMax,
        contractTypes,
        revenueShareMax: contractTypes.includes("zzp") ? revenueShareMax : null,
      };
    } else if (t.type === "contract") {
      const volgende = contractTypes.includes(t.contractType)
        ? contractTypes
        : [...contractTypes, t.contractType];
      setContractTypes(volgende);
      payload = {
        stap: "uren",
        hoursMin,
        hoursMax,
        contractTypes: volgende,
        revenueShareMax: volgende.includes("zzp") ? revenueShareMax : null,
      };
    } else {
      setBegeleiding(true);
      payload = {
        stap: "uitrusting",
        equipment,
        software,
        specializations: specialisaties,
        mentorship: true,
      };
    }
    setRadarBezig(true);
    setRadarFout(null);
    startTransition(async () => {
      const res = await saveStartStapAction(payload);
      if (!res.ok) {
        setRadarFout(res.fout);
        setRadarBezig(false);
        return;
      }
      const radarRes = await startRadarAction();
      if (radarRes.ok) setRadar(radarRes.data);
      else setRadarFout(radarRes.fout);
      setRadarBezig(false);
    });
  }

  /* --- publiceren --- */
  function publiceer() {
    setPublicatieFout(null);
    startTransition(async () => {
      const res = await publiceerStartVacatureAction();
      if (res.ok) {
        setSlug(res.slug);
        setPublicatie({ vacancyId: res.vacancyId, titel: res.titel });
      } else {
        setPublicatieFout({
          fout: res.fout,
          upgradeHint: res.upgradeHint,
          abonnementUrl: res.abonnementUrl,
        });
      }
    });
  }

  const dagenGevraagd = WEEKDAYS.filter((dag) =>
    DAYPARTS.some((deel) => schedule[dag][deel] !== null),
  );

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-surface text-ink">
      {/* dromerige achtergrond-orbs — puur decoratief */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb orb-blauw animate-zweef-traag -top-44 -right-40 h-[32rem] w-[32rem]" />
        <div className="orb orb-roze animate-zweef -bottom-32 -left-36 h-[28rem] w-[28rem] opacity-35" />
        <div className="orb orb-paars top-1/3 -left-52 h-[22rem] w-[22rem]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        {/* voortgang bovenin: stappenindicator + MatchShape die meebeweegt */}
        <header className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight text-ink"
              aria-label="mondzorgwerkt — naar de homepage"
            >
              mondzorg<em className="font-serif italic font-bold">werkt</em>
            </Link>
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-ink/70">
                Stap {stapIndex + 1} van {STAPPEN.length}
                <span className="hidden sm:inline"> · {stap.kort}</span>
              </p>
              <MatchShape
                score={voortgang}
                showScore={false}
                className="-my-2"
              />
            </div>
          </div>
          <ProgressBar
            value={voortgang}
            label={`Onboarding: stap ${stapIndex + 1} van ${STAPPEN.length} — ${stap.kort}`}
          />
        </header>

        {/* één vraaggroep per stap */}
        <section aria-label={stap.kort} className="mt-8 flex flex-1 flex-col gap-7 sm:mt-10">
          {stap.id === "praktijk" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Welkom, stel je"
                accent="praktijk voor"
                intro={`Hoi ${voornaam}. In zeven korte stappen staat je eerste vacature live — en zie je onderweg direct hoeveel kandidaten er in jouw regio binnen bereik zijn. Je proefperiode van ${trialDagen} dagen start bij deze eerste stap.`}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Praktijknaam" htmlFor="praktijknaam" required className="sm:col-span-2">
                  <Input
                    id="praktijknaam"
                    autoComplete="organization"
                    placeholder="bijv. Tandartspraktijk De Lach"
                    value={praktijk.naam}
                    onChange={(e) => setPraktijk({ ...praktijk, naam: e.target.value })}
                  />
                </Field>
                <Field label="Plaats" htmlFor="plaats" required>
                  <Input
                    id="plaats"
                    autoComplete="address-level2"
                    placeholder="bijv. Utrecht"
                    value={praktijk.plaats}
                    onChange={(e) => setPraktijk({ ...praktijk, plaats: e.target.value })}
                  />
                </Field>
                <Field label="Postcode" htmlFor="postcode" required>
                  <Input
                    id="postcode"
                    autoComplete="postal-code"
                    placeholder="3511 AB"
                    value={praktijk.postcode}
                    onChange={(e) => setPraktijk({ ...praktijk, postcode: e.target.value })}
                  />
                </Field>
              </div>
              <Vraag
                titel="Aantal behandelkamers"
                hint="Zo weten kandidaten hoe groot je praktijk is."
              >
                <Stepper
                  waarde={praktijk.behandelkamers}
                  onChange={(waarde) =>
                    setPraktijk({ ...praktijk, behandelkamers: waarde })
                  }
                  eenheidLabel="behandelkamers"
                />
              </Vraag>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Telefoonnummer (optioneel)"
                  htmlFor="telefoon"
                  hint="Alleen voor ons — nooit zichtbaar voor kandidaten."
                >
                  <Input
                    id="telefoon"
                    type="tel"
                    autoComplete="tel"
                    placeholder="bijv. 030 123 45 67"
                    value={praktijk.telefoon}
                    onChange={(e) => setPraktijk({ ...praktijk, telefoon: e.target.value })}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {stap.id === "functie" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Wie zoek"
                accent="je?"
                intro="Kies de functie die je zoekt. Ervaring is een voorkeur, geen harde eis — starters kunnen verrassend goed passen."
              />
              <Vraag titel="Functie">
                <ChipGroep
                  groot
                  opties={ROLES}
                  waarde={role ? [role] : []}
                  onToggle={(sleutel) => setRole(sleutel)}
                  groepLabel="Functie"
                />
              </Vraag>
              <Vraag titel="Gewenst ervaringsniveau">
                <div className="flex flex-col gap-3">
                  {EXPERIENCE_LEVELS.map((niveau) => (
                    <KeuzeKaart
                      key={niveau}
                      actief={ervaringGekozen && ervaring === niveau}
                      titel={label(niveau)}
                      uitleg={ERVARING_UITLEG[niveau] ?? ""}
                      onKies={() => {
                        setErvaring(niveau);
                        setErvaringGekozen(true);
                      }}
                    />
                  ))}
                  <KeuzeKaart
                    actief={ervaringGekozen && ervaring === null}
                    titel="Geen voorkeur"
                    uitleg="Elk ervaringsniveau is welkom — je bereikt zo de meeste kandidaten."
                    onKies={() => {
                      setErvaring(null);
                      setErvaringGekozen(true);
                    }}
                  />
                </div>
              </Vraag>
            </>
          ) : null}

          {stap.id === "werkdagen" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Wanneer heb je"
                accent="iemand nodig?"
                intro={
                  <>
                    Tik op een dagdeel om te wisselen tussen{" "}
                    <strong className="font-semibold text-ink">nodig</strong>,{" "}
                    <strong className="font-semibold text-ink">zou fijn zijn</strong> en niet
                    gevraagd. Hoe flexibeler je rooster, hoe meer kandidaten binnen bereik —
                    dat zie je in stap 6 meteen terug.
                  </>
                }
              />
              <div className="glass-strong rounded-kaart-lg p-4 sm:p-6">
                <WeekGrid mode="vacancy" value={schedule} onChange={setSchedule} />
              </div>
            </>
          ) : null}

          {stap.id === "uren" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Uren en"
                accent="contract"
                intro="Hoeveel uur per week zoek je iemand, en welke samenwerkingsvormen passen bij je praktijk?"
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Uren per week (minimaal)" htmlFor="uren-min" required>
                  <Select
                    id="uren-min"
                    value={String(hoursMin)}
                    onChange={(e) => setHoursMin(Number(e.target.value))}
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
                    value={String(hoursMax)}
                    onChange={(e) => setHoursMax(Number(e.target.value))}
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
                  groot
                  opties={CONTRACT_TYPES}
                  waarde={contractTypes}
                  onToggle={(s) => setContractTypes(toggleIn(contractTypes, s))}
                  groepLabel="Contractvorm"
                />
              </Vraag>
              {contractTypes.includes("zzp") ? (
                <Vraag
                  titel="Omzetpercentage bij zzp"
                  hint="Behandelaren werken met een percentage van de omzet — geen uurtarief. Gebruikelijk is 40–55%."
                >
                  <Field label="Geboden omzetpercentage tot" htmlFor="omzetpercentage">
                    <div className="flex max-w-48 items-center gap-2">
                      <Input
                        id="omzetpercentage"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={1}
                        placeholder="bijv. 50"
                        value={revenueShareMax ?? ""}
                        onChange={(e) =>
                          setRevenueShareMax(
                            e.target.value === "" ? null : Number(e.target.value),
                          )
                        }
                      />
                      <span aria-hidden="true" className="text-sm font-semibold text-ink/70">
                        %
                      </span>
                    </div>
                  </Field>
                </Vraag>
              ) : null}
            </>
          ) : null}

          {stap.id === "uitrusting" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Waarmee gaan ze"
                accent="werken?"
                intro="Alles is optioneel — maar hoe meer je aangeeft, hoe scherper de matches. Deze kenmerken tellen als pluspunt, nooit als harde eis."
              />
              <Vraag titel="Apparatuur in je praktijk">
                <ChipGroep
                  opties={EQUIPMENT}
                  waarde={equipment}
                  onToggle={(s) => setEquipment(toggleIn(equipment, s))}
                  groepLabel="Apparatuur"
                />
              </Vraag>
              <Vraag titel="Praktijksoftware">
                <ChipGroep
                  opties={SOFTWARE}
                  waarde={software}
                  onToggle={(s) => setSoftware(toggleIn(software, s))}
                  groepLabel="Software"
                />
              </Vraag>
              <Vraag titel="Specialisaties">
                <ChipGroep
                  opties={SPECIALIZATIONS}
                  waarde={specialisaties}
                  onToggle={(s) => setSpecialisaties(toggleIn(specialisaties, s))}
                  groepLabel="Specialisaties"
                />
              </Vraag>
              <Vraag titel="Begeleiding">
                <div className="flex flex-col gap-3">
                  <KeuzeKaart
                    actief={begeleiding}
                    titel="Ja, wij bieden begeleiding"
                    uitleg="Kandidaten die nog willen leren werken met jouw apparatuur tellen dan mee als ontwikkelmatch — dat vergroot je bereik."
                    onKies={() => setBegeleiding(true)}
                  />
                  <KeuzeKaart
                    actief={!begeleiding}
                    titel="Nee, zelfstandig aan de slag"
                    uitleg="Je zoekt iemand die direct zelfstandig kan werken."
                    onKies={() => setBegeleiding(false)}
                  />
                </div>
              </Vraag>
            </>
          ) : null}

          {stap.id === "radar" ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Dit is jouw"
                accent="talentmarkt"
                intro="Op basis van wat je invulde, rekenen we live uit hoeveel kandidaten er binnen bereik zijn — en wat je kunt doen om dat bereik te vergroten."
              />
              {radarBezig && radar === null ? (
                <div className="glass flex flex-col items-center gap-3 rounded-kaart-lg px-8 py-14 text-center">
                  <MatchShape score={55} showScore={false} />
                  <p className="text-[15px] font-medium text-ink/70" role="status">
                    We doorzoeken de kandidatenmarkt in jouw regio…
                  </p>
                </div>
              ) : null}
              {radarFout ? (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-3 rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800"
                >
                  {radarFout}
                  <Button variant="secondary" size="sm" onClick={laadRadar} disabled={radarBezig}>
                    Opnieuw proberen
                  </Button>
                </div>
              ) : null}
              {radar ? (
                <>
                  <div className="glass-strong flex flex-col gap-4 rounded-kaart-lg p-6">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-2xl font-semibold leading-snug tracking-tight text-ink">
                        {radar.totalPotential !== null ? (
                          <>
                            <span className="tabular-nums">{radar.totalPotential}</span>{" "}
                            <em className="font-serif italic font-bold text-blauw-600">
                              potentiële kandidaten
                            </em>{" "}
                            in jouw regio
                          </>
                        ) : (
                          <>Te weinig kandidaten om veilig te tonen</>
                        )}
                      </p>
                      <MatchShape
                        score={radar.rapport?.strongMatches ? 78 : 45}
                        showScore={false}
                        className="hidden shrink-0 sm:inline-flex"
                      />
                    </div>
                    {/* de kop toont het potentieel al — hier de rest van het inzicht */}
                    {radarZinnen(radar).length > 1 ? (
                      <p className="text-[15px] leading-relaxed text-ink/80">
                        {radarZinnen(radar).slice(1).join(" · ")}
                      </p>
                    ) : null}
                    {radar.totalPotential === null ? (
                      <p className="text-sm text-ink/60">
                        We tonen alleen aantallen vanaf {radar.minGroupSize} kandidaten, zodat
                        niemand herleidbaar is.
                      </p>
                    ) : null}
                    {radar.rapport === null && slug ? (
                      <p className="text-sm text-ink/70">
                        Het volledige marktrapport — sterke matches en beschikbaarheid per dag —
                        zit in de hogere abonnementen.{" "}
                        <Link
                          href={`/praktijk/${slug}/abonnement`}
                          className="font-semibold text-blauw-700 underline-offset-2 hover:underline"
                        >
                          Bekijk de abonnementen
                        </Link>
                      </p>
                    ) : null}
                  </div>

                  {radar.rapport && radar.rapport.perDay.length > 0 ? (
                    <div className="glass flex flex-col gap-3 rounded-kaart-lg p-6">
                      <h2 className="text-[15px] font-semibold text-ink">
                        Beschikbare kandidaten per gevraagde dag
                      </h2>
                      <ul className="flex flex-wrap gap-2">
                        {radar.rapport.perDay.map((dag) => (
                          <li key={dag.day}>
                            <Badge tone={dag.count !== null ? "blauw" : "wit"}>
                              {label(dag.day)}:{" "}
                              {dag.count !== null
                                ? `${dag.count} kandidaten`
                                : "te weinig om veilig te tonen"}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {radar.aanbevelingen.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <h2 className="text-[15px] font-semibold text-ink">
                        Vergroot je bereik
                      </h2>
                      {radar.aanbevelingen.map((aanbeveling) => (
                        <div
                          key={aanbeveling.code}
                          className="glass flex flex-col gap-3 rounded-kaart p-5 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex flex-col gap-1">
                            <p className="font-semibold text-ink">
                              {aanbeveling.titel}{" "}
                              <span className="font-serif italic font-bold text-blauw-600">
                                →{" "}
                                {aanbeveling.extraKandidaten !== null
                                  ? `+${aanbeveling.extraKandidaten} kandidaten`
                                  : "extra kandidaten"}
                              </span>
                            </p>
                            <p className="text-sm leading-relaxed text-ink/70">
                              {aanbeveling.uitleg}
                              {aanbeveling.extraKandidaten === null
                                ? " (het precieze aantal is te klein om veilig te tonen)"
                                : null}
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            className="shrink-0"
                            onClick={() => pasAanbevelingToe(aanbeveling)}
                            disabled={radarBezig || bezig}
                          >
                            Pas toe
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {radarBezig ? (
                    <p className="text-sm font-medium text-ink/60" role="status">
                      Opnieuw berekenen…
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {stap.id === "publiceren" && !klaar ? (
            <>
              <StapKop
                kopRef={kopRef}
                titel="Zet je vacature"
                accent="live"
                intro="Dit is wat kandidaten gaan zien. Publiceer je vacature en wij gaan direct voor je op zoek."
              />
              <div className="glass-strong flex flex-col gap-5 rounded-kaart-lg p-6">
                <h2 className="text-lg font-semibold text-ink">
                  {role ? label(role) : "Vacature"}
                  {dagenGevraagd.length > 0 ? (
                    <span className="text-ink/60">
                      {" "}
                      — {dagenGevraagd.length} {dagenGevraagd.length === 1 ? "dag" : "dagen"}
                    </span>
                  ) : null}
                </h2>
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <SamenvattingRij
                    term="Praktijk"
                    waarde={`${praktijk.naam || "—"} · ${praktijk.plaats || "—"}`}
                  />
                  <SamenvattingRij
                    term="Functie"
                    waarde={
                      role
                        ? `${label(role)}${ervaring ? ` · ${label(ervaring)}` : " · elk niveau"}`
                        : "Nog niet ingevuld"
                    }
                  />
                  <SamenvattingRij
                    term="Werkdagen"
                    waarde={
                      dagenGevraagd.length > 0
                        ? dagenGevraagd.map((dag) => label(dag)).join(", ")
                        : "Nog geen dagdelen gekozen"
                    }
                  />
                  <SamenvattingRij
                    term="Uren en contract"
                    waarde={`${hoursMin}–${hoursMax} uur · ${
                      contractTypes.length > 0
                        ? contractTypes.map(label).join(", ")
                        : "geen contractvorm gekozen"
                    }${
                      contractTypes.includes("zzp") && revenueShareMax !== null
                        ? ` · tot ${revenueShareMax}% van de omzet`
                        : ""
                    }`}
                  />
                  <SamenvattingRij
                    term="Uitrusting en specialisaties"
                    waarde={
                      equipment.length + software.length + specialisaties.length > 0
                        ? `${equipment.length + software.length + specialisaties.length} kenmerken`
                        : "Geen kenmerken aangegeven"
                    }
                  />
                  <SamenvattingRij
                    term="Begeleiding"
                    waarde={begeleiding ? "Ja, wij begeleiden" : "Zelfstandig werken"}
                  />
                </dl>
                <Button size="lg" className="w-full" onClick={publiceer} disabled={bezig}>
                  {bezig ? "Publiceren…" : "Publiceer mijn vacature"}
                </Button>
                <p className="text-center text-sm text-ink/60">
                  Je kunt de vacature daarna altijd aanpassen in je dashboard.
                </p>
              </div>
              {publicatieFout ? (
                <div
                  role="alert"
                  className="flex flex-col items-start gap-2 rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800"
                >
                  <p>{publicatieFout.fout}</p>
                  {publicatieFout.upgradeHint ? <p>{publicatieFout.upgradeHint}</p> : null}
                  {publicatieFout.abonnementUrl ? (
                    <Link
                      href={publicatieFout.abonnementUrl}
                      className="font-semibold text-roze-800 underline underline-offset-2"
                    >
                      Bekijk de abonnementen
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          {stap.id === "publiceren" && klaar ? (
            <>
              <div className="flex flex-col items-center gap-4 text-center">
                <MatchShape score={100} showScore={false} size="hero" />
                <h1
                  ref={kopRef}
                  tabIndex={-1}
                  className="text-3xl font-semibold tracking-tight text-ink outline-none sm:text-4xl"
                >
                  Je vacature staat{" "}
                  <em className="font-serif italic font-bold text-blauw-600">live</em>
                </h1>
                {publicatie?.titel ? (
                  <Badge tone="blauw">{publicatie.titel}</Badge>
                ) : null}
              </div>
              <div className="glass-strong flex flex-col gap-4 rounded-kaart-lg p-6">
                <h2 className="text-lg font-semibold text-ink">Wat er nu gebeurt</h2>
                <ul className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink/80">
                  <li className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 text-blauw-600">✓</span>
                    Kandidaten in jouw regio zien je vacature vanaf nu in hun matches.
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 text-blauw-600">✓</span>
                    Wij melden je zodra er een sterke match is — je hoeft niets te doen.
                  </li>
                  <li className="flex gap-2.5">
                    <span aria-hidden="true" className="mt-0.5 text-blauw-600">✓</span>
                    In je dashboard nodig je kandidaten uit en volg je alle reacties.
                  </li>
                </ul>
                {trialDagenOver !== null || trialDagen > 0 ? (
                  <p className="rounded-veld bg-brand-light/60 px-4 py-3 text-sm font-medium text-blauw-900">
                    Je proefperiode loopt al: nog{" "}
                    <strong className="font-semibold">
                      {trialDagenOver ?? trialDagen}{" "}
                      {(trialDagenOver ?? trialDagen) === 1 ? "dag" : "dagen"}
                    </strong>{" "}
                    gratis alle basisfuncties.
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row">
                  {slug ? (
                    <>
                      <Link
                        href={`/praktijk/${slug}`}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-blauw-600 px-8 py-3.5 text-base font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
                      >
                        Naar je dashboard
                      </Link>
                      <Link
                        href={`/praktijk/${slug}/abonnement`}
                        className="glass inline-flex flex-1 items-center justify-center gap-2 rounded-full px-8 py-3.5 text-base font-semibold text-ink transition-colors duration-150 hover:bg-white/90 motion-reduce:transition-none"
                      >
                        Bekijk abonnementen
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {fout ? (
            <p role="alert" className="rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800">
              {fout}
            </p>
          ) : null}

          {/* navigatie */}
          {!klaar ? (
            <div className="mt-auto flex flex-col-reverse items-stretch gap-3 pb-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
              {stapIndex > 0 ? (
                <Button variant="ghost" size="lg" onClick={terug} disabled={bezig}>
                  <span aria-hidden="true">←</span> Terug
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              {stap.id !== "publiceren" ? (
                <Button
                  size="lg"
                  onClick={verder}
                  disabled={bezig || (stap.id === "radar" && radarBezig)}
                  className="sm:min-w-44"
                >
                  {bezig ? "Opslaan…" : "Verder"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Samenvattingshulp                                                   */
/* ------------------------------------------------------------------ */

function SamenvattingRij({ term, waarde }: { term: string; waarde: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/50">{term}</dt>
      <dd className="font-medium text-ink">{waarde}</dd>
    </div>
  );
}
