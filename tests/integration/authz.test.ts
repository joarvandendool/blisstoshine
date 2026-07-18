// Autorisatie- en tenantisolatietests (verplicht volgens de productopdracht):
// - tenant A kan tenant B niet lezen
// - viewer kan geen vacature publiceren
// - recruiter kan geen billing wijzigen
// - kandidaatprivacy wordt gerespecteerd
// - geaggregeerde inzichten lekken geen individuele data

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
import { AuthzError, requireMembership } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import {
  createOrganizationWithLocation,
  getOrgForUserBySlug,
} from "@/server/organizations";
import {
  createDraftVacancy,
  publishVacancy,
  getVacancy,
} from "@/server/vacancies";
import {
  candidatesForVacancy,
  simulateVacancyPool,
} from "@/server/matching";
import { radarForVacancy } from "@/server/radar";
import {
  alsGebruiker,
  prepareTestDb,
  maakGebruiker,
  maakKandidaat,
  rooster,
} from "./helpers";

let ownerA: Awaited<ReturnType<typeof maakGebruiker>>;
let viewerA: Awaited<ReturnType<typeof maakGebruiker>>;
let recruiterA: Awaited<ReturnType<typeof maakGebruiker>>;
let ownerB: Awaited<ReturnType<typeof maakGebruiker>>;
let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let vacatureA: { id: string };
let conceptA: { id: string };
let vacatureB: { id: string };

beforeAll(async () => {
  await prepareTestDb();

  ownerA = await maakGebruiker("owner-a@test.nl", "Owner A");
  viewerA = await maakGebruiker("viewer-a@test.nl", "Viewer A");
  recruiterA = await maakGebruiker("recruiter-a@test.nl", "Recruiter A");
  ownerB = await maakGebruiker("owner-b@test.nl", "Owner B");

  alsGebruiker(ownerA.id);
  const a = await createOrganizationWithLocation({
    name: "Praktijk Alfa",
    location: {
      name: "Alfa Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 3,
    },
  });
  orgA = a.organization;

  alsGebruiker(ownerB.id);
  const b = await createOrganizationWithLocation({
    name: "Praktijk Beta",
    location: {
      name: "Beta Rotterdam",
      city: "Rotterdam",
      postcode: "3011 AB",
      treatmentRooms: 2,
    },
  });
  orgB = b.organization;

  await prisma.membership.createMany({
    data: [
      { userId: viewerA.id, organizationId: orgA.id, role: "viewer" },
      { userId: recruiterA.id, organizationId: orgA.id, role: "recruiter" },
    ],
  });

  // Growth-plan voor org A zodat Match Studio/Talent Radar entitlements aanstaan
  await getBillingProvider().changePlan(orgA.id, "growth");

  // Kandidaten: zichtbaar, anoniem en verborgen
  await maakKandidaat("zichtbaar@test.nl", "Zora Zichtbaar", { visibility: "visible" });
  await maakKandidaat("anoniem@test.nl", "Anna Anoniem", { visibility: "anonymous" });
  await maakKandidaat("verborgen@test.nl", "Vera Verborgen", { visibility: "hidden" });

  alsGebruiker(ownerA.id);
  const ctxA = await requireMembership(orgA.id);
  vacatureA = await createDraftVacancy(ctxA, {
    locationId: a.location.id,
    title: "Mondhygiënist",
    role: "mondhygienist",
    schedule: rooster(["di", "do"]),
    hoursMin: 16,
    hoursMax: 32,
    contractTypes: ["loondienst"],
  });
  await publishVacancy(ctxA, vacatureA.id);
  conceptA = await createDraftVacancy(ctxA, {
    locationId: a.location.id,
    title: "Tandartsassistent",
    role: "tandartsassistent",
    schedule: rooster(["ma"]),
    hoursMin: 24,
    hoursMax: 36,
    contractTypes: ["loondienst"],
  });

  alsGebruiker(ownerB.id);
  const ctxB = await requireMembership(orgB.id);
  vacatureB = await createDraftVacancy(ctxB, {
    locationId: b.location.id,
    title: "Tandarts",
    role: "tandarts",
    schedule: rooster(["ma", "wo"]),
    hoursMin: 24,
    hoursMax: 40,
    contractTypes: ["loondienst", "zzp"],
  });
  await publishVacancy(ctxB, vacatureB.id);
});

describe("tenantisolatie", () => {
  it("gebruiker van organisatie A krijgt geen toegang tot organisatie B", async () => {
    alsGebruiker(ownerA.id);
    await expect(getOrgForUserBySlug(orgB.slug)).rejects.toThrow(AuthzError);
  });

  it("vacatures van organisatie B zijn niet leesbaar met een A-context", async () => {
    alsGebruiker(ownerA.id);
    const ctxA = await requireMembership(orgA.id);
    await expect(getVacancy(ctxA, vacatureB.id)).rejects.toThrow(AuthzError);
  });

  it("kandidatenpool van een B-vacature is niet opvraagbaar met een A-context", async () => {
    alsGebruiker(ownerA.id);
    const ctxA = await requireMembership(orgA.id);
    await expect(candidatesForVacancy(ctxA, vacatureB.id)).rejects.toThrow(AuthzError);
    await expect(simulateVacancyPool(ctxA, vacatureB.id, {})).rejects.toThrow(
      AuthzError,
    );
  });

  it("zonder ingelogde sessie is er geen toegang", async () => {
    alsGebruiker(null);
    await expect(getOrgForUserBySlug(orgA.slug)).rejects.toThrow(AuthzError);
  });
});

describe("rolbeperkingen", () => {
  it("viewer kan geen vacature publiceren", async () => {
    alsGebruiker(viewerA.id);
    const ctx = await requireMembership(orgA.id);
    await expect(publishVacancy(ctx, conceptA.id)).rejects.toThrow(AuthzError);
  });

  it("recruiter kan geen billing wijzigen", async () => {
    alsGebruiker(recruiterA.id);
    await expect(requireMembership(orgA.id, "billing.manage")).rejects.toThrow(
      AuthzError,
    );
  });

  it("owner mag billing wél beheren", async () => {
    alsGebruiker(ownerA.id);
    const ctx = await requireMembership(orgA.id, "billing.manage");
    expect(ctx.role).toBe("owner");
  });
});

describe("kandidaatprivacy", () => {
  it("anonieme kandidaten tonen geen naam; verborgen kandidaten ontbreken", async () => {
    alsGebruiker(ownerA.id);
    const ctx = await requireMembership(orgA.id);
    const pool = await candidatesForVacancy(ctx, vacatureA.id);

    const namen = pool.map((k) => k.displayName);
    expect(namen.some((n) => n.includes("Zora"))).toBe(true);
    expect(namen.some((n) => n.includes("Anna"))).toBe(false);
    expect(namen.some((n) => n.includes("Vera"))).toBe(false);

    const anoniem = pool.find((k) => !k.displayName.includes("Zora"));
    expect(anoniem).toBeDefined();
    expect(anoniem!.displayName.toLowerCase()).toContain("mondhygiënist");
  });
});

describe("geaggregeerde inzichten", () => {
  it("Talent Radar maskeert aantallen onder de privacydrempel", async () => {
    // Er zijn maar 2 matchende kandidaten — onder TALENT_RADAR_MIN_GROUP.
    alsGebruiker(ownerA.id);
    const ctx = await requireMembership(orgA.id);
    const rapport = await radarForVacancy(ctx, { vacancyId: vacatureA.id });

    expect(TALENT_RADAR_MIN_GROUP).toBeGreaterThanOrEqual(5);
    expect(rapport.totalPotential).toBeNull();
    expect(rapport.strongMatches).toBeNull();
    for (const dag of rapport.perDay) {
      expect(dag.count === null || dag.count >= TALENT_RADAR_MIN_GROUP).toBe(true);
    }
    if (rapport.mostLimiting) {
      expect(
        rapport.mostLimiting.extraEligible === null ||
          rapport.mostLimiting.extraEligible >= TALENT_RADAR_MIN_GROUP,
      ).toBe(true);
    }
  });
});
