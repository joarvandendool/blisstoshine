// Plaatsingsevents zijn idempotent (functional-excellence, fase 6/audit P0):
// - één "aannemen"-actie vuurt vacancy_filled én candidate_hired precies
//   één keer (markFilled is de énige emitter van vacancy_filled);
// - een herhaalde "aannemen" vuurt geen van beide events opnieuw en maakt
//   geen dubbele journaalregel.

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
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
import { getBillingProvider } from "@/lib/billing";
import { createOrganizationWithLocation } from "@/server/organizations";
import { createDraftVacancy, publishVacancy } from "@/server/vacancies";
import {
  applyToVacancy,
  setPipelineStatus,
  updateApplicationStatus,
} from "@/server/applications";
import { alsGebruiker, prepareTestDb, maakKandidaat, rooster } from "./helpers";

let owner: Awaited<ReturnType<typeof maakKandidaat>>["user"];
let carla: Awaited<ReturnType<typeof maakKandidaat>>;
let org: { id: string; slug: string };
let vacature: { id: string };

async function telEvents(name: string): Promise<number> {
  return prisma.analyticsEvent.count({
    where: { name, organizationId: org.id },
  });
}

beforeAll(async () => {
  await prepareTestDb();

  const eigenaar = await maakKandidaat("owner-hire@test.nl", "Owner Hire");
  owner = eigenaar.user;
  // Het eigenaarsprofiel niet gebruiken als kandidaat; alleen de user voor de org.
  await prisma.candidateProfile.deleteMany({ where: { userId: owner.id } });

  alsGebruiker(owner.id);
  const o = await createOrganizationWithLocation({
    name: "Praktijk Hire",
    location: {
      name: "Hire Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 3,
    },
  });
  org = o.organization;
  await getBillingProvider().changePlan(org.id, "growth");

  const ctx = await requireMembership(org.id);
  vacature = await createDraftVacancy(ctx, {
    locationId: o.location.id,
    title: "Mondhygiënist",
    role: "mondhygienist",
    schedule: rooster(["di", "do"]),
    hoursMin: 16,
    hoursMax: 32,
    contractTypes: ["loondienst"],
  });
  await publishVacancy(ctx, vacature.id);

  carla = await maakKandidaat("carla-hire@test.nl", "Carla Kandidaat", {
    visibility: "visible",
  });
  alsGebruiker(carla.user.id);
  await applyToVacancy(vacature.id);
});

describe("plaatsingsevents zijn idempotent", () => {
  it("één aannemen vuurt vacancy_filled en candidate_hired precies één keer", async () => {
    alsGebruiker(owner.id);
    const ctx = await requireMembership(org.id);
    await setPipelineStatus(ctx, vacature.id, carla.user.id, "hired");

    expect(await telEvents("vacancy_filled")).toBe(1);
    expect(await telEvents("candidate_hired")).toBe(1);

    const na = await prisma.vacancy.findUniqueOrThrow({ where: { id: vacature.id } });
    expect(na.status).toBe("filled");
  });

  it("herhaald aannemen vuurt geen enkel event opnieuw en journaliseert niet dubbel", async () => {
    alsGebruiker(owner.id);
    const ctx = await requireMembership(org.id);

    const hiredRegelsVoor = await prisma.pipelineStatusChange.count({
      where: { vacancyId: vacature.id, toStatus: "hired" },
    });

    await setPipelineStatus(ctx, vacature.id, carla.user.id, "hired");

    expect(await telEvents("vacancy_filled")).toBe(1);
    expect(await telEvents("candidate_hired")).toBe(1);

    const hiredRegelsNa = await prisma.pipelineStatusChange.count({
      where: { vacancyId: vacature.id, toStatus: "hired" },
    });
    expect(hiredRegelsNa).toBe(hiredRegelsVoor);
  });
});

describe("statusovergang is race-veilig", () => {
  it("twee gelijktijdige statuswijzigingen: precies één slaagt, de ander krijgt 409", async () => {
    // Verse praktijk + vacature + sollicitant in status 'submitted'.
    const owner2 = await maakKandidaat("owner-race@test.nl", "Owner Race");
    await prisma.candidateProfile.deleteMany({ where: { userId: owner2.user.id } });
    alsGebruiker(owner2.user.id);
    const o = await createOrganizationWithLocation({
      name: "Praktijk Race Status",
      location: {
        name: "Race Utrecht",
        city: "Utrecht",
        postcode: "3511 AB",
        treatmentRooms: 2,
      },
    });
    await getBillingProvider().changePlan(o.organization.id, "growth");
    const ctx = await requireMembership(o.organization.id);
    const vac = await createDraftVacancy(ctx, {
      locationId: o.location.id,
      title: "Mondhygiënist",
      role: "mondhygienist",
      schedule: rooster(["di", "do"]),
      hoursMin: 16,
      hoursMax: 32,
      contractTypes: ["loondienst"],
    });
    await publishVacancy(ctx, vac.id);

    const soll = await maakKandidaat("race-cand@test.nl", "Race Kandidaat", {
      visibility: "visible",
    });
    alsGebruiker(soll.user.id);
    const application = await applyToVacancy(vac.id);

    // Twee tegelijkertijd concurrerende overgangen vanuit 'submitted'.
    const resultaten = await Promise.allSettled([
      updateApplicationStatus(ctx, application.id, "interview"),
      updateApplicationStatus(ctx, application.id, "offered"),
    ]);
    const geslaagd = resultaten.filter((r) => r.status === "fulfilled");
    const gefaald = resultaten.filter((r) => r.status === "rejected");
    expect(geslaagd).toHaveLength(1);
    expect(gefaald).toHaveLength(1);

    // Precies één journaalregel voor deze overgang (geen divergentie).
    const overgangsregels = await prisma.pipelineStatusChange.count({
      where: {
        vacancyId: vac.id,
        toStatus: { in: ["interview_scheduled", "offer"] },
      },
    });
    expect(overgangsregels).toBe(1);
  });
});
