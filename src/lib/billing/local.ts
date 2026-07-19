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
  processInboundWebhook,
  syncPlanCatalog,
  type BillingProviderAdapter,
  type InboundWebhookOutcome,
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
        graceUntil: null,
        scheduledPlanVersionId: null,
        scheduledChangeAt: null,
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
   * Plant een planwijziging (downgrade) per het einde van de lopende periode:
   * scheduledPlanVersionId + scheduledChangeAt = currentPeriodEnd. De
   * daadwerkelijke omzetting gebeurt door applyScheduledChanges() (index.ts).
   * Idempotent: opnieuw plannen naar hetzelfde plan wijzigt niets wezenlijks;
   * plannen naar het huidige plan wist een eerdere planning.
   */
  async schedulePlanChange(orgId: string, planCode: PlanCode): Promise<void> {
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

    // Terug naar het huidige plan plannen = een eerdere planning annuleren.
    if (current.planVersion.plan.code === planCode) {
      if (current.scheduledPlanVersionId !== null) {
        await prisma.subscription.update({
          where: { id: current.id },
          data: { scheduledPlanVersionId: null, scheduledChangeAt: null },
        });
        await audit("subscription.schedule_change.cancel", "Subscription", current.id, {
          organizationId: orgId,
          meta: { keptPlan: planCode },
        });
      }
      return;
    }

    const { row, catalogVersion } = await resolvePlanVersionRow(planCode);
    if (
      current.scheduledPlanVersionId === row.id &&
      current.scheduledChangeAt?.getTime() === current.currentPeriodEnd.getTime()
    ) {
      return; // al precies zo gepland — idempotent stil succes
    }

    await prisma.subscription.update({
      where: { id: current.id },
      data: {
        scheduledPlanVersionId: row.id,
        scheduledChangeAt: current.currentPeriodEnd,
      },
    });
    await audit("subscription.schedule_change", "Subscription", current.id, {
      organizationId: orgId,
      meta: {
        from: current.planVersion.plan.code,
        to: planCode,
        toVersion: catalogVersion.version,
        changeAt: current.currentPeriodEnd.toISOString(),
      },
    });
  }

  /**
   * Heractiveert het abonnement:
   * - lopend abonnement met cancelAtPeriodEnd → opzegging teruggedraaid
   *   (binnen de lopende periode);
   * - laatste abonnement is al beëindigd (canceled) → nieuw abonnement op
   *   hetzelfde plan met een verse maandperiode;
   * - lopend abonnement zonder opzegging → stille no-op (idempotent).
   */
  async reactivateSubscription(orgId: string): Promise<void> {
    const laatste = await prisma.subscription.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      include: { planVersion: { include: { plan: true } } },
    });
    if (!laatste) {
      throw new Error(
        "Geen abonnement om te heractiveren — start eerst een abonnement.",
      );
    }

    if (laatste.status !== "canceled") {
      if (!laatste.cancelAtPeriodEnd) return; // niets terug te draaien
      await prisma.subscription.update({
        where: { id: laatste.id },
        data: { cancelAtPeriodEnd: false },
      });
      await audit("subscription.reactivate", "Subscription", laatste.id, {
        organizationId: orgId,
        meta: { mode: "opzegging_teruggedraaid" },
      });
      return;
    }

    // Nieuw abonnement op hetzelfde plan (nieuwste actieve catalogusversie).
    const planCode = laatste.planVersion.plan.code as PlanCode;
    await syncPlanCatalog();
    const { row, catalogVersion } = await resolvePlanVersionRow(planCode);
    const now = new Date();
    const nieuw = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planVersionId: row.id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: addMonths(now, 1),
      },
    });
    await audit("subscription.reactivate", "Subscription", nieuw.id, {
      organizationId: orgId,
      meta: {
        mode: "nieuw_abonnement",
        planCode,
        planVersion: catalogVersion.version,
        previousSubscriptionId: laatste.id,
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

/**
 * Lokale testflow voor inkomende betaal-webhooks: simuleert een
 * payment_failed- of payment_succeeded-event van de provider "local_test" en
 * verwerkt het via processInboundWebhook (idempotent op externalId). Met een
 * expliciete externalId kan idempotentie worden getest; zonder wordt een
 * uniek test-ID gegenereerd.
 */
export async function simulateLocalPaymentEvent(
  orgId: string,
  type: "payment_failed" | "payment_succeeded",
  externalId?: string,
  occurredAt?: Date,
): Promise<InboundWebhookOutcome> {
  return processInboundWebhook(
    PROVIDER,
    externalId ?? `evt_local_${randomUUID().replaceAll("-", "")}`,
    type,
    {
      organizationId: orgId,
      ...(occurredAt ? { occurredAt: occurredAt.toISOString() } : {}),
    },
  );
}
