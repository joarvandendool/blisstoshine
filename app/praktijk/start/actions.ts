"use server";

// Server actions voor de commerciële praktijkonboarding (/praktijk/start).
//
// Regels:
// - elke actie begint bij een geverifieerde identiteit (requireUser +
//   requireMembership via het eigen membership — nooit client-input);
// - alle invoer wordt met Zod gevalideerd tegen de taxonomie voordat de
//   servicelaag (src/server/onboarding) wordt aangeroepen;
// - analytics (onboarding_started / onboarding_step_completed / trial_started /
//   talent_radar_viewed / vacancy_published / practice_activated) wordt in de
//   servicelagen getrackt — hier niets dubbel loggen.

import { z } from "zod";
import {
  AuthzError,
  firstOrganizationOf,
  requireMembership,
  requireUser,
  type OrgContext,
} from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import {
  CONTRACT_TYPES,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
} from "@/domain/taxonomy";
import {
  bewaarOnboardingStap,
  onboardingRadar,
  publiceerOnboardingVacature,
  startPraktijkOnboarding,
  updatePraktijkStap,
  type OnboardingRadarData,
} from "@/server/onboarding";

/* ------------------------------------------------------------------ */
/* Resultaattypes richting de client                                    */
/* ------------------------------------------------------------------ */

export type StartStapResultaat =
  | { ok: true; slug: string }
  | { ok: false; fout: string };

export type StartRadarResultaat =
  | { ok: true; data: OnboardingRadarData }
  | { ok: false; fout: string };

export type StartPublicatieResultaat =
  | { ok: true; vacancyId: string; titel: string; slug: string }
  | { ok: false; fout: string; upgradeHint?: string; abonnementUrl?: string };

/* ------------------------------------------------------------------ */
/* Zod-schema's per stap                                               */
/* ------------------------------------------------------------------ */

const POSTCODE_PATROON = /^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/;

const praktijkSchema = z.object({
  stap: z.literal("praktijk"),
  name: z
    .string()
    .trim()
    .min(2, "Vul de naam van je praktijk in")
    .max(120, "De praktijknaam is te lang"),
  city: z
    .string()
    .trim()
    .min(2, "Vul de plaatsnaam in")
    .max(80, "De plaatsnaam is te lang"),
  postcode: z
    .string()
    .trim()
    .regex(POSTCODE_PATROON, "Vul een geldige postcode in, bijvoorbeeld 3511 AB"),
  treatmentRooms: z
    .number({ invalid_type_error: "Kies het aantal behandelkamers" })
    .int()
    .min(1, "Minimaal 1 behandelkamer")
    .max(50, "Controleer het aantal behandelkamers"),
  phone: z
    .string()
    .trim()
    .max(20, "Controleer het telefoonnummer")
    .nullable(),
});

const functieSchema = z.object({
  stap: z.literal("functie"),
  role: z.enum(ROLES, {
    errorMap: () => ({ message: "Kies welke functie je zoekt" }),
  }),
  // null = geen voorkeur voor ervaringsniveau
  experienceLevel: z
    .enum(EXPERIENCE_LEVELS, {
      errorMap: () => ({ message: "Kies een ervaringsniveau" }),
    })
    .nullable(),
});

const eisSchema = z.enum(["required", "preferred"]).nullable();
const roosterDagSchema = z.object({
  ochtend: eisSchema,
  middag: eisSchema,
  avond: eisSchema,
});
const roosterSchema = z.object({
  ma: roosterDagSchema,
  di: roosterDagSchema,
  wo: roosterDagSchema,
  do: roosterDagSchema,
  vr: roosterDagSchema,
  za: roosterDagSchema,
  zo: roosterDagSchema,
});

const werkdagenSchema = z.object({
  stap: z.literal("werkdagen"),
  schedule: roosterSchema,
});

const urenSchema = z.object({
  stap: z.literal("uren"),
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
  // Geboden omzetpercentage tot (zzp) — percentage, géén uurtarief.
  revenueShareMax: z
    .number()
    .int("Vul het omzetpercentage in hele procenten in")
    .min(0, "Het omzetpercentage kan niet negatief zijn")
    .max(100, "Het omzetpercentage kan niet boven de 100% liggen")
    .nullable(),
});

const uitrustingSchema = z.object({
  stap: z.literal("uitrusting"),
  equipment: z.array(z.enum(EQUIPMENT)),
  software: z.array(z.enum(SOFTWARE)),
  specializations: z.array(z.enum(SPECIALIZATIONS)),
  mentorship: z.boolean(),
});

const stapSchema = z.discriminatedUnion("stap", [
  praktijkSchema,
  functieSchema,
  werkdagenSchema,
  urenSchema,
  uitrustingSchema,
]);

type StapInvoer = z.infer<typeof stapSchema>;

/** Kruisveld-controles; geeft een Nederlandse foutmelding of null. */
function controleerSamenhang(d: StapInvoer): string | null {
  if (d.stap === "werkdagen") {
    const rijen = Object.values(d.schedule);
    const gevraagd = rijen.some((rij) => Object.values(rij).some((eis) => eis !== null));
    if (!gevraagd) return "Tik minstens één dagdeel aan waarop je iemand nodig hebt";
  }
  if (d.stap === "uren") {
    if (d.hoursMax < d.hoursMin) {
      return "Het maximum aantal uren ligt onder het minimum";
    }
    if (!d.contractTypes.includes("zzp") && d.revenueShareMax !== null) {
      return "Een omzetpercentage hoort alleen bij zzp";
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Hulpfunctie: geverifieerd membership van de eigen organisatie       */
/* ------------------------------------------------------------------ */

/** OrgContext + slug van de eerste (enige) organisatie van de gebruiker. */
async function eigenOrgContext(
  capability?: string,
): Promise<{ ctx: OrgContext; slug: string }> {
  const user = await requireUser();
  const membership = await firstOrganizationOf(user.id);
  if (!membership) {
    throw new AuthzError("Sla eerst de praktijkgegevens op (stap 1)", 400);
  }
  const ctx = await requireMembership(membership.organizationId, capability);
  return { ctx, slug: membership.organization.slug };
}

/* ------------------------------------------------------------------ */
/* Acties                                                              */
/* ------------------------------------------------------------------ */

/**
 * Autosave van één onboardingstap. Stap 1 (praktijk) maakt bij de eerste
 * opslag direct organisatie + locatie + membership + trial aan; alle verdere
 * stapdata gaat naar Organization.onboardingState.
 */
export async function saveStartStapAction(
  invoer: unknown,
): Promise<StartStapResultaat> {
  try {
    const user = await requireUser();
    const parsed = stapSchema.safeParse(invoer);
    if (!parsed.success) {
      return {
        ok: false,
        fout: parsed.error.errors[0]?.message ?? "Controleer je invoer",
      };
    }
    const samenhangFout = controleerSamenhang(parsed.data);
    if (samenhangFout) return { ok: false, fout: samenhangFout };
    const d = parsed.data;

    if (d.stap === "praktijk") {
      const membership = await firstOrganizationOf(user.id);
      const gegevens = {
        name: d.name,
        city: d.city,
        postcode: d.postcode.toUpperCase(),
        treatmentRooms: d.treatmentRooms,
        phone: d.phone === "" ? null : d.phone,
      };
      if (!membership) {
        const { organization } = await startPraktijkOnboarding(gegevens, user.id);
        return { ok: true, slug: organization.slug };
      }
      const ctx = await requireMembership(membership.organizationId, "org.manage");
      await updatePraktijkStap(ctx, gegevens);
      return { ok: true, slug: membership.organization.slug };
    }

    const { ctx, slug } = await eigenOrgContext("org.manage");
    switch (d.stap) {
      case "functie":
        await bewaarOnboardingStap(
          ctx,
          "functie",
          (state) => ({
            ...state,
            functie: { role: d.role, experienceLevel: d.experienceLevel },
          }),
          2,
        );
        break;
      case "werkdagen":
        await bewaarOnboardingStap(
          ctx,
          "werkdagen",
          (state) => ({ ...state, werkdagen: { schedule: d.schedule } }),
          3,
        );
        break;
      case "uren":
        await bewaarOnboardingStap(
          ctx,
          "uren",
          (state) => ({
            ...state,
            uren: {
              hoursMin: d.hoursMin,
              hoursMax: d.hoursMax,
              contractTypes: d.contractTypes,
              revenueShareMax: d.contractTypes.includes("zzp")
                ? d.revenueShareMax
                : null,
            },
          }),
          4,
        );
        break;
      case "uitrusting":
        await bewaarOnboardingStap(
          ctx,
          "uitrusting",
          (state) => ({
            ...state,
            uitrusting: {
              equipment: d.equipment,
              software: d.software,
              specializations: d.specializations,
              mentorship: d.mentorship,
            },
          }),
          5,
        );
        break;
    }
    return { ok: true, slug };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Onboardingstap niet opgeslagen:", fout);
    return { ok: false, fout: "Opslaan is niet gelukt. Probeer het opnieuw." };
  }
}

/**
 * Stap 6: Talent Radar op de ingevoerde behoefte — teaser voor iedereen,
 * volledig rapport waar de entitlement het toestaat, plus maximaal drie
 * aanbevelingen met live effect. Er wordt niets opgeslagen behalve de
 * "radar bekeken"-markering (voor de activatiecheck).
 */
export async function startRadarAction(): Promise<StartRadarResultaat> {
  try {
    const { ctx } = await eigenOrgContext();
    const data = await onboardingRadar(ctx);
    return { ok: true, data };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Talent Radar in onboarding mislukt:", fout);
    return {
      ok: false,
      fout: "Het marktinzicht kon niet worden berekend. Probeer het opnieuw.",
    };
  }
}

/**
 * Stap 7: maakt van de behoefte een echte vacature en publiceert die.
 * Bij een EntitlementError krijgt de client een nette melding met link naar
 * de abonnementspagina.
 */
export async function publiceerStartVacatureAction(): Promise<StartPublicatieResultaat> {
  let slug: string;
  let ctx: OrgContext;
  try {
    ({ ctx, slug } = await eigenOrgContext());
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    throw fout;
  }
  try {
    const resultaat = await publiceerOnboardingVacature(ctx);
    return { ok: true, ...resultaat, slug };
  } catch (fout) {
    if (fout instanceof EntitlementError) {
      return {
        ok: false,
        fout: fout.message,
        upgradeHint: fout.upgradeHint,
        abonnementUrl: `/praktijk/${slug}/abonnement`,
      };
    }
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Vacature publiceren in onboarding mislukt:", fout);
    return {
      ok: false,
      fout: "Publiceren is niet gelukt. Probeer het opnieuw.",
    };
  }
}
