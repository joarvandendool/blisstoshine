// Integratietests voor de Praktijkbezetting (src/server/capacity.ts):
// (a) capacityWeek telt aanwezigheid en markeert een gat als "open";
// (b) afwezigheid maakt van "volledig" een "gedeeltelijk"/"open";
// (c) gapToVacancyDraft levert een conceptvacature met de juiste
//     required-dagdelen op;
// (d) tenant B kan de bezetting van tenant A niet lezen (AuthzError).

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

import { AuthzError, requireMembership } from "@/lib/authz";
import { createOrganizationWithLocation } from "@/server/organizations";
import {
  capacityWeek,
  deleteTeamMember,
  emptyStaffingTarget,
  gapToVacancyDraft,
  listTeamMembers,
  saveStaffingTarget,
  upsertTeamMember,
  type CapacityCell,
  type StaffingTarget,
  type TeamSchedule,
} from "@/server/capacity";
import { castSchedule } from "@/server/vacancies";
import { DAYPARTS, WEEKDAYS, type Daypart, type Weekday } from "@/domain/taxonomy";
import { alsGebruiker, prepareTestDb, maakGebruiker } from "./helpers";

/* ------------------------------- hulpfuncties ------------------------------ */

const DAG_MS = 86_400_000;

function teamRooster(spec: Partial<Record<Weekday, Daypart[]>>): TeamSchedule {
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

function cel(cells: CapacityCell[], dag: Weekday, dagdeel: Daypart): CapacityCell {
  const gevonden = cells.find((c) => c.day === dag && c.daypart === dagdeel);
  if (!gevonden) throw new Error(`Cel ${dag} ${dagdeel} ontbreekt`);
  return gevonden;
}

/* --------------------------------- fixtures -------------------------------- */

let ownerA: Awaited<ReturnType<typeof maakGebruiker>>;
let ownerB: Awaited<ReturnType<typeof maakGebruiker>>;
let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let locatieA: { id: string };

async function ctxVoorA() {
  alsGebruiker(ownerA.id);
  return requireMembership(orgA.id);
}

beforeAll(async () => {
  await prepareTestDb();

  ownerA = await maakGebruiker("bezetting-owner-a@test.nl", "Owner A");
  ownerB = await maakGebruiker("bezetting-owner-b@test.nl", "Owner B");

  alsGebruiker(ownerA.id);
  const a = await createOrganizationWithLocation({
    name: "Praktijk Bezetting Alfa",
    location: { name: "Alfa Utrecht", city: "Utrecht", postcode: "3511 AB", treatmentRooms: 3 },
  });
  orgA = a.organization;
  locatieA = a.location;

  alsGebruiker(ownerB.id);
  const b = await createOrganizationWithLocation({
    name: "Praktijk Bezetting Beta",
    location: { name: "Beta Rotterdam", city: "Rotterdam", postcode: "3011 AB", treatmentRooms: 2 },
  });
  orgB = b.organization;

  // Team van A: twee teamleden op maandagochtend, één op dinsdagochtend.
  const ctxA = await ctxVoorA();
  await upsertTeamMember(ctxA, locatieA.id, {
    name: "Esther Willems",
    role: "tandarts",
    schedule: teamRooster({ ma: ["ochtend"], di: ["ochtend"] }),
  });
  await upsertTeamMember(ctxA, locatieA.id, {
    name: "Bas van Leeuwen",
    role: "tandartsassistent",
    schedule: teamRooster({ ma: ["ochtend"] }),
  });

  // Gewenst minimum: 2 op maandagochtend, 1 op dinsdagochtend,
  // 1 op woensdagmiddag (waar niemand werkt → open).
  await saveStaffingTarget(
    ctxA,
    locatieA.id,
    minimum({ ma: { ochtend: 2 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
  );
});

/* ---------------------------------- tests ---------------------------------- */

describe("capacityWeek", () => {
  it("telt aanwezigheid en markeert een gat als 'open'", async () => {
    const ctxA = await ctxVoorA();
    const week = await capacityWeek(ctxA, locatieA.id);

    // Maandagochtend: 2 aanwezig van gewenst 2 → volledig.
    const maandag = cel(week.cells, "ma", "ochtend");
    expect(maandag.present).toBe(2);
    expect(maandag.target).toBe(2);
    expect(maandag.status).toBe("volledig");

    // Dinsdagochtend: 1 aanwezig van gewenst 1 → volledig.
    const dinsdag = cel(week.cells, "di", "ochtend");
    expect(dinsdag.present).toBe(1);
    expect(dinsdag.status).toBe("volledig");

    // Woensdagmiddag: gewenst 1, niemand ingepland → open.
    const woensdag = cel(week.cells, "wo", "middag");
    expect(woensdag.present).toBe(0);
    expect(woensdag.target).toBe(1);
    expect(woensdag.status).toBe("open");

    // Privacy: zonder (voldoende) kandidaten in de pool is de teller null.
    expect(woensdag.availableCandidates).toBeNull();
  });

  it("afwezigheid maakt van 'volledig' een 'gedeeltelijk' of 'open'", async () => {
    const ctxA = await ctxVoorA();

    // Extra teamlid dat alleen donderdagochtend werkt, deze week afwezig.
    const nu = new Date();
    const teamlid = await upsertTeamMember(ctxA, locatieA.id, {
      name: "Anouk Peters",
      role: "mondhygienist",
      schedule: teamRooster({ ma: ["ochtend"] }),
      absentFrom: new Date(nu.getTime() - 7 * DAG_MS),
      absentUntil: new Date(nu.getTime() + 7 * DAG_MS),
    });

    // Maandagochtend heeft nu 3 roosterplekken, maar Anouk is afwezig:
    // 2 aanwezig van gewenst 2 → nog volledig. Verhoog het minimum naar 3
    // om het effect van de afwezigheid zichtbaar te maken.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 3 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
    );

    const metAfwezigheid = await capacityWeek(ctxA, locatieA.id);
    const maandag = cel(metAfwezigheid.cells, "ma", "ochtend");
    expect(maandag.present).toBe(2); // Anouk telt niet mee
    expect(maandag.status).toBe("gedeeltelijk");

    // Zonder de afwezigheid is maandagochtend wél volledig (3 van 3).
    await upsertTeamMember(ctxA, locatieA.id, {
      id: teamlid.id,
      name: teamlid.name,
      role: teamlid.role,
      schedule: teamRooster({ ma: ["ochtend"] }),
      absentFrom: null,
      absentUntil: null,
    });
    const zonderAfwezigheid = await capacityWeek(ctxA, locatieA.id);
    expect(cel(zonderAfwezigheid.cells, "ma", "ochtend").status).toBe("volledig");

    // Als álle maandagochtend-teamleden afwezig zijn, wordt de cel "open".
    for (const lid of await listTeamMembers(ctxA, locatieA.id)) {
      await upsertTeamMember(ctxA, locatieA.id, {
        id: lid.id,
        name: lid.name,
        role: lid.role,
        schedule: teamRooster({ ma: ["ochtend"] }),
        // Ruim om de hele huidige week heen (maandag t/m zondag).
        absentFrom: new Date(nu.getTime() - 8 * DAG_MS),
        absentUntil: new Date(nu.getTime() + 14 * DAG_MS),
      });
    }
    const allesAfwezig = await capacityWeek(ctxA, locatieA.id);
    const maandagOpen = cel(allesAfwezig.cells, "ma", "ochtend");
    expect(maandagOpen.present).toBe(0);
    expect(maandagOpen.status).toBe("open");

    // Opruimen: Anouk weer verwijderen en roosters herstellen voor de
    // overige tests (de andere leden krijgen hun oorspronkelijke rooster).
    await deleteTeamMember(ctxA, teamlid.id);
    const rest = await listTeamMembers(ctxA, locatieA.id);
    for (const lid of rest) {
      await upsertTeamMember(ctxA, locatieA.id, {
        id: lid.id,
        name: lid.name,
        role: lid.role,
        schedule:
          lid.name === "Esther Willems"
            ? teamRooster({ ma: ["ochtend"], di: ["ochtend"] })
            : teamRooster({ ma: ["ochtend"] }),
        absentFrom: null,
        absentUntil: null,
      });
    }
  });
});

describe("gapToVacancyDraft", () => {
  it("levert een conceptvacature met de juiste required-dagdelen op", async () => {
    const ctxA = await ctxVoorA();
    const concept = await gapToVacancyDraft(ctxA, locatieA.id, {
      role: "mondhygienist",
      gaps: [
        { day: "wo", daypart: "middag" },
        { day: "vr", daypart: "ochtend" },
      ],
    });

    expect(concept.status).toBe("draft");
    expect(concept.role).toBe("mondhygienist");
    expect(concept.locationId).toBe(locatieA.id);
    expect(concept.title).toContain("Mondhygiënist");
    expect(concept.title.toLowerCase()).toContain("woensdag");
    expect(concept.title.toLowerCase()).toContain("vrijdag");

    // Rooster: precies de geselecteerde gaten zijn "required", de rest leeg.
    const rooster = castSchedule(concept.schedule);
    expect(rooster.wo.middag).toBe("required");
    expect(rooster.vr.ochtend).toBe("required");
    for (const dag of WEEKDAYS) {
      for (const dagdeel of DAYPARTS) {
        if ((dag === "wo" && dagdeel === "middag") || (dag === "vr" && dagdeel === "ochtend")) {
          continue;
        }
        expect(rooster[dag][dagdeel]).toBeNull();
      }
    }
  });

  it("weigert een lege selectie", async () => {
    const ctxA = await ctxVoorA();
    await expect(
      gapToVacancyDraft(ctxA, locatieA.id, { role: "tandarts", gaps: [] }),
    ).rejects.toThrow(AuthzError);
  });
});

describe("tenantisolatie", () => {
  it("tenant B kan de bezetting van tenant A niet lezen of schrijven", async () => {
    alsGebruiker(ownerB.id);
    const ctxB = await requireMembership(orgB.id);

    await expect(capacityWeek(ctxB, locatieA.id)).rejects.toThrow(AuthzError);
    await expect(listTeamMembers(ctxB, locatieA.id)).rejects.toThrow(AuthzError);
    await expect(
      upsertTeamMember(ctxB, locatieA.id, {
        name: "Indringer",
        role: "tandarts",
        schedule: teamRooster({}),
      }),
    ).rejects.toThrow(AuthzError);
    await expect(
      saveStaffingTarget(ctxB, locatieA.id, emptyStaffingTarget()),
    ).rejects.toThrow(AuthzError);
    await expect(
      gapToVacancyDraft(ctxB, locatieA.id, {
        role: "tandarts",
        gaps: [{ day: "ma", daypart: "ochtend" }],
      }),
    ).rejects.toThrow(AuthzError);
  });

  it("teamleden van tenant A zijn voor tenant B ook per id onvindbaar", async () => {
    const ctxA = await ctxVoorA();
    const teamA = await listTeamMembers(ctxA, locatieA.id);
    expect(teamA.length).toBeGreaterThan(0);

    alsGebruiker(ownerB.id);
    const ctxB = await requireMembership(orgB.id);
    await expect(deleteTeamMember(ctxB, teamA[0].id)).rejects.toThrow(AuthzError);
  });
});
