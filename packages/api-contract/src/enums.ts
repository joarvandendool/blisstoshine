// Statuswaarden waarvan de bron in server-only bestanden leeft (Prisma-
// schema, src/server/pipeline.ts, src/lib/notifications.ts). Hier als
// literalen zodat de mobiele app ze kan gebruiken zonder server-imports.
// Pariteit wordt bewaakt door tests/domain/mobile-contract.test.ts.

export const VACANCY_STATUSES = [
  "draft",
  "published",
  "paused",
  "filled",
  "expired",
] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "submitted",
  "in_review",
  "interview",
  "offered",
  "hired",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const INVITATION_STATUSES = ["sent", "accepted", "declined", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INTERVIEW_STATUSES = [
  "proposed",
  "confirmed",
  "declined",
  "cancelled",
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const CANDIDATE_STATUSES = ["draft", "active", "paused", "archived"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const PROFILE_VISIBILITIES = ["visible", "anonymous", "hidden"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const PIPELINE_STATUSES = [
  "matched",
  "invited",
  "interested",
  "applied",
  "interview_proposed",
  "interview_scheduled",
  "offer",
  "hired",
  "declined",
  "rejected",
  "withdrawn",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const FEEDBACK_REASON_CODES = [
  "dagen",
  "reisafstand",
  "uren",
  "salaris_tarief",
  "ervaring",
  "apparatuur",
  "specialisatie",
  "cultuur",
  "niet_beschikbaar",
  "vacature_gewijzigd",
  "anders",
] as const;
export type FeedbackReasonCode = (typeof FEEDBACK_REASON_CODES)[number];

/** Nederlandse weergavelabels voor redencodes (identiek aan pipeline.ts). */
export const FEEDBACK_REASON_LABELS: Record<FeedbackReasonCode, string> = {
  dagen: "De dagen passen niet",
  reisafstand: "De reisafstand is te groot",
  uren: "Het aantal uren past niet",
  salaris_tarief: "Salaris of tarief past niet",
  ervaring: "Ervaring sluit niet aan",
  apparatuur: "Apparatuur of werkwijze past niet",
  specialisatie: "Specialisatie sluit niet aan",
  cultuur: "Cultuur of team past niet",
  niet_beschikbaar: "Niet (meer) beschikbaar",
  vacature_gewijzigd: "De vacature is veranderd",
  anders: "Anders",
};

export const NOTIFICATION_TYPES = [
  "invitation_received",
  "invitation_interested",
  "interview_proposed",
  "interview_confirmed",
  "no_response_reminder",
  "vacancy_expiring",
  "strong_match_found",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Notificatietypen die voor kandidaten relevant zijn (voorkeurenscherm). */
export const CANDIDATE_NOTIFICATION_TYPES = [
  "invitation_received",
  "interview_proposed",
  "interview_confirmed",
  "strong_match_found",
] as const satisfies readonly NotificationType[];

export const CONSENT_SCOPE = "contact_details" as const;
