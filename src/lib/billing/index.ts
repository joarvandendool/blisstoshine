// Billing-laag: provider-onafhankelijke adapterinterface plus de functies die
// abonnementen en entitlements verbinden met de database. Alle planlogica
// zelf (wat mag welk plan?) leeft in src/domain/entitlements — hier staat
// uitsluitend de infrastructuurkant.
//
// In deze release is er alleen de LocalTestBillingProvider (geen echte
// betalingen). Het Stripe-aansluitpunt is gedocumenteerd in ./README.md.

import { Prisma } from "@prisma/client";
import {
  ENTITLEMENT_LABELS,
  PLAN_CATALOG,
  PLAN_CODES,
  can,
  checkLimit,
  effectiveSubscriptionState,
  entitlementsForSubscription,
  getPlanVersion,
  lockedEntitlements,
  type EffectiveSubscriptionState,
  type EntitlementKey,
  type EntitlementSet,
  type PlanCode,
  type SubscriptionSnapshot,
} from "@/domain/entitlements";
import { TRIAL_DAYS } from "@/lib/config";
import { prisma } from "@/lib/db";
import { LocalTestBillingProvider } from "./local";

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
  changePlan(orgId: string, planCode: PlanCode): Promise<void>;
  cancelSubscription(orgId: string, atPeriodEnd: boolean): Promise<void>;
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
}

// ---------- abonnementen ----------

/** Abonnement inclusief planversie, plan en entitlement-rijen. */
export type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: { planVersion: { include: { plan: true; entitlements: true } } };
}>;

const SUBSCRIPTION_INCLUDE = {
  planVersion: { include: { plan: true, entitlements: true } },
} as const;

/**
 * Nieuwste niet-geannuleerde abonnement van een organisatie, inclusief
 * planversie, plan en entitlement-rijen. null wanneer er geen is.
 */
export async function getActiveSubscription(
  orgId: string,
): Promise<SubscriptionWithPlan | null> {
  return prisma.subscription.findFirst({
    where: { organizationId: orgId, status: { not: "canceled" } },
    orderBy: { createdAt: "desc" },
    include: SUBSCRIPTION_INCLUDE,
  });
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

  return prisma.subscription.create({
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
  };
  const now = new Date();

  try {
    return {
      planCode: code,
      status: effectiveSubscriptionState(snapshot, now),
      entitlements: entitlementsForSubscription(snapshot, now),
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

// ---------- hulpfuncties ----------

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
