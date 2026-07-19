// Commerciële integratietests (verplicht volgens de productopdracht):
// - entitlements worden per plan toegepast
// - planwijziging past limieten correct aan
// - bestaande abonnementen behouden hun planversie
// - usage events zijn idempotent
// - trial-expiratie vergrendelt functionaliteit
// Fase 4 (uitbreidbare subscriptions):
// - een add-on (SubscriptionItem) verhoogt de limiet per direct
// - een geplande downgrade wordt pas actief na applyScheduledChanges
// - heractivatie (opzegging terugdraaien of nieuw abonnement)
// - failed payment → past_due: binnen de grace blijft toegang, daarna vergrendeld
// - inkomende webhooks zijn idempotent op (provider, externalId)

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
  // Alleen ./helpers importeren — @/lib/auth zou een circulaire dynamic
  // import veroorzaken (auth importeert zelf next/headers).
  const { sessieHouder, createTestSessionToken } = await import("./helpers");
  return {
    cookies: async () => ({
      get: (naam: string) =>
        naam === "mz_session" && sessieHouder.userId
          ? { value: createTestSessionToken(sessieHouder.userId) }
          : undefined,
      set: () => {},
      delete: () => {},
    }),
  };
});

import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authz";
import {
  BillingError,
  EntitlementError,
  applyScheduledChanges,
  effectiveEntitlements,
  enforceEntitlement,
  getBillingProvider,
  recordUsage,
  setSubscriptionItems,
  simulateLocalPaymentEvent,
} from "@/lib/billing";
import {
  createOrganizationWithLocation,
} from "@/server/organizations";
import { createDraftVacancy, publishVacancy } from "@/server/vacancies";
import {
  alsGebruiker,
  prepareTestDb,
  maakGebruiker,
  rooster,
} from "./helpers";
import type { OrgContext } from "@/lib/authz";

let owner: Awaited<ReturnType<typeof maakGebruiker>>;
let org: { id: string; slug: string };
let locatieId: string;
let ctx: OrgContext;

async function nieuwConcept(titel: string) {
  return createDraftVacancy(ctx, {
    locationId: locatieId,
    title: titel,
    role: "mondhygienist",
    schedule: rooster(["di"]),
    hoursMin: 16,
    hoursMax: 24,
    contractTypes: ["loondienst"],
  });
}

beforeAll(async () => {
  await prepareTestDb();
  owner = await maakGebruiker("owner@commercieel.nl", "Owner");
  alsGebruiker(owner.id);
  const res = await createOrganizationWithLocation({
    name: "Praktijk Commercieel",
    location: {
      name: "Hoofdlocatie",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 3,
    },
  });
  org = res.organization;
  locatieId = res.location.id;
  ctx = await requireMembership(org.id);
});

describe("entitlements per plan", () => {
  it("trial staat één actieve vacature toe en blokkeert de tweede met een upgrade-hint", async () => {
    const eerste = await nieuwConcept("Vacature 1");
    await publishVacancy(ctx, eerste.id);

    const tweede = await nieuwConcept("Vacature 2");
    await expect(publishVacancy(ctx, tweede.id)).rejects.toThrow(EntitlementError);

    const fout = await publishVacancy(ctx, tweede.id).catch((e) => e);
    expect(fout).toBeInstanceOf(EntitlementError);
    expect(String(fout.message).length).toBeGreaterThan(10);
  });

  it("trial heeft geen Talent Radar; growth wél", async () => {
    await expect(enforceEntitlement(org.id, "talent_radar")).rejects.toThrow(
      EntitlementError,
    );

    await getBillingProvider().changePlan(org.id, "growth");
    await expect(enforceEntitlement(org.id, "talent_radar")).resolves.not.toThrow();
  });
});

describe("planwijziging", () => {
  it("upgrade naar growth past de vacaturelimiet direct aan", async () => {
    // Na de upgrade hierboven: growth staat meer actieve vacatures toe.
    const derde = await nieuwConcept("Vacature 3");
    await expect(publishVacancy(ctx, derde.id)).resolves.toBeDefined();

    const eff = await effectiveEntitlements(org.id);
    expect(eff.planCode).toBe("growth");
    expect(eff.entitlements.talent_radar?.enabled).toBe(true);
  });

  it("bestaand abonnement behoudt zijn vastgepinde planversie", async () => {
    const abonnement = await prisma.subscription.findFirst({
      where: { organizationId: org.id, status: { not: "canceled" } },
      include: { planVersion: { include: { plan: true } } },
      orderBy: { createdAt: "desc" },
    });
    expect(abonnement).not.toBeNull();
    const vastgepindeVersie = abonnement!.planVersion.version;

    // Nieuwe planversie 99 met strengere limieten verschijnt in de database…
    await prisma.planVersion.create({
      data: {
        planId: abonnement!.planVersion.planId,
        version: 99,
        priceMonthlyCents: 99900,
        priceYearlyCents: 999000,
        entitlements: {
          create: [{ key: "max_active_vacancies", enabled: true, limitInt: 1 }],
        },
      },
    });

    // …maar het bestaande abonnement blijft op zijn eigen versie rekenen.
    const abonnementNa = await prisma.subscription.findFirst({
      where: { id: abonnement!.id },
      include: { planVersion: true },
    });
    expect(abonnementNa!.planVersion.version).toBe(vastgepindeVersie);

    const eff = await effectiveEntitlements(org.id);
    const limiet = eff.entitlements.max_active_vacancies?.limitInt;
    expect(limiet === null || (limiet ?? 0) > 1).toBe(true);
  });
});

describe("usage events", () => {
  it("recordUsage is idempotent op idempotencyKey", async () => {
    const sleutel = `test-invite-${org.id}-kandidaat-x-2026-07`;
    await recordUsage(org.id, "candidate_invite", 1, sleutel);
    await recordUsage(org.id, "candidate_invite", 1, sleutel);
    await recordUsage(org.id, "candidate_invite", 1, sleutel);

    const rijen = await prisma.usageEvent.count({
      where: { organizationId: org.id, idempotencyKey: sleutel },
    });
    expect(rijen).toBe(1);
  });
});

describe("trial-expiratie", () => {
  it("een verlopen trial vergrendelt entitlements", async () => {
    const eigenaar2 = await maakGebruiker("owner2@commercieel.nl", "Owner 2");
    alsGebruiker(eigenaar2.id);
    const res2 = await createOrganizationWithLocation({
      name: "Praktijk Verlopen Trial",
      location: {
        name: "Locatie",
        city: "Zwolle",
        postcode: "8011 AB",
        treatmentRooms: 2,
      },
    });

    // Trial kunstmatig laten verlopen
    await prisma.subscription.updateMany({
      where: { organizationId: res2.organization.id },
      data: { trialEndsAt: new Date("2020-01-01T00:00:00Z") },
    });

    const eff = await effectiveEntitlements(res2.organization.id);
    expect(eff.status).toBe("trial_expired");
    expect(eff.entitlements.max_active_vacancies?.enabled ?? false).toBe(false);

    alsGebruiker(eigenaar2.id);
    const ctx2 = await requireMembership(res2.organization.id);
    const concept = await createDraftVacancy(ctx2, {
      locationId: res2.location.id,
      title: "Na trial",
      role: "tandarts",
      schedule: rooster(["ma"]),
      hoursMin: 24,
      hoursMax: 32,
      contractTypes: ["loondienst"],
    });
    await expect(publishVacancy(ctx2, concept.id)).rejects.toThrow(EntitlementError);

    // herstel sessie voor eventuele vervolgtests
    alsGebruiker(owner.id);
  });
});

/* ------------------------- fase 4: uitbreidbaarheid ------------------------ */

/** Nieuwe organisatie met eigenaar en (optioneel) een betaald plan. */
async function nieuweOrgMetPlan(
  email: string,
  naam: string,
  plan: "essential" | "growth" | null,
) {
  const gebruiker = await maakGebruiker(email, naam);
  alsGebruiker(gebruiker.id);
  const res = await createOrganizationWithLocation({
    name: naam,
    location: {
      name: "Locatie",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 2,
    },
  });
  if (plan) {
    await getBillingProvider().startSubscription(res.organization.id, plan);
  }
  return { gebruiker, orgId: res.organization.id };
}

async function huidigAbonnement(orgId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { organizationId: orgId, status: { not: "canceled" } },
    orderBy: { createdAt: "desc" },
    include: { planVersion: { include: { plan: true } }, items: true },
  });
  expect(sub).not.toBeNull();
  return sub!;
}

describe("uitbreidingen (add-ons)", () => {
  it("een add-on verhoogt de limiet per direct en is idempotent", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "addons@commercieel.nl",
      "Praktijk Addons",
      "essential",
    );

    let eff = await effectiveEntitlements(orgId);
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(3);
    expect(eff.entitlements.max_members?.limitInt).toBe(3);
    expect(eff.entitlements.api_access?.enabled).toBe(false);

    await setSubscriptionItems(orgId, {
      extra_active_vacancy: 2,
      extra_seat: 1,
      api_access_addon: 1,
    });

    eff = await effectiveEntitlements(orgId);
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(5); // 3 + 2×1
    expect(eff.entitlements.max_members?.limitInt).toBe(4); // 3 + 1
    expect(eff.entitlements.api_access?.enabled).toBe(true); // feature aan

    // Idempotent: dezelfde eindstand nogmaals zetten wijzigt niets en laat
    // precies één rij per sleutel staan.
    await setSubscriptionItems(orgId, { extra_active_vacancy: 2 });
    const sub = await huidigAbonnement(orgId);
    const vacatureItems = sub.items.filter((i) => i.key === "extra_active_vacancy");
    expect(vacatureItems).toHaveLength(1);
    expect(vacatureItems[0].quantity).toBe(2);

    eff = await effectiveEntitlements(orgId);
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(5);

    // Terug naar 0 verwijdert de rij en herstelt de planlimiet.
    await setSubscriptionItems(orgId, { extra_seat: 0 });
    const subNa = await huidigAbonnement(orgId);
    expect(subNa.items.some((i) => i.key === "extra_seat")).toBe(false);
    eff = await effectiveEntitlements(orgId);
    expect(eff.entitlements.max_members?.limitInt).toBe(3);
  });

  it("uitbreidingen zijn niet beschikbaar op het trialplan", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "addons-trial@commercieel.nl",
      "Praktijk Addons Trial",
      null, // blijft op trial
    );
    await expect(
      setSubscriptionItems(orgId, { extra_seat: 1 }),
    ).rejects.toThrow(BillingError);
  });
});

describe("geplande downgrade (per periode-einde)", () => {
  it("wordt pas actief nadat applyScheduledChanges de vervallen planning verwerkt", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "downgrade@commercieel.nl",
      "Praktijk Downgrade",
      "growth",
    );
    const provider = getBillingProvider();

    await provider.schedulePlanChange(orgId, "essential");

    // Tot het periode-einde blijven de growth-entitlements gelden.
    let eff = await effectiveEntitlements(orgId);
    expect(eff.planCode).toBe("growth");
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(15);

    const sub = await huidigAbonnement(orgId);
    expect(sub.scheduledPlanVersionId).not.toBeNull();
    expect(sub.scheduledChangeAt?.getTime()).toBe(sub.currentPeriodEnd.getTime());

    // Verwerking vóór het periode-einde doet niets.
    await applyScheduledChanges();
    eff = await effectiveEntitlements(orgId);
    expect(eff.planCode).toBe("growth");

    // Periode kunstmatig laten verstrijken en verwerken.
    const gisteren = new Date(Date.now() - 86_400_000);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: gisteren, scheduledChangeAt: gisteren },
    });
    const resultaat = await applyScheduledChanges();
    expect(resultaat.planChanges).toBeGreaterThanOrEqual(1);

    eff = await effectiveEntitlements(orgId);
    expect(eff.planCode).toBe("essential");
    expect(eff.status).toBe("active");
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(3);

    // Idempotent: de planning is gewist, een tweede run verwerkt niets meer.
    const subNa = await huidigAbonnement(orgId);
    expect(subNa.scheduledPlanVersionId).toBeNull();
    expect(subNa.scheduledChangeAt).toBeNull();
    const tweede = await applyScheduledChanges();
    expect(tweede.planChanges).toBe(0);
  });
});

describe("heractivatie", () => {
  it("draait een opzegging per periode-einde terug binnen de lopende periode", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "heractivatie@commercieel.nl",
      "Praktijk Heractivatie",
      "essential",
    );
    const provider = getBillingProvider();

    await provider.cancelSubscription(orgId, true);
    let sub = await huidigAbonnement(orgId);
    expect(sub.cancelAtPeriodEnd).toBe(true);

    await provider.reactivateSubscription(orgId);
    sub = await huidigAbonnement(orgId);
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect(sub.status).toBe("active");

    // Idempotent: nogmaals heractiveren is een stille no-op.
    await provider.reactivateSubscription(orgId);
    sub = await huidigAbonnement(orgId);
    expect(sub.cancelAtPeriodEnd).toBe(false);
  });

  it("start een nieuw abonnement op hetzelfde plan wanneer het laatste al beëindigd is", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "heractivatie2@commercieel.nl",
      "Praktijk Heractivatie 2",
      "growth",
    );
    const provider = getBillingProvider();

    await provider.cancelSubscription(orgId, false); // per direct beëindigd
    let eff = await effectiveEntitlements(orgId);
    expect(eff.status).toBe("none"); // geen lopend abonnement meer

    await provider.reactivateSubscription(orgId);
    eff = await effectiveEntitlements(orgId);
    expect(eff.planCode).toBe("growth");
    expect(eff.status).toBe("active");
    expect(eff.entitlements.talent_radar?.enabled).toBe(true);
  });
});

describe("failed payment → past_due met coulance (grace)", () => {
  it("behoudt toegang binnen de grace en vergrendelt daarna; betaling herstelt", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "pastdue@commercieel.nl",
      "Praktijk Past Due",
      "growth",
    );

    const uitkomst = await simulateLocalPaymentEvent(orgId, "payment_failed");
    expect(uitkomst.processed).toBe(true);

    let sub = await huidigAbonnement(orgId);
    expect(sub.status).toBe("past_due");
    expect(sub.graceUntil).not.toBeNull();
    // graceUntil ≈ nu + 14 dagen
    const dagen = (sub.graceUntil!.getTime() - Date.now()) / 86_400_000;
    expect(dagen).toBeGreaterThan(13);
    expect(dagen).toBeLessThanOrEqual(14.01);

    // Binnen de grace: coulance — entitlements blijven gelden.
    let eff = await effectiveEntitlements(orgId);
    expect(eff.status).toBe("past_due");
    expect(eff.entitlements.talent_radar?.enabled).toBe(true);
    expect(eff.entitlements.max_active_vacancies?.limitInt).toBe(15);

    // Ná de grace: vergrendeld (alles uit, basis-analytics blijft).
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { graceUntil: new Date(Date.now() - 86_400_000) },
    });
    eff = await effectiveEntitlements(orgId);
    expect(eff.status).toBe("past_due");
    expect(eff.entitlements.talent_radar?.enabled).toBe(false);
    expect(eff.entitlements.max_active_vacancies?.enabled).toBe(false);
    expect(eff.entitlements.analytics_level?.enabled).toBe(true);

    // Geslaagde betaling herstelt het abonnement met een nieuwe periode.
    const herstel = await simulateLocalPaymentEvent(orgId, "payment_succeeded");
    expect(herstel.processed).toBe(true);
    sub = await huidigAbonnement(orgId);
    expect(sub.status).toBe("active");
    expect(sub.graceUntil).toBeNull();
    expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());

    eff = await effectiveEntitlements(orgId);
    expect(eff.status).toBe("active");
    expect(eff.entitlements.talent_radar?.enabled).toBe(true);
  });
});

describe("inkomende webhooks", () => {
  it("is idempotent: hetzelfde externalId twee keer geeft één verwerking", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "webhook@commercieel.nl",
      "Praktijk Webhook",
      "essential",
    );
    const externalId = "evt_test_dubbel_1";

    const eerste = await simulateLocalPaymentEvent(orgId, "payment_failed", externalId);
    expect(eerste.processed).toBe(true);

    const tweede = await simulateLocalPaymentEvent(orgId, "payment_failed", externalId);
    expect(tweede.processed).toBe(false);
    expect(tweede.status).toBe("duplicaat");

    const rijen = await prisma.inboundWebhookEvent.count({
      where: { provider: "local_test", externalId },
    });
    expect(rijen).toBe(1);

    // Ook de notificatie voor de eigenaar is er precies één per event.
    const meldingen = await prisma.notification.count({
      where: { type: "payment_failed", dedupeKey: { contains: externalId } },
    });
    expect(meldingen).toBe(1);

    // Onbekende types worden vastgelegd als "genegeerd", ook idempotent.
    const onbekend = await simulateLocalPaymentEvent(
      orgId,
      // @ts-expect-error bewust een onbekend type om het vangnet te testen
      "invoice_finalized",
      "evt_test_onbekend_1",
    );
    expect(onbekend.processed).toBe(false);
    expect(onbekend.status).toBe("genegeerd");
  });

  it("draait een geldige actieve status niet terug door een ouder (out-of-order) event", async () => {
    const { orgId } = await nieuweOrgMetPlan(
      "ordering@commercieel.nl",
      "Praktijk Ordering",
      "growth",
    );

    const t1 = new Date("2026-06-01T10:00:00.000Z");
    const t2 = new Date("2026-06-01T12:00:00.000Z");

    // Nieuwer event (t2) wordt verwerkt: abonnement actief.
    const succes = await simulateLocalPaymentEvent(
      orgId,
      "payment_succeeded",
      "evt_ordering_succeeded",
      t2,
    );
    expect(succes.processed).toBe(true);
    expect((await huidigAbonnement(orgId)).status).toBe("active");

    // Ouder, later aankomend payment_failed (t1 < t2) mag NIET terugdraaien.
    const ouder = await simulateLocalPaymentEvent(
      orgId,
      "payment_failed",
      "evt_ordering_failed_old",
      t1,
    );
    expect(ouder.processed).toBe(false);
    expect(ouder.status).toBe("genegeerd");

    const sub = await huidigAbonnement(orgId);
    expect(sub.status).toBe("active");
    expect(sub.graceUntil).toBeNull();
  });
});
