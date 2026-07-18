"use server";

// Server actions voor de profielpagina van de kandidaat: opslaan per sectie.
//
// Regels:
// - elke actie begint met requireCandidate (autorisatie uit @/lib/authz);
// - alle invoer wordt met Zod gevalideerd tegen de taxonomie voordat de
//   servicelaag (src/server/candidates.saveProfileStep) wordt aangeroepen;
// - de secties spiegelen de onboardingstappen; stepName krijgt het voorvoegsel
//   "profiel_" zodat analytics onboarding en profielonderhoud kan onderscheiden.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireCandidate } from "@/lib/authz";
import { saveProfileStep, type ProfileStepInput } from "@/server/candidates";
import {
  CONTRACT_TYPES,
  DAYPARTS,
  DEVELOPMENT,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PATIENT_POPULATION,
  PRACTICE_SIZES,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  TEAM_PREFERENCES,
  TREATMENTS,
  WEEKDAYS,
  WORK_PACES,
} from "@/domain/taxonomy";

/** Resultaat van een sectie-opslag richting de client. */
export type SectieResultaat =
  | { ok: true; volledigheid: number }
  | { ok: false; fout: string };

/* ------------------------------------------------------------------ */
/* Zod-schema's per sectie (spiegel van de onboardingstappen)          */
/* ------------------------------------------------------------------ */

const beschikbaarheidsNiveau = z.enum(["preferred", "available", "unavailable"], {
  errorMap: () => ({ message: "Ongeldige beschikbaarheidswaarde" }),
});

const dagSchema = z.object({
  ochtend: beschikbaarheidsNiveau,
  middag: beschikbaarheidsNiveau,
  avond: beschikbaarheidsNiveau,
});

const beschikbaarheidSchema = z.object({
  ma: dagSchema,
  di: dagSchema,
  wo: dagSchema,
  do: dagSchema,
  vr: dagSchema,
  za: dagSchema,
  zo: dagSchema,
});

const POSTCODE_PATROON = /^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/;
const DATUM_PATROON = /^\d{4}-\d{2}-\d{2}$/;

const functieSchema = z.object({
  sectie: z.literal("functie"),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Kies een functie uit de lijst" }) }),
  experienceLevel: z.enum(EXPERIENCE_LEVELS, {
    errorMap: () => ({ message: "Kies je ervaringsniveau" }),
  }),
});

const werkweekSchema = z.object({
  sectie: z.literal("werkweek"),
  availability: beschikbaarheidSchema,
});

const locatieSchema = z.object({
  sectie: z.literal("locatie"),
  postcode: z
    .string()
    .trim()
    .regex(POSTCODE_PATROON, "Vul een geldige postcode in, bijvoorbeeld 3511 AB"),
  maxTravelMinutes: z
    .number({ invalid_type_error: "Kies een maximale reistijd" })
    .int()
    .min(5, "Reistijd is minimaal 5 minuten")
    .max(120, "Reistijd is maximaal 120 minuten"),
  hoursMin: z
    .number({ invalid_type_error: "Vul het minimum aantal uren in" })
    .int()
    .min(1, "Minimaal 1 uur per week")
    .max(40, "Maximaal 40 uur per week"),
  hoursMax: z
    .number({ invalid_type_error: "Vul het maximum aantal uren in" })
    .int()
    .min(1, "Minimaal 1 uur per week")
    .max(40, "Maximaal 40 uur per week"),
  contractTypes: z
    .array(z.enum(CONTRACT_TYPES))
    .min(1, "Kies minstens één contractvorm"),
  availableFrom: z.string().regex(DATUM_PATROON, "Ongeldige startdatum").nullable(),
  salaryMin: z
    .number()
    .int("Vul het salaris in hele euro's in")
    .min(0, "Salaris kan niet negatief zijn")
    .max(20000, "Controleer het maandsalaris")
    .nullable(),
  salaryMax: z
    .number()
    .int("Vul het salaris in hele euro's in")
    .min(0, "Salaris kan niet negatief zijn")
    .max(20000, "Controleer het maandsalaris")
    .nullable(),
  hourlyRateMin: z
    .number()
    .int("Vul het uurtarief in hele euro's in")
    .min(0, "Uurtarief kan niet negatief zijn")
    .max(500, "Controleer het uurtarief")
    .nullable(),
});

const vakinhoudSchema = z.object({
  sectie: z.literal("vakinhoud"),
  equipmentExperience: z.array(z.enum(EQUIPMENT)),
  techniquesWantsToLearn: z.array(z.enum(EQUIPMENT)),
  softwareSkills: z.array(z.enum(SOFTWARE)),
  specializations: z.array(z.enum(SPECIALIZATIONS)),
  treatmentInterests: z.array(z.enum(TREATMENTS)),
});

const werkplekSchema = z.object({
  sectie: z.literal("werkplek"),
  preferredPopulation: z.array(z.enum(PATIENT_POPULATION)),
  preferredPracticeSize: z.enum(PRACTICE_SIZES).nullable(),
  workPace: z.enum(WORK_PACES).nullable(),
  teamPreferences: z.array(z.enum(TEAM_PREFERENCES)),
  mentorshipNeeded: z.boolean(),
  developmentGoals: z.array(z.enum(DEVELOPMENT)),
});

const zichtbaarheidSchema = z.object({
  sectie: z.literal("zichtbaarheid"),
  visibility: z.enum(["visible", "anonymous", "hidden"], {
    errorMap: () => ({ message: "Kies hoe zichtbaar je wilt zijn" }),
  }),
});

const sectieSchema = z.discriminatedUnion("sectie", [
  functieSchema,
  werkweekSchema,
  locatieSchema,
  vakinhoudSchema,
  werkplekSchema,
  zichtbaarheidSchema,
]);

type SectieInvoer = z.infer<typeof sectieSchema>;

/* ------------------------------------------------------------------ */
/* Kruisveld-controles en mapping                                      */
/* ------------------------------------------------------------------ */

function controleerSamenhang(d: SectieInvoer): string | null {
  if (d.sectie === "werkweek") {
    const beschikbaar = WEEKDAYS.some((dag) =>
      DAYPARTS.some((deel) => d.availability[dag][deel] !== "unavailable"),
    );
    if (!beschikbaar) return "Kies minstens één dagdeel waarop je kunt werken";
  }
  if (d.sectie === "locatie") {
    if (d.hoursMax < d.hoursMin) {
      return "Het maximum aantal uren ligt onder het minimum";
    }
    if (d.salaryMin !== null && d.salaryMax !== null && d.salaryMax < d.salaryMin) {
      return "Het maximumsalaris ligt onder het minimum";
    }
    if (d.availableFrom !== null && Number.isNaN(new Date(d.availableFrom).getTime())) {
      return "Ongeldige startdatum";
    }
  }
  return null;
}

const naarCenten = (euro: number | null): number | null =>
  euro === null ? null : Math.round(euro * 100);

function naarStapInvoer(d: SectieInvoer): ProfileStepInput {
  switch (d.sectie) {
    case "functie":
      return {
        stepName: "profiel_functie",
        role: d.role,
        experienceLevel: d.experienceLevel,
      };
    case "werkweek":
      return { stepName: "profiel_werkweek", availability: d.availability };
    case "locatie":
      return {
        stepName: "profiel_waar_en_hoeveel",
        postcode: d.postcode.toUpperCase(),
        maxTravelMinutes: d.maxTravelMinutes,
        hoursMin: d.hoursMin,
        hoursMax: d.hoursMax,
        contractTypes: d.contractTypes,
        availableFrom: d.availableFrom === null ? null : new Date(d.availableFrom),
        salaryMin: naarCenten(d.salaryMin),
        salaryMax: naarCenten(d.salaryMax),
        hourlyRateMin: naarCenten(d.hourlyRateMin),
      };
    case "vakinhoud":
      return {
        stepName: "profiel_vakinhoud",
        equipmentExperience: d.equipmentExperience,
        techniquesWantsToLearn: d.techniquesWantsToLearn,
        softwareSkills: d.softwareSkills,
        specializations: d.specializations,
        treatmentInterests: d.treatmentInterests,
      };
    case "werkplek":
      return {
        stepName: "profiel_werkplek",
        preferredPopulation: d.preferredPopulation,
        preferredPracticeSize: d.preferredPracticeSize,
        workPace: d.workPace,
        teamPreferences: d.teamPreferences,
        mentorshipNeeded: d.mentorshipNeeded,
        developmentGoals: d.developmentGoals,
      };
    case "zichtbaarheid":
      return { stepName: "profiel_zichtbaarheid", visibility: d.visibility };
  }
}

/* ------------------------------------------------------------------ */
/* Actie                                                               */
/* ------------------------------------------------------------------ */

/** Slaat één profielsectie op en geeft de nieuwe volledigheidsscore terug. */
export async function updateProfielSectieAction(
  invoer: unknown,
): Promise<SectieResultaat> {
  try {
    const { profile } = await requireCandidate();
    if (!profile) {
      return {
        ok: false,
        fout: "Je hebt nog geen profiel — doorloop eerst de onboarding.",
      };
    }
    const parsed = sectieSchema.safeParse(invoer);
    if (!parsed.success) {
      return {
        ok: false,
        fout: parsed.error.errors[0]?.message ?? "Controleer je invoer",
      };
    }
    const samenhangFout = controleerSamenhang(parsed.data);
    if (samenhangFout) return { ok: false, fout: samenhangFout };

    const bijgewerkt = await saveProfileStep(naarStapInvoer(parsed.data));
    revalidatePath("/kandidaat/profiel");
    return { ok: true, volledigheid: bijgewerkt.completenessScore };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Profielsectie niet opgeslagen:", fout);
    return { ok: false, fout: "Opslaan is niet gelukt. Probeer het opnieuw." };
  }
}
