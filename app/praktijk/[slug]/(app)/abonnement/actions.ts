"use server";

// Server actions van de abonnementspagina:
// - wijzigPlanAction: upgrade/downgrade via de billing-provider
//   (startSubscription vanaf trial of zonder abonnement, changePlan tussen
//   betaalde plannen) + de events subscription_started/upgraded/downgraded;
// - zegOpAction: opzeggen per periode-einde (cancelAtPeriodEnd) na expliciete
//   bevestiging in de UI + het event subscription_cancelled.
//
// Elke actie begint bij getOrgForUserBySlug met capability billing.manage
// (geverifieerd membership = tenantisolatie). De auditregels worden door de
// provider zelf vastgelegd. In deze release is de provider de
// LocalTestBillingProvider: testomgeving — geen echte betaling.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { getActiveSubscription, getBillingProvider } from "@/lib/billing";
import { PLAN_CATALOG, PLAN_CODES, type PlanCode } from "@/domain/entitlements";
import { getOrgForUserBySlug } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Validatie
// ---------------------------------------------------------------------------

// Zelf te kiezen plannen: trial is geen keuze en multi_location gaat op
// aanvraag (contractpricing) — die twee zijn hier bewust uitgesloten.
const wijzigSchema = z.object({
  planCode: z.enum(["essential", "growth"], {
    errorMap: () => ({ message: "Dit plan kun je hier niet zelf kiezen" }),
  }),
  interval: z.enum(["monthly", "yearly"], {
    errorMap: () => ({ message: "Kies maandelijkse of jaarlijkse facturatie" }),
  }),
});

export type PlanActieResultaat =
  | { ok: true; melding: string }
  | { ok: false; melding: string };

/** Rangorde van plannen om upgrade van downgrade te onderscheiden. */
const PLAN_VOLGORDE: Record<PlanCode, number> = {
  trial: 0,
  essential: 1,
  growth: 2,
  multi_location: 3,
};

function isPlanCode(waarde: string): waarde is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(waarde);
}

/** Datum in lopende tekst, bv. "12 augustus 2026". */
function datumLang(datum: Date): string {
  return datum.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Plan wijzigen (upgrade/downgrade/start)
// ---------------------------------------------------------------------------

/**
 * Wijzigt het abonnement naar het gekozen plan. Vanaf trial (of zonder lopend
 * abonnement) start een nieuw betaald abonnement met het gekozen interval;
 * tussen betaalde plannen wordt changePlan gebruikt (maandperiode, conform de
 * provider). Analytics: subscription_started bij een eerste betaald plan,
 * anders subscription_upgraded of subscription_downgraded.
 */
export async function wijzigPlanAction(
  slug: string,
  invoer: unknown,
): Promise<PlanActieResultaat> {
  const parsed = wijzigSchema.safeParse(invoer);
  if (!parsed.success) {
    return {
      ok: false,
      melding: parsed.error.errors[0]?.message ?? "Controleer je keuze",
    };
  }
  const { planCode, interval } = parsed.data;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    const provider = getBillingProvider();

    const huidig = await getActiveSubscription(ctx.organizationId);
    const huidigeCodeRuw = huidig?.planVersion.plan.code ?? null;
    const huidigeCode =
      huidigeCodeRuw !== null && isPlanCode(huidigeCodeRuw) ? huidigeCodeRuw : null;

    if (huidigeCode === planCode) {
      return { ok: false, melding: "Dit is al je huidige plan." };
    }

    // Eerste betaald plan (geen abonnement, onherkenbaar plan of trial):
    // startSubscription met het gekozen interval; tussen betaalde plannen:
    // changePlan (maandperiode, conform het gedrag van de provider).
    if (huidigeCode === null || huidigeCode === "trial") {
      await provider.startSubscription(ctx.organizationId, planCode, { interval });
      await track("subscription_started", {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        plan: planCode,
        context: { van: huidigeCode ?? "geen", naar: planCode, interval },
      });
    } else {
      await provider.changePlan(ctx.organizationId, planCode);
      const event =
        PLAN_VOLGORDE[planCode] > PLAN_VOLGORDE[huidigeCode]
          ? "subscription_upgraded"
          : "subscription_downgraded";
      await track(event, {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        plan: planCode,
        context: { van: huidigeCode, naar: planCode, interval: "monthly" },
      });
    }

    revalidatePath(`/praktijk/${slug}/abonnement`);
    revalidatePath(`/praktijk/${slug}`);
    return {
      ok: true,
      melding: `Je abonnement is gewijzigd naar ${PLAN_CATALOG[planCode].name}. Testomgeving — geen echte betaling.`,
    };
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return { ok: false, melding: fout.message };
    }
    console.error("Abonnement: plan wijzigen mislukt:", fout);
    return {
      ok: false,
      melding: "Het wijzigen van je plan is niet gelukt. Probeer het opnieuw.",
    };
  }
}

// ---------------------------------------------------------------------------
// Opzeggen (per periode-einde)
// ---------------------------------------------------------------------------

/**
 * Zegt het lopende abonnement op per het einde van de betaalperiode
 * (cancelAtPeriodEnd). Tot die datum blijft alles gewoon werken. De UI vraagt
 * vóór het aanroepen om expliciete bevestiging.
 */
export async function zegOpAction(slug: string): Promise<PlanActieResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");

    const huidig = await getActiveSubscription(ctx.organizationId);
    if (!huidig) {
      return { ok: false, melding: "Er is geen lopend abonnement om op te zeggen." };
    }
    if (huidig.cancelAtPeriodEnd) {
      return {
        ok: false,
        melding: `Je abonnement is al opgezegd en loopt tot ${datumLang(huidig.currentPeriodEnd)}.`,
      };
    }

    await getBillingProvider().cancelSubscription(ctx.organizationId, true);

    await track("subscription_cancelled", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      plan: huidig.planVersion.plan.code,
      context: { atPeriodEnd: true },
    });

    revalidatePath(`/praktijk/${slug}/abonnement`);
    revalidatePath(`/praktijk/${slug}`);
    return {
      ok: true,
      melding: `Je abonnement is opgezegd en blijft actief tot ${datumLang(huidig.currentPeriodEnd)}.`,
    };
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return { ok: false, melding: fout.message };
    }
    console.error("Abonnement: opzeggen mislukt:", fout);
    return {
      ok: false,
      melding: "Het opzeggen is niet gelukt. Probeer het opnieuw.",
    };
  }
}
