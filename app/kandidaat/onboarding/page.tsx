// Kandidaat-onboarding — eigen rustige full-screen flow (bewust zónder
// AppShell). Wie al een geactiveerd profiel heeft, gaat direct door naar de
// kandidaatomgeving; wie niet is ingelogd, eerst naar /inloggen.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { CandidateProfile } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { castAvailability, getOwnProfile } from "@/server/candidates";
import { emptyAvailability } from "@/domain/taxonomy";
import { OnboardingFlow, type ProfielWaarden } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Stel je profiel samen — mondzorgwerkt",
  description:
    "Stel in zes stappen je ideale werkweek samen en ontdek praktijken die echt bij je passen.",
};

/** Centen → hele euro's voor de invoervelden (null blijft null). */
function naarEuros(centen: number | null): number | null {
  return centen === null ? null : Math.round(centen / 100);
}

/** Opgeslagen profiel → plat clientmodel voor de flow. */
function profielNaarWaarden(profiel: CandidateProfile): ProfielWaarden {
  return {
    role: profiel.role,
    experienceLevel: profiel.experienceLevel,
    availability: castAvailability(profiel.availability),
    postcode: profiel.postcode,
    maxTravelMinutes: profiel.maxTravelMinutes,
    hoursMin: profiel.hoursMin > 0 ? profiel.hoursMin : 24,
    hoursMax: profiel.hoursMax > 0 ? profiel.hoursMax : 32,
    contractTypes: profiel.contractTypes,
    availableFrom: profiel.availableFrom
      ? profiel.availableFrom.toISOString().slice(0, 10)
      : null,
    salaryMin: naarEuros(profiel.salaryMin),
    salaryMax: naarEuros(profiel.salaryMax),
    hourlyRateMin: naarEuros(profiel.hourlyRateMin),
    equipmentExperience: profiel.equipmentExperience,
    techniquesWantsToLearn: profiel.techniquesWantsToLearn,
    softwareSkills: profiel.softwareSkills,
    specializations: profiel.specializations,
    treatmentInterests: profiel.treatmentInterests,
    preferredPopulation: profiel.preferredPopulation,
    preferredPracticeSize: profiel.preferredPracticeSize,
    workPace: profiel.workPace,
    teamPreferences: profiel.teamPreferences,
    mentorshipNeeded: profiel.mentorshipNeeded,
    developmentGoals: profiel.developmentGoals,
    visibility: profiel.visibility,
  };
}

/** Startwaarden voor een gloednieuw profiel. */
function beginWaarden(): ProfielWaarden {
  return {
    role: "",
    experienceLevel: "",
    availability: emptyAvailability(),
    postcode: "",
    maxTravelMinutes: 30,
    hoursMin: 24,
    hoursMax: 32,
    contractTypes: [],
    availableFrom: null,
    salaryMin: null,
    salaryMax: null,
    hourlyRateMin: null,
    equipmentExperience: [],
    techniquesWantsToLearn: [],
    softwareSkills: [],
    specializations: [],
    treatmentInterests: [],
    preferredPopulation: [],
    preferredPracticeSize: null,
    workPace: null,
    teamPreferences: [],
    mentorshipNeeded: false,
    developmentGoals: [],
    visibility: "anonymous",
  };
}

/** Heeft de kandidaat de zichtbaarheidskeuze al bewust bevestigd? */
function zichtbaarheidBevestigd(profiel: CandidateProfile | null): boolean {
  const instellingen = profiel?.anonymitySettings;
  return (
    typeof instellingen === "object" &&
    instellingen !== null &&
    !Array.isArray(instellingen) &&
    (instellingen as Record<string, unknown>).keuzeBevestigd === true
  );
}

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/inloggen");

  const { profile } = await getOwnProfile();
  // Al een actief (of gepauzeerd/gearchiveerd) profiel: onboarding is klaar.
  if (profile && profile.status !== "draft") redirect("/kandidaat");

  const voornaam = user.name.split(" ")[0] ?? user.name;

  return (
    <OnboardingFlow
      initieel={profile ? profielNaarWaarden(profile) : beginWaarden()}
      volledigheid={profile?.completenessScore ?? 0}
      zichtbaarheidBevestigd={zichtbaarheidBevestigd(profile)}
      voornaam={voornaam}
    />
  );
}
