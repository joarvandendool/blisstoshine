// Commerciële integratietests (verplicht volgens de productopdracht):
// - entitlements worden per plan toegepast
// - planwijziging past limieten correct aan
// - bestaande abonnementen behouden hun planversie
// - usage events zijn idempotent
// - trial-expiratie vergrendelt functionaliteit

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
  EntitlementError,
  effectiveEntitlements,
  enforceEntitlement,
  getBillingProvider,
  recordUsage,
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
