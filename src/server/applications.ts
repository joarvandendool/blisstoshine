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
import { markFilled, vacancyToMatchVacancy } from "@/server/vacancies";
import { saveMatchSnapshot } from "@/server/matching";
import {
  applicationToPipelineStatus,
  recordDecisionFeedback,
  recordStatusChange,
  type FeedbackReasonCode,
} from "@/server/pipeline";

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

  // Journaal: de kandidaat solliciteert (van de vorige stand naar applied).
  await recordStatusChange(vacature.id, user.id, {
    to: "applied",
    actorType: "candidate",
    actorUserId: user.id,
  });

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

export interface StatusFeedbackInput {
  reasonCode: FeedbackReasonCode;
  note?: string;
}

/**
 * Werkt de status van een sollicitatie bij (pipeline). Capability:
 * pipeline.manage. Elke wijziging wordt in het pipeline-journaal bijgeschreven
 * (recordStatusChange). Bij interview wordt interview_scheduled getrackt; bij
 * hired candidate_hired en vacancy_filled (het daadwerkelijk sluiten van de
 * vacature blijft een aparte, bewuste actie via markFilled). Bij rejected kan
 * gestructureerde feedback worden meegegeven (recordDecisionFeedback).
 */
export async function updateApplicationStatus(
  ctx: OrgContext,
  applicationId: string,
  status: ApplicationStatus,
  feedback?: StatusFeedbackInput,
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

  // Idempotent: alleen bij een échte statusovergang journaliseren, analytics
  // vuren en auditen. Zonder deze guard vuurt een herhaalde "hired"-klik
  // candidate_hired opnieuw en ontstaat er een dubbele journaalregel.
  const statusGewijzigd = sollicitatie.status !== status;

  const bijgewerkt = statusGewijzigd
    ? await prisma.application.update({
        where: { id: sollicitatie.id },
        data: { status },
      })
    : await prisma.application.findUniqueOrThrow({ where: { id: sollicitatie.id } });

  if (statusGewijzigd) {
    // Journaal: statuswijziging door de praktijk.
    await recordStatusChange(sollicitatie.vacancy.id, sollicitatie.candidateUserId, {
      to: applicationToPipelineStatus(status),
      actorType: "practice",
      actorUserId: ctx.user.id,
      reasonCode: feedback?.reasonCode,
    });
  }

  if (status === "rejected" && feedback) {
    await recordDecisionFeedback({
      matchSnapshotId: sollicitatie.matchSnapshotId,
      vacancyId: sollicitatie.vacancy.id,
      candidateUserId: sollicitatie.candidateUserId,
      organizationId: ctx.organizationId,
      actorType: "practice",
      decision: "rejected",
      reasonCode: feedback.reasonCode,
      note: feedback.note,
    });
  }

  const eventBasis = {
    organizationId: ctx.organizationId,
    locationId: sollicitatie.vacancy.locationId,
    userId: ctx.user.id,
    candidateId: sollicitatie.candidate.candidateProfile?.id,
    context: { vacancyId: sollicitatie.vacancy.id, applicationId: sollicitatie.id },
  };
  if (statusGewijzigd && status === "interview") {
    await track("interview_scheduled", eventBasis);
  }
  if (statusGewijzigd && status === "hired") {
    // candidate_hired precies één keer per plaatsing. vacancy_filled wordt
    // NIET hier gevuurd: markFilled (aangeroepen door setPipelineStatus) is
    // de énige emitter, zodat het event niet dubbel telt.
    await track("candidate_hired", eventBasis);
  }

  if (statusGewijzigd) {
    await audit("application.status", "Application", sollicitatie.id, {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      meta: { van: sollicitatie.status, naar: status },
    });
  }

  return bijgewerkt;
}

/**
 * Kandidaat trekt de eigen sollicitatie terug (withdrawn), met optioneel
 * dezelfde gestructureerde feedback als bij afwijzen. Alleen mogelijk zolang
 * de sollicitatie nog niet is afgerond (hired/rejected/withdrawn).
 */
export async function withdrawApplication(
  applicationId: string,
  feedback?: { reasonCode?: FeedbackReasonCode; note?: string },
): Promise<Application> {
  const { user, profile } = await requireCandidate();

  const sollicitatie = await prisma.application.findFirst({
    where: { id: applicationId, candidateUserId: user.id },
    include: { vacancy: { select: { id: true, locationId: true, organizationId: true } } },
  });
  if (!sollicitatie) throw new AuthzError("Sollicitatie niet gevonden", 404);
  if (["hired", "rejected", "withdrawn"].includes(sollicitatie.status)) {
    throw new AuthzError("Deze sollicitatie kan niet meer worden ingetrokken", 409);
  }

  const bijgewerkt = await prisma.application.update({
    where: { id: sollicitatie.id },
    data: { status: "withdrawn" },
  });

  await recordStatusChange(sollicitatie.vacancy.id, user.id, {
    to: "withdrawn",
    actorType: "candidate",
    actorUserId: user.id,
    reasonCode: feedback?.reasonCode,
  });

  if (feedback?.reasonCode) {
    await recordDecisionFeedback({
      matchSnapshotId: sollicitatie.matchSnapshotId,
      vacancyId: sollicitatie.vacancy.id,
      candidateUserId: user.id,
      organizationId: sollicitatie.vacancy.organizationId,
      actorType: "candidate",
      decision: "withdrawn",
      reasonCode: feedback.reasonCode,
      note: feedback.note,
    });
  }

  await audit("application.withdraw", "Application", sollicitatie.id, {
    organizationId: sollicitatie.vacancy.organizationId,
    userId: user.id,
    meta: { reasonCode: feedback?.reasonCode ?? null, candidateProfileId: profile?.id },
  });

  return bijgewerkt;
}

/**
 * Zet een kandidaat in de pipeline van een (eigen) vacature op offer, hired
 * of rejected — óók wanneer er (nog) geen sollicitatie is, bijvoorbeeld bij
 * een uitgenodigde kandidaat. Bestaat er wél een sollicitatie, dan loopt de
 * wijziging via updateApplicationStatus (inclusief journaal en analytics).
 *
 * - rejected vereist gestructureerde feedback (reasonCode verplicht).
 * - hired markeert de vacature als vervuld (markFilled) wanneer die nog
 *   gepubliceerd is.
 */
export async function setPipelineStatus(
  ctx: OrgContext,
  vacancyId: string,
  candidateUserId: string,
  to: "offer" | "hired" | "rejected",
  feedback?: StatusFeedbackInput,
): Promise<void> {
  if (!roleCan(ctx.role, "pipeline.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag de pipeline niet beheren`, 403);
  }
  if (to === "rejected" && !feedback?.reasonCode) {
    throw new AuthzError("Een reden is verplicht bij afwijzen", 400);
  }

  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    select: { id: true, status: true, locationId: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);

  const sollicitatie = await prisma.application.findUnique({
    where: {
      vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId },
    },
    select: { id: true },
  });

  if (sollicitatie) {
    const applicatieStatus: ApplicationStatus =
      to === "offer" ? "offered" : to === "hired" ? "hired" : "rejected";
    await updateApplicationStatus(ctx, sollicitatie.id, applicatieStatus, feedback);
  } else {
    await recordStatusChange(vacature.id, candidateUserId, {
      to,
      actorType: "practice",
      actorUserId: ctx.user.id,
      reasonCode: feedback?.reasonCode,
    });

    const profiel = await prisma.candidateProfile.findUnique({
      where: { userId: candidateUserId },
      select: { id: true },
    });

    if (to === "rejected" && feedback) {
      const uitnodiging = await prisma.invitation.findUnique({
        where: {
          vacancyId_candidateUserId: { vacancyId: vacature.id, candidateUserId },
        },
        select: { matchSnapshotId: true },
      });
      await recordDecisionFeedback({
        matchSnapshotId: uitnodiging?.matchSnapshotId ?? null,
        vacancyId: vacature.id,
        candidateUserId,
        organizationId: ctx.organizationId,
        actorType: "practice",
        decision: "rejected",
        reasonCode: feedback.reasonCode,
        note: feedback.note,
      });
    }

    if (to === "hired") {
      await track("candidate_hired", {
        organizationId: ctx.organizationId,
        locationId: vacature.locationId,
        userId: ctx.user.id,
        candidateId: profiel?.id,
        context: { vacancyId: vacature.id },
      });
    }
  }

  // Aannemen sluit de vacature (bewust, zichtbaar in het dashboard).
  if (to === "hired" && vacature.status === "published") {
    await markFilled(ctx, vacature.id);
  }
}
