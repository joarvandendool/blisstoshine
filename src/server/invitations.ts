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
import { label } from "@/domain/taxonomy";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { geocodePostcode } from "@/server/geo";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { saveMatchSnapshot } from "@/server/matching";
import { planCodeVoorAnalytics } from "@/server/organizations";

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
 */
export async function inviteCandidate(
  ctx: OrgContext,
  vacancyId: string,
  candidateUserId: string,
  message?: string,
): Promise<Invitation> {
  if (!roleCan(ctx.role, "candidate.invite")) {
    throw new AuthzError(`Rol ${ctx.role} mag geen kandidaten uitnodigen`, 403);
  }

  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    include: { location: true },
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
   * Naam volgens privacy: pas zichtbaar bij visibility "visible" of nadat de
   * kandidaat de uitnodiging heeft geaccepteerd (bewuste toestemming);
   * anders geanonimiseerd.
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

  return uitnodigingen.map(({ matchSnapshot, candidate, ...invitation }) => {
    const profiel = candidate.candidateProfile;
    const naamZichtbaar =
      invitation.status === "accepted" || profiel?.visibility === "visible";
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

/**
 * Kandidaat beantwoordt een eigen uitnodiging: accepteren of afslaan.
 * Alleen een nog openstaande uitnodiging (status sent) kan worden beantwoord.
 */
export async function respondToInvitation(
  invitationId: string,
  accepted: boolean,
): Promise<Invitation> {
  const { user } = await requireCandidate();

  const uitnodiging = await prisma.invitation.findFirst({
    where: { id: invitationId, candidateUserId: user.id },
  });
  if (!uitnodiging) throw new AuthzError("Uitnodiging niet gevonden", 404);
  if (uitnodiging.status !== "sent") {
    throw new AuthzError("Deze uitnodiging is al beantwoord", 409);
  }

  const bijgewerkt = await prisma.invitation.update({
    where: { id: uitnodiging.id },
    data: { status: accepted ? "accepted" : "declined" },
  });

  await audit("invitation.respond", "Invitation", uitnodiging.id, {
    userId: user.id,
    meta: { accepted },
  });

  return bijgewerkt;
}
