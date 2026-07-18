// Pipeline-servicelaag: het onwijzigbare statusjournaal (PipelineStatusChange),
// gestructureerde beslisfeedback (MatchDecisionFeedback), privacy-consent
// (CandidateConsent) en gespreksplanning (Interview).
//
// Regels:
// - ALLE statuswijzigingen in het kandidaat-vacaturetraject lopen via
//   recordStatusChange — de actuele stand leeft op Invitation/Application,
//   dit journaal is de historie met verantwoordelijke actor.
// - Vrije tekst (notes) wordt vóór opslag ontdaan van e-mailadressen en
//   telefoonnummers: feedback is een datalaag, geen contactkanaal.
// - Privacy: praktijken zien de naam van een kandidaat alleen bij
//   visibility "visible", ná expliciete consent, of bij een sollicitatie
//   (wie solliciteert deelt zijn naam bewust).

import type {
  ApplicationStatus,
  CandidateProfile,
  Interview,
  InvitationStatus,
  PipelineStatusChange,
  Prisma,
} from "@prisma/client";
import {
  AuthzError,
  requireCandidate,
  roleCan,
  type OrgContext,
} from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  sendNotification,
  type NotificationType,
  type SendNotificationInput,
} from "@/lib/notifications";
import { label } from "@/domain/taxonomy";
import { geocodePostcode } from "@/server/geo";

// ---------------------------------------------------------------------------
// Statussen, actoren en redencodes
// ---------------------------------------------------------------------------

/**
 * De pipelinestatussen van match tot plaatsing. `interview_proposed` is de
 * tussenstap tussen een gespreksvoorstel en de bevestiging door de kandidaat.
 */
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

export function isPipelineStatus(waarde: unknown): waarde is PipelineStatus {
  return (
    typeof waarde === "string" &&
    (PIPELINE_STATUSES as readonly string[]).includes(waarde)
  );
}

export type PipelineActorType = "practice" | "candidate" | "system";

/** Vaste redencodes voor beslisfeedback — de datamoat blijft vergelijkbaar. */
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

export function isFeedbackReasonCode(
  waarde: unknown,
): waarde is FeedbackReasonCode {
  return (
    typeof waarde === "string" &&
    (FEEDBACK_REASON_CODES as readonly string[]).includes(waarde)
  );
}

/** Nederlandse labels voor de redencodes (voor selects en weergave). */
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

/** Nederlandse weergave van pipelinestatussen. */
export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  matched: "Match",
  invited: "Uitgenodigd",
  interested: "Interesse getoond",
  applied: "Gesolliciteerd",
  interview_proposed: "Gesprek voorgesteld",
  interview_scheduled: "Gesprek gepland",
  offer: "Aanbod gedaan",
  hired: "Aangenomen",
  declined: "Afgeslagen door kandidaat",
  rejected: "Afgewezen",
  withdrawn: "Teruggetrokken",
};

// ---------------------------------------------------------------------------
// Vrije tekst opschonen (privacy)
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Telefoonnummers: 8+ cijfers, eventueel met +, spaties, koppeltekens of haakjes.
const PHONE_PATTERN = /(?:\+|\b0)[\d\s\-()]{6,}\d/g;

/** Verwijdert e-mailadressen en telefoonnummers uit vrije tekst (simpele regex). */
export function stripContactgegevens(tekst: string): string {
  return tekst
    .replace(EMAIL_PATTERN, "[e-mailadres verwijderd]")
    .replace(PHONE_PATTERN, "[telefoonnummer verwijderd]")
    .trim();
}

/** Note opschonen en begrenzen op 500 tekens; lege string → null. */
function schoneNote(note: string | undefined | null): string | null {
  if (!note) return null;
  const schoon = stripContactgegevens(note).slice(0, 500).trim();
  return schoon.length > 0 ? schoon : null;
}

// ---------------------------------------------------------------------------
// Het journaal
// ---------------------------------------------------------------------------

export interface StatusChangeInput {
  /** Vorige status; onbekend/weggelaten → laatste journaalstand. */
  from?: PipelineStatus | null;
  to: PipelineStatus;
  actorType: PipelineActorType;
  actorUserId?: string | null;
  reasonCode?: FeedbackReasonCode;
  note?: string;
}

/** Laatste journaalstand van een kandidaat-vacaturetraject (of null). */
export async function latestPipelineStatus(
  vacancyId: string,
  candidateUserId: string,
): Promise<PipelineStatus | null> {
  const laatste = await prisma.pipelineStatusChange.findFirst({
    where: { vacancyId, candidateUserId },
    orderBy: { createdAt: "desc" },
    select: { toStatus: true },
  });
  return laatste && isPipelineStatus(laatste.toStatus) ? laatste.toStatus : null;
}

/**
 * Schrijft één regel in het onwijzigbare statusjournaal. Alle statuswijzigingen
 * in invitations/applications/interviews lopen hier doorheen.
 */
export async function recordStatusChange(
  vacancyId: string,
  candidateUserId: string,
  change: StatusChangeInput,
): Promise<PipelineStatusChange> {
  const from =
    change.from !== undefined
      ? change.from
      : await latestPipelineStatus(vacancyId, candidateUserId);

  return prisma.pipelineStatusChange.create({
    data: {
      vacancyId,
      candidateUserId,
      fromStatus: from ?? null,
      toStatus: change.to,
      actorType: change.actorType,
      actorUserId: change.actorUserId ?? null,
      reasonCode: change.reasonCode ?? null,
      note: schoneNote(change.note),
    },
  });
}

/** Volledige statushistorie van een traject, oudste eerst. */
export async function statusHistory(
  vacancyId: string,
  candidateUserId: string,
): Promise<PipelineStatusChange[]> {
  return prisma.pipelineStatusChange.findMany({
    where: { vacancyId, candidateUserId },
    orderBy: { createdAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Beslisfeedback
// ---------------------------------------------------------------------------

export interface DecisionFeedbackInput {
  matchSnapshotId?: string | null;
  vacancyId: string;
  candidateUserId?: string | null;
  organizationId?: string | null;
  actorType: "practice" | "candidate";
  decision: "declined" | "rejected" | "withdrawn" | "cancelled" | "other";
  reasonCode: FeedbackReasonCode;
  note?: string;
}

/**
 * Legt gestructureerde feedback bij een beslissing vast (data-moat). Vrije
 * tekst wordt van e-mailadressen en telefoonnummers ontdaan en begrensd op
 * 500 tekens. Verandert nooit automatisch individuele scores.
 */
export async function recordDecisionFeedback(
  input: DecisionFeedbackInput,
): Promise<void> {
  if (!isFeedbackReasonCode(input.reasonCode)) {
    throw new AuthzError("Onbekende redencode", 400);
  }

  await prisma.matchDecisionFeedback.create({
    data: {
      matchSnapshotId: input.matchSnapshotId ?? null,
      vacancyId: input.vacancyId,
      candidateUserId: input.candidateUserId ?? null,
      organizationId: input.organizationId ?? null,
      actorType: input.actorType,
      decision: input.decision,
      reasonCode: input.reasonCode,
      note: schoneNote(input.note),
    },
  });

  await track("match_feedback_given", {
    organizationId: input.organizationId ?? undefined,
    context: {
      vacancyId: input.vacancyId,
      reasonCode: input.reasonCode,
      actorType: input.actorType,
      decision: input.decision,
    },
  });
}

// ---------------------------------------------------------------------------
// Consent (naam + contactgegevens delen)
// ---------------------------------------------------------------------------

const CONSENT_SCOPE = "contact_details";

/** Bestaande (eventueel ingetrokken) consentrij zoeken, exact op scope. */
async function vindConsent(
  candidateUserId: string,
  organizationId: string,
  vacancyId: string | null,
) {
  return prisma.candidateConsent.findFirst({
    where: {
      candidateUserId,
      organizationId,
      vacancyId,
      scope: CONSENT_SCOPE,
    },
  });
}

/**
 * De ingelogde kandidaat geeft toestemming om naam en contactgegevens te delen
 * met één organisatie (optioneel beperkt tot één vacature). Idempotent: een
 * eerder ingetrokken consent wordt opnieuw geactiveerd.
 */
export async function grantConsent(
  organizationId: string,
  vacancyId?: string,
): Promise<void> {
  const { user, profile } = await requireCandidate();

  const bestaand = await vindConsent(user.id, organizationId, vacancyId ?? null);
  if (bestaand) {
    if (bestaand.revokedAt !== null) {
      await prisma.candidateConsent.update({
        where: { id: bestaand.id },
        data: { grantedAt: new Date(), revokedAt: null },
      });
    }
  } else {
    await prisma.candidateConsent.create({
      data: {
        candidateUserId: user.id,
        organizationId,
        vacancyId: vacancyId ?? null,
        scope: CONSENT_SCOPE,
      },
    });
  }

  await track("consent_granted", {
    userId: user.id,
    candidateId: profile?.id,
    organizationId,
    context: { vacancyId: vacancyId ?? null, scope: CONSENT_SCOPE },
  });
  await audit("consent.grant", "CandidateConsent", organizationId, {
    organizationId,
    userId: user.id,
    meta: { vacancyId: vacancyId ?? null },
  });
}

/** Trekt de toestemming voor een organisatie (en optioneel vacature) in. */
export async function revokeConsent(
  organizationId: string,
  vacancyId?: string,
): Promise<void> {
  const { user, profile } = await requireCandidate();

  await prisma.candidateConsent.updateMany({
    where: {
      candidateUserId: user.id,
      organizationId,
      ...(vacancyId !== undefined ? { vacancyId } : {}),
      scope: CONSENT_SCOPE,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  await track("consent_revoked", {
    userId: user.id,
    candidateId: profile?.id,
    organizationId,
    context: { vacancyId: vacancyId ?? null, scope: CONSENT_SCOPE },
  });
  await audit("consent.revoke", "CandidateConsent", organizationId, {
    organizationId,
    userId: user.id,
    meta: { vacancyId: vacancyId ?? null },
  });
}

/**
 * Is er een actieve consent van deze kandidaat richting deze organisatie?
 * Een organisatiebrede consent (vacancyId null) dekt alle vacatures; een
 * vacature-specifieke consent alleen die vacature.
 */
export async function hasConsent(
  candidateUserId: string,
  organizationId: string,
  vacancyId?: string,
): Promise<boolean> {
  const rij = await prisma.candidateConsent.findFirst({
    where: {
      candidateUserId,
      organizationId,
      scope: CONSENT_SCOPE,
      revokedAt: null,
      OR: [
        { vacancyId: null },
        ...(vacancyId ? [{ vacancyId }] : []),
      ],
    },
    select: { id: true },
  });
  return rij !== null;
}

// ---------------------------------------------------------------------------
// Notificaties naar praktijkleden
// ---------------------------------------------------------------------------

/**
 * Stuurt een notificatie naar alle actieve praktijkleden die de pipeline
 * beheren (rol met pipeline.manage). dedupeKey wordt per lid afgeleid van
 * `dedupeBase` zodat herhaalde aanroepen idempotent blijven.
 */
export async function notifyPipelineMembers(
  organizationId: string,
  input: Omit<SendNotificationInput, "userId" | "dedupeKey"> & {
    type: NotificationType;
    dedupeBase: string;
  },
): Promise<void> {
  const leden = await prisma.membership.findMany({
    where: { organizationId, status: "active" },
    select: { userId: true, role: true },
  });
  const { dedupeBase, ...rest } = input;
  for (const lid of leden) {
    if (!roleCan(lid.role, "pipeline.manage")) continue;
    await sendNotification({
      ...rest,
      userId: lid.userId,
      dedupeKey: `${dedupeBase}-${lid.userId}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Gesprekken (Interview)
// ---------------------------------------------------------------------------

export interface InterviewSlotInput {
  startsAt: Date | string;
  durationMinutes: number;
}

export interface InterviewSlot {
  startsAt: string; // ISO
  durationMinutes: number;
}

/** Json-kolom → gespreksmomenten, defensief. */
export function castSlots(waarde: unknown): InterviewSlot[] {
  if (!Array.isArray(waarde)) return [];
  const uit: InterviewSlot[] = [];
  for (const slot of waarde) {
    if (!slot || typeof slot !== "object") continue;
    const { startsAt, durationMinutes } = slot as Record<string, unknown>;
    if (typeof startsAt !== "string" || typeof durationMinutes !== "number") {
      continue;
    }
    uit.push({ startsAt, durationMinutes });
  }
  return uit;
}

const MAX_SLOTS = 5;

function valideerSlots(slots: InterviewSlotInput[]): InterviewSlot[] {
  if (slots.length === 0) {
    throw new AuthzError("Stel minstens één gespreksmoment voor", 400);
  }
  if (slots.length > MAX_SLOTS) {
    throw new AuthzError(
      `Maximaal ${MAX_SLOTS} gespreksmomenten per voorstel`,
      400,
    );
  }
  const nu = Date.now();
  return slots.map((slot) => {
    const start = new Date(slot.startsAt);
    if (Number.isNaN(start.getTime()) || start.getTime() <= nu) {
      throw new AuthzError("Gespreksmomenten moeten in de toekomst liggen", 400);
    }
    if (
      !Number.isFinite(slot.durationMinutes) ||
      slot.durationMinutes < 10 ||
      slot.durationMinutes > 480
    ) {
      throw new AuthzError("Ongeldige gespreksduur", 400);
    }
    return {
      startsAt: start.toISOString(),
      durationMinutes: Math.round(slot.durationMinutes),
    };
  });
}

/**
 * Praktijk stelt gespreksmomenten voor aan een kandidaat (max 5, toekomstig).
 * Maakt een Interview (status proposed), zet de pipeline op interview_proposed,
 * stuurt de kandidaat een idempotente notificatie en trackt interview_proposed.
 */
export async function proposeInterview(
  ctx: OrgContext,
  vacancyId: string,
  candidateUserId: string,
  slots: InterviewSlotInput[],
  message?: string,
): Promise<Interview> {
  if (!roleCan(ctx.role, "pipeline.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag de pipeline niet beheren`, 403);
  }

  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    include: { organization: { select: { name: true } } },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const geldigeSlots = valideerSlots(slots);

  const interview = await prisma.interview.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId,
      status: "proposed",
      slots: geldigeSlots as unknown as Prisma.InputJsonValue,
      proposedByUserId: ctx.user.id,
      message: message?.trim() || null,
    },
  });

  await recordStatusChange(vacature.id, candidateUserId, {
    to: "interview_proposed",
    actorType: "practice",
    actorUserId: ctx.user.id,
  });

  await sendNotification({
    userId: candidateUserId,
    type: "interview_proposed",
    title: "Gespreksvoorstel ontvangen",
    body: `${vacature.organization.name} stelt ${geldigeSlots.length === 1 ? "een gespreksmoment" : `${geldigeSlots.length} gespreksmomenten`} voor voor “${vacature.title}”. Kies wat jou past.`,
    href: "/kandidaat/uitnodigingen",
    dedupeKey: `interview-${interview.id}`,
    meta: { vacancyId: vacature.id, interviewId: interview.id },
  });

  const profiel = await prisma.candidateProfile.findUnique({
    where: { userId: candidateUserId },
    select: { id: true },
  });
  await track("interview_proposed", {
    organizationId: ctx.organizationId,
    locationId: vacature.locationId,
    userId: ctx.user.id,
    candidateId: profiel?.id,
    context: { vacancyId: vacature.id, slots: geldigeSlots.length },
  });
  await audit("interview.propose", "Interview", interview.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { vacancyId: vacature.id, slots: geldigeSlots.length },
  });

  return interview;
}

/**
 * Kandidaat bevestigt één van de voorgestelde gespreksmomenten. Zet het
 * Interview op confirmed, de pipeline op interview_scheduled, en stuurt de
 * praktijkleden een idempotente notificatie.
 */
export async function confirmInterview(
  interviewId: string,
  chosenSlot: Date | string,
): Promise<Interview> {
  const { user, profile } = await requireCandidate();

  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, candidateUserId: user.id },
  });
  if (!interview) throw new AuthzError("Gesprek niet gevonden", 404);
  if (interview.status !== "proposed") {
    throw new AuthzError("Dit gesprek is al beantwoord of geannuleerd", 409);
  }

  const gekozen = new Date(chosenSlot);
  const voorstellen = castSlots(interview.slots);
  const match = voorstellen.find(
    (slot) => new Date(slot.startsAt).getTime() === gekozen.getTime(),
  );
  if (!match) {
    throw new AuthzError("Kies één van de voorgestelde momenten", 400);
  }

  const bevestigd = await prisma.interview.update({
    where: { id: interview.id },
    data: { status: "confirmed", chosenSlot: gekozen },
  });

  await recordStatusChange(interview.vacancyId, user.id, {
    to: "interview_scheduled",
    actorType: "candidate",
    actorUserId: user.id,
  });

  const vacature = await prisma.vacancy.findUnique({
    where: { id: interview.vacancyId },
    select: { id: true, title: true, locationId: true, organizationId: true },
  });

  if (vacature) {
    const wanneer = gekozen.toLocaleString("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
    await notifyPipelineMembers(vacature.organizationId, {
      type: "interview_confirmed",
      title: "Gesprek bevestigd",
      body: `De kandidaat heeft het gesprek voor “${vacature.title}” bevestigd: ${wanneer}.`,
      dedupeBase: `interview-confirmed-${interview.id}`,
      meta: { vacancyId: vacature.id, interviewId: interview.id },
    });

    const eventBasis = {
      organizationId: vacature.organizationId,
      locationId: vacature.locationId,
      userId: user.id,
      candidateId: profile?.id,
      context: { vacancyId: vacature.id, interviewId: interview.id },
    };
    await track("interview_scheduled", eventBasis);
    await track("interview_confirmed", eventBasis);
  }

  await audit("interview.confirm", "Interview", interview.id, {
    organizationId: vacature?.organizationId,
    userId: user.id,
    meta: { chosenSlot: gekozen.toISOString() },
  });

  return bevestigd;
}

/** Gespreksvoorstellen en bevestigde gesprekken van de ingelogde kandidaat. */
export interface CandidateInterviewEntry {
  interview: Interview;
  slots: InterviewSlot[];
  vacancyTitle: string;
  vacancyId: string;
  organizationName: string;
  city: string;
}

export async function listInterviewsForCandidate(): Promise<
  CandidateInterviewEntry[]
> {
  const { user } = await requireCandidate();
  const interviews = await prisma.interview.findMany({
    where: { candidateUserId: user.id, status: { in: ["proposed", "confirmed"] } },
    orderBy: { createdAt: "desc" },
  });
  if (interviews.length === 0) return [];

  const vacatures = await prisma.vacancy.findMany({
    where: { id: { in: interviews.map((i) => i.vacancyId) } },
    select: {
      id: true,
      title: true,
      location: { select: { city: true } },
      organization: { select: { name: true } },
    },
  });
  const perVacature = new Map(vacatures.map((v) => [v.id, v]));

  return interviews.map((interview) => {
    const vacature = perVacature.get(interview.vacancyId);
    return {
      interview,
      slots: castSlots(interview.slots),
      vacancyTitle: vacature?.title ?? "Vacature",
      vacancyId: interview.vacancyId,
      organizationName: vacature?.organization.name ?? "Praktijk",
      city: vacature?.location.city ?? "",
    };
  });
}

/** Eigen gesprek van de ingelogde kandidaat (voor het bevestigingsscherm). */
export async function getOwnInterview(
  interviewId: string,
): Promise<Interview | null> {
  const { user } = await requireCandidate();
  return prisma.interview.findFirst({
    where: { id: interviewId, candidateUserId: user.id },
  });
}

// ---------------------------------------------------------------------------
// Pipeline-overzicht per vacature (praktijkkant)
// ---------------------------------------------------------------------------

export interface PipelineCandidateEntry {
  candidateUserId: string;
  /** Naam volgens privacy: echte naam of geanonimiseerd label. */
  displayName: string;
  /** true wanneer de echte naam getoond mag worden. */
  naamZichtbaar: boolean;
  profileId: string | null;
  status: PipelineStatus;
  lastActivity: Date;
  score: number | null;
  scoreLabel: string | null;
  /** Maximaal drie matchredenen uit het snapshot. */
  matchRedenen: string[];
  /** Aandachtspunten uit het snapshot (compact). */
  aandachtspunten: string[];
  invitationId: string | null;
  invitationStatus: InvitationStatus | null;
  applicationId: string | null;
  applicationStatus: ApplicationStatus | null;
  matchSnapshotId: string | null;
  /** Meest recente gesprek (proposed of confirmed), indien aanwezig. */
  interview: Interview | null;
  interviewSlots: InterviewSlot[];
  /** Volledige statushistorie, oudste eerst. */
  history: PipelineStatusChange[];
}

/** Sollicitatiestatus → pipelinestatus (voor de terugvalafleiding). */
export function applicationToPipelineStatus(
  status: ApplicationStatus,
): PipelineStatus {
  switch (status) {
    case "submitted":
    case "in_review":
      return "applied";
    case "interview":
      return "interview_scheduled";
    case "offered":
      return "offer";
    case "hired":
      return "hired";
    case "rejected":
      return "rejected";
    case "withdrawn":
      return "withdrawn";
  }
}

function invitationToPipelineStatus(status: InvitationStatus): PipelineStatus {
  switch (status) {
    case "sent":
      return "invited";
    case "accepted":
      return "interested";
    case "declined":
      return "declined";
    case "expired":
      return "invited";
  }
}

function geanonimiseerdLabel(profiel: CandidateProfile | null): string {
  if (!profiel) return "Kandidaat (anoniem profiel)";
  const stad = geocodePostcode(profiel.postcode)?.city;
  const rol = label(profiel.role);
  return stad ? `${rol} uit regio ${stad}` : `${rol} (anoniem profiel)`;
}

/** Redenen (strengths/attentionPoints) defensief uit een snapshot-result Json. */
export function redenenUitSnapshot(
  result: unknown,
  veld: "strengths" | "attentionPoints",
  max: number,
): string[] {
  if (!result || typeof result !== "object") return [];
  const lijst = (result as Record<string, unknown>)[veld];
  if (!Array.isArray(lijst)) return [];
  const uit: string[] = [];
  for (const item of lijst) {
    if (uit.length >= max) break;
    if (item && typeof item === "object") {
      const bericht = (item as Record<string, unknown>).message;
      if (typeof bericht === "string" && bericht.length > 0) uit.push(bericht);
    }
  }
  return uit;
}

/**
 * Alle kandidaten in de pipeline van één (eigen) vacature: uitnodigingen,
 * sollicitaties en gesprekken samengevoegd per kandidaat, met statushistorie.
 *
 * Privacy: de naam is alleen zichtbaar bij visibility "visible", bij een
 * actieve consent van de kandidaat, of bij een sollicitatie (bewust gedeeld).
 * Anders een geanonimiseerd label.
 */
export async function listPipelineForVacancy(
  ctx: OrgContext,
  vacancyId: string,
): Promise<PipelineCandidateEntry[]> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const [uitnodigingen, sollicitaties, gesprekken, wijzigingen] =
    await Promise.all([
      prisma.invitation.findMany({
        where: { vacancyId: vacature.id },
        include: {
          matchSnapshot: {
            select: { id: true, score: true, label: true, result: true },
          },
          candidate: { select: { name: true, candidateProfile: true } },
        },
      }),
      prisma.application.findMany({
        where: { vacancyId: vacature.id },
        include: {
          matchSnapshot: {
            select: { id: true, score: true, label: true, result: true },
          },
          candidate: { select: { name: true, candidateProfile: true } },
        },
      }),
      prisma.interview.findMany({
        where: { vacancyId: vacature.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.pipelineStatusChange.findMany({
        where: { vacancyId: vacature.id },
        orderBy: { createdAt: "asc" },
      }),
    ]);

  const kandidaatIds = new Set<string>([
    ...uitnodigingen.map((u) => u.candidateUserId),
    ...sollicitaties.map((s) => s.candidateUserId),
    ...gesprekken.map((g) => g.candidateUserId),
  ]);
  if (kandidaatIds.size === 0) return [];

  const consents = await prisma.candidateConsent.findMany({
    where: {
      organizationId: ctx.organizationId,
      candidateUserId: { in: [...kandidaatIds] },
      scope: CONSENT_SCOPE,
      revokedAt: null,
      OR: [{ vacancyId: null }, { vacancyId: vacature.id }],
    },
    select: { candidateUserId: true },
  });
  const metConsent = new Set(consents.map((c) => c.candidateUserId));

  const entries: PipelineCandidateEntry[] = [];
  for (const kandidaatId of kandidaatIds) {
    const uitnodiging = uitnodigingen.find(
      (u) => u.candidateUserId === kandidaatId,
    );
    const sollicitatie = sollicitaties.find(
      (s) => s.candidateUserId === kandidaatId,
    );
    const interview =
      gesprekken.find(
        (g) =>
          g.candidateUserId === kandidaatId &&
          (g.status === "proposed" || g.status === "confirmed"),
      ) ?? null;
    const history = wijzigingen.filter(
      (w) => w.candidateUserId === kandidaatId,
    );

    const kandidaat = sollicitatie?.candidate ?? uitnodiging?.candidate ?? null;
    const profiel = kandidaat?.candidateProfile ?? null;

    const naamZichtbaar =
      profiel?.visibility === "visible" ||
      metConsent.has(kandidaatId) ||
      sollicitatie !== undefined;
    const displayName = naamZichtbaar
      ? (kandidaat?.name ?? "Kandidaat")
      : geanonimiseerdLabel(profiel);

    // Status: laatste journaalstand; terugval op sollicitatie/uitnodiging.
    const laatste = history.at(-1)?.toStatus;
    const status: PipelineStatus = isPipelineStatus(laatste)
      ? laatste
      : sollicitatie
        ? applicationToPipelineStatus(sollicitatie.status)
        : uitnodiging
          ? invitationToPipelineStatus(uitnodiging.status)
          : "matched";

    const snapshot = sollicitatie?.matchSnapshot ?? uitnodiging?.matchSnapshot ?? null;

    const activiteiten = [
      history.at(-1)?.createdAt,
      sollicitatie?.updatedAt,
      uitnodiging?.createdAt,
      interview?.updatedAt,
    ].filter((d): d is Date => d instanceof Date);
    const lastActivity = activiteiten.length
      ? new Date(Math.max(...activiteiten.map((d) => d.getTime())))
      : new Date(0);

    entries.push({
      candidateUserId: kandidaatId,
      displayName,
      naamZichtbaar,
      profileId: profiel?.id ?? null,
      status,
      lastActivity,
      score: snapshot?.score ?? null,
      scoreLabel: snapshot?.label ?? null,
      matchRedenen: redenenUitSnapshot(snapshot?.result, "strengths", 3),
      aandachtspunten: redenenUitSnapshot(snapshot?.result, "attentionPoints", 3),
      invitationId: uitnodiging?.id ?? null,
      invitationStatus: uitnodiging?.status ?? null,
      applicationId: sollicitatie?.id ?? null,
      applicationStatus: sollicitatie?.status ?? null,
      matchSnapshotId: snapshot?.id ?? null,
      interview,
      interviewSlots: interview ? castSlots(interview.slots) : [],
      history,
    });
  }

  entries.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return entries;
}
