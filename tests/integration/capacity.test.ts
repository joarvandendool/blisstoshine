// Integratietests voor de Praktijkbezetting (src/server/capacity.ts):
// (a) capacityWeek telt aanwezigheid en markeert een gat als "open";
// (b) TeamAbsence (getypeerde afwezigheid) maakt van "volledig" een
//     "gedeeltelijk"/"open" — meerdere periodes per teamlid;
// (c) contracturen, toekomstige startdatum en verwachte einddatum
//     beïnvloeden de week (incl. tekort_verwacht binnen 8 weken);
// (d) per-functie staffingTarget levert dekking per functie op;
// (e) parttimer-combinaties worden gevonden voor gaten van één functie;
// (f) gapToVacancyDraft levert een conceptvacature met de juiste
//     required-dagdelen op;
// (g) tenant B kan de bezetting van tenant A niet lezen (AuthzError).

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
  addAbsence,
  capacityWeek,
  deleteAbsence,
  deleteTeamMember,
  emptyStaffingTarget,
  gapToVacancyDraft,
  listTeamMembers,
  maandagVan,
  saveStaffingTarget,
  upsertTeamMember,
  type CapacityCell,
  type RoleStaffingTargets,
  type StaffingTarget,
  type TeamSchedule,
} from "@/server/capacity";
import { castSchedule } from "@/server/vacancies";
import { DAYPARTS, WEEKDAYS, type Daypart, type Weekday } from "@/domain/taxonomy";
import { alsGebruiker, beschikbaarheid, maakKandidaat, prepareTestDb, maakGebruiker } from "./helpers";

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
  it("telt aanwezigheid en markeert een gat als 'open' (met absoluut/relatief tekort)", async () => {
    const ctxA = await ctxVoorA();
    const week = await capacityWeek(ctxA, locatieA.id);

    // Maandagochtend: 2 aanwezig van gewenst 2 → volledig, geen tekort.
    const maandag = cel(week.cells, "ma", "ochtend");
    expect(maandag.present).toBe(2);
    expect(maandag.target).toBe(2);
    expect(maandag.status).toBe("volledig");
    expect(maandag.shortage).toBe(0);
    expect(maandag.shortageRatio).toBe(0);

    // Dinsdagochtend: 1 aanwezig van gewenst 1 → volledig.
    const dinsdag = cel(week.cells, "di", "ochtend");
    expect(dinsdag.present).toBe(1);
    expect(dinsdag.status).toBe("volledig");

    // Woensdagmiddag: gewenst 1, niemand ingepland → open; tekort 1 (100%).
    const woensdag = cel(week.cells, "wo", "middag");
    expect(woensdag.present).toBe(0);
    expect(woensdag.target).toBe(1);
    expect(woensdag.status).toBe("open");
    expect(woensdag.shortage).toBe(1);
    expect(woensdag.shortageRatio).toBe(1);

    // Privacy: zonder (voldoende) kandidaten in de pool is de teller null.
    expect(woensdag.availableCandidates).toBeNull();

    // Oude totaalvorm: geen per-functie cellen.
    expect(week.roleTargets).toBeNull();
    expect(week.roleCells).toHaveLength(0);
    expect(week.treatmentRooms).toBe(3);
  });

  it("TeamAbsence maakt van 'volledig' een 'gedeeltelijk' of 'open' (meerdere periodes)", async () => {
    const ctxA = await ctxVoorA();

    // Extra teamlid op maandagochtend, deze week afwezig (verlof).
    const nu = new Date();
    const teamlid = await upsertTeamMember(ctxA, locatieA.id, {
      name: "Anouk Peters",
      role: "mondhygienist",
      schedule: teamRooster({ ma: ["ochtend"] }),
    });
    const verlof = await addAbsence(ctxA, teamlid.id, {
      kind: "verlof",
      from: new Date(nu.getTime() - 7 * DAG_MS),
      until: new Date(nu.getTime() + 7 * DAG_MS),
    });

    // Maandagochtend heeft nu 3 roosterplekken, maar Anouk is afwezig:
    // verhoog het minimum naar 3 om het effect zichtbaar te maken.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 3 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
    );

    const metAfwezigheid = await capacityWeek(ctxA, locatieA.id);
    const maandag = cel(metAfwezigheid.cells, "ma", "ochtend");
    expect(maandag.present).toBe(2); // Anouk telt niet mee
    expect(maandag.status).toBe("gedeeltelijk");

    // Meerdere periodes per teamlid: een tweede (toekomstige) ziekteperiode
    // verandert de huidige week niet, maar bestaat naast het verlof.
    const ziekte = await addAbsence(ctxA, teamlid.id, {
      kind: "ziekte",
      from: new Date(nu.getTime() + 30 * DAG_MS),
      until: null, // einddatum nog onbekend
    });
    const team = await listTeamMembers(ctxA, locatieA.id);
    const anouk = team.find((lid) => lid.id === teamlid.id);
    expect(anouk?.absences).toHaveLength(2);
    expect(anouk?.absences.map((a) => a.kind).sort()).toEqual(["verlof", "ziekte"]);

    // Zonder het verlof is maandagochtend wél volledig (3 van 3) — de
    // toekomstige ziekte zonder einddatum geeft wel een verwacht tekort.
    await deleteAbsence(ctxA, verlof.id);
    const zonderVerlof = await capacityWeek(ctxA, locatieA.id);
    const maandagZonderVerlof = cel(zonderVerlof.cells, "ma", "ochtend");
    expect(maandagZonderVerlof.present).toBe(3);
    expect(maandagZonderVerlof.status).toBe("tekort_verwacht");
    expect(maandagZonderVerlof.shortageExpectedOn).not.toBeNull();

    await deleteAbsence(ctxA, ziekte.id);
    const zonderAfwezigheid = await capacityWeek(ctxA, locatieA.id);
    expect(cel(zonderAfwezigheid.cells, "ma", "ochtend").status).toBe("volledig");

    // Als álle maandagochtend-teamleden afwezig zijn (ziekte), wordt de cel "open".
    for (const lid of await listTeamMembers(ctxA, locatieA.id)) {
      await addAbsence(ctxA, lid.id, {
        kind: "ziekte",
        from: new Date(nu.getTime() - 8 * DAG_MS),
        until: new Date(nu.getTime() + 14 * DAG_MS),
      });
    }
    const allesAfwezig = await capacityWeek(ctxA, locatieA.id);
    const maandagOpen = cel(allesAfwezig.cells, "ma", "ochtend");
    expect(maandagOpen.present).toBe(0);
    expect(maandagOpen.status).toBe("open");

    // Opruimen: Anouk verwijderen en alle afwezigheden weghalen.
    await deleteTeamMember(ctxA, teamlid.id);
    for (const lid of await listTeamMembers(ctxA, locatieA.id)) {
      for (const afwezigheid of lid.absences) {
        await deleteAbsence(ctxA, afwezigheid.id);
      }
    }
  });
});

describe("contracturen, instroom en uitstroom", () => {
  it("contracturen toppen de inzet af (±4 uur per dagdeel, in weekvolgorde)", async () => {
    const ctxA = await ctxVoorA();

    // Petra staat op drie ochtenden ingeroosterd maar heeft 8 contracturen
    // (= 2 dagdelen): alleen maandag en dinsdag tellen mee, woensdag niet.
    const petra = await upsertTeamMember(ctxA, locatieA.id, {
      name: "Parttime Petra",
      role: "tandarts",
      schedule: teamRooster({ ma: ["ochtend"], di: ["ochtend"], wo: ["ochtend"] }),
      contractHours: 8,
    });

    const week = await capacityWeek(ctxA, locatieA.id);
    expect(cel(week.cells, "ma", "ochtend").present).toBe(3); // Esther, Bas, Petra
    expect(cel(week.cells, "di", "ochtend").present).toBe(2); // Esther, Petra
    expect(cel(week.cells, "wo", "ochtend").present).toBe(0); // buiten contracturen

    await deleteTeamMember(ctxA, petra.id);
  });

  it("een toekomstige startdatum telt pas mee vanaf die datum", async () => {
    const ctxA = await ctxVoorA();
    const weekStart = maandagVan(new Date());
    const startOverDrieWeken = new Date(weekStart.getTime() + 21 * DAG_MS);

    const nina = await upsertTeamMember(ctxA, locatieA.id, {
      name: "Nieuwe Nina",
      role: "mondhygienist",
      schedule: teamRooster({ wo: ["middag"] }),
      startDate: startOverDrieWeken,
    });

    // Deze week: het woensdagmiddag-gat blijft open.
    const dezeWeek = await capacityWeek(ctxA, locatieA.id);
    expect(cel(dezeWeek.cells, "wo", "middag").present).toBe(0);
    expect(cel(dezeWeek.cells, "wo", "middag").status).toBe("open");

    // Vier weken vooruit is Nina gestart: volledig.
    const latereWeek = await capacityWeek(ctxA, locatieA.id, {
      weekStart: new Date(weekStart.getTime() + 28 * DAG_MS),
    });
    expect(cel(latereWeek.cells, "wo", "middag").present).toBe(1);
    expect(cel(latereWeek.cells, "wo", "middag").status).toBe("volledig");

    await deleteTeamMember(ctxA, nina.id);
  });

  it("een verwachte einddatum (uitstroom) geeft binnen 8 weken 'tekort_verwacht'", async () => {
    const ctxA = await ctxVoorA();
    const weekStart = maandagVan(new Date());

    // Vera dekt donderdagavond, maar vertrekt over ~3 weken.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 2 }, di: { ochtend: 1 }, wo: { middag: 1 }, do: { avond: 1 } }),
    );
    const vera = await upsertTeamMember(ctxA, locatieA.id, {
      name: "Vertrekkende Vera",
      role: "tandarts",
      schedule: teamRooster({ do: ["avond"] }),
      endDate: new Date(weekStart.getTime() + 20 * DAG_MS),
    });

    const week = await capacityWeek(ctxA, locatieA.id);
    const donderdagAvond = cel(week.cells, "do", "avond");
    expect(donderdagAvond.present).toBe(1); // nu nog aanwezig
    expect(donderdagAvond.status).toBe("tekort_verwacht");
    expect(donderdagAvond.shortageExpectedOn).not.toBeNull();
    expect(donderdagAvond.shortageExpectedOn!.getTime()).toBeGreaterThan(
      weekStart.getTime() + 20 * DAG_MS,
    );

    await deleteTeamMember(ctxA, vera.id);
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 2 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
    );
  });
});

describe("staffingTarget per functie", () => {
  it("levert dekking per functie op, met terugval op de totaalvorm", async () => {
    const ctxA = await ctxVoorA();

    // Nieuwe vorm: { rol: { ma: { ochtend: n } } }.
    const perFunctie: RoleStaffingTargets = {
      tandarts: minimum({ ma: { ochtend: 1 } }),
      mondhygienist: minimum({ ma: { ochtend: 1 } }),
    };
    await saveStaffingTarget(ctxA, locatieA.id, perFunctie);

    const week = await capacityWeek(ctxA, locatieA.id);
    expect(week.roleTargets).not.toBeNull();
    // Totaal = som van de functies: 2 op maandagochtend.
    expect(cel(week.cells, "ma", "ochtend").target).toBe(2);

    const tandartsCel = week.roleCells.find(
      (c) => c.role === "tandarts" && c.day === "ma" && c.daypart === "ochtend",
    );
    const mondhygienistCel = week.roleCells.find(
      (c) => c.role === "mondhygienist" && c.day === "ma" && c.daypart === "ochtend",
    );
    expect(tandartsCel?.present).toBe(1); // Esther
    expect(tandartsCel?.status).toBe("volledig");
    expect(mondhygienistCel?.present).toBe(0); // geen mondhygiënist in het team
    expect(mondhygienistCel?.status).toBe("open");
    expect(mondhygienistCel?.shortage).toBe(1);
    expect(mondhygienistCel?.shortageRatio).toBe(1);

    // Terug naar de totaalvorm voor de vervolgstappen.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 2 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
    );
    const terug = await capacityWeek(ctxA, locatieA.id);
    expect(terug.roleTargets).toBeNull();
    expect(terug.roleCells).toHaveLength(0);
  });
});

describe("parttimer-combinaties", () => {
  it("vindt paren kandidaten die samen de gevraagde dagdelen dekken", async () => {
    const ctxA = await ctxVoorA();

    // Twee gaten voor de dominante teamrol (tandarts): wo middag + vr ochtend.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ wo: { middag: 1 }, vr: { ochtend: 1 } }),
    );

    // Drie kandidaten die alleen woensdag kunnen en drie die alleen vrijdag
    // kunnen: geen enkele kandidaat dekt beide dagdelen alleen, maar er zijn
    // 3 × 3 = 9 combinaties (boven de privacydrempel van 5).
    for (let i = 1; i <= 3; i += 1) {
      await maakKandidaat(`combo-wo-${i}@test.nl`, `Combo Wo ${i}`, {
        role: "tandarts",
        availability: beschikbaarheid(["wo"]),
      });
      await maakKandidaat(`combo-vr-${i}@test.nl`, `Combo Vr ${i}`, {
        role: "tandarts",
        availability: beschikbaarheid(["vr"]),
      });
    }

    const week = await capacityWeek(ctxA, locatieA.id);
    const combo = week.partTimeCombos.find((c) => c.role === "tandarts");
    expect(combo).toBeDefined();
    expect(combo?.gaps).toHaveLength(2);
    expect(combo?.comboCount).toBe(9);

    // Herstel het oorspronkelijke minimum.
    await saveStaffingTarget(
      ctxA,
      locatieA.id,
      minimum({ ma: { ochtend: 2 }, di: { ochtend: 1 }, wo: { middag: 1 } }),
    );
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

  it("teamleden en afwezigheden van tenant A zijn voor tenant B per id onvindbaar", async () => {
    const ctxA = await ctxVoorA();
    const teamA = await listTeamMembers(ctxA, locatieA.id);
    expect(teamA.length).toBeGreaterThan(0);
    const afwezigheid = await addAbsence(ctxA, teamA[0].id, {
      kind: "verlof",
      from: new Date(),
      until: null,
    });

    alsGebruiker(ownerB.id);
    const ctxB = await requireMembership(orgB.id);
    await expect(deleteTeamMember(ctxB, teamA[0].id)).rejects.toThrow(AuthzError);
    await expect(
      addAbsence(ctxB, teamA[0].id, { kind: "ziekte", from: new Date(), until: null }),
    ).rejects.toThrow(AuthzError);
    await expect(deleteAbsence(ctxB, afwezigheid.id)).rejects.toThrow(AuthzError);

    // Opruimen.
    const ctxA2 = await ctxVoorA();
    await deleteAbsence(ctxA2, afwezigheid.id);
  });
});
