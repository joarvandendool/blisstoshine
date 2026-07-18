"use server";

// Server actions van de abonnementspagina:
// - startCheckoutAction / annuleerCheckoutAction: leggen checkout_started en
//   checkout_abandoned vast wanneer de bevestigingsstap opent of wordt
//   geannuleerd (server-side getrackt, met geverifieerd membership);
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
import {
  getActiveSubscription,
  getBillingProvider,
  setSubscriptionItems,
} from "@/lib/billing";
import {
  ADDON_CATALOG,
  PLAN_CATALOG,
  PLAN_CODES,
  getPlanVersion,
  isAddonKey,
  type AddonKey,
  type PlanCode,
} from "@/domain/entitlements";
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
// Checkout-events (bevestigingsstap geopend / geannuleerd)
// ---------------------------------------------------------------------------

/**
 * Legt checkout_started vast wanneer de bevestigingsstap opent. Server-side
 * getrackt zodat het event altijd bij een geverifieerd membership hoort.
 * Faalt stil: een mislukt event mag de checkout nooit blokkeren.
 */
export async function startCheckoutAction(
  slug: string,
  invoer: unknown,
): Promise<void> {
  const parsed = wijzigSchema.safeParse(invoer);
  if (!parsed.success) return;
  const { planCode, interval } = parsed.data;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    const versie = getPlanVersion(planCode);
    await track("checkout_started", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      plan: planCode,
      context: {
        interval,
        prijsCents:
          interval === "yearly" ? versie.priceYearlyCents : versie.priceMonthlyCents,
      },
    });
  } catch (fout) {
    console.error("Abonnement: checkout_started niet vastgelegd:", fout);
  }
}

/**
 * Legt checkout_abandoned vast wanneer de bevestigingsstap wordt geannuleerd.
 * Faalt stil, om dezelfde reden als startCheckoutAction.
 */
export async function annuleerCheckoutAction(
  slug: string,
  invoer: unknown,
): Promise<void> {
  const parsed = wijzigSchema.safeParse(invoer);
  if (!parsed.success) return;
  const { planCode, interval } = parsed.data;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    await track("checkout_abandoned", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      plan: planCode,
      context: { interval },
    });
  } catch (fout) {
    console.error("Abonnement: checkout_abandoned niet vastgelegd:", fout);
  }
}

// ---------------------------------------------------------------------------
// Plan wijzigen (upgrade/downgrade/start)
// ---------------------------------------------------------------------------

/**
 * Wijzigt het abonnement naar het gekozen plan. Vanaf trial (of zonder lopend
 * abonnement) start een nieuw betaald abonnement met het gekozen interval.
 * Tussen betaalde plannen geldt: een upgrade gaat per direct in (changePlan),
 * een downgrade wordt GEPLAND per het einde van de lopende periode
 * (schedulePlanChange; applyScheduledChanges voert die later door).
 * Analytics: subscription_started bij een eerste betaald plan, anders
 * subscription_upgraded of subscription_downgraded.
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
    // startSubscription met het gekozen interval.
    if (huidigeCode === null || huidigeCode === "trial") {
      await provider.startSubscription(ctx.organizationId, planCode, { interval });
      await track("subscription_started", {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        plan: planCode,
        context: { van: huidigeCode ?? "geen", naar: planCode, interval },
      });
      revalidatePath(`/praktijk/${slug}/abonnement`);
      revalidatePath(`/praktijk/${slug}`);
      return {
        ok: true,
        melding: `Je abonnement is gewijzigd naar ${PLAN_CATALOG[planCode].name}. Testomgeving — geen echte betaling.`,
      };
    }

    const isUpgrade = PLAN_VOLGORDE[planCode] > PLAN_VOLGORDE[huidigeCode];
    if (isUpgrade) {
      // Upgrade: per direct, met een nieuwe maandperiode.
      await provider.changePlan(ctx.organizationId, planCode);
      await track("subscription_upgraded", {
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        plan: planCode,
        context: { van: huidigeCode, naar: planCode, interval: "monthly" },
      });
      revalidatePath(`/praktijk/${slug}/abonnement`);
      revalidatePath(`/praktijk/${slug}`);
      return {
        ok: true,
        melding: `Je abonnement is gewijzigd naar ${PLAN_CATALOG[planCode].name}. Testomgeving — geen echte betaling.`,
      };
    }

    // Downgrade: gepland per het einde van de lopende periode — tot die tijd
    // behoud je de functies van je huidige plan.
    await provider.schedulePlanChange(ctx.organizationId, planCode);
    await track("subscription_downgraded", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      plan: planCode,
      context: {
        van: huidigeCode,
        naar: planCode,
        gepland: true,
        ingangsdatum: huidig!.currentPeriodEnd.toISOString(),
      },
    });
    revalidatePath(`/praktijk/${slug}/abonnement`);
    revalidatePath(`/praktijk/${slug}`);
    return {
      ok: true,
      melding: `Je downgrade naar ${PLAN_CATALOG[planCode].name} staat gepland per ${datumLang(huidig!.currentPeriodEnd)}. Tot die datum behoud je de functies van je huidige plan.`,
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
// Heractiveren (opzegging terugdraaien binnen de lopende periode)
// ---------------------------------------------------------------------------

/**
 * Draait een opzegging per periode-einde terug zolang de periode nog loopt
 * (of start een nieuw abonnement op hetzelfde plan wanneer het laatste
 * abonnement al beëindigd is — het gedrag van de provider). De auditregel
 * wordt door de provider vastgelegd.
 */
export async function heractiveerAction(slug: string): Promise<PlanActieResultaat> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    await getBillingProvider().reactivateSubscription(ctx.organizationId);

    revalidatePath(`/praktijk/${slug}/abonnement`);
    revalidatePath(`/praktijk/${slug}`);
    return {
      ok: true,
      melding:
        "Je abonnement is geheractiveerd en loopt gewoon door. Testomgeving — geen echte betaling.",
    };
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return { ok: false, melding: fout.message };
    }
    console.error("Abonnement: heractiveren mislukt:", fout);
    return {
      ok: false,
      melding: "Het heractiveren is niet gelukt. Probeer het opnieuw.",
    };
  }
}

// ---------------------------------------------------------------------------
// Uitbreidingen (add-ons als subscription items)
// ---------------------------------------------------------------------------

const uitbreidingenSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string(),
        quantity: z.number().int().min(0).max(99),
      }),
    )
    .min(1)
    .max(20),
});

/** Valideert de add-on-sleutels en bouwt de gewenste eindstand per sleutel. */
function alsGewensteItems(
  items: Array<{ key: string; quantity: number }>,
): Partial<Record<AddonKey, number>> | null {
  const gewenst: Partial<Record<AddonKey, number>> = {};
  for (const item of items) {
    if (!isAddonKey(item.key)) return null;
    gewenst[item.key] = item.quantity;
  }
  return gewenst;
}

/** Maandbedrag (centen) van een gewenste eindstand, uit de add-on-catalogus. */
function maandbedragCents(gewenst: Partial<Record<AddonKey, number>>): number {
  return Object.entries(gewenst).reduce((som, [key, aantal]) => {
    if (!isAddonKey(key) || aantal === undefined) return som;
    return som + ADDON_CATALOG[key].priceMonthlyCents * aantal;
  }, 0);
}

/**
 * checkout_started wanneer de bevestigingsstap van de uitbreidingen opent.
 * Server-side getrackt (geverifieerd membership); faalt stil.
 */
export async function startUitbreidingCheckoutAction(
  slug: string,
  invoer: unknown,
): Promise<void> {
  const parsed = uitbreidingenSchema.safeParse(invoer);
  if (!parsed.success) return;
  const gewenst = alsGewensteItems(parsed.data.items);
  if (!gewenst) return;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    await track("checkout_started", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      context: {
        type: "uitbreidingen",
        maandbedragCents: maandbedragCents(gewenst),
      },
    });
  } catch (fout) {
    console.error("Abonnement: checkout_started (uitbreidingen) niet vastgelegd:", fout);
  }
}

/**
 * checkout_abandoned wanneer de bevestigingsstap van de uitbreidingen wordt
 * geannuleerd. Faalt stil.
 */
export async function annuleerUitbreidingCheckoutAction(
  slug: string,
  invoer: unknown,
): Promise<void> {
  const parsed = uitbreidingenSchema.safeParse(invoer);
  if (!parsed.success) return;
  const gewenst = alsGewensteItems(parsed.data.items);
  if (!gewenst) return;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    await track("checkout_abandoned", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      context: {
        type: "uitbreidingen",
        maandbedragCents: maandbedragCents(gewenst),
      },
    });
  } catch (fout) {
    console.error(
      "Abonnement: checkout_abandoned (uitbreidingen) niet vastgelegd:",
      fout,
    );
  }
}

/**
 * Stelt de add-on-aantallen van het lopende abonnement in (declaratieve
 * eindstand per sleutel). De verhoogde limieten gelden per direct via
 * effectiveEntitlements. Analytics: subscription_upgraded met het nieuwe
 * maandbedrag van de uitbreidingen; de auditregel schrijft de billinglaag.
 */
export async function wijzigUitbreidingenAction(
  slug: string,
  invoer: unknown,
): Promise<PlanActieResultaat> {
  const parsed = uitbreidingenSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, melding: "Controleer de gekozen uitbreidingen." };
  }
  const gewenst = alsGewensteItems(parsed.data.items);
  if (!gewenst) {
    return { ok: false, melding: "Onbekende uitbreiding in de aanvraag." };
  }

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "billing.manage");
    await setSubscriptionItems(ctx.organizationId, gewenst, {
      userId: ctx.user.id,
    });

    await track("subscription_upgraded", {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      context: {
        type: "uitbreidingen",
        maandbedragCents: maandbedragCents(gewenst),
      },
    });

    revalidatePath(`/praktijk/${slug}/abonnement`);
    revalidatePath(`/praktijk/${slug}`);
    return {
      ok: true,
      melding:
        "Je uitbreidingen zijn bijgewerkt; de nieuwe limieten gelden per direct. Testomgeving — geen echte betaling.",
    };
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return { ok: false, melding: fout.message };
    }
    if (fout instanceof Error && fout.message.length > 0) {
      // Nederlandse validatiefouten uit de billinglaag (bv. trialplan).
      return { ok: false, melding: fout.message };
    }
    console.error("Abonnement: uitbreidingen wijzigen mislukt:", fout);
    return {
      ok: false,
      melding: "Het wijzigen van je uitbreidingen is niet gelukt. Probeer het opnieuw.",
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
