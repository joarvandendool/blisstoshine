// Integratietests voor multi-location (Workstream A, fase 3):
// (a) een locatiegebonden gebruiker (Membership.locationIds=[A]) ziet
//     locatie B niet — bezetting én team;
// (b) een centrale gebruiker ziet alles binnen de eigen organisatie, maar
//     niets van een andere organisatie;
// (c) een viewer kan niet publiceren (bestaande capability-matrix);
// (d) billing_manager heeft billing.manage maar krijgt AuthzError op
//     kandidaatgerelateerde capabilities;
// (e) cross-locatiematching werkt alleen met de entitlement
//     cross_location_matching;
// (f) een staffing-scenario is immutable (result verandert niet na een
//     latere teamwijziging) en bevestiging maakt een conceptvacature;
// (g) consent-scope per vacature lekt niet cross-locatie;
// (h) ledenbeheer: uitnodigen op e-mail, rol/locaties wijzigen, deactiveren.

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

import {
  AuthzError,
  allowedLocationIds,
  requireMembership,
  roleCan,
} from "@/lib/authz";
import { EntitlementError, getBillingProvider } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  addLocation,
  createOrganizationWithLocation,
  deactivateMember,
  inviteMember,
  listLocations,
  listMembers,
  moveVacancy,
  updateLocation,
  updateMember,
} from "@/server/organizations";
import {
  capacityWeek,
  confirmScenario,
  emptyStaffingTarget,
  listTeamMembers,
  maandagVan,
  rejectScenario,
  runScenario,
  saveStaffingTarget,
  upsertTeamMember,
  type StaffingTarget,
  type TeamSchedule,
} from "@/server/capacity";
import {
  candidatesForVacancy,
  organizationCandidatePool,
} from "@/server/matching";
import { createDraftVacancy, castSchedule, publishVacancy } from "@/server/vacancies";
import { grantConsent } from "@/server/pipeline";
import { DAYPARTS, WEEKDAYS, type Daypart, type Weekday } from "@/domain/taxonomy";
import {
  alsGebruiker,
  beschikbaarheid,
  maakGebruiker,
  maakKandidaat,
  prepareTestDb,
} from "./helpers";

/* ------------------------------- hulpfuncties ------------------------------ */

const DAG_MS = 86_400_000;

function rooster(spec: Partial<Record<Weekday, Daypart[]>>): TeamSchedule {
  const uit = {} as TeamSchedule;
  for (const dag of WEEKDAYS) {
    uit[dag] = { ochtend: false, middag: false, avond: false };
    for (const dagdeel of spec[dag] ?? []) uit[dag][dagdeel] = true;
  }
  return uit;
}

function minimum(
  spec: Partial<Record<Weekday, Partial<Record<Daypart, number>>>>,
): StaffingTarget {
  const uit = emptyStaffingTarget();
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      const aantal = spec[dag]?.[dagdeel];
      if (aantal !== undefined) uit[dag][dagdeel] = aantal;
    }
  }
  return uit;
}

/* --------------------------------- fixtures -------------------------------- */

let ownerML: Awaited<ReturnType<typeof maakGebruiker>>;
let lokaleAdmin: Awaited<ReturnType<typeof maakGebruiker>>;
let viewerUser: Awaited<ReturnType<typeof maakGebruiker>>;
let billingUser: Awaited<ReturnType<typeof maakGebruiker>>;
let ownerX: Awaited<ReturnType<typeof maakGebruiker>>;

let org1: { id: string; slug: string };
let locA: { id: string };
let locB: { id: string };
let org2: { id: string; slug: string };
let locC: { id: string };
let locD: { id: string };

let vacA: { id: string; title: string };
let vacB: { id: string };

let kandidaat: Awaited<ReturnType<typeof maakKandidaat>>;

async function ctxOwner() {
  alsGebruiker(ownerML.id);
  return requireMembership(org1.id);
}

beforeAll(async () => {
  await prepareTestDb();

  ownerML = await maakGebruiker("ml-owner@test.nl", "Owner Keten");
  lokaleAdmin = await maakGebruiker("ml-lokaal@test.nl", "Lokale Admin");
  viewerUser = await maakGebruiker("ml-viewer@test.nl", "Kijker Kees");
  billingUser = await maakGebruiker("ml-billing@test.nl", "Facturatie Fien");
  ownerX = await maakGebruiker("ml-owner-x@test.nl", "Owner Solo");

  // Organisatie 1: multi-locatieplan met twee locaties.
  alsGebruiker(ownerML.id);
  const a = await createOrganizationWithLocation({
    name: "Keten Midden",
    location: { name: "Hoofdlocatie Utrecht", city: "Utrecht", postcode: "3511 AB", treatmentRooms: 3 },
  });
  org1 = a.organization;
  locA = a.location;
  await getBillingProvider().changePlan(org1.id, "multi_location");

  const ctx1 = await ctxOwner();
  locB = await addLocation(ctx1, {
    name: "Filiaal Rotterdam",
    postcode: "3011 AB",
    city: "Rotterdam",
    treatmentRooms: 2,
  });

  // Extra memberships: lokaal (alleen locatie A), viewer en billing_manager.
  await prisma.membership.create({
    data: { userId: lokaleAdmin.id, organizationId: org1.id, role: "admin", locationIds: [locA.id] },
  });
  await prisma.membership.create({
    data: { userId: viewerUser.id, organizationId: org1.id, role: "viewer" },
  });
  await prisma.membership.create({
    data: { userId: billingUser.id, organizationId: org1.id, role: "billing_manager" },
  });

  // Gepubliceerde vacatures op beide locaties van organisatie 1.
  const conceptA = await createDraftVacancy(ctx1, {
    locationId: locA.id,
    title: "Tandarts Utrecht",
    role: "tandarts",
    hoursMin: 16,
    hoursMax: 32,
  });
  vacA = await publishVacancy(ctx1, conceptA.id);
  const conceptB = await createDraftVacancy(ctx1, {
    locationId: locB.id,
    title: "Tandarts Rotterdam",
    role: "tandarts",
    hoursMin: 16,
    hoursMax: 32,
  });
  vacB = await publishVacancy(ctx1, conceptB.id);

  // Organisatie 2: trialplan; tweede locatie en tweede publicatie direct in
  // de database (bewust langs de limieten heen — we testen de entitlement op
  // cross-locatiematching, niet de locatielimiet).
  alsGebruiker(ownerX.id);
  const x = await createOrganizationWithLocation({
    name: "Solo Praktijk",
    location: { name: "Solo Utrecht", city: "Utrecht", postcode: "3511 AB", treatmentRooms: 2 },
  });
  org2 = x.organization;
  locC = x.location;
  locD = await prisma.practiceLocation.create({
    data: {
      organizationId: org2.id,
      name: "Solo Tweede",
      city: "Rotterdam",
      postcode: "3011 AB",
      latitude: 51.9225,
      longitude: 4.47917,
      treatmentRooms: 1,
    },
  });
  const ctx2 = await (async () => {
    alsGebruiker(ownerX.id);
    return requireMembership(org2.id);
  })();
  const conceptC = await createDraftVacancy(ctx2, {
    locationId: locC.id,
    title: "Tandarts Solo",
    role: "tandarts",
    hoursMin: 16,
    hoursMax: 32,
  });
  await publishVacancy(ctx2, conceptC.id);
  const conceptD = await createDraftVacancy(ctx2, {
    locationId: locD.id,
    title: "Tandarts Solo Twee",
    role: "tandarts",
    hoursMin: 16,
    hoursMax: 32,
  });
  await prisma.vacancy.update({ where: { id: conceptD.id }, data: { status: "published" } });

  // Eén anonieme kandidaat voor de consent-scope-test.
  kandidaat = await maakKandidaat("ml-kandidaat@test.nl", "Sanne de Vries", {
    role: "tandarts",
    visibility: "anonymous",
    availability: beschikbaarheid(["ma", "di", "wo", "do", "vr"]),
  });
});

/* ---------------------------------- tests ---------------------------------- */

describe("locatiegebonden rechten", () => {
  it("een lokale gebruiker (locationIds=[A]) ziet locatie B niet — bezetting én team", async () => {
    alsGebruiker(lokaleAdmin.id);
    const ctx = await requireMembership(org1.id);
    expect(allowedLocationIds(ctx)).toEqual([locA.id]);

    // Locatie A werkt gewoon.
    await expect(capacityWeek(ctx, locA.id)).resolves.toBeDefined();
    await expect(listTeamMembers(ctx, locA.id)).resolves.toBeDefined();

    // Locatie B is verboden terrein (AuthzError), ook voor het team.
    await expect(capacityWeek(ctx, locB.id)).rejects.toThrow(AuthzError);
    await expect(listTeamMembers(ctx, locB.id)).rejects.toThrow(AuthzError);
    await expect(saveStaffingTarget(ctx, locB.id, emptyStaffingTarget())).rejects.toThrow(
      AuthzError,
    );
    await expect(candidatesForVacancy(ctx, vacB.id)).rejects.toThrow(AuthzError);

    // listLocations filtert op de toewijzing.
    const locaties = await listLocations(ctx);
    expect(locaties.map((l) => l.id)).toEqual([locA.id]);

    // requireMembership met expliciete locatie: A mag, B niet.
    await expect(requireMembership(org1.id, undefined, locA.id)).resolves.toBeDefined();
    await expect(requireMembership(org1.id, undefined, locB.id)).rejects.toThrow(AuthzError);
  });

  it("een centrale gebruiker ziet alles binnen de eigen org, maar niets van een andere org", async () => {
    const ctx = await ctxOwner();
    expect(allowedLocationIds(ctx)).toBeNull();

    const locaties = await listLocations(ctx);
    expect(locaties.map((l) => l.id).sort()).toEqual([locA.id, locB.id].sort());
    await expect(capacityWeek(ctx, locA.id)).resolves.toBeDefined();
    await expect(capacityWeek(ctx, locB.id)).resolves.toBeDefined();

    // Andere organisatie: locaties onvindbaar, membership geweigerd.
    await expect(capacityWeek(ctx, locC.id)).rejects.toThrow(AuthzError);
    alsGebruiker(ownerML.id);
    await expect(requireMembership(org2.id)).rejects.toThrow(AuthzError);
  });
});

describe("rollen", () => {
  it("een viewer kan niet publiceren", async () => {
    const ctx1 = await ctxOwner();
    const concept = await createDraftVacancy(ctx1, {
      locationId: locA.id,
      title: "Concept voor viewer-test",
      role: "mondhygienist",
      hoursMin: 8,
      hoursMax: 24,
    });

    alsGebruiker(viewerUser.id);
    const ctxViewer = await requireMembership(org1.id);
    await expect(publishVacancy(ctxViewer, concept.id)).rejects.toThrow(AuthzError);
    await expect(requireMembership(org1.id, "vacancy.publish")).rejects.toThrow(AuthzError);
  });

  it("billing_manager heeft billing.manage maar geen kandidaatgerelateerde capabilities", async () => {
    expect(roleCan("billing_manager", "billing.manage")).toBe(true);
    expect(roleCan("billing_manager", "candidate.invite")).toBe(false);
    expect(roleCan("billing_manager", "pipeline.manage")).toBe(false);
    expect(roleCan("billing_manager", "vacancy.manage")).toBe(false);

    alsGebruiker(billingUser.id);
    await expect(requireMembership(org1.id, "billing.manage")).resolves.toBeDefined();
    await expect(requireMembership(org1.id, "candidate.invite")).rejects.toThrow(AuthzError);
    await expect(requireMembership(org1.id, "pipeline.manage")).rejects.toThrow(AuthzError);

    const ctxBilling = await requireMembership(org1.id);
    await expect(organizationCandidatePool(ctxBilling)).rejects.toThrow(AuthzError);
    await expect(candidatesForVacancy(ctxBilling, vacA.id)).resolves.toBeDefined();
  });
});

describe("cross-locatiematching", () => {
  it("werkt met de entitlement (multi_location-plan)", async () => {
    const ctx = await ctxOwner();
    const pool = await organizationCandidatePool(ctx);
    // De pool beslaat vacatures van beide locaties.
    const locatieIds = new Set(pool.map((entry) => entry.locationId));
    expect(locatieIds.has(locA.id)).toBe(true);
    expect(locatieIds.has(locB.id)).toBe(true);
  });

  it("wordt geweigerd zonder entitlement (trialplan, EntitlementError 402)", async () => {
    alsGebruiker(ownerX.id);
    const ctx = await requireMembership(org2.id);
    await expect(organizationCandidatePool(ctx)).rejects.toThrow(EntitlementError);
  });

  it("moveVacancy verplaatst een vacature naar een andere eigen locatie met auditregel", async () => {
    const ctx = await ctxOwner();
    const concept = await createDraftVacancy(ctx, {
      locationId: locA.id,
      title: "Verplaatsbare vacature",
      role: "tandarts",
      hoursMin: 8,
      hoursMax: 16,
    });

    const verplaatst = await moveVacancy(ctx, concept.id, locB.id);
    expect(verplaatst.locationId).toBe(locB.id);

    const auditRij = await prisma.auditLog.findFirst({
      where: { action: "vacancy.move", entityId: concept.id },
    });
    expect(auditRij).not.toBeNull();

    // Niet naar een locatie van een andere organisatie.
    await expect(moveVacancy(ctx, concept.id, locC.id)).rejects.toThrow(AuthzError);
  });
});

describe("staffing-scenario's", () => {
  it("is immutable (result verandert niet na teamwijziging) en bevestiging maakt een conceptvacature", async () => {
    const ctx = await ctxOwner();
    const weekStart = maandagVan(new Date());

    // Eén tandarts dekt maandagochtend; die vertrekt over ~3 weken.
    const solo = await upsertTeamMember(ctx, locA.id, {
      name: "Solo Tandarts",
      role: "tandarts",
      schedule: rooster({ ma: ["ochtend"] }),
    });
    await saveStaffingTarget(ctx, locA.id, minimum({ ma: { ochtend: 1 } }));

    const uitkomst = await runScenario(ctx, locA.id, {
      kind: "vertrek",
      teamMemberId: solo.id,
      from: new Date(weekStart.getTime() + 20 * DAG_MS),
    });
    expect(uitkomst.scenario.status).toBe("simulatie");
    expect(uitkomst.afterGaps.length).toBeGreaterThan(0);

    const opgeslagen = await prisma.staffingScenario.findUniqueOrThrow({
      where: { id: uitkomst.scenario.id },
    });
    const resultVoorWijziging = JSON.stringify(opgeslagen.result);

    // Teamwijziging ná het scenario: extra tandarts op maandagochtend.
    const extra = await upsertTeamMember(ctx, locA.id, {
      name: "Extra Tandarts",
      role: "tandarts",
      schedule: rooster({ ma: ["ochtend"] }),
    });

    // Het opgeslagen resultaat is onveranderd (immutable simulatie).
    const naWijziging = await prisma.staffingScenario.findUniqueOrThrow({
      where: { id: uitkomst.scenario.id },
    });
    expect(JSON.stringify(naWijziging.result)).toBe(resultVoorWijziging);
    expect(naWijziging.status).toBe("simulatie");

    // Bevestiging → conceptvacature met de gaten als verplichte dagdelen.
    const bevestiging = await confirmScenario(ctx, uitkomst.scenario.id);
    expect(bevestiging.type).toBe("vacature");
    if (bevestiging.type === "vacature") {
      expect(bevestiging.vacancy.status).toBe("draft");
      expect(bevestiging.vacancy.locationId).toBe(locA.id);
      const vacRooster = castSchedule(bevestiging.vacancy.schedule);
      expect(vacRooster.ma.ochtend).toBe("required");
    }
    const bevestigd = await prisma.staffingScenario.findUniqueOrThrow({
      where: { id: uitkomst.scenario.id },
    });
    expect(bevestigd.status).toBe("bevestigd");
    expect(bevestigd.confirmedAt).not.toBeNull();

    // Nogmaals bevestigen kan niet (immutable na afronding).
    await expect(confirmScenario(ctx, uitkomst.scenario.id)).rejects.toThrow(AuthzError);

    // Verwerpen kan alleen vanuit "simulatie".
    const tweede = await runScenario(ctx, locA.id, {
      kind: "uitval",
      teamMemberId: extra.id,
    });
    await rejectScenario(ctx, tweede.scenario.id);
    const verworpen = await prisma.staffingScenario.findUniqueOrThrow({
      where: { id: tweede.scenario.id },
    });
    expect(verworpen.status).toBe("verworpen");
    await expect(rejectScenario(ctx, tweede.scenario.id)).rejects.toThrow(AuthzError);

    // Scenario's van organisatie 1 zijn voor organisatie 2 onvindbaar.
    alsGebruiker(ownerX.id);
    const ctx2 = await requireMembership(org2.id);
    await expect(confirmScenario(ctx2, uitkomst.scenario.id)).rejects.toThrow(AuthzError);
  });
});

describe("consent-scope per vacature", () => {
  it("consent voor vacature A geeft geen naam bij vacature B (andere locatie)", async () => {
    // De kandidaat geeft consent voor uitsluitend vacature A (locatie A).
    alsGebruiker(kandidaat.user.id);
    await grantConsent(org1.id, vacA.id);

    const ctx = await ctxOwner();

    const bijVacA = await candidatesForVacancy(ctx, vacA.id);
    const entryA = bijVacA.find((e) => e.profile.id === kandidaat.profiel.id);
    expect(entryA?.displayName).toBe("Sanne de Vries");

    const bijVacB = await candidatesForVacancy(ctx, vacB.id);
    const entryB = bijVacB.find((e) => e.profile.id === kandidaat.profiel.id);
    expect(entryB).toBeDefined();
    expect(entryB?.displayName).not.toContain("Sanne");

    // Ook in de organisatiebrede pool blijft de scope per vacature.
    const pool = await organizationCandidatePool(ctx);
    const poolA = pool.find(
      (e) => e.vacancyId === vacA.id && e.profile.id === kandidaat.profiel.id,
    );
    const poolB = pool.find(
      (e) => e.vacancyId === vacB.id && e.profile.id === kandidaat.profiel.id,
    );
    expect(poolA?.displayName).toBe("Sanne de Vries");
    if (poolB) {
      expect(poolB.displayName).not.toContain("Sanne");
    }
  });
});

describe("ledenbeheer", () => {
  it("uitnodigen op e-mail, rol/locaties wijzigen en deactiveren (members.manage)", async () => {
    const nieuweCollega = await maakGebruiker("ml-collega@test.nl", "Nieuwe Collega");
    const ctx = await ctxOwner();

    // Uitnodigen: bestaande gebruiker, billing_manager is toewijsbaar.
    const lid = await inviteMember(ctx, "ml-collega@test.nl", "billing_manager", [locB.id]);
    expect(lid.role).toBe("billing_manager");
    expect(lid.locationIds).toEqual([locB.id]);
    expect(lid.userId).toBe(nieuweCollega.id);

    // Onbekend e-mailadres en dubbele uitnodiging worden geweigerd.
    await expect(inviteMember(ctx, "bestaat-niet@test.nl", "viewer")).rejects.toThrow(AuthzError);
    await expect(inviteMember(ctx, "ml-collega@test.nl", "viewer")).rejects.toThrow(AuthzError);

    // Rol en locatietoewijzing wijzigen.
    const bijgewerkt = await updateMember(ctx, lid.membershipId, {
      role: "recruiter",
      locationIds: [locA.id, locB.id],
    });
    expect(bijgewerkt.role).toBe("recruiter");
    expect(bijgewerkt.locationIds.sort()).toEqual([locA.id, locB.id].sort());

    // Locaties van een andere organisatie zijn ongeldig.
    await expect(
      updateMember(ctx, lid.membershipId, { locationIds: [locC.id] }),
    ).rejects.toThrow(AuthzError);

    // Deactiveren; daarna staat het lid niet meer in de lijst.
    await deactivateMember(ctx, lid.membershipId);
    const leden = await listMembers(ctx);
    expect(leden.find((l) => l.membershipId === lid.membershipId)).toBeUndefined();

    // De laatste eigenaar kan zichzelf niet deactiveren of degraderen.
    const eigenaar = leden.find((l) => l.role === "owner");
    expect(eigenaar).toBeDefined();
    await expect(deactivateMember(ctx, eigenaar!.membershipId)).rejects.toThrow(AuthzError);
    await expect(
      updateMember(ctx, eigenaar!.membershipId, { role: "viewer" }),
    ).rejects.toThrow(AuthzError);

    // Zonder members.manage (viewer) is ledenbeheer verboden.
    alsGebruiker(viewerUser.id);
    const ctxViewer = await requireMembership(org1.id);
    await expect(listMembers(ctxViewer)).rejects.toThrow(AuthzError);

    // Locatie bewerken werkt en blijft tenant-gescoped.
    const ctxOpnieuw = await ctxOwner();
    const bijgewerkteLocatie = await updateLocation(ctxOpnieuw, locB.id, {
      name: "Filiaal Rotterdam Zuid",
      treatmentRooms: 4,
    });
    expect(bijgewerkteLocatie.name).toBe("Filiaal Rotterdam Zuid");
    expect(bijgewerkteLocatie.treatmentRooms).toBe(4);
    await expect(updateLocation(ctxOpnieuw, locC.id, { name: "Hack" })).rejects.toThrow(
      AuthzError,
    );
  });
});
