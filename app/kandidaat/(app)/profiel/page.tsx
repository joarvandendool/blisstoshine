// Profielpagina van de kandidaat — draait binnen de (app)-layout van de
// kandidaatomgeving. Zonder profiel (of met een niet-afgeronde onboarding)
// gaat de kandidaat eerst terug de onboarding in.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { CandidateProfile } from "@prisma/client";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { castAvailability, getOwnProfile } from "@/server/candidates";
import type { ProfielWaarden } from "../../onboarding/onboarding-flow";
import { ProfielEditor } from "./profiel-editor";

export const metadata: Metadata = {
  title: "Jouw profiel — mondzorgwerkt",
  description: "Bekijk en werk je profiel bij: werkweek, vakinhoud en zichtbaarheid.",
};

/** Centen → hele euro's voor de invoervelden (null blijft null). */
function naarEuros(centen: number | null): number | null {
  return centen === null ? null : Math.round(centen / 100);
}

/** Opgeslagen profiel → plat clientmodel voor de editor. */
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

export default async function ProfielPage() {
  const user = await getSessionUser();
  if (!user) redirect("/inloggen");

  const { profile } = await getOwnProfile();
  if (!profile || profile.status === "draft") redirect("/kandidaat/onboarding");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Jouw"
        accent="profiel"
        description="Werk je gegevens per onderdeel bij — elke wijziging telt direct mee in je matches."
      />
      <ProfielEditor
        initieel={profielNaarWaarden(profile)}
        volledigheid={profile.completenessScore}
        status={profile.status}
      />
    </div>
  );
}
