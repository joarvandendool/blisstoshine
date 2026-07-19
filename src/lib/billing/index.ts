// Billing-laag: provider-onafhankelijke adapterinterface plus de functies die
// abonnementen en entitlements verbinden met de database. Alle planlogica
// zelf (wat mag welk plan?) leeft in src/domain/entitlements — hier staat
// uitsluitend de infrastructuurkant.
//
// In deze release is er alleen de LocalTestBillingProvider (geen echte
// betalingen). Het Stripe-aansluitpunt is gedocumenteerd in ./README.md.

import { cache } from "react";
import { Prisma } from "@prisma/client";
import {
  ADDON_CATALOG,
  ENTITLEMENT_LABELS,
  PLAN_CATALOG,
  PLAN_CODES,
  applySubscriptionItems,
  can,
  checkLimit,
  effectiveSubscriptionState,
  entitlementsForSubscription,
  getPlanVersion,
  isAddonKey,
  lockedEntitlements,
  subscriptionHasAccess,
  type AddonKey,
  type EffectiveSubscriptionState,
  type EntitlementKey,
  type EntitlementSet,
  type PlanCode,
  type SubscriptionSnapshot,
} from "@/domain/entitlements";
import { audit } from "@/lib/audit";
import {
  huidigeAbonnementGeneratie,
  verversAbonnementCache,
} from "./abonnement-cache";
import { TRIAL_DAYS } from "@/lib/config";
import { prisma } from "@/lib/db";
import { LocalTestBillingProvider } from "./local";

/**
 * Coulanceperiode (dagen) na een mislukte betaling: het abonnement gaat naar
 * past_due met graceUntil = nu + GRACE_DAYS; binnen die periode blijven de
 * entitlements gelden, daarna is het abonnement vergrendeld.
 */
export const GRACE_DAYS = 14;

// ---------- provider-adapter ----------

export interface StartSubscriptionOptions {
  /** Facturatie-interval voor betaalde plannen (standaard maandelijks). */
  interval?: "monthly" | "yearly";
  /**
   * Afwijkende proefperiode in dagen. Zonder deze optie geldt de proefperiode
   * uit de plancatalogus (alleen het trialplan definieert er een).
   */
  trialDays?: number;
}

/**
 * Provider-onafhankelijk contract voor betaalproviders. De rest van de
 * codebase praat uitsluitend tegen deze interface; welke provider erachter
 * zit is een implementatiedetail van getBillingProvider().
 */
export interface BillingProviderAdapter {
  /** Zorgt dat er een klant bij de provider bestaat; geeft het provider-klant-ID terug. */
  ensureCustomer(orgId: string): Promise<string>;
  startSubscription(
    orgId: string,
    planCode: PlanCode,
    opts?: StartSubscriptionOptions,
  ): Promise<void>;
  /** Directe planwijziging (upgrade): gaat per direct in met een nieuwe periode. */
  changePlan(orgId: string, planCode: PlanCode): Promise<void>;
  /**
   * Geplande planwijziging (downgrade): gaat pas in aan het einde van de
   * lopende periode (scheduledPlanVersionId/scheduledChangeAt); verwerking
   * gebeurt door applyScheduledChanges(). Idempotent.
   */
  schedulePlanChange(orgId: string, planCode: PlanCode): Promise<void>;
  cancelSubscription(orgId: string, atPeriodEnd: boolean): Promise<void>;
  /**
   * Heractiveert een abonnement: binnen de lopende periode wordt een opzegging
   * (cancelAtPeriodEnd) teruggedraaid; is het laatste abonnement al beëindigd,
   * dan start een nieuw abonnement op hetzelfde plan. Idempotent.
   */
  reactivateSubscription(orgId: string): Promise<void>;
}

let providerInstance: BillingProviderAdapter | null = null;

/**
 * Geeft de actieve betaalprovider. In deze release altijd de
 * LocalTestBillingProvider (lokale testabonnementen, geen echte betalingen).
 *
 * Later wordt hier op basis van de omgeving geresolved:
 * `BILLING_PROVIDER=stripe` → StripeBillingProvider (zie ./README.md voor het
 * volledige aansluitpunt); alles anders → lokale testprovider.
 */
export function getBillingProvider(): BillingProviderAdapter {
  if (!providerInstance) providerInstance = new LocalTestBillingProvider();
  return providerInstance;
}

export { simulateLocalPaymentEvent } from "./local";

// ---------- catalogus-synchronisatie ----------

/**
 * Synchroniseert de plancatalogus (src/domain/entitlements) idempotent naar de
 * database: Plan-, PlanVersion- en Entitlement-rijen worden ge-upsert. De
 * catalogus in code is de bron van waarheid; deze functie wordt gebruikt door
 * de seed, tests en ensureOrgSubscription().
 */
export async function syncPlanCatalog(): Promise<void> {
  for (const code of PLAN_CODES) {
    const planDef = PLAN_CATALOG[code];
    const plan = await prisma.plan.upsert({
      where: { code },
      create: { code, name: planDef.name },
      update: { name: planDef.name },
    });

    for (const versionDef of planDef.versions) {
      const priceFields = {
        priceMonthlyCents: versionDef.priceMonthlyCents,
        priceYearlyCents: versionDef.priceYearlyCents,
        currency: versionDef.currency,
        active: versionDef.active,
      };
      const planVersion = await prisma.planVersion.upsert({
        where: {
          planId_version: { planId: plan.id, version: versionDef.version },
        },
        create: { planId: plan.id, version: versionDef.version, ...priceFields },
        update: priceFields,
      });

      for (const [key, def] of Object.entries(versionDef.entitlements)) {
        await prisma.entitlement.upsert({
          where: {
            planVersionId_key: { planVersionId: planVersion.id, key },
          },
          create: {
            planVersionId: planVersion.id,
            key,
            enabled: def.enabled,
            limitInt: def.limitInt,
            meta:
              def.meta === undefined
                ? undefined
                : (def.meta as Prisma.InputJsonValue),
          },
          update: {
            enabled: def.enabled,
            limitInt: def.limitInt,
            meta:
              def.meta === undefined
                ? Prisma.DbNull
                : (def.meta as Prisma.InputJsonValue),
          },
        });
      }
    }
  }
  verversAbonnementCache();
}

// ---------- abonnementen ----------

/** Abonnement inclusief planversie, plan, entitlement-rijen en items. */
export type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: {
    planVersion: { include: { plan: true; entitlements: true } };
    items: true;
  };
}>;

const SUBSCRIPTION_INCLUDE = {
  planVersion: { include: { plan: true, entitlements: true } },
  items: true,
} as const;

// PERF: React cache() dedupliceert de abonnementsketen (Subscription +
// PlanVersion + Plan + Entitlements + items) binnen één serverrequest — pagina's
// als Talent Radar vroegen die keten tot 7× per request op. De cache leeft
// nooit langer dan de request; binnen een request wordt hij bovendien
// omzeild na élke schrijfactie via de generatieteller hieronder, zodat een
// server action die het abonnement wijzigt nooit een stale rij terugleest.
const abonnementViaCache = cache(
  async (orgId: string, _generatie: number): Promise<SubscriptionWithPlan | null> =>
    prisma.subscription.findFirst({
      where: { organizationId: orgId, status: { not: "canceled" } },
      orderBy: { createdAt: "desc" },
      include: SUBSCRIPTION_INCLUDE,
    }),
);

/**
 * Nieuwste niet-geannuleerde abonnement van een organisatie, inclusief
 * planversie, plan en entitlement-rijen. null wanneer er geen is.
 */
export async function getActiveSubscription(
  orgId: string,
): Promise<SubscriptionWithPlan | null> {
  return abonnementViaCache(orgId, huidigeAbonnementGeneratie());
}

/**
 * Zorgt dat een organisatie een abonnement heeft. Bestaat er al een
 * niet-geannuleerd abonnement, dan wordt dat teruggegeven. Anders wordt de
 * plancatalogus gesynchroniseerd en een trial-abonnement aangemaakt:
 * status `trialing`, trialEndsAt = nu + trialDays (uit de catalogus).
 */
export async function ensureOrgSubscription(
  orgId: string,
): Promise<SubscriptionWithPlan> {
  const existing = await getActiveSubscription(orgId);
  if (existing) return existing;

  await syncPlanCatalog();

  const trialVersion = getPlanVersion("trial");
  const dbVersion = await prisma.planVersion.findFirst({
    where: { plan: { code: "trial" }, version: trialVersion.version },
  });
  if (!dbVersion) {
    throw new Error(
      "Trialplan ontbreekt in de database, ook na catalogus-synchronisatie",
    );
  }

  const now = new Date();
  const trialEndsAt = addDays(now, trialVersion.trialDays ?? TRIAL_DAYS);

  const aangemaakt = await prisma.subscription.create({
    data: {
      organizationId: orgId,
      planVersionId: dbVersion.id,
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      trialEndsAt,
    },
    include: SUBSCRIPTION_INCLUDE,
  });
  verversAbonnementCache();
  return aangemaakt;
}

// ---------- effectieve entitlements ----------

export interface EffectiveEntitlements {
  /** null wanneer er geen (herkenbaar) abonnement is. */
  planCode: PlanCode | null;
  /** Effectieve toestand; "none" wanneer er geen abonnement is. */
  status: EffectiveSubscriptionState | "none";
  /** Per entitlement-sleutel: enabled + limitInt (null = onbeperkt). */
  entitlements: EntitlementSet;
}

function isPlanCode(value: string): value is PlanCode {
  return (PLAN_CODES as readonly string[]).includes(value);
}

/**
 * Combineert het opgeslagen abonnement met de domeinlogica
 * (entitlementsForSubscription): trial verlopen of geannuleerd → vergrendeld,
 * past_due → coulance, actief → de entitlements van de vastgepinde planversie.
 * Zonder abonnement (of bij onherkenbare plandata) → vergrendeld.
 */
export async function effectiveEntitlements(
  orgId: string,
): Promise<EffectiveEntitlements> {
  const sub = await getActiveSubscription(orgId);
  if (!sub) {
    return { planCode: null, status: "none", entitlements: lockedEntitlements() };
  }

  const code = sub.planVersion.plan.code;
  if (!isPlanCode(code)) {
    console.error(
      `Onbekende plancode "${code}" in database voor organisatie ${orgId} — entitlements vergrendeld`,
    );
    return { planCode: null, status: "none", entitlements: lockedEntitlements() };
  }

  const snapshot: SubscriptionSnapshot = {
    planCode: code,
    planVersion: sub.planVersion.version,
    status: sub.status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    graceUntil: sub.graceUntil,
  };
  const now = new Date();

  try {
    const base = entitlementsForSubscription(snapshot, now);
    // Add-ons (SubscriptionItems) gelden alleen zolang het abonnement toegang
    // geeft; op een vergrendeld abonnement worden ze niet toegepast.
    const entitlements = subscriptionHasAccess(snapshot, now)
      ? applySubscriptionItems(base, sub.items)
      : base;
    return {
      planCode: code,
      status: effectiveSubscriptionState(snapshot, now),
      entitlements,
    };
  } catch (error) {
    // Defensief: planversie in de database die de catalogus niet (meer) kent.
    console.error(
      `Entitlements niet bepaalbaar voor organisatie ${orgId} — vergrendeld:`,
      error,
    );
    return { planCode: code, status: "none", entitlements: lockedEntitlements() };
  }
}

// ---------- afdwingen ----------

/**
 * Fout die aangeeft dat het huidige abonnement iets niet toestaat.
 * status 402 (Payment Required) zodat routes dit direct kunnen vertalen.
 */
export class EntitlementError extends Error {
  readonly status = 402;
  readonly entitlementKey: EntitlementKey;
  /** Nederlandse hint voor de UI, bv. "Upgrade naar een hoger plan …". */
  readonly upgradeHint: string;

  constructor(message: string, entitlementKey: EntitlementKey, upgradeHint: string) {
    super(message);
    this.name = "EntitlementError";
    this.entitlementKey = entitlementKey;
    this.upgradeHint = upgradeHint;
  }
}

const UPGRADE_HINT_FEATURE =
  "Upgrade naar een hoger plan om deze functie te gebruiken.";
const UPGRADE_HINT_LIMIT =
  "Upgrade naar een hoger plan voor een ruimere limiet.";

/**
 * Throwt een EntitlementError (status 402) wanneer de feature niet is
 * ingeschakeld in het effectieve abonnement van de organisatie.
 */
export async function enforceEntitlement(
  orgId: string,
  key: EntitlementKey,
): Promise<void> {
  const effective = await effectiveEntitlements(orgId);
  if (!can(effective.entitlements, key)) {
    throw new EntitlementError(
      `Deze functie (${ENTITLEMENT_LABELS[key]}) is niet beschikbaar in je huidige abonnement.`,
      key,
      UPGRADE_HINT_FEATURE,
    );
  }
}

/**
 * Throwt een EntitlementError (status 402) wanneer er bij het huidige gebruik
 * geen ruimte meer is onder de limiet — via checkLimit uit het domein.
 */
export async function enforceLimit(
  orgId: string,
  key: EntitlementKey,
  currentUsage: number,
): Promise<void> {
  const effective = await effectiveEntitlements(orgId);
  const check = checkLimit(effective.entitlements, key, currentUsage);
  if (!check.allowed) {
    const isDisabled = check.limit === 0;
    throw new EntitlementError(
      check.reason ??
        `Je hebt de limiet voor ${ENTITLEMENT_LABELS[key]} van je huidige abonnement bereikt.`,
      key,
      isDisabled ? UPGRADE_HINT_FEATURE : UPGRADE_HINT_LIMIT,
    );
  }
}

// ---------- gebruik ----------

/**
 * Legt gebruik vast (bv. een kandidaat-uitnodiging) voor limietbewaking.
 * Idempotent via de unieke idempotencyKey: bestaat die al, dan is dit een
 * stil succes — er komt geen dubbele rij en er wordt niets gegooid.
 */
export async function recordUsage(
  orgId: string,
  key: string,
  quantity: number,
  idempotencyKey: string,
): Promise<void> {
  try {
    await prisma.usageEvent.create({
      data: { organizationId: orgId, key, quantity, idempotencyKey },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return; // al vastgelegd onder deze idempotencyKey
    }
    throw error;
  }
}

// ---------- uitbreidingen (subscription items) ----------

/** Verwachte, veilige billingfout met een Nederlandse melding voor de UI. */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

export interface SetSubscriptionItemsOptions {
  /** Voor de auditregel; geen autorisatie — die doet de aanroepende action. */
  userId?: string;
}

/**
 * Stelt de add-on-aantallen van het lopende abonnement in (declaratief: de
 * meegegeven aantallen zijn de gewenste eindstand per sleutel; niet-genoemde
 * sleutels blijven ongewijzigd). Idempotent: dezelfde aanroep twee keer geeft
 * dezelfde eindstand en maximaal één auditregel per echte wijziging.
 *
 * Vereist een lopend, niet-vergrendeld abonnement op een betaald plan
 * (add-ons zijn niet beschikbaar op het trialplan).
 */
export async function setSubscriptionItems(
  orgId: string,
  gewenst: Partial<Record<AddonKey, number>>,
  opts?: SetSubscriptionItemsOptions,
): Promise<void> {
  const sub = await getActiveSubscription(orgId);
  if (!sub) {
    throw new BillingError("Geen lopend abonnement — start eerst een abonnement.");
  }
  if (sub.planVersion.plan.code === "trial") {
    throw new BillingError(
      "Uitbreidingen zijn niet beschikbaar in de proefperiode — kies eerst een betaald plan.",
    );
  }

  const wijzigingen: Array<{ key: AddonKey; van: number; naar: number }> = [];
  for (const [key, aantalRuw] of Object.entries(gewenst)) {
    if (!isAddonKey(key) || aantalRuw === undefined) {
      throw new BillingError(`Onbekende uitbreiding: ${key}`);
    }
    const addon = ADDON_CATALOG[key];
    const aantal = Math.floor(aantalRuw);
    if (!Number.isFinite(aantal) || aantal < 0 || aantal > addon.maxQuantity) {
      throw new BillingError(
        `Ongeldig aantal voor ${addon.name}: kies 0 tot ${addon.maxQuantity}.`,
      );
    }
    const huidig = sub.items.find((item) => item.key === key)?.quantity ?? 0;
    if (huidig !== aantal) wijzigingen.push({ key, van: huidig, naar: aantal });
  }

  if (wijzigingen.length === 0) return; // niets te doen — stil succes

  await prisma.$transaction(
    wijzigingen.map(({ key, naar }) =>
      naar === 0
        ? prisma.subscriptionItem.deleteMany({
            where: { subscriptionId: sub.id, key },
          })
        : prisma.subscriptionItem.upsert({
            where: { subscriptionId_key: { subscriptionId: sub.id, key } },
            create: { subscriptionId: sub.id, key, quantity: naar },
            update: { quantity: naar },
          }),
    ),
  );
  verversAbonnementCache();

  await audit("subscription.items.change", "Subscription", sub.id, {
    organizationId: orgId,
    userId: opts?.userId,
    meta: {
      wijzigingen: wijzigingen.map(({ key, van, naar }) => ({ key, van, naar })),
    },
  });
}

// ---------- geplande wijzigingen ----------

export interface ApplyScheduledChangesResult {
  /** Aantal verwerkte geplande planwijzigingen (downgrades per periode-einde). */
  planChanges: number;
  /** Aantal geëffectueerde opzeggingen (cancelAtPeriodEnd, periode voorbij). */
  cancellations: number;
}

/**
 * Verwerkt vervallen planningen — aanroepbaar vanuit een cron/job of test:
 * - geplande planwijzigingen (scheduledPlanVersionId + scheduledChangeAt ≤ nu)
 *   worden doorgevoerd: nieuwe planversie, nieuwe maandperiode vanaf het
 *   geplande moment, planning gewist;
 * - opzeggingen per periode-einde (cancelAtPeriodEnd) waarvan de periode
 *   voorbij is, gaan naar status canceled.
 * Idempotent: verwerkte rijen voldoen daarna niet meer aan de criteria.
 */
export async function applyScheduledChanges(
  now: Date = new Date(),
): Promise<ApplyScheduledChangesResult> {
  const result: ApplyScheduledChangesResult = { planChanges: 0, cancellations: 0 };

  // 1. Vervallen geplande planwijzigingen (downgrade per periode-einde).
  const gepland = await prisma.subscription.findMany({
    where: {
      status: { not: "canceled" },
      scheduledPlanVersionId: { not: null },
      scheduledChangeAt: { lte: now },
    },
    include: { planVersion: { include: { plan: true } } },
  });
  for (const sub of gepland) {
    // Nieuwe periode start op het geplande moment (het einde van de oude
    // periode) — ook als de verwerking later draait; zo sluiten de perioden
    // administratief op elkaar aan.
    const vanaf = sub.scheduledChangeAt ?? now;
    const naarVersieId = sub.scheduledPlanVersionId;
    if (!naarVersieId) continue;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        planVersionId: naarVersieId,
        status: "active",
        trialEndsAt: null,
        graceUntil: null,
        currentPeriodStart: vanaf,
        currentPeriodEnd: addMonths(vanaf, 1),
        scheduledPlanVersionId: null,
        scheduledChangeAt: null,
      },
    });
    verversAbonnementCache();
    await audit("subscription.scheduled_change.apply", "Subscription", sub.id, {
      organizationId: sub.organizationId,
      meta: {
        from: sub.planVersion.plan.code,
        toPlanVersionId: naarVersieId,
        scheduledChangeAt: vanaf.toISOString(),
      },
    });
    result.planChanges += 1;
  }

  // 2. Opzeggingen per periode-einde waarvan de periode voorbij is.
  const opgezegd = await prisma.subscription.findMany({
    where: {
      status: { not: "canceled" },
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lte: now },
    },
  });
  for (const sub of opgezegd) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: "canceled" },
    });
    verversAbonnementCache();
    await audit("subscription.cancel.effectuate", "Subscription", sub.id, {
      organizationId: sub.organizationId,
      meta: { periodEnd: sub.currentPeriodEnd.toISOString() },
    });
    result.cancellations += 1;
  }

  return result;
}

// ---------- inkomende webhooks ----------

export type InboundWebhookOutcome =
  | { processed: true; status: "verwerkt" }
  | { processed: false; status: "duplicaat" | "genegeerd" | "fout"; reason?: string };

/**
 * Verwerkt een inkomende provider-webhook, idempotent via
 * InboundWebhookEvent unique(provider, externalId): hetzelfde event twee keer
 * aanbieden geeft precies één verwerking (de tweede keer een stil duplicaat).
 *
 * Ondersteunde types (provider-neutraal; de Stripe-mapping staat in README.md):
 * - "payment_failed"   → abonnement naar past_due + graceUntil (nu + GRACE_DAYS),
 *   auditregel en in-app-notificatie voor de billing-beheerders;
 * - "payment_succeeded" → abonnement naar active, grace gewist en een nieuwe
 *   maandperiode (verlenging), met auditregel.
 * Onbekende types worden vastgelegd met status "genegeerd".
 *
 * De payload moet een organizationId bevatten waarmee het lopende abonnement
 * wordt gevonden; fouten worden op het event vastgelegd (status "fout").
 */
export async function processInboundWebhook(
  provider: string,
  externalId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<InboundWebhookOutcome> {
  // 1. Idempotentie-anker: de event-rij claimt unique(provider, externalId).
  let eventId: string;
  try {
    const event = await prisma.inboundWebhookEvent.create({
      data: {
        provider,
        externalId,
        type,
        payload: payload as Prisma.InputJsonValue,
        status: "verwerkt",
      },
    });
    eventId = event.id;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { processed: false, status: "duplicaat" }; // al verwerkt
    }
    throw error;
  }

  const markeer = async (status: "genegeerd" | "fout") => {
    await prisma.inboundWebhookEvent.update({
      where: { id: eventId },
      data: { status },
    });
  };

  try {
    if (type !== "payment_failed" && type !== "payment_succeeded") {
      await markeer("genegeerd");
      return { processed: false, status: "genegeerd", reason: `Onbekend type: ${type}` };
    }

    const organizationId =
      typeof payload.organizationId === "string" ? payload.organizationId : null;
    if (!organizationId) {
      await markeer("fout");
      return {
        processed: false,
        status: "fout",
        reason: "Payload mist organizationId",
      };
    }

    const sub = await prisma.subscription.findFirst({
      where: { organizationId, status: { not: "canceled" } },
      orderBy: { createdAt: "desc" },
    });
    if (!sub) {
      await markeer("fout");
      return {
        processed: false,
        status: "fout",
        reason: "Geen lopend abonnement voor deze organisatie",
      };
    }

    const now = new Date();
    if (type === "payment_failed") {
      const graceUntil = addDays(now, GRACE_DAYS);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "past_due", graceUntil },
      });
      verversAbonnementCache();
      await audit("subscription.payment_failed", "Subscription", sub.id, {
        organizationId,
        meta: { provider, externalId, graceUntil: graceUntil.toISOString() },
      });
      await notificeerBetalingMislukt(organizationId, sub.id, externalId, graceUntil);
    } else {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: "active",
          graceUntil: null,
          trialEndsAt: null,
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, 1),
        },
      });
      verversAbonnementCache();
      await audit("subscription.payment_succeeded", "Subscription", sub.id, {
        organizationId,
        meta: { provider, externalId },
      });
    }

    return { processed: true, status: "verwerkt" };
  } catch (error) {
    await markeer("fout").catch(() => {
      // De statusupdate mag de oorspronkelijke fout niet maskeren.
    });
    throw error;
  }
}

/**
 * In-app-notificatie "betaling mislukt" voor alle actieve leden met de
 * capability billing.manage (owner en billing_manager). Idempotent via de
 * dedupeKey (uniek per abonnement + extern event); faalt zacht — een
 * notificatiefout mag de webhookverwerking nooit breken.
 */
async function notificeerBetalingMislukt(
  organizationId: string,
  subscriptionId: string,
  externalId: string,
  graceUntil: Date,
): Promise<void> {
  try {
    const beheerders = await prisma.membership.findMany({
      where: {
        organizationId,
        status: "active",
        role: { in: ["owner", "billing_manager"] },
      },
      select: { userId: true },
    });
    const tot = graceUntil.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    for (const { userId } of beheerders) {
      await prisma.notification
        .create({
          data: {
            userId,
            type: "payment_failed",
            title: "Betaling mislukt",
            body: `De laatste betaling van je abonnement is niet gelukt. Je functies blijven werken tot ${tot}; herstel de betaling om onderbreking te voorkomen.`,
            href: null,
            dedupeKey: `payment_failed:${subscriptionId}:${externalId}:${userId}`,
          },
        })
        .catch((error: unknown) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            return; // al gemeld voor dit event (idempotent)
          }
          throw error;
        });
    }
  } catch (error) {
    console.error("Billing: notificatie betaling-mislukt niet vastgelegd:", error);
  }
}

// ---------- hulpfuncties ----------

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
