// Zod-schema's van /api/mobile/v1-verzoeken. Waarden worden gevalideerd
// tegen de canonieke taxonomie (src/domain/taxonomy) — dezelfde lijsten die
// via @mondzorgwerkt/api-contract met de app worden gedeeld.

import { z } from "zod";
import {
  CONTRACT_TYPES,
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
import { FEEDBACK_REASON_CODES } from "@/server/pipeline";
import { NOTIFICATION_TYPES } from "@/lib/notifications";

const deviceVelden = {
  deviceName: z.string().trim().max(100).optional(),
  platform: z.string().trim().max(20).optional(),
};

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Vul je naam in").max(200),
  email: z.string().trim().email("Vul een geldig e-mailadres in"),
  password: z.string().min(8, "Wachtwoord moet minimaal 8 tekens zijn").max(200),
  ...deviceVelden,
});

export const loginSchema = z.object({
  email: z.string().trim().email("Vul een geldig e-mailadres in"),
  password: z.string().min(1, "Vul je wachtwoord in").max(200),
  ...deviceVelden,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(200),
});

const beschikbaarheidsNiveau = z.enum(["preferred", "available", "unavailable"]);
const dagdeelRij = z.object({
  ochtend: beschikbaarheidsNiveau,
  middag: beschikbaarheidsNiveau,
  avond: beschikbaarheidsNiveau,
});
export const availabilitySchema = z.object(
  Object.fromEntries(WEEKDAYS.map((dag) => [dag, dagdeelRij])) as Record<
    (typeof WEEKDAYS)[number],
    typeof dagdeelRij
  >,
);

const sleutelLijst = (toegestaan: readonly string[]) =>
  z.array(z.enum(toegestaan as [string, ...string[]])).max(50);

/** NL-postcode: 4 cijfers + optioneel 2 letters ("3511" of "3511 AB"). */
const postcodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{3}\s?(?:[A-Za-z]{2})?$/, "Vul een geldige postcode in");

const isoDatum = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Ongeldige datum");

export const profileStepSchema = z
  .object({
    stepName: z.string().trim().min(1).max(50),
    role: z.enum(ROLES).optional(),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
    postcode: postcodeSchema.optional(),
    maxTravelMinutes: z.number().int().min(5).max(180).optional(),
    hoursMin: z.number().int().min(0).max(60).optional(),
    hoursMax: z.number().int().min(0).max(60).optional(),
    contractTypes: sleutelLijst(CONTRACT_TYPES).optional(),
    availableFrom: isoDatum.nullable().optional(),
    salaryMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
    salaryMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
    revenueShareMin: z.number().int().min(0).max(100).nullable().optional(),
    availability: availabilitySchema.optional(),
    equipmentExperience: sleutelLijst(EQUIPMENT).optional(),
    equipmentWantsToWork: sleutelLijst(EQUIPMENT).optional(),
    techniquesWantsToLearn: sleutelLijst([...EQUIPMENT, ...TREATMENTS]).optional(),
    softwareSkills: sleutelLijst(SOFTWARE).optional(),
    specializations: sleutelLijst(SPECIALIZATIONS).optional(),
    treatmentInterests: sleutelLijst(TREATMENTS).optional(),
    preferredPopulation: sleutelLijst(PATIENT_POPULATION).optional(),
    mentorshipNeeded: z.boolean().optional(),
    developmentGoals: sleutelLijst(DEVELOPMENT).optional(),
    preferredPracticeSize: z.enum(PRACTICE_SIZES).nullable().optional(),
    workPace: z.enum(WORK_PACES).nullable().optional(),
    teamPreferences: sleutelLijst(TEAM_PREFERENCES).optional(),
    visibility: z.enum(["visible", "anonymous", "hidden"]).optional(),
  })
  .strict()
  .refine(
    (stap) =>
      stap.hoursMin === undefined ||
      stap.hoursMax === undefined ||
      stap.hoursMax >= stap.hoursMin,
    { message: "hoursMax moet groter of gelijk zijn aan hoursMin", path: ["hoursMax"] },
  );

export const applySchema = z.object({
  vacancyId: z.string().trim().min(1).max(50),
  motivation: z.string().trim().max(2000).optional(),
});

export const withdrawSchema = z.object({
  reasonCode: z.enum(FEEDBACK_REASON_CODES).optional(),
  note: z.string().trim().max(500).optional(),
});

export const invitationRespondSchema = z
  .object({
    accepted: z.boolean(),
    shareContact: z.boolean().optional(),
    reasonCode: z.enum(FEEDBACK_REASON_CODES).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const consentRevokeSchema = z.object({
  organizationId: z.string().trim().min(1).max(50),
  vacancyId: z.string().trim().min(1).max(50).optional(),
});

export const interviewConfirmSchema = z.object({
  chosenSlot: isoDatum,
});

export const notificationPreferenceSchema = z.object({
  type: z.enum([...NOTIFICATION_TYPES, "all"] as [string, ...string[]]),
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});

export const pushTokenSchema = z.object({
  token: z.string().trim().min(10).max(200),
  platform: z.enum(["ios", "android"]),
});

export const pushTokenDeleteSchema = z.object({
  token: z.string().trim().min(10).max(200),
});

export const accountDeleteSchema = z.object({
  confirm: z.literal("verwijderen", {
    errorMap: () => ({ message: 'Typ "verwijderen" om te bevestigen' }),
  }),
});
