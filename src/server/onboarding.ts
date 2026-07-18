// Commerciële praktijkonboarding (/praktijk/start).
//
// Deze service beheert de doorlopende onboarding-flow van een praktijk:
// - stap 1 maakt via createOrganizationWithLocation direct organisatie,
//   locatie, owner-membership en trial-abonnement aan (trial_started éénmalig);
// - alle verdere stapdata wordt per stap ge-autosaved in
//   Organization.onboardingState (Json);
// - het "directe waarde"-moment: Talent Radar op een concept-behoefte
//   (draft-MatchVacancy) plus maximaal drie aanbevelingen met live effect,
//   doorgerekend op KOPIEËN via de bestaande matchinglogica — er wordt niets
//   opgeslagen;
// - de activatiedefinitie (checkAndMarkActivated): practice_activated wordt
//   exact één keer gevuurd, met Organization.activatedAt als guard.

import type { Organization, PracticeLocation } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthzError, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { can } from "@/domain/entitlements";
import { effectiveEntitlements } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  CONTRACT_TYPES,
  DAYPARTS,
  WEEKDAYS,
  label,
  type VacancyCriteria,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";
import type { MatchVacancy } from "@/domain/matching";
import { applyVacancyOverrides, poolForMatchVacancy } from "@/server/matching";
import { geocodePostcode } from "@/server/geo";
import {
  createOrganizationWithLocation,
  planCodeVoorAnalytics,
} from "@/server/organizations";
import {
  radarForVacancy,
  radarTeaser,
  type TalentRadarReport,
} from "@/server/radar";
import {
  castSchedule,
  createDraftVacancy,
  practiceSizeVanKamers,
  publishVacancy,
} from "@/server/vacancies";

// ---------------------------------------------------------------------------
// Stappen en state-contract (Organization.onboardingState)
// ---------------------------------------------------------------------------

/** De zeven stappen van de flow, in volgorde. */
export const START_STAPPEN = [
  "praktijk",
  "functie",
  "werkdagen",
  "uren",
  "uitrusting",
  "radar",
  "publiceren",
] as const;

export type StartStap = (typeof START_STAPPEN)[number];

/** Stapdata zoals opgeslagen in Organization.onboardingState. */
export interface OnboardingStateData {
  /** Index (0-basis) van de stap waarop de flow hervat. */
  currentStep: number;
  functie: { role: string; experienceLevel: string | null } | null;
  werkdagen: { schedule: VacancySchedule } | null;
  uren: {
    hoursMin: number;
    hoursMax: number;
    contractTypes: string[];
    /** Geboden omzetpercentage tot (0–100) bij zzp; anders null. */
    revenueShareMax: number | null;
  } | null;
  uitrusting: {
    equipment: string[];
    software: string[];
    specializations: string[];
    mentorship: boolean;
  } | null;
  /** ISO-timestamp: Talent Radar-stap bekeken. */
  radarViewedAt: string | null;
  /** ISO-timestamp: marktinzichtrapport (teaser/rapport) ontvangen. */
  radarReportAt: string | null;
  /** Conceptvacature die bij een mislukte publicatie hergebruikt wordt. */
  draftVacancyId: string | null;
  publishedVacancyId: string | null;
  completedAt: string | null;
}

const eisSchema = z.enum(["required", "preferred"]).nullable();
const roosterDagSchema = z.object({
  ochtend: eisSchema,
  middag: eisSchema,
  avond: eisSchema,
});
const roosterSchema = z.object({
  ma: roosterDagSchema,
  di: roosterDagSchema,
  wo: roosterDagSchema,
  do: roosterDagSchema,
  vr: roosterDagSchema,
  za: roosterDagSchema,
  zo: roosterDagSchema,
});

/** Defensief schema: onherkenbare (deel)data valt terug op null/0. */
const stateSchema = z.object({
  currentStep: z.number().int().min(0).max(START_STAPPEN.length - 1).catch(0),
  functie: z
    .object({ role: z.string().min(1), experienceLevel: z.string().nullable() })
    .nullable()
    .catch(null),
  werkdagen: z
    .object({ schedule: roosterSchema })
    .nullable()
    .catch(null),
  uren: z
    .object({
      hoursMin: z.number().int().min(0),
      hoursMax: z.number().int().min(0),
      contractTypes: z.array(z.string()),
      revenueShareMax: z.number().int().min(0).max(100).nullable(),
    })
    .nullable()
    .catch(null),
  uitrusting: z
    .object({
      equipment: z.array(z.string()),
      software: z.array(z.string()),
      specializations: z.array(z.string()),
      mentorship: z.boolean(),
    })
    .nullable()
    .catch(null),
  radarViewedAt: z.string().nullable().catch(null),
  radarReportAt: z.string().nullable().catch(null),
  draftVacancyId: z.string().nullable().catch(null),
  publishedVacancyId: z.string().nullable().catch(null),
  completedAt: z.string().nullable().catch(null),
});

/** Lege beginstand van de onboarding-state. */
export function legeOnboardingState(): OnboardingStateData {
  return {
    currentStep: 0,
    functie: null,
    werkdagen: null,
    uren: null,
    uitrusting: null,
    radarViewedAt: null,
    radarReportAt: null,
    draftVacancyId: null,
    publishedVacancyId: null,
    completedAt: null,
  };
}

/** Json-kolom → OnboardingStateData, defensief (kapotte data = leeg). */
export function leesOnboardingState(waarde: unknown): OnboardingStateData {
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) {
    return legeOnboardingState();
  }
  const parsed = stateSchema.safeParse(waarde);
  if (!parsed.success) return legeOnboardingState();
  const d = parsed.data;
  return {
    ...d,
    werkdagen: d.werkdagen
      ? { schedule: castSchedule(d.werkdagen.schedule) }
      : null,
  };
}

/** State veilig serialiseren voor de Json-kolom. */
function alsJson(state: OnboardingStateData): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Interne hulpfuncties
// ---------------------------------------------------------------------------

/** Organisatie + eerste locatie binnen het geverifieerde membership. */
async function eigenOrgMetLocatie(
  ctx: OrgContext,
): Promise<{ org: Organization; locatie: PracticeLocation }> {
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
  });
  if (!org || org.status !== "active") {
    throw new AuthzError("Praktijk niet gevonden", 404);
  }
  const locatie = await prisma.practiceLocation.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
  if (!locatie) throw new AuthzError("Er is nog geen praktijklocatie", 400);
  return { org, locatie };
}

/** Leest, muteert en schrijft de onboarding-state van een organisatie. */
async function schrijfState(
  orgId: string,
  muteer: (state: OnboardingStateData) => OnboardingStateData,
): Promise<OnboardingStateData> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { onboardingState: true },
  });
  const volgende = muteer(leesOnboardingState(org.onboardingState));
  await prisma.organization.update({
    where: { id: orgId },
    data: { onboardingState: alsJson(volgende) },
  });
  return volgende;
}

// ---------------------------------------------------------------------------
// Stap 1: praktijk aanmaken of bijwerken
// ---------------------------------------------------------------------------

export interface PraktijkStapInput {
  name: string;
  city: string;
  postcode: string;
  treatmentRooms: number;
  phone: string | null;
}

/**
 * Eerste opslag van stap 1: maakt organisatie, eerste locatie,
 * owner-membership en trial-abonnement aan via de bestaande servicelaag en
 * vuurt éénmalig onboarding_started en trial_started (dit codepad draait
 * alleen wanneer de gebruiker nog géén organisatie heeft).
 */
export async function startPraktijkOnboarding(
  input: PraktijkStapInput,
  userId: string,
): Promise<{ organization: Organization; location: PracticeLocation }> {
  const { organization, location } = await createOrganizationWithLocation({
    name: input.name,
    acquisitionSource: "praktijk_start",
    location: {
      postcode: input.postcode,
      city: input.city,
      phone: input.phone ?? undefined,
      treatmentRooms: input.treatmentRooms,
    },
  });

  await prisma.organization.update({
    where: { id: organization.id },
    data: { onboardingState: alsJson({ ...legeOnboardingState(), currentStep: 1 }) },
  });

  await track("onboarding_started", {
    organizationId: organization.id,
    userId,
    plan: "trial",
    context: { flow: "praktijk" },
  });
  // Trial-abonnement is zojuist gestart door de servicelaag — éénmalig event
  // bij organisatie-aanmaak in deze flow.
  await track("trial_started", {
    organizationId: organization.id,
    userId,
    plan: "trial",
    context: { source: "praktijk_start" },
  });
  await track("onboarding_step_completed", {
    organizationId: organization.id,
    userId,
    plan: "trial",
    context: { flow: "praktijk", step: "praktijk" },
  });

  return { organization, location };
}

/** Her-opslag van stap 1 wanneer de organisatie al bestaat. */
export async function updatePraktijkStap(
  ctx: OrgContext,
  input: PraktijkStapInput,
): Promise<void> {
  const { org, locatie } = await eigenOrgMetLocatie(ctx);
  const geo = geocodePostcode(input.postcode);
  await prisma.organization.update({
    where: { id: org.id },
    data: { name: input.name.trim() },
  });
  await prisma.practiceLocation.update({
    where: { id: locatie.id },
    data: {
      postcode: input.postcode.trim(),
      city: geo?.city ?? input.city.trim(),
      ...(geo ? { latitude: geo.latitude, longitude: geo.longitude } : {}),
      phone: input.phone,
      treatmentRooms: input.treatmentRooms,
    },
  });
  await bewaarOnboardingStap(ctx, "praktijk", (state) => state, 1);
}

// ---------------------------------------------------------------------------
// Stappen 2–5: autosave in onboardingState
// ---------------------------------------------------------------------------

/**
 * Slaat één stap op in Organization.onboardingState en trackt
 * onboarding_step_completed (context.step). currentStep gaat alleen vooruit —
 * teruggaan in de flow verlaagt het hervatpunt niet.
 */
export async function bewaarOnboardingStap(
  ctx: OrgContext,
  stap: StartStap,
  muteer: (state: OnboardingStateData) => OnboardingStateData,
  volgendeStapIndex: number,
): Promise<OnboardingStateData> {
  const state = await schrijfState(ctx.organizationId, (huidig) => {
    const volgende = muteer(huidig);
    return {
      ...volgende,
      currentStep: Math.max(huidig.currentStep, volgendeStapIndex),
    };
  });
  await track("onboarding_step_completed", {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { flow: "praktijk", step: stap },
  });
  return state;
}

// ---------------------------------------------------------------------------
// Concept-behoefte → draft-MatchVacancy (niets wordt opgeslagen)
// ---------------------------------------------------------------------------

/** Ingevoerde behoefte + locatie → MatchVacancy; null zolang stappen missen. */
export function draftUitOnboarding(
  state: OnboardingStateData,
  locatie: PracticeLocation,
): MatchVacancy | null {
  if (!state.functie || !state.werkdagen || !state.uren) return null;

  const criteria: VacancyCriteria = {};
  const u = state.uitrusting;
  if (u && u.equipment.length > 0) {
    criteria.equipment = { values: u.equipment, level: "preferred" };
  }
  if (u && u.software.length > 0) {
    criteria.software = { values: u.software, level: "preferred" };
  }
  if (u && u.specializations.length > 0) {
    criteria.specializations = { values: u.specializations, level: "preferred" };
  }

  return {
    id: "onboarding-draft",
    role: state.functie.role,
    experienceLevel: state.functie.experienceLevel,
    latitude: locatie.latitude,
    longitude: locatie.longitude,
    schedule: state.werkdagen.schedule,
    hoursMin: state.uren.hoursMin,
    hoursMax: state.uren.hoursMax,
    contractTypes: state.uren.contractTypes,
    startBy: null,
    startByHard: false,
    criteria,
    culture: [],
    mentorship: u?.mentorship ?? false,
    development: [],
    practiceSize: practiceSizeVanKamers(locatie.treatmentRooms),
    patientPopulation: locatie.patientPopulation,
  };
}

// ---------------------------------------------------------------------------
// Aanbevelingen met live effect (pure vergelijking van draft-varianten)
// ---------------------------------------------------------------------------

/** Hoe de client de aanbeveling op de ingevoerde behoefte kan toepassen. */
export type AanbevelingToepassing =
  | { type: "dag_flexibel"; dag: Weekday }
  | { type: "uren_verlagen"; hoursMin: number }
  | { type: "begeleiding" }
  | { type: "contract"; contractType: string };

export interface OnboardingAanbeveling {
  code: string;
  /** Bv. "Maak vrijdag flexibel". */
  titel: string;
  uitleg: string;
  /** Extra kandidaten binnen bereik; null onder de privacydrempel. */
  extraKandidaten: number | null;
  toepassing: AanbevelingToepassing;
}

/** Teller onder de privacydrempel → null (zelfde regel als Talent Radar). */
function maskeer(aantal: number): number | null {
  return aantal >= TALENT_RADAR_MIN_GROUP ? aantal : null;
}

interface Variant {
  code: string;
  titel: string;
  uitleg: string;
  toepassing: AanbevelingToepassing;
  vacature: MatchVacancy;
}

/** Alle zinvolle versoepelingsvarianten van de draft, elk op een kopie. */
function bouwVarianten(draft: MatchVacancy): Variant[] {
  const varianten: Variant[] = [];

  // 1. Een verplichte dag flexibel maken (required → preferred), per dag.
  for (const dag of WEEKDAYS) {
    const heeftVerplicht = DAYPARTS.some(
      (deel) => draft.schedule[dag][deel] === "required",
    );
    if (!heeftVerplicht) continue;
    const rooster = structuredClone(draft.schedule);
    for (const deel of DAYPARTS) {
      if (rooster[dag][deel] === "required") rooster[dag][deel] = "preferred";
    }
    varianten.push({
      code: `dag_flexibel_${dag}`,
      titel: `Maak ${label(dag).toLowerCase()} flexibel`,
      uitleg: `Vraag ${label(dag).toLowerCase()} als gewenst in plaats van verplicht — kandidaten die deze dag niet kunnen, blijven dan binnen bereik.`,
      toepassing: { type: "dag_flexibel", dag },
      vacature: applyVacancyOverrides(draft, { schedule: rooster }),
    });
  }

  // 2. Minimum uren verlagen.
  if (draft.hoursMin > 4) {
    const nieuwMin = Math.max(4, draft.hoursMin - 8);
    varianten.push({
      code: "uren_verlagen",
      titel: `Verlaag het minimum naar ${nieuwMin} uur`,
      uitleg:
        "Ook kandidaten die minder uren zoeken tellen dan mee in je bereik.",
      toepassing: { type: "uren_verlagen", hoursMin: nieuwMin },
      vacature: applyVacancyOverrides(draft, { hoursMin: nieuwMin }),
    });
  }

  // 3. Begeleiding of training aanbieden (bv. voor een scanner).
  if (!draft.mentorship) {
    varianten.push({
      code: "begeleiding",
      titel: "Bied begeleiding of training aan",
      uitleg:
        "Kandidaten die bijvoorbeeld nog met jouw scanner willen leren werken, scoren dan als ontwikkelmatch in plaats van als mismatch.",
      toepassing: { type: "begeleiding" },
      vacature: applyVacancyOverrides(draft, { mentorship: true }),
    });
  }

  // 4. Een extra contractvorm toestaan, per ontbrekende vorm.
  for (const vorm of CONTRACT_TYPES) {
    if (draft.contractTypes.includes(vorm)) continue;
    const kopie = structuredClone(draft);
    kopie.contractTypes = [...draft.contractTypes, vorm];
    varianten.push({
      code: `contract_${vorm}`,
      titel: `Sta ook ${label(vorm).toLowerCase() === "zzp" ? "zzp" : label(vorm).toLowerCase()} toe`,
      uitleg: `Kandidaten die uitsluitend via ${label(vorm).toLowerCase() === "zzp" ? "zzp" : label(vorm).toLowerCase()} willen werken, komen dan ook in aanmerking.`,
      toepassing: { type: "contract", contractType: vorm },
      vacature: kopie,
    });
  }

  return varianten;
}

/**
 * Maximaal drie aanbevelingen met live effect: elke variant wordt door de
 * bestaande matchinglogica (poolForMatchVacancy) gehaald en vergeleken met de
 * basis. Alleen varianten die daadwerkelijk kandidaten opleveren blijven over;
 * gesorteerd op effect. Er wordt NIETS opgeslagen.
 */
export async function berekenOnboardingAanbevelingen(
  draft: MatchVacancy,
): Promise<OnboardingAanbeveling[]> {
  const basisPool = await poolForMatchVacancy(draft);
  const profielen = basisPool.map((p) => p.profile);
  const basisEligible = basisPool.filter((p) => p.result.eligible).length;

  const uitkomsten: Array<{ variant: Variant; groei: number }> = [];
  for (const variant of bouwVarianten(draft)) {
    const pool = await poolForMatchVacancy(variant.vacature, profielen);
    const groei = pool.filter((p) => p.result.eligible).length - basisEligible;
    if (groei > 0) uitkomsten.push({ variant, groei });
  }

  uitkomsten.sort((a, b) => b.groei - a.groei);
  return uitkomsten.slice(0, 3).map(({ variant, groei }) => ({
    code: variant.code,
    titel: variant.titel,
    uitleg: variant.uitleg,
    extraKandidaten: maskeer(groei),
    toepassing: variant.toepassing,
  }));
}

// ---------------------------------------------------------------------------
// Stap 6: Talent Radar op de concept-behoefte
// ---------------------------------------------------------------------------

export interface OnboardingRadarData {
  /** Potentiële kandidaten (juiste rol binnen reisafstand); null onder drempel. */
  totalPotential: number | null;
  minGroupSize: number;
  /** Volledig rapport wanneer de entitlement talent_radar het toestaat. */
  rapport: TalentRadarReport | null;
  aanbevelingen: OnboardingAanbeveling[];
}

/**
 * Het "directe waarde"-moment: teaser voor iedereen, het volledige rapport
 * alleen wanneer het abonnement talent_radar toestaat, plus maximaal drie
 * aanbevelingen. Markeert de radar als bekeken en het marktinzichtrapport als
 * ontvangen, en voert daarna de activatiecheck uit.
 */
export async function onboardingRadar(
  ctx: OrgContext,
): Promise<OnboardingRadarData> {
  const { org, locatie } = await eigenOrgMetLocatie(ctx);
  const state = leesOnboardingState(org.onboardingState);
  const draft = draftUitOnboarding(state, locatie);
  if (!draft) {
    throw new AuthzError("Vul eerst je personeelsbehoefte in (stap 2 t/m 4)", 400);
  }

  const teaser = await radarTeaser(ctx, { draft });

  let rapport: TalentRadarReport | null = null;
  const effectief = await effectiveEntitlements(ctx.organizationId);
  if (can(effectief.entitlements, "talent_radar")) {
    // talent_radar_viewed wordt in de radar-service getrackt.
    rapport = await radarForVacancy(ctx, { draft });
  }

  const aanbevelingen = await berekenOnboardingAanbevelingen(draft);

  const nu = new Date().toISOString();
  await schrijfState(org.id, (huidig) => ({
    ...huidig,
    radarViewedAt: huidig.radarViewedAt ?? nu,
    radarReportAt: huidig.radarReportAt ?? nu,
    currentStep: Math.max(huidig.currentStep, 5),
  }));
  await checkAndMarkActivated(org.id);

  return {
    totalPotential: teaser.totalPotential,
    minGroupSize: teaser.minGroupSize,
    rapport,
    aanbevelingen,
  };
}

// ---------------------------------------------------------------------------
// Stap 7: publiceren
// ---------------------------------------------------------------------------

/** "Mondhygiënist — 2–3 dagen" op basis van rol en gevraagde dagen. */
export function automatischeTitel(
  role: string,
  schedule: VacancySchedule,
): string {
  let verplicht = 0;
  let totaal = 0;
  for (const dag of WEEKDAYS) {
    const eisen = DAYPARTS.map((deel) => schedule[dag][deel]);
    if (eisen.some((eis) => eis !== null)) totaal += 1;
    if (eisen.some((eis) => eis === "required")) verplicht += 1;
  }
  if (totaal === 0) return label(role);
  const min = verplicht > 0 ? verplicht : totaal;
  const dagen =
    min === totaal
      ? `${totaal} ${totaal === 1 ? "dag" : "dagen"}`
      : `${min}–${totaal} dagen`;
  return `${label(role)} — ${dagen}`;
}

export interface PublicatieResultaat {
  vacancyId: string;
  titel: string;
}

/**
 * Maakt van de ingevoerde behoefte een echte vacature (createDraftVacancy +
 * publishVacancy). Een eerder aangemaakt concept wordt hergebruikt zodat een
 * mislukte publicatie (bv. EntitlementError) geen dubbele concepten oplevert.
 * vacancy_published wordt in de vacature-service getrackt.
 */
export async function publiceerOnboardingVacature(
  ctx: OrgContext,
): Promise<PublicatieResultaat> {
  const { org, locatie } = await eigenOrgMetLocatie(ctx);
  const state = leesOnboardingState(org.onboardingState);

  if (state.publishedVacancyId) {
    const bestaand = await prisma.vacancy.findFirst({
      where: { id: state.publishedVacancyId, organizationId: org.id },
      select: { id: true, title: true },
    });
    if (bestaand) return { vacancyId: bestaand.id, titel: bestaand.title };
  }

  if (!state.functie || !state.werkdagen || !state.uren) {
    throw new AuthzError("Vul eerst je personeelsbehoefte in (stap 2 t/m 4)", 400);
  }

  // Bestaand concept hergebruiken of een nieuw concept aanmaken.
  let vacancyId: string | null = null;
  if (state.draftVacancyId) {
    const concept = await prisma.vacancy.findFirst({
      where: { id: state.draftVacancyId, organizationId: org.id, status: "draft" },
      select: { id: true },
    });
    vacancyId = concept?.id ?? null;
  }

  const titel = automatischeTitel(state.functie.role, state.werkdagen.schedule);
  if (!vacancyId) {
    const criteria: VacancyCriteria = {};
    const u = state.uitrusting;
    if (u && u.equipment.length > 0) {
      criteria.equipment = { values: u.equipment, level: "preferred" };
    }
    if (u && u.software.length > 0) {
      criteria.software = { values: u.software, level: "preferred" };
    }
    if (u && u.specializations.length > 0) {
      criteria.specializations = { values: u.specializations, level: "preferred" };
    }
    const concept = await createDraftVacancy(ctx, {
      locationId: locatie.id,
      title: titel,
      role: state.functie.role,
      experienceLevel: state.functie.experienceLevel,
      schedule: state.werkdagen.schedule,
      hoursMin: state.uren.hoursMin,
      hoursMax: state.uren.hoursMax,
      contractTypes: state.uren.contractTypes,
      revenueShareMax: state.uren.contractTypes.includes("zzp")
        ? state.uren.revenueShareMax
        : null,
      criteria,
      mentorship: state.uitrusting?.mentorship ?? false,
    });
    vacancyId = concept.id;
    await schrijfState(org.id, (huidig) => ({
      ...huidig,
      draftVacancyId: concept.id,
    }));
  }

  // Kan een EntitlementError gooien — de route vangt die netjes af; het
  // concept blijft dan staan voor een volgende poging.
  const gepubliceerd = await publishVacancy(ctx, vacancyId);

  await schrijfState(org.id, (huidig) => ({
    ...huidig,
    draftVacancyId: null,
    publishedVacancyId: gepubliceerd.id,
    completedAt: huidig.completedAt ?? new Date().toISOString(),
    currentStep: START_STAPPEN.length - 1,
  }));
  await track("onboarding_step_completed", {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { flow: "praktijk", step: "publiceren" },
  });
  await checkAndMarkActivated(org.id);

  return { vacancyId: gepubliceerd.id, titel: gepubliceerd.title };
}

// ---------------------------------------------------------------------------
// Activatie
// ---------------------------------------------------------------------------

/**
 * Activatiedefinitie: een praktijk is geactiveerd wanneer
 * 1. de organisatie bestaat (actief),
 * 2. er minstens één complete locatie is (plaats + postcode + behandelkamer),
 * 3. de personeelsbehoefte is ingevoerd (functie + werkdagen in de
 *    onboarding, of er bestaat al een vacature),
 * 4. de Talent Radar is bekeken, en
 * 5. minstens één match of marktinzichtrapport is ontvangen.
 *
 * Zet Organization.activatedAt eenmalig en vuurt practice_activated EXACT ÉÉN
 * KEER: de updateMany met guard `activatedAt: null` is atomair — alleen de
 * aanroep die de rij daadwerkelijk omzet (count === 1) trackt het event.
 */
export async function checkAndMarkActivated(orgId: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: { locations: true },
  });
  if (!org || org.status !== "active" || org.activatedAt) return false;

  // 2. minstens één complete locatie
  const locatieCompleet = org.locations.some(
    (locatie) =>
      locatie.city.trim().length > 0 &&
      locatie.postcode.trim().length > 0 &&
      locatie.treatmentRooms >= 1,
  );
  if (!locatieCompleet) return false;

  // 3. personeelsbehoefte ingevoerd
  const state = leesOnboardingState(org.onboardingState);
  const behoefteIngevoerd =
    (state.functie !== null && state.werkdagen !== null) ||
    (await prisma.vacancy.count({ where: { organizationId: orgId } })) > 0;
  if (!behoefteIngevoerd) return false;

  // 4 + 5. Talent Radar bekeken en een match of marktinzichtrapport ontvangen.
  // Buiten de onboarding om telt een talent_radar_viewed-event (het rapport is
  // dan geleverd) of een MatchSnapshot als bewijs.
  const radarEvents =
    state.radarViewedAt !== null
      ? 1
      : await prisma.analyticsEvent.count({
          where: { name: "talent_radar_viewed", organizationId: orgId },
        });
  const radarBekeken = state.radarViewedAt !== null || radarEvents > 0;
  if (!radarBekeken) return false;

  const matchOfRapport =
    state.radarReportAt !== null ||
    radarEvents > 0 ||
    (await prisma.matchSnapshot.count({
      where: { vacancy: { organizationId: orgId } },
    })) > 0;
  if (!matchOfRapport) return false;

  // Atomaire guard: alleen de aanroep die activatedAt daadwerkelijk zet
  // (count === 1) vuurt het event — nooit twee keer, ook niet bij races.
  const resultaat = await prisma.organization.updateMany({
    where: { id: orgId, activatedAt: null },
    data: { activatedAt: new Date() },
  });
  if (resultaat.count !== 1) return false;

  await track("practice_activated", {
    organizationId: orgId,
    plan: await planCodeVoorAnalytics(orgId),
    acquisitionSource: org.acquisitionSource ?? undefined,
    context: { flow: "praktijk" },
  });
  await audit("organization.activate", "Organization", orgId, {
    organizationId: orgId,
  });
  return true;
}
