// Talent Radar: geaggregeerd arbeidsmarktinzicht voor een vacature of concept.
//
// Privacy is hier de hoofdregel (TALENT_RADAR_MIN_GROUP uit @/lib/config):
// elke geaggregeerde teller onder de drempel wordt als null teruggegeven —
// de UI toont dan "te weinig kandidaten om veilig te tonen". Het rapport
// bevat nooit identificeerbare kandidaatgegevens, alleen tellingen.
//
// Entitlement: het volledige rapport (radarForVacancy) vereist talent_radar;
// de teaser (radarTeaser) is bewust vrij van entitlements zodat trial- en
// essential-praktijken en de vacaturewizard het totale potentieel zien.

import { cache } from "react";
import type { CandidateProfile } from "@prisma/client";
import { AuthzError, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { enforceEntitlement } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  CONTRACT_TYPES,
  DAYPARTS,
  WEEKDAYS,
  type Weekday,
} from "@/domain/taxonomy";
import {
  LABEL_THRESHOLDS,
  TRAVEL_MODEL,
  computeMatch,
  type MatchVacancy,
} from "@/domain/matching";
import { castAvailability, profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { applyVacancyOverrides } from "@/server/matching";
import { planCodeVoorAnalytics } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Contracten
// ---------------------------------------------------------------------------

/** Invoer: een bestaande (eigen) vacature of een concept uit de wizard. */
export type RadarInput = { vacancyId: string } | { draft: MatchVacancy };

export interface RadarDayCount {
  day: Weekday;
  /** Aantal beschikbare kandidaten; null onder de privacydrempel. */
  count: number | null;
}

export interface RadarLimitingCriterion {
  /** Categoriecode, bv. "schedule" of "criteria". */
  category: string;
  /** Nederlandse omschrijving voor de UI. */
  label: string;
  /** Extra eligible kandidaten bij versoepeling; null onder de privacydrempel. */
  extraEligible: number | null;
}

export interface TalentRadarReport {
  /** Actieve kandidaten met de juiste rol binnen reisafstand; null onder de drempel. */
  totalPotential: number | null;
  /** Beschikbare kandidaten per gevraagde werkdag. */
  perDay: RadarDayCount[];
  /** Eligible kandidaten met score ≥ 70; null onder de drempel. */
  strongMatches: number | null;
  /** Eligible kandidaten met score 50–69; null onder de drempel. */
  partialMatches: number | null;
  /** Meest beperkende criterium, of null wanneer versoepelen niets oplevert. */
  mostLimiting: RadarLimitingCriterion | null;
  /** Op basis van sterke matches: ≥10 laag, ≥3 gemiddeld, anders hoog. */
  difficulty: "laag" | "gemiddeld" | "hoog";
  /** De gehanteerde privacydrempel, voor uitleg in de UI. */
  minGroupSize: number;
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

/** Teller onder de privacydrempel → null. */
function maskeer(aantal: number): number | null {
  return aantal >= TALENT_RADAR_MIN_GROUP ? aantal : null;
}

/**
 * Hemelsbrede afstand in km — zelfde model als de matching-engine
 * (haversine, aardstraal 6371 km; reistijd ≈ km × minutesPerKm).
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (graden: number) => (graden * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Valt de vacature binnen de maximale reistijd van de kandidaat? */
function binnenReisafstand(profiel: CandidateProfile, vacature: MatchVacancy): boolean {
  const km = haversineKm(
    profiel.latitude,
    profiel.longitude,
    vacature.latitude,
    vacature.longitude,
  );
  return km * TRAVEL_MODEL.minutesPerKm <= profiel.maxTravelMinutes;
}

/** Invoer → MatchVacancy; een vacancyId wordt altijd binnen de eigen organisatie opgelost. */
async function resolveMatchVacancy(
  ctx: OrgContext,
  input: RadarInput,
): Promise<{ matchVacancy: MatchVacancy; vacancyId: string | null }> {
  if ("vacancyId" in input) {
    const vacature = await prisma.vacancy.findFirst({
      where: { id: input.vacancyId, organizationId: ctx.organizationId },
      include: { location: true },
    });
    if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);
    return {
      matchVacancy: vacancyToMatchVacancy(vacature, vacature.location),
      vacancyId: vacature.id,
    };
  }
  return { matchVacancy: input.draft, vacancyId: null };
}

/**
 * Actieve, vindbare kandidaten (verborgen profielen tellen nergens in mee).
 * PERF: React cache() — de radarpagina bouwt een rapport per vacature, maar
 * binnen één serverrequest volstaat één scan van de kandidatenpool.
 */
const actieveKandidaten = cache(async (): Promise<CandidateProfile[]> => {
  return prisma.candidateProfile.findMany({
    where: { status: "active", visibility: { not: "hidden" } },
  });
});

/** Potentieel: juiste rol én binnen reisafstand. */
function potentiëlePool(
  kandidaten: CandidateProfile[],
  vacature: MatchVacancy,
): CandidateProfile[] {
  return kandidaten.filter(
    (profiel) => profiel.role === vacature.role && binnenReisafstand(profiel, vacature),
  );
}

/** Aantal eligible kandidaten voor een vacaturevariant. */
function telEligible(kandidaten: CandidateProfile[], vacature: MatchVacancy): number {
  return kandidaten.filter(
    (profiel) => computeMatch(profileToMatchCandidate(profiel), vacature).eligible,
  ).length;
}

// ---------------------------------------------------------------------------
// Versoepelingsstrategieën (hergebruik van de simulatielogica)
// ---------------------------------------------------------------------------

interface Versoepeling {
  category: string;
  label: string;
  toepassen: (basis: MatchVacancy) => MatchVacancy;
}

const VERSOEPELINGEN: Versoepeling[] = [
  {
    category: "schedule",
    label: "verplichte werkdagen",
    toepassen: (basis) => {
      const rooster = structuredClone(basis.schedule);
      for (const dag of WEEKDAYS) {
        for (const dagdeel of DAYPARTS) {
          if (rooster[dag][dagdeel] === "required") rooster[dag][dagdeel] = "preferred";
        }
      }
      return applyVacancyOverrides(basis, { schedule: rooster });
    },
  },
  {
    category: "hours",
    label: "urenrange",
    toepassen: (basis) =>
      applyVacancyOverrides(basis, { hoursMin: 0, hoursMax: Math.max(basis.hoursMax, 40) }),
  },
  {
    category: "criteria",
    label: "verplichte criteria (registraties, apparatuur, software, specialisaties)",
    toepassen: (basis) => {
      const kopie = structuredClone(basis);
      for (const spec of Object.values(kopie.criteria)) {
        if (spec && spec.level === "required") spec.level = "preferred";
      }
      return kopie;
    },
  },
  {
    category: "contract",
    label: "contractvorm",
    toepassen: (basis) => {
      const kopie = structuredClone(basis);
      kopie.contractTypes = [...CONTRACT_TYPES];
      return kopie;
    },
  },
  {
    category: "startBy",
    label: "uiterste startdatum",
    toepassen: (basis) => {
      const kopie = structuredClone(basis);
      kopie.startByHard = false;
      return kopie;
    },
  },
  {
    category: "mentorship",
    label: "begeleiding",
    toepassen: (basis) => applyVacancyOverrides(basis, { mentorship: true }),
  },
];

/**
 * Meest beperkende criterium: versoepel per categorie op een kopie en meet de
 * groei van de eligible pool. De categorie met de grootste groei wint; levert
 * geen enkele versoepeling groei op, dan null.
 */
function bepaalMeestBeperkend(
  kandidaten: CandidateProfile[],
  basis: MatchVacancy,
  basisEligible: number,
): RadarLimitingCriterion | null {
  let beste: { versoepeling: Versoepeling; groei: number } | null = null;
  for (const versoepeling of VERSOEPELINGEN) {
    const groei = telEligible(kandidaten, versoepeling.toepassen(basis)) - basisEligible;
    if (groei > 0 && (beste === null || groei > beste.groei)) {
      beste = { versoepeling, groei };
    }
  }
  if (!beste) return null;
  return {
    category: beste.versoepeling.category,
    label: beste.versoepeling.label,
    extraEligible: maskeer(beste.groei),
  };
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Teaser zonder entitlement: alleen het totale aantal potentiële kandidaten
 * (juiste rol binnen reisafstand), met privacydrempel. Voor trial/essential
 * en de vacaturewizard.
 */
export async function radarTeaser(
  ctx: OrgContext,
  input: RadarInput,
): Promise<{ totalPotential: number | null; minGroupSize: number }> {
  const { matchVacancy } = await resolveMatchVacancy(ctx, input);
  const kandidaten = await actieveKandidaten();
  return {
    totalPotential: maskeer(potentiëlePool(kandidaten, matchVacancy).length),
    minGroupSize: TALENT_RADAR_MIN_GROUP,
  };
}

/**
 * Volledig Talent Radar-rapport. Vereist de entitlement talent_radar.
 * Alle tellers respecteren de privacydrempel (null onder de drempel).
 */
export async function radarForVacancy(
  ctx: OrgContext,
  input: RadarInput,
): Promise<TalentRadarReport> {
  const { matchVacancy, vacancyId } = await resolveMatchVacancy(ctx, input);
  await enforceEntitlement(ctx.organizationId, "talent_radar");

  const kandidaten = await actieveKandidaten();
  const potentieel = potentiëlePool(kandidaten, matchVacancy);

  // Verdeling per gevraagde werkdag: een kandidaat telt mee wanneer die op
  // élk gevraagd dagdeel van die dag beschikbaar is (preferred of available).
  const perDay: RadarDayCount[] = [];
  for (const dag of WEEKDAYS) {
    const gevraagdeDagdelen = DAYPARTS.filter(
      (dagdeel) => matchVacancy.schedule[dag][dagdeel] !== null,
    );
    if (gevraagdeDagdelen.length === 0) continue;
    const aantal = potentieel.filter((profiel) => {
      const beschikbaarheid = castAvailability(profiel.availability);
      return gevraagdeDagdelen.every(
        (dagdeel) => beschikbaarheid[dag][dagdeel] !== "unavailable",
      );
    }).length;
    perDay.push({ day: dag, count: maskeer(aantal) });
  }

  // Sterke en gedeeltelijke matches (drempels uit de matchingconfiguratie).
  const resultaten = kandidaten.map((profiel) =>
    computeMatch(profileToMatchCandidate(profiel), matchVacancy),
  );
  const eligibleResultaten = resultaten.filter((resultaat) => resultaat.eligible);
  const sterk = eligibleResultaten.filter(
    (resultaat) => resultaat.score >= LABEL_THRESHOLDS.good,
  ).length;
  const gedeeltelijk = eligibleResultaten.filter(
    (resultaat) =>
      resultaat.score >= LABEL_THRESHOLDS.partial &&
      resultaat.score < LABEL_THRESHOLDS.good,
  ).length;

  const mostLimiting = bepaalMeestBeperkend(
    kandidaten,
    matchVacancy,
    eligibleResultaten.length,
  );

  const difficulty: TalentRadarReport["difficulty"] =
    sterk >= 10 ? "laag" : sterk >= 3 ? "gemiddeld" : "hoog";

  await track("talent_radar_viewed", {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: {
      vacancyId: vacancyId ?? null,
      draft: vacancyId === null,
      difficulty,
    },
  });

  return {
    totalPotential: maskeer(potentieel.length),
    perDay,
    strongMatches: maskeer(sterk),
    partialMatches: maskeer(gedeeltelijk),
    mostLimiting,
    difficulty,
    minGroupSize: TALENT_RADAR_MIN_GROUP,
  };
}
