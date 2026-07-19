// Bronwaarheid: src/domain/matching/types.ts (pure types, geen engine).
// De app dupliceert NOOIT scoreberekening; zij toont uitsluitend het
// server-MatchResult dat aan deze types voldoet.
export type {
  MatchCandidate,
  MatchVacancy,
  MatchReason,
  MatchReasonKind,
  MatchCategory,
  MatchLabel,
  MatchOpportunity,
  CategoryScores,
  MatchResult,
} from "../../../src/domain/matching/types";

/** Categoriescoresleutels in vaste weergavevolgorde (identiek aan web). */
export const MATCH_CATEGORIES = [
  "availability",
  "roleAndExperience",
  "travel",
  "employment",
  "equipmentAndSoftware",
  "specializations",
  "workplacePreferences",
] as const;

/** Nederlandse categorielabels — presentatie, identiek aan de webapp. */
export const MATCH_CATEGORY_LABELS: Record<(typeof MATCH_CATEGORIES)[number], string> = {
  availability: "Beschikbaarheid",
  roleAndExperience: "Rol en ervaring",
  travel: "Reisafstand",
  employment: "Contract en uren",
  equipmentAndSoftware: "Apparatuur en software",
  specializations: "Specialisaties en behandelingen",
  workplacePreferences: "Werkplekvoorkeuren",
};

/** Ondergrenzen van de matchlabels — alleen voor presentatie (badgekleur). */
export const MATCH_LABEL_TEKST: Record<string, string> = {
  excellent: "Uitstekende match",
  good: "Goede match",
  partial: "Gedeeltelijke match",
  low: "Beperkte match",
  ineligible: "Geen match mogelijk",
};
