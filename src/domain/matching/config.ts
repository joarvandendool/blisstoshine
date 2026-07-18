// Geversioneerde configuratie van de matching-engine.
//
// Alles wat de uitkomst van een match beïnvloedt staat hier, zodat de volledige
// configuratie (MATCHING_CONFIG) als JSON in de database kan worden opgeslagen
// (model MatchingConfigVersion) en resultaten reproduceerbaar blijven.

import type { MatchCategory } from "./types";

/** Semver van het algoritme; wijzigt mee met elke inhoudelijke aanpassing. */
export const ALGORITHM_VERSION = "1.0.0";

/** Gewichten per categorie — sommeren tot 1. */
export const CATEGORY_WEIGHTS: Record<MatchCategory, number> = {
  availability: 0.35,
  roleAndExperience: 0.15,
  travel: 0.15,
  employment: 0.1,
  equipmentAndSoftware: 0.1,
  specializations: 0.1,
  workplacePreferences: 0.05,
};

/**
 * Ondergrenzen (inclusief) voor de labels. Onder `partial` volgt "low";
 * een harde mismatch geeft altijd "ineligible", los van de score.
 */
export const LABEL_THRESHOLDS = {
  excellent: 85,
  good: 70,
  partial: 50,
} as const;

/** Neutrale categoriescore wanneer gegevens ontbreken — de engine crasht nooit. */
export const NEUTRAL_SCORE = 60;

/** Waarde per beschikbaarheidsniveau van de kandidaat (0–1). */
export const AVAILABILITY_LEVEL_VALUES = {
  preferred: 1,
  available: 0.75,
  unavailable: 0,
} as const;

/**
 * Gewicht per criteriumniveau: "required" telt dubbel t.o.v. "preferred",
 * "informational" telt niet mee in de score. Geldt ook voor roosterdagdelen.
 */
export const CRITERION_LEVEL_WEIGHTS = {
  required: 2,
  preferred: 1,
  informational: 0,
} as const;

/** Ontwikkelmatch-waarden (0–1) voor gevraagde apparatuur/software. */
export const DEVELOPMENT_MATCH_VALUES = {
  directExperience: 1,
  strongInterest: 0.9,
  wantsToLearnWithMentorship: 0.8,
  wantsToLearnWithoutMentorship: 0.5,
  neutral: 0.4,
  mismatch: 0.1,
} as const;

/**
 * Reistijdmodel: hemelsbrede afstand (haversine, km) × minutesPerKm ≈ reistijd.
 * T/m 50% van maxTravelMinutes → score 100; daarna lineair aflopend naar 0 bij
 * 130%; boven maxTravelMinutes volgt een aandachtspunt.
 */
export const TRAVEL_MODEL = {
  minutesPerKm: 1.1,
  fullScoreFraction: 0.5,
  zeroScoreFraction: 1.3,
} as const;

/** Weging binnen dienstverband: urenoverlap 60%, contractvorm-overlap 40%. */
export const EMPLOYMENT_WEIGHTS = {
  hours: 0.6,
  contract: 0.4,
} as const;

/**
 * Volledig configuratieobject van deze algoritmeversie — geversioneerd op te
 * slaan in de database zodat oude snapshots verklaarbaar blijven.
 */
export const MATCHING_CONFIG = {
  algorithmVersion: ALGORITHM_VERSION,
  weights: CATEGORY_WEIGHTS,
  labelThresholds: LABEL_THRESHOLDS,
  neutralScore: NEUTRAL_SCORE,
  availabilityLevelValues: AVAILABILITY_LEVEL_VALUES,
  criterionLevelWeights: CRITERION_LEVEL_WEIGHTS,
  developmentMatchValues: DEVELOPMENT_MATCH_VALUES,
  travelModel: TRAVEL_MODEL,
  employmentWeights: EMPLOYMENT_WEIGHTS,
} as const;

export type MatchingConfig = typeof MATCHING_CONFIG;
