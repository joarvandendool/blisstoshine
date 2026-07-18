"use server";

// Server actions van de Praktijkbezetting:
// - bewaarTeamlidAction / verwijderTeamlidAction: teambeheer (incl.
//   contracturen, dienstverband, start- en einddatum);
// - bewaarAfwezigheidAction / verwijderAfwezigheidAction: TeamAbsence-CRUD;
// - bewaarMinimumAction: het gewenste minimum per weekdag+dagdeel, totaal of
//   per functie;
// - maakPersoneelsbehoefteAction: geselecteerde gaten → conceptvacature;
// - runScenarioAction / bevestigScenarioAction / verwerpScenarioAction:
//   staffing-scenario's (immutable tot bevestiging).
//
// Elke actie begint bij getOrgForUserBySlug (geverifieerd membership =
// tenantisolatie); capabilities en locatie-checks zitten in de servicelaag
// (src/server/capacity.ts). Alle invoer wordt eerst met Zod gevalideerd.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  ABSENCE_KINDS,
  EMPLOYMENT_TYPES,
  SCENARIO_KINDS,
  addAbsence,
  confirmScenario,
  deleteAbsence,
  deleteTeamMember,
  gapToVacancyDraft,
  rejectScenario,
  runScenario,
  saveStaffingTarget,
  upsertTeamMember,
  type RoleStaffingTargets,
  type ScenarioSamenvatting,
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

export type ScenarioActieResultaat =
  | {
      ok: true;
      scenarioId: string;
      before: ScenarioSamenvatting;
      after: ScenarioSamenvatting;
      afterGaps: number;
    }
  | { ok: false; fout: string };

export type BevestigResultaat =
  | { ok: true; type: "vacature"; vacancyId: string; titel: string }
  | { ok: true; type: "uitnodigingen"; kandidaten: number }
  | { ok: true; type: "rapport" }
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

const datumVeld = z.string().regex(DATUM_PATROON, "Ongeldige datum").nullable();

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
  contractHours: z
    .number()
    .int("Contracturen zijn hele uren")
    .min(0, "Contracturen kunnen niet negatief zijn")
    .max(60, "Contracturen kunnen maximaal 60 zijn")
    .nullable(),
  employmentType: z
    .enum(EMPLOYMENT_TYPES, {
      errorMap: () => ({ message: "Kies een dienstverband uit de lijst" }),
    })
    .nullable(),
  startDate: datumVeld,
  endDate: datumVeld,
  note: z
    .string()
    .trim()
    .max(300, "De notitie mag maximaal 300 tekens zijn")
    .nullable(),
});

const afwezigheidSchema = z.object({
  teamMemberId: z.string().min(1, "Teamlid onbekend"),
  kind: z.enum(ABSENCE_KINDS, {
    errorMap: () => ({ message: "Kies een soort afwezigheid" }),
  }),
  from: z.string().regex(DATUM_PATROON, "Ongeldige startdatum"),
  until: datumVeld,
  note: z.string().trim().max(300, "De notitie mag maximaal 300 tekens zijn").nullable(),
});

const dagdeelAantallen = z.object({
  ochtend: z.number().int().min(0).max(99),
  middag: z.number().int().min(0).max(99),
  avond: z.number().int().min(0).max(99),
});

const weekTargetSchema = z.object({
  ma: dagdeelAantallen,
  di: dagdeelAantallen,
  wo: dagdeelAantallen,
  do: dagdeelAantallen,
  vr: dagdeelAantallen,
  za: dagdeelAantallen,
  zo: dagdeelAantallen,
});

const minimumSchema = z.object({
  locationId: z.string().min(1, "Locatie onbekend"),
  /** Totaal (oude vorm) óf per functie (nieuwe vorm { rol: weektarget }). */
  target: z.union([weekTargetSchema, z.record(z.enum(ROLES), weekTargetSchema)]),
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

const scenarioSchema = z.object({
  locationId: z.string().min(1, "Locatie onbekend"),
  kind: z.enum(SCENARIO_KINDS, {
    errorMap: () => ({ message: "Kies een scenariotype" }),
  }),
  name: z.string().trim().max(120).optional(),
  teamMemberId: z.string().min(1).optional(),
  from: z.string().regex(DATUM_PATROON).optional(),
  until: z.string().regex(DATUM_PATROON).optional(),
  extraRooms: z.number().int().min(1).max(10).optional(),
  role: z.enum(ROLES).optional(),
  day: z.enum(WEEKDAYS).optional(),
  dayparts: z.array(z.enum(DAYPARTS)).max(3).optional(),
  extraTarget: z.number().int().min(1).max(10).optional(),
  gaps: z
    .array(z.object({ day: z.enum(WEEKDAYS), daypart: z.enum(DAYPARTS) }))
    .max(21)
    .optional(),
  schedule: teamRoosterSchema.optional(),
  targetLocationId: z.string().min(1).optional(),
  treatmentRooms: z.number().int().min(1).max(25).optional(),
});

const bevestigSchema = z.object({
  scenarioId: z.string().min(1, "Scenario onbekend"),
  outcome: z.enum(["vacature", "uitnodigingen", "rapport"]).optional(),
});

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function foutmelding(fout: unknown, standaard: string): string {
  if (fout instanceof AuthzError) return fout.message;
  if (fout instanceof EntitlementError) return `${fout.message} ${fout.upgradeHint}`;
  return standaard;
}

function logOnverwacht(fout: unknown, actie: string): void {
  if (!(fout instanceof AuthzError) && !(fout instanceof EntitlementError)) {
    console.error(`${actie} mislukt:`, fout);
  }
}

/** "YYYY-MM-DD" → Date (lokale middernacht); null blijft null. */
function naarDatum(waarde: string | null | undefined): Date | null {
  if (waarde === null || waarde === undefined) return null;
  const datum = new Date(`${waarde}T00:00:00`);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/* ------------------------------------------------------------------ */
/* Team-acties                                                         */
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
  if (d.startDate !== null && d.endDate !== null && d.endDate < d.startDate) {
    return { ok: false, fout: "De einddatum ligt vóór de startdatum" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await upsertTeamMember(ctx, d.locationId, {
      id: d.id,
      name: d.name,
      role: d.role,
      schedule: d.schedule as TeamSchedule,
      contractHours: d.contractHours,
      employmentType: d.employmentType,
      startDate: naarDatum(d.startDate),
      endDate: naarDatum(d.endDate),
      note: d.note,
    });
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    logOnverwacht(fout, "Teamlid opslaan");
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
    logOnverwacht(fout, "Teamlid verwijderen");
    return {
      ok: false,
      fout: foutmelding(fout, "Verwijderen is niet gelukt. Probeer het opnieuw."),
    };
  }
}

/** Afwezigheidsperiode toevoegen (soort verlof|ziekte|zwangerschapsverlof|anders). */
export async function bewaarAfwezigheidAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = afwezigheidSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  const d = parsed.data;
  if (d.until !== null && d.until < d.from) {
    return { ok: false, fout: "De einddatum van de afwezigheid ligt vóór de startdatum" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    const from = naarDatum(d.from);
    if (!from) return { ok: false, fout: "Ongeldige startdatum" };
    await addAbsence(ctx, d.teamMemberId, {
      kind: d.kind,
      from,
      until: naarDatum(d.until),
      note: d.note,
    });
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    logOnverwacht(fout, "Afwezigheid opslaan");
    return { ok: false, fout: foutmelding(fout, "Opslaan is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Afwezigheidsperiode verwijderen. */
export async function verwijderAfwezigheidAction(
  slug: string,
  absenceId: string,
): Promise<ActieResultaat> {
  if (!absenceId) return { ok: false, fout: "Afwezigheid onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await deleteAbsence(ctx, absenceId);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    logOnverwacht(fout, "Afwezigheid verwijderen");
    return {
      ok: false,
      fout: foutmelding(fout, "Verwijderen is niet gelukt. Probeer het opnieuw."),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Gewenst minimum                                                     */
/* ------------------------------------------------------------------ */

/** Gewenst minimum per weekdag+dagdeel opslaan (totaal of per functie). */
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
    await saveStaffingTarget(
      ctx,
      parsed.data.locationId,
      parsed.data.target as StaffingTarget | RoleStaffingTargets,
    );
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    logOnverwacht(fout, "Minimum opslaan");
    return { ok: false, fout: foutmelding(fout, "Opslaan is niet gelukt. Probeer het opnieuw.") };
  }
}

/* ------------------------------------------------------------------ */
/* Personeelsbehoefte                                                  */
/* ------------------------------------------------------------------ */

/**
 * Geselecteerde bezettingsgaten → conceptvacature. De servicelaag
 * (gapToVacancyDraft → createDraftVacancy) bewaakt capability en
 * tenantisolatie en trackt de bijbehorende events.
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
    logOnverwacht(fout, "Personeelsbehoefte aanmaken");
    return {
      ok: false,
      fout: foutmelding(fout, "Het concept is niet aangemaakt. Probeer het opnieuw."),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Staffing-scenario's                                                 */
/* ------------------------------------------------------------------ */

/** Draait een scenario en slaat het immutabel op (status "simulatie"). */
export async function runScenarioAction(
  slug: string,
  invoer: unknown,
): Promise<ScenarioActieResultaat> {
  const parsed = scenarioSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  const d = parsed.data;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    const uitkomst = await runScenario(ctx, d.locationId, {
      kind: d.kind,
      name: d.name,
      teamMemberId: d.teamMemberId,
      from: naarDatum(d.from),
      until: naarDatum(d.until),
      extraRooms: d.extraRooms,
      role: d.role,
      day: d.day,
      dayparts: d.dayparts,
      extraTarget: d.extraTarget,
      gaps: d.gaps,
      schedule: d.schedule as TeamSchedule | undefined,
      targetLocationId: d.targetLocationId,
      treatmentRooms: d.treatmentRooms,
    });
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return {
      ok: true,
      scenarioId: uitkomst.scenario.id,
      before: uitkomst.before,
      after: uitkomst.after,
      afterGaps: uitkomst.afterGaps.length,
    };
  } catch (fout) {
    logOnverwacht(fout, "Scenario draaien");
    return {
      ok: false,
      fout: foutmelding(fout, "Het scenario is niet gedraaid. Probeer het opnieuw."),
    };
  }
}

/** Bevestigt een scenario en voert de gekozen uitkomst uit. */
export async function bevestigScenarioAction(
  slug: string,
  invoer: unknown,
): Promise<BevestigResultaat> {
  const parsed = bevestigSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    const uitkomst = await confirmScenario(ctx, parsed.data.scenarioId, parsed.data.outcome);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    revalidatePath(`/praktijk/${slug}`);
    if (uitkomst.type === "vacature") {
      return {
        ok: true,
        type: "vacature",
        vacancyId: uitkomst.vacancy.id,
        titel: uitkomst.vacancy.title,
      };
    }
    if (uitkomst.type === "uitnodigingen") {
      return {
        ok: true,
        type: "uitnodigingen",
        kandidaten: uitkomst.candidateProfileIds.length,
      };
    }
    return { ok: true, type: "rapport" };
  } catch (fout) {
    logOnverwacht(fout, "Scenario bevestigen");
    return {
      ok: false,
      fout: foutmelding(fout, "Bevestigen is niet gelukt. Probeer het opnieuw."),
    };
  }
}

/** Verwerpt een scenario. */
export async function verwerpScenarioAction(
  slug: string,
  scenarioId: string,
): Promise<ActieResultaat> {
  if (!scenarioId) return { ok: false, fout: "Scenario onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await rejectScenario(ctx, scenarioId);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    logOnverwacht(fout, "Scenario verwerpen");
    return {
      ok: false,
      fout: foutmelding(fout, "Verwerpen is niet gelukt. Probeer het opnieuw."),
    };
  }
}
