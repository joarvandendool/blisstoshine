// Servicelaag voor kandidaat-uitnodigingen. Praktijkkant: uitnodigen met
// maandlimiet (UsageEvents, idempotent) en snapshot van de match op het
// beslismoment. Kandidaatkant: eigen uitnodigingen bekijken en beantwoorden.

import type {
  Invitation,
  MatchSnapshot,
  PracticeLocation,
  Vacancy,
} from "@prisma/client";
import { AuthzError, requireCandidate, roleCan, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { enforceLimit, recordUsage } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { sendNotification } from "@/lib/notifications";
import { label } from "@/domain/taxonomy";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { geocodePostcode } from "@/server/geo";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { saveMatchSnapshot } from "@/server/matching";
import { planCodeVoorAnalytics } from "@/server/organizations";
import {
  grantConsent,
  hasConsent,
  notifyPipelineMembers,
  proposeInterview,
  recordDecisionFeedback,
  recordStatusChange,
  type FeedbackReasonCode,
  type InterviewSlotInput,
} from "@/server/pipeline";

/** Sleutel van de lopende kalendermaand, bv. "2026-07". */
function maandSleutel(nu: Date): string {
  return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, "0")}`;
}

/** Eerste dag van de lopende kalendermaand (lokale tijd). */
function maandStart(nu: Date): Date {
  return new Date(nu.getFullYear(), nu.getMonth(), 1);
}

/**
 * Nodigt een kandidaat uit voor een (eigen) vacature. Capability:
 * candidate.invite. De maandlimiet max_candidate_invites_per_month wordt
 * gecontroleerd op basis van UsageEvents (key candidate_invite) in de lopende
 * kalendermaand; het gebruik wordt idempotent vastgelegd per
 * org+vacature+kandidaat+maand, zodat een herhaalde uitnodiging binnen
 * dezelfde maand niet dubbel telt. Er ontstaat nooit een dubbele uitnodiging
 * (upsert op vacature+kandidaat).
 *
 * Bij een nieuwe uitnodiging wordt de pipeline-historie bijgeschreven
 * (invited) en krijgt de kandidaat een idempotente notificatie
 * (invitation_received). Met `gesprekSlots` worden direct gespreksmomenten
 * voorgesteld (Interview met status proposed).
 */
export async function inviteCandidate(
  ctx: OrgContext,
  vacancyId: string,
  candidateUserId: string,
  message?: string,
  gesprekSlots?: InterviewSlotInput[],
): Promise<Invitation> {
  if (!roleCan(ctx.role, "candidate.invite")) {
    throw new AuthzError(`Rol ${ctx.role} mag geen kandidaten uitnodigen`, 403);
  }

  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    include: { location: true, organization: { select: { name: true } } },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const profiel = await prisma.candidateProfile.findUnique({
    where: { userId: candidateUserId },
  });
  if (!profiel || profiel.status !== "active" || profiel.visibility === "hidden") {
    throw new AuthzError("Deze kandidaat is niet beschikbaar voor uitnodigingen", 404);
  }

  // Maandlimiet: tel het vastgelegde gebruik van deze kalendermaand.
  const nu = new Date();
  const gebruikDezeMaand = await prisma.usageEvent.count({
    where: {
      organizationId: ctx.organizationId,
      key: "candidate_invite",
      createdAt: { gte: maandStart(nu) },
    },
  });
  await enforceLimit(
    ctx.organizationId,
    "max_candidate_invites_per_month",
    gebruikDezeMaand,
  );

  // Match vastleggen op het beslismoment.
  const matchKandidaat = profileToMatchCandidate(profiel);
  const matchVacature = vacancyToMatchVacancy(vacature, vacature.location);
  const resultaat = computeMatchWithOpportunities(matchKandidaat, matchVacature);
  const snapshotId = await saveMatchSnapshot(
    vacature.id,
    candidateUserId,
    resultaat,
    "invitation",
    matchKandidaat,
    matchVacature,
  );

  // Geen dubbele uitnodigingen: bestaat er al één, dan worden alleen het
  // bericht en de snapshot ververst (de status blijft zoals die is).
  const bestondAl = await prisma.invitation.findUnique({
    where: {
      vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId },
    },
    select: { id: true },
  });
  const invitation = await prisma.invitation.upsert({
    where: {
      vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId },
    },
    create: {
      vacancyId: vacature.id,
      candidateUserId,
      message: message ?? null,
      matchSnapshotId: snapshotId,
    },
    update: {
      ...(message !== undefined ? { message } : {}),
      matchSnapshotId: snapshotId,
    },
  });

  // Journaal: alleen bij een écht nieuwe uitnodiging (herhaald uitnodigen
  // verandert de status niet).
  if (!bestondAl) {
    await recordStatusChange(vacature.id, candidateUserId, {
      from: "matched",
      to: "invited",
      actorType: "practice",
      actorUserId: ctx.user.id,
    });
  }

  // Idempotente notificatie naar de kandidaat: een tweede identieke
  // uitnodiging levert géén tweede melding op (dedupeKey).
  await sendNotification({
    userId: candidateUserId,
    type: "invitation_received",
    title: "Persoonlijke uitnodiging ontvangen",
    body: `${vacature.organization.name} nodigt je uit voor “${vacature.title}” in ${vacature.location.city}.`,
    href: "/kandidaat/uitnodigingen",
    dedupeKey: `invite-${vacature.id}-${candidateUserId}`,
    meta: { vacancyId: vacature.id, invitationId: invitation.id },
  });

  // Optioneel: direct gespreksmomenten voorstellen bij de uitnodiging.
  if (gesprekSlots && gesprekSlots.length > 0) {
    await proposeInterview(ctx, vacature.id, candidateUserId, gesprekSlots);
  }

  await recordUsage(
    ctx.organizationId,
    "candidate_invite",
    1,
    `invite:${ctx.organizationId}:${vacature.id}:${candidateUserId}:${maandSleutel(nu)}`,
  );

  await track("candidate_invited", {
    organizationId: ctx.organizationId,
    locationId: vacature.locationId,
    userId: ctx.user.id,
    candidateId: profiel.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { vacancyId: vacature.id, score: resultaat.score },
  });
  await audit("candidate.invite", "Invitation", invitation.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { vacancyId: vacature.id, candidateProfileId: profiel.id },
  });

  return invitation;
}

// ---------------------------------------------------------------------------
// Lijsten
// ---------------------------------------------------------------------------

export interface VacancyInvitationEntry {
  invitation: Invitation;
  /**
   * Naam volgens privacy: pas zichtbaar bij visibility "visible" of na
   * expliciete consent van de kandidaat (CandidateConsent); anders
   * geanonimiseerd.
   */
  displayName: string;
  snapshot: MatchSnapshot | null;
}

/** Uitnodigingen van één (eigen) vacature, nieuwste eerst. */
export async function listInvitationsForVacancy(
  ctx: OrgContext,
  vacancyId: string,
): Promise<VacancyInvitationEntry[]> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const uitnodigingen = await prisma.invitation.findMany({
    where: { vacancyId: vacature.id },
    include: {
      matchSnapshot: true,
      candidate: { select: { name: true, candidateProfile: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const consentPerKandidaat = new Map<string, boolean>();
  for (const uitnodiging of uitnodigingen) {
    consentPerKandidaat.set(
      uitnodiging.candidateUserId,
      await hasConsent(
        uitnodiging.candidateUserId,
        ctx.organizationId,
        vacature.id,
      ),
    );
  }

  return uitnodigingen.map(({ matchSnapshot, candidate, ...invitation }) => {
    const profiel = candidate.candidateProfile;
    const naamZichtbaar =
      profiel?.visibility === "visible" ||
      consentPerKandidaat.get(invitation.candidateUserId) === true;
    let displayName: string;
    if (naamZichtbaar) {
      displayName = candidate.name;
    } else if (profiel) {
      const stad = geocodePostcode(profiel.postcode)?.city;
      displayName = stad
        ? `${label(profiel.role)} uit ${stad}`
        : `${label(profiel.role)} (anoniem profiel)`;
    } else {
      displayName = "Kandidaat (anoniem profiel)";
    }
    return { invitation: invitation as Invitation, displayName, snapshot: matchSnapshot };
  });
}

export interface CandidateInvitationEntry {
  invitation: Invitation;
  vacancy: Vacancy;
  location: PracticeLocation;
  organizationName: string;
  snapshot: MatchSnapshot | null;
}

/** Alle uitnodigingen van de ingelogde kandidaat, nieuwste eerst. */
export async function listInvitationsForCandidate(): Promise<CandidateInvitationEntry[]> {
  const { user } = await requireCandidate();

  const uitnodigingen = await prisma.invitation.findMany({
    where: { candidateUserId: user.id },
    include: {
      matchSnapshot: true,
      vacancy: { include: { location: true, organization: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return uitnodigingen.map(({ matchSnapshot, vacancy, ...invitation }) => {
    const { location, organization, ...vacatureRest } = vacancy;
    return {
      invitation: invitation as Invitation,
      vacancy: vacatureRest as Vacancy,
      location,
      organizationName: organization.name,
      snapshot: matchSnapshot,
    };
  });
}

export interface InvitationResponseInput {
  /** true = "Ik heb interesse"; false = afwijzen. */
  accepted: boolean;
  /**
   * Alleen bij interesse: expliciete keuze om naam en contactgegevens met
   * deze praktijk te delen (grantConsent). Zonder deze keuze blijft de
   * kandidaat geanonimiseerd zichtbaar.
   */
  shareContact?: boolean;
  /** Alleen bij afwijzen: gestructureerde reden (recordDecisionFeedback). */
  reasonCode?: FeedbackReasonCode;
  /** Optionele toelichting bij de reden (max 500 tekens, wordt opgeschoond). */
  note?: string;
}

/**
 * Kandidaat beantwoordt een eigen uitnodiging: interesse tonen of afwijzen.
 * Alleen een nog openstaande uitnodiging (status sent) kan worden beantwoord.
 *
 * - Interesse → status accepted, pipeline interested, notificatie naar de
 *   praktijkleden (invitation_interested) en optioneel consent (shareContact).
 * - Afwijzen → status declined, pipeline declined en — bij een reasonCode —
 *   gestructureerde feedback (MatchDecisionFeedback).
 */
export async function respondToInvitation(
  invitationId: string,
  response: InvitationResponseInput,
): Promise<Invitation> {
  const { user, profile } = await requireCandidate();

  const uitnodiging = await prisma.invitation.findFirst({
    where: { id: invitationId, candidateUserId: user.id },
    include: {
      vacancy: {
        select: {
          id: true,
          title: true,
          locationId: true,
          organizationId: true,
        },
      },
    },
  });
  if (!uitnodiging) throw new AuthzError("Uitnodiging niet gevonden", 404);
  if (uitnodiging.status !== "sent") {
    throw new AuthzError("Deze uitnodiging is al beantwoord", 409);
  }

  const bijgewerkt = await prisma.invitation.update({
    where: { id: uitnodiging.id },
    data: { status: response.accepted ? "accepted" : "declined" },
  });

  const vacature = uitnodiging.vacancy;
  const eventBasis = {
    userId: user.id,
    candidateId: profile?.id,
    organizationId: vacature.organizationId,
    locationId: vacature.locationId,
  };

  if (response.accepted) {
    await recordStatusChange(vacature.id, user.id, {
      to: "interested",
      actorType: "candidate",
      actorUserId: user.id,
    });

    if (response.shareContact) {
      await grantConsent(vacature.organizationId, vacature.id);
    }

    await notifyPipelineMembers(vacature.organizationId, {
      type: "invitation_interested",
      title: "Kandidaat heeft interesse",
      body: `Een kandidaat heeft interesse getoond in je uitnodiging voor “${vacature.title}”.`,
      dedupeBase: `invitation-interested-${uitnodiging.id}`,
      meta: { vacancyId: vacature.id, invitationId: uitnodiging.id },
    });

    await track("invitation_interested", {
      ...eventBasis,
      context: {
        vacancyId: vacature.id,
        consent: response.shareContact === true,
      },
    });
  } else {
    await recordStatusChange(vacature.id, user.id, {
      to: "declined",
      actorType: "candidate",
      actorUserId: user.id,
      reasonCode: response.reasonCode,
    });

    if (response.reasonCode) {
      await recordDecisionFeedback({
        matchSnapshotId: uitnodiging.matchSnapshotId,
        vacancyId: vacature.id,
        candidateUserId: user.id,
        organizationId: vacature.organizationId,
        actorType: "candidate",
        decision: "declined",
        reasonCode: response.reasonCode,
        note: response.note,
      });
    }

    await track("invitation_declined", {
      ...eventBasis,
      context: {
        vacancyId: vacature.id,
        reasonCode: response.reasonCode ?? null,
      },
    });
  }

  await audit("invitation.respond", "Invitation", uitnodiging.id, {
    organizationId: vacature.organizationId,
    userId: user.id,
    meta: { accepted: response.accepted, reasonCode: response.reasonCode ?? null },
  });

  return bijgewerkt;
}

/**
 * Beschouwt de openstaande uitnodigingen van de ingelogde kandidaat als
 * gezien: de bijbehorende invitation_received-notificaties gaan op gelezen en
 * per uitnodiging wordt eenmalig invitation_viewed getrackt (de ongelezen
 * notificatie is het "eerste keer bekeken"-signaal).
 */
export async function markInvitationsViewed(): Promise<void> {
  const { user, profile } = await requireCandidate();

  const ongelezen = await prisma.notification.findMany({
    where: { userId: user.id, type: "invitation_received", readAt: null },
    select: { id: true, meta: true },
  });
  if (ongelezen.length === 0) return;

  await prisma.notification.updateMany({
    where: { id: { in: ongelezen.map((n) => n.id) } },
    data: { readAt: new Date() },
  });

  for (const notificatie of ongelezen) {
    const meta = notificatie.meta as Record<string, unknown> | null;
    const vacancyId =
      meta && typeof meta.vacancyId === "string" ? meta.vacancyId : null;
    await track("invitation_viewed", {
      userId: user.id,
      candidateId: profile?.id,
      context: { vacancyId },
    });
  }
}
