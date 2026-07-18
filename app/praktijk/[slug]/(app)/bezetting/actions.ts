"use server";

// Server actions van de Praktijkbezetting:
// - bewaarTeamlidAction / verwijderTeamlidAction: teambeheer;
// - bewaarMinimumAction: het gewenste minimum per weekdag+dagdeel;
// - maakPersoneelsbehoefteAction: geselecteerde gaten → conceptvacature
//   (gapToVacancyDraft trackt capacity_gap_to_vacancy in de servicelaag).
//
// Elke actie begint bij getOrgForUserBySlug (geverifieerd membership =
// tenantisolatie); capabilities en locatie-checks zitten in de servicelaag
// (src/server/capacity.ts). Alle invoer wordt eerst met Zod gevalideerd.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  deleteTeamMember,
  gapToVacancyDraft,
  saveStaffingTarget,
  upsertTeamMember,
  type StaffingTarget,
  type TeamSchedule,
} from "@/server/capacity";
import { DAYPARTS, ROLES, WEEKDAYS } from "@/domain/taxonomy";

/* ------------------------------------------------------------------ */
/* Resultaattypes richting de client                                   */
/* ------------------------------------------------------------------ */

export type ActieResultaat = { ok: true } | { ok: false; fout: string };

export type ConceptResultaat =
  | { ok: true; vacancyId: string; titel: string }
  | { ok: false; fout: string };

/* ------------------------------------------------------------------ */
/* Zod-schema's                                                        */
/* ------------------------------------------------------------------ */

const DATUM_PATROON = /^\d{4}-\d{2}-\d{2}$/;

const dagdeelBooleans = z.object({
  ochtend: z.boolean(),
  middag: z.boolean(),
  avond: z.boolean(),
});

const teamRoosterSchema = z.object({
  ma: dagdeelBooleans,
  di: dagdeelBooleans,
  wo: dagdeelBooleans,
  do: dagdeelBooleans,
  vr: dagdeelBooleans,
  za: dagdeelBooleans,
  zo: dagdeelBooleans,
});

const teamlidSchema = z.object({
  id: z.string().min(1).optional(),
  locationId: z.string().min(1, "Locatie onbekend"),
  name: z
    .string()
    .trim()
    .min(2, "Vul de naam van het teamlid in")
    .max(120, "De naam is te lang"),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Kies een functie uit de lijst" }) }),
  schedule: teamRoosterSchema,
  absentFrom: z.string().regex(DATUM_PATROON, "Ongeldige startdatum").nullable(),
  absentUntil: z.string().regex(DATUM_PATROON, "Ongeldige einddatum").nullable(),
  note: z
    .string()
    .trim()
    .max(300, "De notitie mag maximaal 300 tekens zijn")
    .nullable(),
});

const dagdeelAantallen = z.object({
  ochtend: z.number().int().min(0).max(99),
  middag: z.number().int().min(0).max(99),
  avond: z.number().int().min(0).max(99),
});

const minimumSchema = z.object({
  locationId: z.string().min(1, "Locatie onbekend"),
  target: z.object({
    ma: dagdeelAantallen,
    di: dagdeelAantallen,
    wo: dagdeelAantallen,
    do: dagdeelAantallen,
    vr: dagdeelAantallen,
    za: dagdeelAantallen,
    zo: dagdeelAantallen,
  }),
});

const behoefteSchema = z.object({
  locationId: z.string().min(1, "Locatie onbekend"),
  role: z.enum(ROLES, { errorMap: () => ({ message: "Kies een functie uit de lijst" }) }),
  gaps: z
    .array(
      z.object({
        day: z.enum(WEEKDAYS),
        daypart: z.enum(DAYPARTS),
      }),
    )
    .min(1, "Selecteer minstens één dagdeel")
    .max(21, "Selecteer maximaal 21 dagdelen"),
});

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function foutmelding(fout: unknown, standaard: string): string {
  return fout instanceof AuthzError ? fout.message : standaard;
}

/** "YYYY-MM-DD" → Date (lokale middernacht); null blijft null. */
function naarDatum(waarde: string | null): Date | null {
  if (waarde === null) return null;
  const datum = new Date(`${waarde}T00:00:00`);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/* ------------------------------------------------------------------ */
/* Acties                                                              */
/* ------------------------------------------------------------------ */

/** Teamlid toevoegen of bijwerken (id bepaalt welke van de twee). */
export async function bewaarTeamlidAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = teamlidSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  const d = parsed.data;
  if (d.absentFrom !== null && d.absentUntil !== null && d.absentUntil < d.absentFrom) {
    return { ok: false, fout: "De einddatum van de afwezigheid ligt vóór de startdatum" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await upsertTeamMember(ctx, d.locationId, {
      id: d.id,
      name: d.name,
      role: d.role,
      schedule: d.schedule as TeamSchedule,
      absentFrom: naarDatum(d.absentFrom),
      absentUntil: naarDatum(d.absentUntil),
      note: d.note,
    });
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    if (!(fout instanceof AuthzError)) console.error("Teamlid opslaan mislukt:", fout);
    return { ok: false, fout: foutmelding(fout, "Opslaan is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Teamlid verwijderen. */
export async function verwijderTeamlidAction(
  slug: string,
  teamlidId: string,
): Promise<ActieResultaat> {
  if (!teamlidId) return { ok: false, fout: "Teamlid onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await deleteTeamMember(ctx, teamlidId);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    if (!(fout instanceof AuthzError)) console.error("Teamlid verwijderen mislukt:", fout);
    return {
      ok: false,
      fout: foutmelding(fout, "Verwijderen is niet gelukt. Probeer het opnieuw."),
    };
  }
}

/** Gewenst minimum per weekdag+dagdeel opslaan. */
export async function bewaarMinimumAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = minimumSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await saveStaffingTarget(ctx, parsed.data.locationId, parsed.data.target as StaffingTarget);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    if (!(fout instanceof AuthzError)) console.error("Minimum opslaan mislukt:", fout);
    return { ok: false, fout: foutmelding(fout, "Opslaan is niet gelukt. Probeer het opnieuw.") };
  }
}

/**
 * Geselecteerde bezettingsgaten → conceptvacature. De servicelaag
 * (gapToVacancyDraft → createDraftVacancy) bewaakt capability en
 * tenantisolatie en trackt capacity_gap_to_vacancy.
 */
export async function maakPersoneelsbehoefteAction(
  slug: string,
  invoer: unknown,
): Promise<ConceptResultaat> {
  const parsed = behoefteSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je selectie" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");
    const vacature = await gapToVacancyDraft(ctx, parsed.data.locationId, {
      role: parsed.data.role,
      gaps: parsed.data.gaps,
    });
    revalidatePath(`/praktijk/${slug}/bezetting`);
    revalidatePath(`/praktijk/${slug}`);
    return { ok: true, vacancyId: vacature.id, titel: vacature.title };
  } catch (fout) {
    if (!(fout instanceof AuthzError)) {
      console.error("Personeelsbehoefte aanmaken mislukt:", fout);
    }
    return {
      ok: false,
      fout: foutmelding(fout, "Het concept is niet aangemaakt. Probeer het opnieuw."),
    };
  }
}
