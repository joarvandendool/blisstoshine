// Wire-types van /api/mobile/v1/* — het contract dat server-mappers
// (src/server/mobile/views.ts) produceren en de app consumeert.
// Datums zijn altijd ISO 8601-strings op de draad.

import type { CandidateAvailability, VacancySchedule } from "./taxonomy";
import type { MatchResult } from "./matching";
import type {
  ApplicationStatus,
  CandidateStatus,
  FeedbackReasonCode,
  InterviewStatus,
  InvitationStatus,
  ProfileVisibility,
  VacancyStatus,
} from "./enums";

// ---------------------------------------------------------------------------
// Fout-envelope
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid"
  | "revoked"
  | "gone"
  | "server_error";

export interface ApiErrorEnvelope {
  error: { code: ApiErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface MobileUser {
  id: string;
  email: string;
  name: string;
}

export interface MobileTokens {
  accessToken: string;
  /** ISO-tijdstip waarop de access-token verloopt. */
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  deviceName?: string;
  platform?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceName?: string;
  platform?: string;
}

export interface AuthResponse {
  user: MobileUser;
  tokens: MobileTokens;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  tokens: MobileTokens;
}

export interface MobileSessionView {
  id: string;
  deviceName: string | null;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

// ---------------------------------------------------------------------------
// Profiel
// ---------------------------------------------------------------------------

export interface ProfileView {
  role: string;
  experienceLevel: string;
  postcode: string;
  maxTravelMinutes: number;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  /** ISO-datum of null. */
  availableFrom: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Gewenst zzp-omzetpercentage, geheel getal 0–100. */
  revenueShareMin: number | null;
  availability: CandidateAvailability;
  equipmentExperience: string[];
  equipmentWantsToWork: string[];
  techniquesWantsToLearn: string[];
  softwareSkills: string[];
  specializations: string[];
  treatmentInterests: string[];
  preferredPopulation: string[];
  mentorshipNeeded: boolean;
  developmentGoals: string[];
  preferredPracticeSize: string | null;
  workPace: string | null;
  teamPreferences: string[];
  visibility: ProfileVisibility;
  completenessScore: number;
  status: CandidateStatus;
}

export interface MeResponse {
  user: MobileUser;
  profile: ProfileView | null;
}

export interface ProfileResponse {
  profile: ProfileView | null;
}

/**
 * Gedeeltelijke profielstap — zelfde semantiek als de web-onboarding:
 * alleen meegegeven velden overschrijven; arrays vervangen volledig.
 */
export interface ProfileStepRequest {
  stepName: string;
  role?: string;
  experienceLevel?: string;
  postcode?: string;
  maxTravelMinutes?: number;
  hoursMin?: number;
  hoursMax?: number;
  contractTypes?: string[];
  availableFrom?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
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

// ---------------------------------------------------------------------------
// Openbare vacatures (hergebruik van /api/public/v1 — hier het deel dat de
// app leest; het volledige contract blijft src/server/public/read-models.ts)
// ---------------------------------------------------------------------------

export interface PublicKeyLabel {
  key: string;
  label: string;
}

export interface PublicOrganizationSummary {
  name: string;
  slug: string;
}

export interface PublicLocation {
  city: string;
  region: string;
  postcode4: string | null;
}

export interface PublicCompensation {
  minCents: number | null;
  maxCents: number | null;
  period: "month";
}

export interface PublicRevenueShare {
  maxPercent: number;
}

export interface PublicRequirement {
  label: string;
  level: "required" | "preferred" | "informational";
}

export interface PublicAvailabilityDay {
  day: string;
  dayparts: string[];
  level: "required" | "preferred";
}

export interface PublicJobSummary {
  id: string;
  slug: string;
  canonicalUrl: string;
  title: string;
  role: PublicKeyLabel;
  organization: PublicOrganizationSummary;
  location: PublicLocation;
  hoursMin?: number;
  hoursMax?: number;
  employmentTypes: string[];
  salary?: PublicCompensation;
  revenueShare?: PublicRevenueShare;
  datePosted: string;
  updatedAt: string;
  status: "published";
}

export interface PublicJobView {
  id: string;
  slug: string;
  canonicalUrl: string;
  title: string;
  role: PublicKeyLabel;
  organization: PublicOrganizationSummary;
  location: PublicLocation;
  description: string | null;
  responsibilities: string[];
  requirements: PublicRequirement[];
  availability: PublicAvailabilityDay[];
  hoursMin?: number;
  hoursMax?: number;
  employmentTypes: string[];
  salary?: PublicCompensation;
  revenueShare?: PublicRevenueShare;
  equipment: PublicKeyLabel[];
  software: PublicKeyLabel[];
  specializations: PublicKeyLabel[];
  datePosted: string;
  validThrough?: string;
  status: "published" | "closed";
}

export interface PublicJobSearchResult {
  items: PublicJobSummary[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export interface MatchListItem {
  vacancyId: string;
  slug: string | null;
  title: string;
  role: string;
  organizationName: string;
  city: string;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  schedule: VacancySchedule;
  /** Volledig serverresultaat — de app rekent nooit zelf. */
  result: MatchResult;
}

export interface MatchesResponse {
  matches: MatchListItem[];
}

export interface MatchDetail extends MatchListItem {
  description: string | null;
  culture: string[];
  mentorship: boolean;
  development: string[];
  flexibilityNote: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** Maximaal geboden zzp-omzetpercentage. */
  revenueShareMax: number | null;
  startBy: string | null;
  startByHard: boolean;
  experienceLevel: string | null;
  vacancyStatus: VacancyStatus;
  location: { city: string; postcode: string };
  application: { id: string; status: ApplicationStatus; createdAt: string } | null;
  invitation: { id: string; status: InvitationStatus } | null;
}

export interface MatchDetailResponse {
  match: MatchDetail;
}

// ---------------------------------------------------------------------------
// Sollicitaties
// ---------------------------------------------------------------------------

export interface ApplyRequest {
  vacancyId: string;
  motivation?: string;
}

export interface ApplicationView {
  id: string;
  status: ApplicationStatus;
  motivation: string | null;
  createdAt: string;
  vacancy: {
    id: string;
    slug: string | null;
    title: string;
    city: string;
    organizationName: string;
    status: VacancyStatus;
  };
  snapshotScore: number | null;
  snapshotLabel: string | null;
}

export interface ApplicationsResponse {
  applications: ApplicationView[];
}

export interface WithdrawRequest {
  reasonCode?: FeedbackReasonCode;
  note?: string;
}

// ---------------------------------------------------------------------------
// Uitnodigingen
// ---------------------------------------------------------------------------

export interface InvitationView {
  id: string;
  status: InvitationStatus;
  message: string | null;
  createdAt: string;
  vacancy: {
    id: string;
    slug: string | null;
    title: string;
    city: string;
    organizationName: string;
    status: VacancyStatus;
  };
  snapshotScore: number | null;
  snapshotLabel: string | null;
}

export interface InvitationsResponse {
  invitations: InvitationView[];
}

export interface InvitationRespondRequest {
  accepted: boolean;
  /** Alleen bij interesse: naam + contactgegevens delen (consent). */
  shareContact?: boolean;
  /** Alleen bij afwijzen. */
  reasonCode?: FeedbackReasonCode;
  note?: string;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export interface ConsentView {
  id: string;
  organizationId: string;
  organizationName: string;
  vacancyId: string | null;
  vacancyTitle: string | null;
  grantedAt: string;
}

export interface ConsentsResponse {
  consents: ConsentView[];
}

export interface ConsentRevokeRequest {
  organizationId: string;
  vacancyId?: string;
}

// ---------------------------------------------------------------------------
// Gesprekken
// ---------------------------------------------------------------------------

export interface InterviewSlotView {
  startsAt: string;
  durationMinutes: number;
}

export interface InterviewView {
  id: string;
  status: InterviewStatus;
  slots: InterviewSlotView[];
  chosenSlot: string | null;
  message: string | null;
  vacancyId: string;
  vacancyTitle: string;
  organizationName: string;
  city: string;
}

export interface InterviewsResponse {
  interviews: InterviewView[];
}

export interface InterviewConfirmRequest {
  chosenSlot: string;
}

// ---------------------------------------------------------------------------
// Notificaties
// ---------------------------------------------------------------------------

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  /** Webpad — de app vertaalt dit met resolveDeepLink (deeplinks.ts). */
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  unreadCount: number;
  notifications: NotificationView[];
}

export interface NotificationPreferenceView {
  type: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreferenceView[];
}

export interface NotificationPreferenceUpdateRequest {
  type: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

// ---------------------------------------------------------------------------
// Push-tokens
// ---------------------------------------------------------------------------

export interface PushTokenRequest {
  token: string;
  platform: "ios" | "android";
}

// ---------------------------------------------------------------------------
// Privacy & account
// ---------------------------------------------------------------------------

export interface PrivacyCategoryView {
  categorie: string;
  omschrijving: string;
  aantal: number;
}

export interface PrivacyOverviewResponse {
  categories: PrivacyCategoryView[];
}

export interface AccountDeleteRequest {
  /** Moet letterlijk "verwijderen" zijn — zelfde bevestiging als web. */
  confirm: string;
}

export interface OkResponse {
  ok: true;
}
