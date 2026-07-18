"use server";

// Server actions van de Match Studio:
// - saveScheduleChanges: gesimuleerde wijzigingen persisteren, uitsluitend na
//   expliciete bevestiging in de UI (updateVacancy + auditregel);
// - inviteCandidateAction: kandidaat uitnodigen (servicelaag legt maandlimiet,
//   snapshot, analytics en audit vast);
// - trackOpportunityViewedAction: het opportunity_viewed-event bij het openen
//   van het kandidaatdetail.
//
// Elke actie begint bij getOrgForUserBySlug (geverifieerd membership =
// tenantisolatie) en dwingt entitlements uitsluitend via @/lib/billing af.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { EntitlementError, enforceEntitlement } from "@/lib/billing";
import { audit } from "@/lib/audit";
import { track } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { getOrgForUserBySlug, planCodeVoorAnalytics } from "@/server/organizations";
import { updateVacancy } from "@/server/vacancies";
import { inviteCandidate } from "@/server/invitations";
import type { VacancySchedule } from "@/domain/taxonomy";
import type { MatchLabel } from "@/domain/matching";

// ---------------------------------------------------------------------------
// Validatie
// ---------------------------------------------------------------------------

const eisSchema = z.union([
  z.literal("required"),
  z.literal("preferred"),
  z.null(),
]);

const dagSchema = z.object({
  ochtend: eisSchema,
  middag: eisSchema,
  avond: eisSchema,
});

const roosterSchema = z.object({
  ma: dagSchema,
  di: dagSchema,
  wo: dagSchema,
  do: dagSchema,
  vr: dagSchema,
  za: dagSchema,
  zo: dagSchema,
});

const wijzigingenSchema = z
  .object({
    schedule: roosterSchema,
    hoursMin: z.number().int().min(0).max(80),
    hoursMax: z.number().int().min(0).max(80),
    mentorship: z.boolean(),
  })
  .refine((w) => w.hoursMin <= w.hoursMax, {
    message: "Het minimum aantal uren mag niet boven het maximum liggen",
  });

const uitnodigSchema = z.object({
  vacancyId: z.string().min(1, "Vacature onbekend"),
  candidateUserId: z.string().min(1, "Kandidaat onbekend"),
  bericht: z
    .string()
    .trim()
    .max(1000, "Je bericht mag maximaal 1000 tekens zijn"),
});

// ---------------------------------------------------------------------------
// Wijzigingen opslaan
// ---------------------------------------------------------------------------

export type OpslaanResultaat = { ok: true } | { ok: false; melding: string };

/**
 * Persisteert de gesimuleerde vacature-instellingen (rooster, urenrange,
 * begeleiding) nadat de gebruiker de wijzigingen expliciet heeft bevestigd.
 * Alle domeincontroles (capability vacancy.manage, tenantisolatie) zitten in
 * getOrgForUserBySlug en updateVacancy; hier komt de auditregel bij.
 */
export async function saveScheduleChanges(
  slug: string,
  vacancyId: string,
  invoer: unknown,
): Promise<OpslaanResultaat> {
  const parsed = wijzigingenSchema.safeParse(invoer);
  if (!parsed.success) {
    return {
      ok: false,
      melding: parsed.error.errors[0]?.message ?? "Controleer je wijzigingen",
    };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");

    // Wijzigingen uit de simulatiestand doorvoeren hoort bij de volledige
    // Match Studio — dezelfde entitlement als het simuleren zelf.
    await enforceEntitlement(ctx.organizationId, "match_studio_full");

    await updateVacancy(ctx, vacancyId, {
      schedule: parsed.data.schedule as VacancySchedule,
      hoursMin: parsed.data.hoursMin,
      hoursMax: parsed.data.hoursMax,
      mentorship: parsed.data.mentorship,
    });

    await audit("vacancy.update_from_studio", "Vacancy", vacancyId, {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      meta: {
        hoursMin: parsed.data.hoursMin,
        hoursMax: parsed.data.hoursMax,
        mentorship: parsed.data.mentorship,
      },
    });

    revalidatePath(`/praktijk/${slug}/vacatures/${vacancyId}/studio`);
    return { ok: true };
  } catch (fout) {
    if (fout instanceof EntitlementError) {
      return { ok: false, melding: `${fout.message} ${fout.upgradeHint}` };
    }
    if (fout instanceof AuthzError) {
      return { ok: false, melding: fout.message };
    }
    console.error("Match Studio: wijzigingen opslaan mislukt:", fout);
    return {
      ok: false,
      melding: "Het opslaan is niet gelukt. Probeer het opnieuw.",
    };
  }
}

// ---------------------------------------------------------------------------
// Kandidaat uitnodigen
// ---------------------------------------------------------------------------

export type UitnodigResultaat =
  | {
      ok: true;
      /** Vastgelegde snapshot-score op het beslismoment (null bij ontbreken). */
      score: number | null;
      label: MatchLabel | null;
    }
  | { ok: false; soort: "limiet"; melding: string; upgradeHint: string }
  | { ok: false; soort: "fout"; melding: string };

/**
 * Nodigt een kandidaat uit vanuit het kandidaatdetail. De servicelaag
 * (inviteCandidate) bewaakt de maandlimiet, legt een MatchSnapshot vast en
 * verzorgt analytics en audit. Een EntitlementError (limiet bereikt) wordt
 * vertaald naar een nette limietmelding met upgrade-hint voor de UI.
 */
export async function inviteCandidateAction(
  slug: string,
  vacancyId: string,
  candidateUserId: string,
  bericht: string,
): Promise<UitnodigResultaat> {
  const parsed = uitnodigSchema.safeParse({ vacancyId, candidateUserId, bericht });
  if (!parsed.success) {
    return {
      ok: false,
      soort: "fout",
      melding: parsed.error.errors[0]?.message ?? "Ongeldige invoer",
    };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "candidate.invite");
    const uitnodiging = await inviteCandidate(
      ctx,
      parsed.data.vacancyId,
      parsed.data.candidateUserId,
      parsed.data.bericht.length > 0 ? parsed.data.bericht : undefined,
    );

    // De vastgelegde snapshot erbij zoeken zodat de bevestiging exact de score
    // van het beslismoment toont. Veilig: de snapshot is zojuist door onze
    // eigen servicelaag voor deze (tenant-gescopete) vacature aangemaakt.
    let score: number | null = null;
    let snapshotLabel: MatchLabel | null = null;
    if (uitnodiging.matchSnapshotId) {
      const snapshot = await prisma.matchSnapshot.findUnique({
        where: { id: uitnodiging.matchSnapshotId },
        select: { score: true, label: true },
      });
      if (snapshot) {
        score = snapshot.score;
        snapshotLabel = snapshot.label as MatchLabel;
      }
    }

    revalidatePath(`/praktijk/${slug}/vacatures/${vacancyId}/studio`);
    return { ok: true, score, label: snapshotLabel };
  } catch (fout) {
    if (fout instanceof EntitlementError) {
      return {
        ok: false,
        soort: "limiet",
        melding: fout.message,
        upgradeHint: fout.upgradeHint,
      };
    }
    if (fout instanceof AuthzError) {
      return { ok: false, soort: "fout", melding: fout.message };
    }
    console.error("Match Studio: kandidaat uitnodigen mislukt:", fout);
    return {
      ok: false,
      soort: "fout",
      melding: "De uitnodiging is niet verstuurd. Probeer het opnieuw.",
    };
  }
}

// ---------------------------------------------------------------------------
// Analytics: opportunity_viewed
// ---------------------------------------------------------------------------

/**
 * Legt vast dat de opportunity-voorstellen van een kandidaat zijn bekeken
 * (openen van het kandidaatdetail met voorstellen). Faalt nooit hard:
 * analytics mag geen productflow breken. Context bevat uitsluitend
 * pseudoniemen en categorische gegevens — geen persoonsgegevens.
 */
export async function trackOpportunityViewedAction(
  slug: string,
  vacancyId: string,
  candidateProfileId: string,
  codes: string[],
): Promise<void> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "vacancy.manage");
    await track("opportunity_viewed", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      candidateId: candidateProfileId,
      plan: await planCodeVoorAnalytics(ctx.organizationId),
      context: {
        vacancyId,
        codes: codes.slice(0, 3).join(","),
        aantal: codes.length,
      },
    });
  } catch (fout) {
    console.error("opportunity_viewed niet vastgelegd:", fout);
  }
}
