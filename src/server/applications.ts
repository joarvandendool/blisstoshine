// Servicelaag voor sollicitaties. Kandidaatkant: solliciteren (met actief
// profiel) en eigen sollicitaties bekijken. Praktijkkant: sollicitaties per
// vacature en statusbeheer van de pipeline.
//
// Privacy: wie solliciteert deelt zijn naam bewust met de praktijk — bij
// sollicitaties is de echte naam dus altijd zichtbaar, ongeacht de
// zichtbaarheidsinstelling van het profiel.

import {
  Prisma,
  type Application,
  type ApplicationStatus,
  type CandidateProfile,
  type MatchSnapshot,
  type PracticeLocation,
  type Vacancy,
} from "@prisma/client";
import { AuthzError, requireCandidate, roleCan, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { saveMatchSnapshot } from "@/server/matching";

/**
 * Kandidaat solliciteert op een gepubliceerde vacature. Vereist een actief
 * profiel. De match wordt op het beslismoment vastgelegd als snapshot;
 * dubbele sollicitaties op dezelfde vacature zijn niet mogelijk.
 */
export async function applyToVacancy(
  vacancyId: string,
  motivation?: string,
): Promise<Application> {
  const { user, profile } = await requireCandidate();
  if (!profile || profile.status !== "active") {
    throw new AuthzError(
      "Activeer eerst je profiel voordat je kunt solliciteren",
      403,
    );
  }

  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, status: "published", organization: { status: "active" } },
    include: { location: true },
  });
  if (!vacature) {
    throw new AuthzError("Vacature niet gevonden of niet (meer) gepubliceerd", 404);
  }

  const bestaand = await prisma.application.findUnique({
    where: {
      vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId: user.id },
    },
    select: { id: true },
  });
  if (bestaand) {
    throw new AuthzError("Je hebt al gesolliciteerd op deze vacature", 409);
  }

  await track("application_started", {
    userId: user.id,
    candidateId: profile.id,
    organizationId: vacature.organizationId,
    locationId: vacature.locationId,
    context: { vacancyId: vacature.id },
  });

  // Match vastleggen op het beslismoment.
  const matchKandidaat = profileToMatchCandidate(profile);
  const matchVacature = vacancyToMatchVacancy(vacature, vacature.location);
  const resultaat = computeMatchWithOpportunities(matchKandidaat, matchVacature);
  const snapshotId = await saveMatchSnapshot(
    vacature.id,
    user.id,
    resultaat,
    "application",
    matchKandidaat,
    matchVacature,
  );

  let application: Application;
  try {
    application = await prisma.application.create({
      data: {
        vacancyId: vacature.id,
        candidateUserId: user.id,
        motivation: motivation ?? null,
        matchSnapshotId: snapshotId,
      },
    });
  } catch (error) {
    // Race met een tweede gelijktijdige sollicitatie: dezelfde nette fout.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AuthzError("Je hebt al gesolliciteerd op deze vacature", 409);
    }
    throw error;
  }

  await track("application_submitted", {
    userId: user.id,
    candidateId: profile.id,
    organizationId: vacature.organizationId,
    locationId: vacature.locationId,
    context: { vacancyId: vacature.id, score: resultaat.score },
  });
  await audit("application.submit", "Application", application.id, {
    organizationId: vacature.organizationId,
    userId: user.id,
    meta: { vacancyId: vacature.id },
  });

  return application;
}

// ---------------------------------------------------------------------------
// Lijsten
// ---------------------------------------------------------------------------

export interface VacancyApplicationEntry {
  application: Application;
  /** Echte naam — bij een sollicitatie deelt de kandidaat die bewust. */
  candidateName: string;
  profile: CandidateProfile | null;
  snapshot: MatchSnapshot | null;
}

/** Sollicitaties op één (eigen) vacature, nieuwste eerst. */
export async function listApplicationsForVacancy(
  ctx: OrgContext,
  vacancyId: string,
): Promise<VacancyApplicationEntry[]> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const sollicitaties = await prisma.application.findMany({
    where: { vacancyId: vacature.id },
    include: {
      matchSnapshot: true,
      candidate: { select: { name: true, candidateProfile: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return sollicitaties.map(({ matchSnapshot, candidate, ...application }) => ({
    application: application as Application,
    candidateName: candidate.name,
    profile: candidate.candidateProfile,
    snapshot: matchSnapshot,
  }));
}

export interface CandidateApplicationEntry {
  application: Application;
  vacancy: Vacancy;
  location: PracticeLocation;
  organizationName: string;
  snapshot: MatchSnapshot | null;
}

/** Alle sollicitaties van de ingelogde kandidaat, nieuwste eerst. */
export async function listApplicationsForCandidate(): Promise<CandidateApplicationEntry[]> {
  const { user } = await requireCandidate();

  const sollicitaties = await prisma.application.findMany({
    where: { candidateUserId: user.id },
    include: {
      matchSnapshot: true,
      vacancy: { include: { location: true, organization: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return sollicitaties.map(({ matchSnapshot, vacancy, ...application }) => {
    const { location, organization, ...vacatureRest } = vacancy;
    return {
      application: application as Application,
      vacancy: vacatureRest as Vacancy,
      location,
      organizationName: organization.name,
      snapshot: matchSnapshot,
    };
  });
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Werkt de status van een sollicitatie bij (pipeline). Capability:
 * pipeline.manage. Bij interview wordt interview_scheduled getrackt; bij
 * hired candidate_hired en vacancy_filled (het daadwerkelijk sluiten van de
 * vacature blijft een aparte, bewuste actie via markFilled).
 */
export async function updateApplicationStatus(
  ctx: OrgContext,
  applicationId: string,
  status: ApplicationStatus,
): Promise<Application> {
  if (!roleCan(ctx.role, "pipeline.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag de pipeline niet beheren`, 403);
  }

  const sollicitatie = await prisma.application.findFirst({
    where: { id: applicationId, vacancy: { organizationId: ctx.organizationId } },
    include: {
      vacancy: { select: { id: true, locationId: true } },
      candidate: { select: { candidateProfile: { select: { id: true } } } },
    },
  });
  if (!sollicitatie) throw new AuthzError("Sollicitatie niet gevonden", 404);

  const bijgewerkt = await prisma.application.update({
    where: { id: sollicitatie.id },
    data: { status },
  });

  const eventBasis = {
    organizationId: ctx.organizationId,
    locationId: sollicitatie.vacancy.locationId,
    userId: ctx.user.id,
    candidateId: sollicitatie.candidate.candidateProfile?.id,
    context: { vacancyId: sollicitatie.vacancy.id, applicationId: sollicitatie.id },
  };
  if (status === "interview") {
    await track("interview_scheduled", eventBasis);
  }
  if (status === "hired") {
    await track("candidate_hired", eventBasis);
    await track("vacancy_filled", eventBasis);
  }

  await audit("application.status", "Application", sollicitatie.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { van: sollicitatie.status, naar: status },
  });

  return bijgewerkt;
}
