// Servicelaag voor kandidaatprofielen: onboarding in stappen, activatie en de
// mapping van een opgeslagen profiel naar het matching-contract
// (MatchCandidate). Alles loopt via requireCandidate — een kandidaat kan
// uitsluitend zijn eigen profiel lezen en schrijven.

import type { CandidateProfile, Prisma, ProfileVisibility } from "@prisma/client";
import { AuthzError, requireCandidate } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import {
  DAYPARTS,
  WEEKDAYS,
  emptyAvailability,
  type CandidateAvailability,
} from "@/domain/taxonomy";
import type { MatchCandidate } from "@/domain/matching";
import { geocodePostcode } from "@/server/geo";

// Terugvalcoördinaten (midden van Nederland) voor een onbekende postcode.
const MIDDEN_NEDERLAND = { latitude: 52.1326, longitude: 5.2913 } as const;

// ---------------------------------------------------------------------------
// Lezen
// ---------------------------------------------------------------------------

/** Ingelogde kandidaat + eigen profiel (null zolang onboarding niet is gestart). */
export async function getOwnProfile(): Promise<{
  user: SessionUser;
  profile: CandidateProfile | null;
}> {
  return requireCandidate();
}

// ---------------------------------------------------------------------------
// Onboarding in stappen
// ---------------------------------------------------------------------------

/**
 * Gedeeltelijke profielvelden van één onboardingstap. Alleen meegegeven velden
 * worden overschreven; arrays vervangen de vorige waarde volledig.
 */
export interface ProfileStepInput {
  /** Naam van de stap (bv. "basis", "werkweek") — voor analytics. */
  stepName: string;
  role?: string;
  experienceLevel?: string;
  postcode?: string;
  maxTravelMinutes?: number;
  hoursMin?: number;
  hoursMax?: number;
  contractTypes?: string[];
  availableFrom?: Date | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  /** Gewenst omzetpercentage bij zzp (geheel getal, 0–100). */
  revenueShareMin?: number | null;
  availability?: CandidateAvailability;
  equipmentExperience?: string[];
  equipmentWantsToWork?: string[];
  techniquesWantsToLearn?: string[];
  softwareSkills?: string[];
  specializations?: string[];
  treatmentInterests?: string[];
  preferredPopulation?: string[];
  mentorshipNeeded?: boolean;
  developmentGoals?: string[];
  preferredPracticeSize?: string | null;
  workPace?: string | null;
  teamPreferences?: string[];
  visibility?: ProfileVisibility;
}

/** Json-kolom → CandidateAvailability, defensief (ontbrekend = unavailable). */
export function castAvailability(waarde: unknown): CandidateAvailability {
  const basis = emptyAvailability();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        const niveau = (rij as Record<string, unknown>)[dagdeel];
        if (niveau === "preferred" || niveau === "available" || niveau === "unavailable") {
          basis[dag][dagdeel] = niveau;
        }
      }
    }
  }
  return basis;
}

/** Is er minstens één dagdeel waarop de kandidaat kan werken? */
function heeftBeschikbaarheid(availability: CandidateAvailability): boolean {
  return WEEKDAYS.some((dag) =>
    DAYPARTS.some((dagdeel) => availability[dag][dagdeel] !== "unavailable"),
  );
}

/** Heeft de kandidaat de zichtbaarheidskeuze expliciet bevestigd? */
function zichtbaarheidBevestigd(anonymitySettings: unknown): boolean {
  return (
    typeof anonymitySettings === "object" &&
    anonymitySettings !== null &&
    (anonymitySettings as Record<string, unknown>).keuzeBevestigd === true
  );
}

/**
 * Volledigheid als percentage van zes ingevulde kerngroepen:
 * basis, werkweek, reizen/uren, vakinhoud, voorkeuren en zichtbaarheid.
 * De zichtbaarheidsgroep telt zodra de kandidaat de keuze expliciet heeft
 * bevestigd (marker keuzeBevestigd in anonymitySettings — de standaardwaarde
 * "anonymous" telt niet automatisch als bewuste keuze).
 */
export function berekenCompleteness(profiel: {
  role: string;
  experienceLevel: string;
  postcode: string;
  availability: CandidateAvailability;
  maxTravelMinutes: number;
  hoursMin: number;
  hoursMax: number;
  equipmentExperience: string[];
  softwareSkills: string[];
  specializations: string[];
  treatmentInterests: string[];
  preferredPopulation: string[];
  developmentGoals: string[];
  teamPreferences: string[];
  preferredPracticeSize: string | null;
  workPace: string | null;
  mentorshipNeeded: boolean;
  anonymitySettings: unknown;
}): number {
  const groepen = [
    // basis
    profiel.role.length > 0 && profiel.experienceLevel.length > 0 && profiel.postcode.length > 0,
    // werkweek
    heeftBeschikbaarheid(profiel.availability),
    // reizen en uren
    profiel.maxTravelMinutes > 0 && profiel.hoursMin > 0 && profiel.hoursMax >= profiel.hoursMin,
    // vakinhoud
    profiel.equipmentExperience.length > 0 ||
      profiel.softwareSkills.length > 0 ||
      profiel.specializations.length > 0 ||
      profiel.treatmentInterests.length > 0,
    // voorkeuren
    profiel.preferredPracticeSize !== null ||
      profiel.workPace !== null ||
      profiel.teamPreferences.length > 0 ||
      profiel.preferredPopulation.length > 0 ||
      profiel.developmentGoals.length > 0 ||
      profiel.mentorshipNeeded,
    // zichtbaarheid
    zichtbaarheidBevestigd(profiel.anonymitySettings),
  ];
  const ingevuld = groepen.filter(Boolean).length;
  return Math.round((ingevuld / groepen.length) * 100);
}

/**
 * Slaat één onboardingstap op (upsert van het eigen CandidateProfile) en
 * herberekent de volledigheidsscore. Bij de allereerste stap wordt
 * onboarding_started getrackt; elke stap trackt onboarding_step_completed.
 */
export async function saveProfileStep(
  input: ProfileStepInput,
): Promise<CandidateProfile> {
  const { user, profile: bestaand } = await requireCandidate();

  // Nieuwe waarden samenvoegen met het bestaande profiel (of met defaults).
  const postcode = input.postcode ?? bestaand?.postcode ?? "";
  const geo = geocodePostcode(postcode);
  const latitude =
    geo?.latitude ?? (input.postcode === undefined ? bestaand?.latitude : undefined) ?? MIDDEN_NEDERLAND.latitude;
  const longitude =
    geo?.longitude ?? (input.postcode === undefined ? bestaand?.longitude : undefined) ?? MIDDEN_NEDERLAND.longitude;

  const anonymitySettings =
    input.visibility !== undefined
      ? {
          ...(typeof bestaand?.anonymitySettings === "object" && bestaand?.anonymitySettings !== null
            ? (bestaand.anonymitySettings as Record<string, unknown>)
            : {}),
          keuzeBevestigd: true,
        }
      : undefined;

  const samengevoegd = {
    role: input.role ?? bestaand?.role ?? "",
    experienceLevel: input.experienceLevel ?? bestaand?.experienceLevel ?? "",
    postcode,
    latitude,
    longitude,
    maxTravelMinutes: input.maxTravelMinutes ?? bestaand?.maxTravelMinutes ?? 30,
    hoursMin: input.hoursMin ?? bestaand?.hoursMin ?? 0,
    hoursMax: input.hoursMax ?? bestaand?.hoursMax ?? 0,
    contractTypes: input.contractTypes ?? bestaand?.contractTypes ?? [],
    availableFrom:
      input.availableFrom !== undefined ? input.availableFrom : bestaand?.availableFrom ?? null,
    salaryMin: input.salaryMin !== undefined ? input.salaryMin : bestaand?.salaryMin ?? null,
    salaryMax: input.salaryMax !== undefined ? input.salaryMax : bestaand?.salaryMax ?? null,
    revenueShareMin:
      input.revenueShareMin !== undefined
        ? input.revenueShareMin
        : bestaand?.revenueShareMin ?? null,
    availability: input.availability ?? castAvailability(bestaand?.availability),
    equipmentExperience: input.equipmentExperience ?? bestaand?.equipmentExperience ?? [],
    equipmentWantsToWork: input.equipmentWantsToWork ?? bestaand?.equipmentWantsToWork ?? [],
    techniquesWantsToLearn:
      input.techniquesWantsToLearn ?? bestaand?.techniquesWantsToLearn ?? [],
    softwareSkills: input.softwareSkills ?? bestaand?.softwareSkills ?? [],
    specializations: input.specializations ?? bestaand?.specializations ?? [],
    treatmentInterests: input.treatmentInterests ?? bestaand?.treatmentInterests ?? [],
    preferredPopulation: input.preferredPopulation ?? bestaand?.preferredPopulation ?? [],
    mentorshipNeeded: input.mentorshipNeeded ?? bestaand?.mentorshipNeeded ?? false,
    developmentGoals: input.developmentGoals ?? bestaand?.developmentGoals ?? [],
    preferredPracticeSize:
      input.preferredPracticeSize !== undefined
        ? input.preferredPracticeSize
        : bestaand?.preferredPracticeSize ?? null,
    workPace: input.workPace !== undefined ? input.workPace : bestaand?.workPace ?? null,
    teamPreferences: input.teamPreferences ?? bestaand?.teamPreferences ?? [],
    visibility: input.visibility ?? bestaand?.visibility ?? ("anonymous" as ProfileVisibility),
  };

  const completenessScore = berekenCompleteness({
    ...samengevoegd,
    anonymitySettings: anonymitySettings ?? bestaand?.anonymitySettings ?? null,
  });

  const data = {
    ...samengevoegd,
    availability: samengevoegd.availability as unknown as Prisma.InputJsonValue,
    ...(anonymitySettings !== undefined
      ? { anonymitySettings: anonymitySettings as Prisma.InputJsonValue }
      : {}),
    completenessScore,
  };

  const profile = await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  if (!bestaand) {
    await track("onboarding_started", {
      userId: user.id,
      candidateId: profile.id,
      context: { step: input.stepName },
    });
  }
  await track("onboarding_step_completed", {
    userId: user.id,
    candidateId: profile.id,
    context: { step: input.stepName, completeness: completenessScore },
  });

  return profile;
}

/**
 * Zet het eigen profiel op actief: vanaf dat moment draait de kandidaat mee in
 * matching en (afhankelijk van zichtbaarheid) in kandidaatlijsten.
 */
export async function activateProfile(): Promise<CandidateProfile> {
  const { user, profile } = await requireCandidate();
  if (!profile) {
    throw new AuthzError("Maak eerst je profiel aan voordat je het activeert", 404);
  }

  const geactiveerd = await prisma.candidateProfile.update({
    where: { userId: user.id },
    data: { status: "active" },
  });

  await track("candidate_profile_completed", {
    userId: user.id,
    candidateId: profile.id,
    context: { completeness: profile.completenessScore },
  });
  await track("candidate_profile_activated", {
    userId: user.id,
    candidateId: profile.id,
  });

  return geactiveerd;
}

// ---------------------------------------------------------------------------
// Mapping naar het matching-contract
// ---------------------------------------------------------------------------

/**
 * Vereenvoudigde afleiding van registraties/bevoegdheden — het profiel vraagt
 * hier (nog) niet expliciet naar, dus we leiden af uit rol en ervaring:
 * - tandarts → BIG-registratie tandarts;
 * - mondhygiënist → BIG-registratie mondhygiënist, en senior daarnaast
 *   röntgenbevoegdheid;
 * - overige rollen → geen registraties.
 * Zodra het profiel registraties expliciet uitvraagt, vervangt dat deze regel.
 */
function afgeleideRegistraties(role: string, experienceLevel: string): string[] {
  if (role === "tandarts") return ["big_tandarts"];
  if (role === "mondhygienist") {
    return experienceLevel === "senior"
      ? ["big_mondhygienist", "rontgenbevoegdheid"]
      : ["big_mondhygienist"];
  }
  return [];
}

/** Opgeslagen profiel → MatchCandidate voor de matching-engine. Pure mapper. */
export function profileToMatchCandidate(profile: CandidateProfile): MatchCandidate {
  return {
    id: profile.id,
    role: profile.role,
    experienceLevel: profile.experienceLevel,
    latitude: profile.latitude,
    longitude: profile.longitude,
    maxTravelMinutes: profile.maxTravelMinutes,
    hoursMin: profile.hoursMin,
    hoursMax: profile.hoursMax,
    contractTypes: profile.contractTypes,
    salaryMin: profile.salaryMin,
    revenueShareMin: profile.revenueShareMin,
    availableFrom: profile.availableFrom,
    availability: castAvailability(profile.availability),
    registrations: afgeleideRegistraties(profile.role, profile.experienceLevel),
    equipmentExperience: profile.equipmentExperience,
    equipmentWantsToWork: profile.equipmentWantsToWork,
    techniquesWantsToLearn: profile.techniquesWantsToLearn,
    softwareSkills: profile.softwareSkills,
    specializations: profile.specializations,
    treatmentInterests: profile.treatmentInterests,
    preferredPopulation: profile.preferredPopulation,
    mentorshipNeeded: profile.mentorshipNeeded,
    preferredPracticeSize: profile.preferredPracticeSize,
    workPace: profile.workPace,
    teamPreferences: profile.teamPreferences,
  };
}
