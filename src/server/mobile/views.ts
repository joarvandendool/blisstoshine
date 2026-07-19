// Mappers van Prisma-/servicemodellen naar de wire-types van
// @mondzorgwerkt/api-contract. Dit is de ENIGE plek waar mobiele payloads
// worden gevormd — de contracttests (tests/domain/mobile-contract.test.ts)
// bewaken dat de uitkomst aan het gedeelde contract voldoet.
//
// Privacyregels: geen coördinaten van de kandidaat op de draad (alleen
// postcode), geen interne organisatie-id's waar niet nodig, en het
// matchresultaat is altijd de letterlijke serveruitkomst.

import type {
  CandidateProfile,
  MatchSnapshot,
  MobileSession,
} from "@prisma/client";
import type {
  ApplicationView,
  ConsentView,
  InterviewView,
  InvitationView,
  MatchDetail,
  MatchListItem,
  MobileSessionView,
  MobileTokens,
  NotificationView,
  ProfileView,
} from "../../../packages/api-contract/src/api";
import { decodeSchedule } from "../../../packages/api-contract/src/decode";
import { castAvailability } from "@/server/candidates";
import type { CandidateVacancyMatch } from "@/server/matching";
import type { CandidateApplicationEntry } from "@/server/applications";
import type { CandidateInvitationEntry } from "@/server/invitations";
import type { ActiveConsentEntry, CandidateInterviewEntry } from "@/server/pipeline";
import type { MintedTokens } from "@/lib/mobile-auth";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toMobileTokens(tokens: MintedTokens): MobileTokens {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    refreshToken: tokens.refreshToken,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
  };
}

export function toProfileView(profile: CandidateProfile): ProfileView {
  return {
    role: profile.role,
    experienceLevel: profile.experienceLevel,
    postcode: profile.postcode,
    maxTravelMinutes: profile.maxTravelMinutes,
    hoursMin: profile.hoursMin,
    hoursMax: profile.hoursMax,
    contractTypes: profile.contractTypes,
    availableFrom: iso(profile.availableFrom),
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    revenueShareMin: profile.revenueShareMin,
    availability: castAvailability(profile.availability),
    equipmentExperience: profile.equipmentExperience,
    equipmentWantsToWork: profile.equipmentWantsToWork,
    techniquesWantsToLearn: profile.techniquesWantsToLearn,
    softwareSkills: profile.softwareSkills,
    specializations: profile.specializations,
    treatmentInterests: profile.treatmentInterests,
    preferredPopulation: profile.preferredPopulation,
    mentorshipNeeded: profile.mentorshipNeeded,
    developmentGoals: profile.developmentGoals,
    preferredPracticeSize: profile.preferredPracticeSize,
    workPace: profile.workPace,
    teamPreferences: profile.teamPreferences,
    visibility: profile.visibility,
    completenessScore: profile.completenessScore,
    status: profile.status,
  };
}

export function toMatchListItem(match: CandidateVacancyMatch): MatchListItem {
  return {
    vacancyId: match.vacancy.id,
    slug: match.vacancy.slug ?? null,
    title: match.vacancy.title,
    role: match.vacancy.role,
    organizationName: match.organizationName,
    city: match.location.city,
    hoursMin: match.vacancy.hoursMin,
    hoursMax: match.vacancy.hoursMax,
    contractTypes: match.vacancy.contractTypes,
    schedule: decodeSchedule(match.vacancy.schedule),
    result: match.result,
  };
}

export function toMatchDetail(
  match: CandidateVacancyMatch,
  extra: {
    application: { id: string; status: string; createdAt: Date } | null;
    invitation: { id: string; status: string } | null;
  },
): MatchDetail {
  return {
    ...toMatchListItem(match),
    description: match.vacancy.description ?? null,
    culture: match.vacancy.culture,
    mentorship: match.vacancy.mentorship,
    development: match.vacancy.development,
    flexibilityNote: match.vacancy.flexibilityNote ?? null,
    salaryMin: match.vacancy.salaryMin,
    salaryMax: match.vacancy.salaryMax,
    revenueShareMax: match.vacancy.revenueShareMax,
    startBy: iso(match.vacancy.startBy),
    startByHard: match.vacancy.startByHard,
    experienceLevel: match.vacancy.experienceLevel ?? null,
    vacancyStatus: match.vacancy.status,
    location: { city: match.location.city, postcode: match.location.postcode },
    application: extra.application
      ? {
          id: extra.application.id,
          status: extra.application.status as ApplicationView["status"],
          createdAt: extra.application.createdAt.toISOString(),
        }
      : null,
    invitation: extra.invitation
      ? {
          id: extra.invitation.id,
          status: extra.invitation.status as InvitationView["status"],
        }
      : null,
  };
}

function snapshotVelden(snapshot: MatchSnapshot | null): {
  snapshotScore: number | null;
  snapshotLabel: string | null;
} {
  return {
    snapshotScore: snapshot?.score ?? null,
    snapshotLabel: snapshot?.label ?? null,
  };
}

export function toApplicationView(entry: CandidateApplicationEntry): ApplicationView {
  return {
    id: entry.application.id,
    status: entry.application.status,
    motivation: entry.application.motivation ?? null,
    createdAt: entry.application.createdAt.toISOString(),
    vacancy: {
      id: entry.vacancy.id,
      slug: entry.vacancy.slug ?? null,
      title: entry.vacancy.title,
      city: entry.location.city,
      organizationName: entry.organizationName,
      status: entry.vacancy.status,
    },
    ...snapshotVelden(entry.snapshot),
  };
}

export function toInvitationView(entry: CandidateInvitationEntry): InvitationView {
  return {
    id: entry.invitation.id,
    status: entry.invitation.status,
    message: entry.invitation.message ?? null,
    createdAt: entry.invitation.createdAt.toISOString(),
    vacancy: {
      id: entry.vacancy.id,
      slug: entry.vacancy.slug ?? null,
      title: entry.vacancy.title,
      city: entry.location.city,
      organizationName: entry.organizationName,
      status: entry.vacancy.status,
    },
    ...snapshotVelden(entry.snapshot),
  };
}

export function toConsentView(entry: ActiveConsentEntry): ConsentView {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    organizationName: entry.organizationName,
    vacancyId: entry.vacancyId,
    vacancyTitle: entry.vacancyTitle,
    grantedAt:
      entry.grantedAt instanceof Date
        ? entry.grantedAt.toISOString()
        : String(entry.grantedAt),
  };
}

export function toInterviewView(entry: CandidateInterviewEntry): InterviewView {
  return {
    id: entry.interview.id,
    status: entry.interview.status,
    slots: entry.slots.map((slot) => ({
      startsAt: slot.startsAt,
      durationMinutes: slot.durationMinutes,
    })),
    chosenSlot: iso(entry.interview.chosenSlot),
    message: entry.interview.message ?? null,
    vacancyId: entry.vacancyId,
    vacancyTitle: entry.vacancyTitle,
    organizationName: entry.organizationName,
    city: entry.city,
  };
}

export function toNotificationView(melding: {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: melding.id,
    type: melding.type,
    title: melding.title,
    body: melding.body,
    href: melding.href,
    readAt: iso(melding.readAt),
    createdAt: melding.createdAt.toISOString(),
  };
}

export function toSessionView(
  session: MobileSession,
  currentSessionId: string,
): MobileSessionView {
  return {
    id: session.id,
    deviceName: session.deviceName,
    platform: session.platform,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    current: session.id === currentSessionId,
  };
}
