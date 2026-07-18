// Contracten van de matching-engine. Pure types — geen React, routes of database.

import type {
  CandidateAvailability,
  VacancySchedule,
  VacancyCriteria,
} from "../taxonomy";

/** Bepalende kandidaatgegevens voor matching (los van Prisma). */
export interface MatchCandidate {
  id: string;
  role: string;
  experienceLevel: string;
  latitude: number;
  longitude: number;
  maxTravelMinutes: number;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  availableFrom: Date | null;
  availability: CandidateAvailability;
  registrations?: string[];
  equipmentExperience: string[];
  equipmentWantsToWork: string[];
  techniquesWantsToLearn: string[];
  softwareSkills: string[];
  specializations: string[];
  treatmentInterests: string[];
  preferredPopulation: string[];
  mentorshipNeeded: boolean;
  preferredPracticeSize: string | null;
  workPace: string | null;
  teamPreferences: string[];
}

/** Bepalende vacature- en praktijkgegevens voor matching. */
export interface MatchVacancy {
  id: string;
  role: string;
  experienceLevel: string | null;
  latitude: number;
  longitude: number;
  schedule: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  startBy: Date | null;
  startByHard: boolean;
  criteria: VacancyCriteria;
  culture: string[];
  mentorship: boolean;
  development: string[];
  /** praktijkcontext */
  practiceSize?: string | null; // klein | middel | groot (afgeleid van behandelkamers)
  patientPopulation?: string[];
}

export type MatchReasonKind = "hard" | "strength" | "attention";

export interface MatchReason {
  code: string;
  category: MatchCategory;
  message: string; // Nederlandstalige, concrete uitleg
}

export type MatchCategory =
  | "availability"
  | "roleAndExperience"
  | "travel"
  | "employment"
  | "equipmentAndSoftware"
  | "specializations"
  | "workplacePreferences";

export type MatchLabel = "excellent" | "good" | "partial" | "low" | "ineligible";

export interface MatchOpportunity {
  code: string;
  title: string;
  explanation: string;
  currentScore: number;
  projectedScore: number;
  affectedCriteria: string[];
  requiresCandidateApproval: boolean;
  requiresPracticeApproval: boolean;
}

export interface CategoryScores {
  availability: number;
  roleAndExperience: number;
  travel: number;
  employment: number;
  equipmentAndSoftware: number;
  specializations: number;
  workplacePreferences: number;
}

export interface MatchResult {
  eligible: boolean;
  score: number; // 0–100
  label: MatchLabel;
  summary: string; // korte Nederlandse samenvatting
  hardMismatchReasons: MatchReason[];
  strengths: MatchReason[];
  attentionPoints: MatchReason[];
  categoryScores: CategoryScores;
  opportunities: MatchOpportunity[];
  algorithmVersion: string;
}

/** Ontwikkelmatch-niveau voor apparatuur/technieken. */
export type DevelopmentMatch =
  | "direct_experience"
  | "strong_interest"
  | "wants_to_learn"
  | "neutral"
  | "mismatch";
