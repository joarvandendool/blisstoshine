// LocalTestBillingProvider — de enige betaalprovider in deze release.
//
// Er lopen GEEN echte betalingen: abonnementen worden rechtstreeks in de
// database aangemaakt, gewijzigd en geannuleerd, zodat de volledige
// commerciële flow (trial → upgrade → annulering, entitlements, limieten)
// end-to-end getest en gedemonstreerd kan worden. Het Stripe-aansluitpunt
// staat beschreven in ./README.md; deze klasse is daarvoor het referentie-
// gedrag achter dezelfde BillingProviderAdapter-interface.

import { randomUUID } from "node:crypto";
import { getPlanVersion, type PlanCode } from "@/domain/entitlements";
import { audit } from "@/lib/audit";
import { TRIAL_DAYS } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  syncPlanCatalog,
  type BillingProviderAdapter,
  type StartSubscriptionOptions,
} from "./index";

const PROVIDER = "local_test";

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/** Zoekt de database-rij van de nieuwste actieve catalogusversie van een plan. */
async function resolvePlanVersionRow(planCode: PlanCode) {
  const catalogVersion = getPlanVersion(planCode);
  const row = await prisma.planVersion.findFirst({
    where: { plan: { code: planCode }, version: catalogVersion.version },
  });
  if (!row) {
    throw new Error(
      `Planversie ${planCode} v${catalogVersion.version} ontbreekt in de database — draai syncPlanCatalog()`,
    );
  }
  return { row, catalogVersion };
}

export class LocalTestBillingProvider implements BillingProviderAdapter {
  /**
   * Zorgt voor een BillingCustomer met provider "local_test". Het
   * providerCustomerId is een opaak test-ID ("local_" + willekeurig cuid-achtig
   * ID) — bij Stripe staat hier later het echte customer-ID (cus_…).
   */
  async ensureCustomer(orgId: string): Promise<string> {
    const existing = await prisma.billingCustomer.findUnique({
      where: { organizationId: orgId },
    });
    if (existing) return existing.providerCustomerId;

    const providerCustomerId = `local_${randomUUID().replaceAll("-", "")}`;
    const created = await prisma.billingCustomer.create({
      data: {
        organizationId: orgId,
        provider: PROVIDER,
        providerCustomerId,
      },
    });
    await audit("billing.customer.create", "BillingCustomer", created.id, {
      organizationId: orgId,
      meta: { provider: PROVIDER },
    });
    return providerCustomerId;
  }

  /**
   * Start een abonnement direct in de database. Eventuele lopende
   * (niet-geannuleerde) abonnementen worden eerst geannuleerd zodat er per
   * organisatie één lopend abonnement is. Plannen met een proefperiode
   * (of expliciete opts.trialDays) starten als `trialing`; betaalde plannen
   * als `active` met een maand- of jaarperiode.
   */
  async startSubscription(
    orgId: string,
    planCode: PlanCode,
    opts?: StartSubscriptionOptions,
  ): Promise<void> {
    await this.ensureCustomer(orgId);
    await syncPlanCatalog();
    const { row, catalogVersion } = await resolvePlanVersionRow(planCode);

    await prisma.subscription.updateMany({
      where: { organizationId: orgId, status: { not: "canceled" } },
      data: { status: "canceled" },
    });

    const now = new Date();
    const trialDays =
      opts?.trialDays ??
      (planCode === "trial" ? (catalogVersion.trialDays ?? TRIAL_DAYS) : undefined);

    let status: "trialing" | "active";
    let trialEndsAt: Date | null;
    let currentPeriodEnd: Date;
    if (trialDays !== undefined) {
      status = "trialing";
      trialEndsAt = addDays(now, trialDays);
      currentPeriodEnd = trialEndsAt;
    } else {
      status = "active";
      trialEndsAt = null;
      currentPeriodEnd = addMonths(now, opts?.interval === "yearly" ? 12 : 1);
    }

    const subscription = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planVersionId: row.id,
        status,
        currentPeriodStart: now,
        currentPeriodEnd,
        trialEndsAt,
      },
    });
    await audit("subscription.start", "Subscription", subscription.id, {
      organizationId: orgId,
      meta: { planCode, planVersion: catalogVersion.version, status },
    });
  }

  /**
   * Wijzigt het lopende abonnement naar (de nieuwste actieve versie van) een
   * ander plan. Het abonnement wordt `active` met een nieuwe maandperiode —
   * een up- of downgrade beëindigt dus ook een eventuele proefperiode.
   */
  async changePlan(orgId: string, planCode: PlanCode): Promise<void> {
    await syncPlanCatalog();
    const current = await prisma.subscription.findFirst({
      where: { organizationId: orgId, status: { not: "canceled" } },
      orderBy: { createdAt: "desc" },
      include: { planVersion: { include: { plan: true } } },
    });
    if (!current) {
      throw new Error(
        "Geen lopend abonnement om te wijzigen — start eerst een abonnement.",
      );
    }

    const { row, catalogVersion } = await resolvePlanVersionRow(planCode);
    const now = new Date();
    await prisma.subscription.update({
      where: { id: current.id },
      data: {
        planVersionId: row.id,
        status: "active",
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
        currentPeriodStart: now,
        currentPeriodEnd: addMonths(now, 1),
      },
    });
    await audit("subscription.change_plan", "Subscription", current.id, {
      organizationId: orgId,
      meta: {
        from: current.planVersion.plan.code,
        to: planCode,
        toVersion: catalogVersion.version,
      },
    });
  }

  /**
   * Annuleert het lopende abonnement. Met atPeriodEnd=true blijft het actief
   * tot het einde van de betaalperiode (cancelAtPeriodEnd); anders gaat de
   * status direct naar `canceled`. Geen lopend abonnement → stille no-op.
   */
  async cancelSubscription(orgId: string, atPeriodEnd: boolean): Promise<void> {
    const current = await prisma.subscription.findFirst({
      where: { organizationId: orgId, status: { not: "canceled" } },
      orderBy: { createdAt: "desc" },
    });
    if (!current) return;

    await prisma.subscription.update({
      where: { id: current.id },
      data: atPeriodEnd
        ? { cancelAtPeriodEnd: true }
        : { status: "canceled", cancelAtPeriodEnd: false },
    });
    await audit("subscription.cancel", "Subscription", current.id, {
      organizationId: orgId,
      meta: { atPeriodEnd },
    });
  }
}
