"use server";

// Server actions voor de vacaturewizard.
//
// Regels:
// - elke actie begint met getOrgForUserBySlug (autorisatie + tenantisolatie
//   uit @/lib/authz via de servicelaag);
// - alle invoer wordt met Zod gevalideerd tegen de taxonomie voordat de
//   servicelaag (src/server/vacancies, src/server/radar) wordt aangeroepen;
// - analytics (vacancy_started bij het aanmaken van het concept in stap 1,
//   vacancy_published, talent_radar_viewed) wordt in de servicelaag getrackt —
//   hier niets dubbel loggen;
// - entitlements lopen uitsluitend via @/lib/billing: publishVacancy gooit een
//   EntitlementError die hier wordt vertaald naar een vriendelijke melding.

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  createDraftVacancy,
  publishVacancy,
  updateVacancy,
  type VacancyInput,
} from "@/server/vacancies";
import {
  radarForVacancy,
  radarTeaser,
  type TalentRadarReport,
} from "@/server/radar";
import {
  CONTRACT_TYPES,
  CULTURE,
  DEVELOPMENT,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PATIENT_POPULATION,
  REGISTRATIONS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  TREATMENTS,
  WEEKDAYS,
  DAYPARTS,
  type VacancyCriteria,
} from "@/domain/taxonomy";

/* ------------------------------------------------------------------ */
/* Resultaattypes richting de client                                   */
/* ------------------------------------------------------------------ */

export type StartResultaat =
  | { ok: true; vacancyId: string }
  | { ok: false; fout: string };

export type StapResultaat = { ok: true } | { ok: false; fout: string };

export interface RadarPreview {
  /** Totaal potentieel (teaser) — voor iedereen, ongeacht plan. */
  teaser: { totalPotential: number | null; minGroupSize: number };
  /** Volledig rapport; null zonder talent_radar-entitlement. */
  rapport: TalentRadarReport | null;
}

export type RadarResultaat =
  | ({ ok: true } & RadarPreview)
  | { ok: false; fout: string };

/** Bij succes wordt geredirect; alleen fouten komen als waarde terug. */
export type PubliceerResultaat = {
  ok: false;
  fout: string;
  /** true wanneer het abonnement de publicatie blokkeert (limiet/feature). */
  limietBereikt: boolean;
  upgradeHint?: string;
};

/* ------------------------------------------------------------------ */
/* Zod-schema's per stap                                               */
/* ------------------------------------------------------------------ */

const DATUM_PATROON = /^\d{4}-\d{2}-\d{2}$/;

const basisSchema = z.object({
  stap: z.literal("basis"),
  locationId: z.string().min(1, "Kies een locatie"),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Kies een functie uit de lijst" }) }),
  title: z
    .string()
    .trim()
    .min(3, "Geef de vacature een titel")
    .max(120, "De titel is te lang"),
  experienceLevel: z
    .enum(EXPERIENCE_LEVELS, {
      errorMap: () => ({ message: "Kies een ervaringsniveau" }),
    })
    .nullable(),
  description: z
    .string()
    .trim()
    .max(2000, "De omschrijving mag maximaal 2000 tekens zijn")
    .nullable(),
});

const eisWaarde = z.union([z.literal("required"), z.literal("preferred"), z.null()], {
  errorMap: () => ({ message: "Ongeldige roosterwaarde" }),
});

const dagdelenSchema = z.object({
  ochtend: eisWaarde,
  middag: eisWaarde,
  avond: eisWaarde,
});

const roosterSchema = z.object({
  ma: dagdelenSchema,
  di: dagdelenSchema,
  wo: dagdelenSchema,
  do: dagdelenSchema,
  vr: dagdelenSchema,
  za: dagdelenSchema,
  zo: dagdelenSchema,
});

const werkweekSchema = z.object({
  stap: z.literal("werkweek"),
  schedule: roosterSchema,
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
  startBy: z.string().regex(DATUM_PATROON, "Ongeldige startdatum").nullable(),
  startByHard: z.boolean(),
  // salarissen in hele euro's (client) — hieronder omgerekend naar centen;
  // het omzetpercentage (zzp) blijft een geheel getal in procenten
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
  revenueShareMax: z
    .number()
    .int("Vul het omzetpercentage in hele procenten in")
    .min(0, "Het omzetpercentage kan niet negatief zijn")
    .max(100, "Het omzetpercentage kan niet boven de 100% liggen")
    .nullable(),
});

const criteriumNiveau = z.enum(["required", "preferred", "informational"], {
  errorMap: () => ({ message: "Kies per groep een niveau" }),
});

function criteriumSpec(opties: readonly [string, ...string[]]) {
  return z.object({
    values: z.array(z.enum(opties)),
    level: criteriumNiveau,
  });
}

const eisenSchema = z.object({
  stap: z.literal("eisen"),
  registrations: criteriumSpec(REGISTRATIONS),
  equipment: criteriumSpec(EQUIPMENT),
  software: criteriumSpec(SOFTWARE),
  specializations: criteriumSpec(SPECIALIZATIONS),
  treatments: criteriumSpec(TREATMENTS),
  population: criteriumSpec(PATIENT_POPULATION),
  culture: z.array(z.enum(CULTURE)),
  mentorship: z.boolean(),
  development: z.array(z.enum(DEVELOPMENT)),
});

const stapSchema = z.discriminatedUnion("stap", [
  basisSchema,
  werkweekSchema,
  eisenSchema,
]);

type StapInvoer = z.infer<typeof stapSchema>;
type BasisInvoer = z.infer<typeof basisSchema>;

/* ------------------------------------------------------------------ */
/* Extra samenhang en mapping naar het servicecontract                 */
/* ------------------------------------------------------------------ */

/** Kruisveld-controles per stap; geeft een Nederlandse foutmelding of null. */
function controleerSamenhang(d: StapInvoer): string | null {
  if (d.stap === "werkweek") {
    const gevraagd = WEEKDAYS.some((dag) =>
      DAYPARTS.some((deel) => d.schedule[dag][deel] !== null),
    );
    if (!gevraagd) {
      return "Tik minstens één dagdeel aan dat je nodig hebt of gewenst vindt";
    }
    if (d.hoursMax < d.hoursMin) {
      return "Het maximum aantal uren ligt onder het minimum";
    }
    if (d.salaryMin !== null && d.salaryMax !== null && d.salaryMax < d.salaryMin) {
      return "Het maximumsalaris ligt onder het minimum";
    }
    if (d.startBy !== null && Number.isNaN(new Date(d.startBy).getTime())) {
      return "Ongeldige startdatum";
    }
  }
  return null;
}

const naarCenten = (euro: number | null): number | null =>
  euro === null ? null : Math.round(euro * 100);

/** Stapinvoer → Partial<VacancyInput> voor updateVacancy. */
function naarVacancyUpdate(d: StapInvoer): Partial<VacancyInput> {
  switch (d.stap) {
    case "basis":
      return {
        locationId: d.locationId,
        role: d.role,
        title: d.title,
        experienceLevel: d.experienceLevel,
        description: d.description,
      };
    case "werkweek":
      return {
        schedule: d.schedule,
        hoursMin: d.hoursMin,
        hoursMax: d.hoursMax,
        contractTypes: d.contractTypes,
        startBy: d.startBy === null ? null : new Date(d.startBy),
        startByHard: d.startByHard,
        salaryMin: naarCenten(d.salaryMin),
        salaryMax: naarCenten(d.salaryMax),
        // percentage, geen bedrag — dus géén centen-conversie
        revenueShareMax: d.revenueShareMax,
      };
    case "eisen": {
      // Alleen groepen met gekozen waarden komen in de criteria terecht.
      const criteria: VacancyCriteria = {};
      const groepen = [
        ["registrations", d.registrations],
        ["equipment", d.equipment],
        ["software", d.software],
        ["specializations", d.specializations],
        ["treatments", d.treatments],
        ["population", d.population],
      ] as const;
      for (const [sleutel, spec] of groepen) {
        if (spec.values.length > 0) {
          criteria[sleutel] = { values: spec.values, level: spec.level };
        }
      }
      return {
        criteria,
        culture: d.culture,
        mentorship: d.mentorship,
        development: d.development,
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Acties                                                              */
/* ------------------------------------------------------------------ */

/**
 * Stap 1 afgerond: maakt het concept aan (createDraftVacancy trackt
 * vacancy_started) en geeft het vacature-id terug voor de vervolgstappen.
 * Uren krijgen een neutrale standaard; stap 2 werkt ze bij.
 */
export async function startVacatureAction(
  slug: string,
  invoer: unknown,
): Promise<StartResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");

    const parsed = basisSchema.safeParse(invoer);
    if (!parsed.success) {
      return {
        ok: false,
        fout: parsed.error.errors[0]?.message ?? "Controleer je invoer",
      };
    }
    const d: BasisInvoer = parsed.data;

    const vacature = await createDraftVacancy(ctx, {
      locationId: d.locationId,
      title: d.title,
      role: d.role,
      description: d.description,
      experienceLevel: d.experienceLevel,
      hoursMin: 24,
      hoursMax: 32,
    });
    return { ok: true, vacancyId: vacature.id };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Vacatureconcept aanmaken mislukt:", fout);
    return {
      ok: false,
      fout: "Het aanmaken van de vacature is niet gelukt. Probeer het opnieuw.",
    };
  }
}

/** Slaat één wizardstap op in het bestaande concept. */
export async function bewaarStapAction(
  slug: string,
  vacancyId: string,
  invoer: unknown,
): Promise<StapResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");

    const parsed = stapSchema.safeParse(invoer);
    if (!parsed.success) {
      return {
        ok: false,
        fout: parsed.error.errors[0]?.message ?? "Controleer je invoer",
      };
    }
    const samenhangFout = controleerSamenhang(parsed.data);
    if (samenhangFout) return { ok: false, fout: samenhangFout };

    await updateVacancy(ctx, vacancyId, naarVacancyUpdate(parsed.data));
    return { ok: true };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Wizardstap niet opgeslagen:", fout);
    return { ok: false, fout: "Opslaan is niet gelukt. Probeer het opnieuw." };
  }
}

/**
 * Talent Radar-preview vóór publicatie: de teaser (totaal potentieel) is er
 * voor iedereen; het volledige rapport alleen met de talent_radar-entitlement
 * — zonder die entitlement blijft rapport null en toont de wizard een
 * upgrade-hint.
 */
export async function radarPreviewAction(
  slug: string,
  vacancyId: string,
): Promise<RadarResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");

    const teaser = await radarTeaser(ctx, { vacancyId });

    let rapport: TalentRadarReport | null = null;
    try {
      rapport = await radarForVacancy(ctx, { vacancyId });
    } catch (fout) {
      if (!(fout instanceof EntitlementError)) throw fout;
      // Geen talent_radar in het huidige plan: alleen de teaser tonen.
    }

    return { ok: true, teaser, rapport };
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Talent Radar-preview mislukt:", fout);
    return {
      ok: false,
      fout: "De arbeidsmarktcijfers konden niet worden geladen. Probeer het opnieuw.",
    };
  }
}

/**
 * Publiceert de vacature en stuurt door naar het dashboard. Een
 * EntitlementError (vacaturelimiet van het abonnement) wordt vertaald naar
 * een vriendelijke melding; de wizard toont daarbij een link naar
 * /praktijk/[slug]/abonnement.
 */
export async function publiceerVacatureAction(
  slug: string,
  vacancyId: string,
): Promise<PubliceerResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.publish");
    await publishVacancy(ctx, vacancyId);
  } catch (fout) {
    if (fout instanceof EntitlementError) {
      return {
        ok: false,
        fout: fout.message,
        limietBereikt: true,
        upgradeHint: fout.upgradeHint,
      };
    }
    if (fout instanceof AuthzError) {
      return { ok: false, fout: fout.message, limietBereikt: false };
    }
    console.error("Vacature publiceren mislukt:", fout);
    return {
      ok: false,
      fout: "Publiceren is niet gelukt. Probeer het opnieuw.",
      limietBereikt: false,
    };
  }
  redirect(`/praktijk/${slug}`);
}
