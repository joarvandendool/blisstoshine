// Unit tests voor de opportunity-engine ("Maak deze match mogelijk") —
// puur domein, geen database.

import { describe, expect, it } from "vitest";

import { computeMatch, type MatchCandidate, type MatchVacancy } from "@/domain/matching";
import {
  computeMatchWithOpportunities,
  generateOpportunities,
} from "@/domain/opportunity";
import {
  emptyAvailability,
  emptySchedule,
  type AvailabilityLevel,
  type CandidateAvailability,
  type Daypart,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";

// ---------------------------------------------------------------------------
// Testhelpers
// ---------------------------------------------------------------------------

function maakKandidaat(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    id: "kandidaat-1",
    role: "mondhygienist",
    experienceLevel: "medior",
    latitude: 52.37,
    longitude: 4.89,
    maxTravelMinutes: 45,
    hoursMin: 24,
    hoursMax: 32,
    contractTypes: ["loondienst"],
    availableFrom: null,
    availability: emptyAvailability(),
    registrations: ["big_mondhygienist"],
    equipmentExperience: [],
    equipmentWantsToWork: [],
    techniquesWantsToLearn: [],
    softwareSkills: [],
    specializations: [],
    treatmentInterests: [],
    preferredPopulation: [],
    mentorshipNeeded: false,
    preferredPracticeSize: null,
    workPace: null,
    teamPreferences: [],
    ...overrides,
  };
}

function maakVacature(overrides: Partial<MatchVacancy> = {}): MatchVacancy {
  return {
    id: "vacature-1",
    role: "mondhygienist",
    experienceLevel: "medior",
    latitude: 52.37,
    longitude: 4.89,
    schedule: emptySchedule(),
    hoursMin: 24,
    hoursMax: 32,
    contractTypes: ["loondienst"],
    startBy: null,
    startByHard: false,
    criteria: {},
    culture: [],
    mentorship: false,
    development: [],
    practiceSize: null,
    patientPopulation: [],
    ...overrides,
  };
}

function beschikbaarheid(
  slots: Array<[Weekday, Daypart, AvailabilityLevel]>,
): CandidateAvailability {
  const basis = emptyAvailability();
  for (const [dag, dagdeel, niveau] of slots) basis[dag][dagdeel] = niveau;
  return basis;
}

function rooster(
  slots: Array<[Weekday, Daypart, "required" | "preferred"]>,
): VacancySchedule {
  const basis = emptySchedule();
  for (const [dag, dagdeel, eis] of slots) basis[dag][dagdeel] = eis;
  return basis;
}

/** Rijk scenario met meerdere kansen tegelijk (flex-dagen + leerwens). */
function rijkScenario(): { kandidaat: MatchCandidate; vacature: MatchVacancy } {
  return {
    kandidaat: maakKandidaat({
      availability: beschikbaarheid([
        ["ma", "ochtend", "available"],
        ["di", "ochtend", "available"],
        ["wo", "ochtend", "available"],
        ["do", "ochtend", "available"],
      ]),
      techniquesWantsToLearn: ["cerec"],
    }),
    vacature: maakVacature({
      schedule: rooster([
        ["ma", "ochtend", "preferred"],
        ["di", "ochtend", "preferred"],
        ["wo", "ochtend", "preferred"],
        ["do", "ochtend", "preferred"],
      ]),
      criteria: { equipment: { values: ["cerec"], level: "preferred" } },
      mentorship: false,
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("opportunity-engine — relax_required_day", () => {
  it("stelt voor het verplichte woensdagochtend-dagdeel flexibel te maken wanneer de kandidaat dan niet beschikbaar is", () => {
    const vacature = maakVacature({
      schedule: rooster([
        ["wo", "ochtend", "required"],
        ["di", "ochtend", "preferred"],
      ]),
    });
    const kandidaat = maakKandidaat({
      availability: beschikbaarheid([["di", "ochtend", "preferred"]]),
    });

    const basis = computeMatch(kandidaat, vacature);
    expect(basis.eligible).toBe(false);
    expect(basis.score).toBe(0);

    const kansen = generateOpportunities(kandidaat, vacature, basis);
    const relax = kansen.find((k) => k.code === "relax_required_day");

    expect(relax).toBeDefined();
    expect(relax!.currentScore).toBe(0);
    expect(relax!.projectedScore).toBeGreaterThan(relax!.currentScore);
    expect(relax!.requiresPracticeApproval).toBe(true);
    expect(relax!.requiresCandidateApproval).toBe(false);
    expect(relax!.affectedCriteria).toEqual(["schedule.wo.ochtend"]);
    expect(relax!.title).toContain("woensdagochtend");
    expect(relax!.explanation).toContain("woensdagochtend");
    expect(relax!.explanation).toContain(`${relax!.projectedScore}%`);
  });
});

describe("opportunity-engine — flex_candidate_day", () => {
  it("vraagt de kandidaat een 'available' slot als voorkeursdagdeel te zien, met kandidaatgoedkeuring", () => {
    const vacature = maakVacature({ schedule: rooster([["wo", "ochtend", "required"]]) });
    const kandidaat = maakKandidaat({
      availability: beschikbaarheid([["wo", "ochtend", "available"]]),
    });

    const kansen = generateOpportunities(kandidaat, vacature);
    const flex = kansen.find((k) => k.code === "flex_candidate_day");

    expect(flex).toBeDefined();
    expect(flex!.projectedScore).toBeGreaterThan(flex!.currentScore);
    expect(flex!.requiresCandidateApproval).toBe(true);
    expect(flex!.requiresPracticeApproval).toBe(false);
    expect(flex!.affectedCriteria).toEqual(["schedule.wo.ochtend"]);
    expect(flex!.explanation).toContain("Wanneer woensdagochtend flexibel is");
    expect(flex!.explanation).toContain(`stijgt de match van ${flex!.currentScore}% naar ${flex!.projectedScore}%`);
  });
});

describe("opportunity-engine — opportunityscore", () => {
  it("geeft voor elk voorstel een projectedScore die hoger is dan de currentScore", () => {
    const { kandidaat, vacature } = rijkScenario();
    const basis = computeMatch(kandidaat, vacature);

    const kansen = generateOpportunities(kandidaat, vacature, basis);

    expect(kansen.length).toBeGreaterThan(0);
    for (const kans of kansen) {
      expect(kans.currentScore).toBe(basis.score);
      expect(kans.projectedScore).toBeGreaterThan(kans.currentScore);
    }
  });

  it("retourneert maximaal 3 voorstellen bij veel verschillen, aflopend gesorteerd op projectedScore", () => {
    const { kandidaat, vacature } = rijkScenario();

    const kansen = generateOpportunities(kandidaat, vacature);

    // Vier flex-dagen + leerwens zonder begeleiding leveren méér dan drie kansen op.
    expect(kansen).toHaveLength(3);
    expect(kansen[0].projectedScore).toBeGreaterThanOrEqual(kansen[1].projectedScore);
    expect(kansen[1].projectedScore).toBeGreaterThanOrEqual(kansen[2].projectedScore);
  });
});

describe("opportunity-engine — lower_min_hours", () => {
  it("stelt voor het vacature-minimum te verlagen naar 24 uur wanneer de kandidaat maximaal 24 uur wil en de vacature 32 vraagt", () => {
    const kandidaat = maakKandidaat({ hoursMin: 24, hoursMax: 24 });
    const vacature = maakVacature({ hoursMin: 32, hoursMax: 36 });

    const kansen = generateOpportunities(kandidaat, vacature);
    const uren = kansen.find((k) => k.code === "lower_min_hours");

    expect(uren).toBeDefined();
    expect(uren!.projectedScore).toBeGreaterThan(uren!.currentScore);
    expect(uren!.requiresPracticeApproval).toBe(true);
    expect(uren!.requiresCandidateApproval).toBe(false);
    expect(uren!.affectedCriteria).toEqual(["hoursMin"]);
    expect(uren!.title).toContain("24 uur");
    expect(uren!.explanation).toContain("minimaal 32 uur");
    expect(uren!.explanation).toContain("verlaagt naar 24 uur");
  });

  it("stelt geen urenverlaging voor wanneer het kandidaatmaximum niet onder het vacature-minimum ligt", () => {
    const kansen = generateOpportunities(
      maakKandidaat({ hoursMin: 24, hoursMax: 32 }),
      maakVacature({ hoursMin: 24, hoursMax: 32 }),
    );

    expect(kansen.some((k) => k.code === "lower_min_hours")).toBe(false);
  });
});

describe("opportunity-engine — offer_mentorship", () => {
  it("stelt begeleiding voor wanneer de kandidaat gevraagde apparatuur wil leren en de vacature geen begeleiding biedt", () => {
    const kandidaat = maakKandidaat({ techniquesWantsToLearn: ["cerec"] });
    const vacature = maakVacature({
      criteria: { equipment: { values: ["cerec"], level: "required" } },
      mentorship: false,
    });

    const kansen = generateOpportunities(kandidaat, vacature);
    const begeleiding = kansen.find((k) => k.code === "offer_mentorship");

    expect(begeleiding).toBeDefined();
    expect(begeleiding!.projectedScore).toBeGreaterThan(begeleiding!.currentScore);
    expect(begeleiding!.requiresPracticeApproval).toBe(true);
    expect(begeleiding!.requiresCandidateApproval).toBe(false);
    expect(begeleiding!.affectedCriteria).toEqual(["mentorship"]);
    expect(begeleiding!.title).toContain("CEREC");
    expect(begeleiding!.explanation).toContain("wil CEREC leren");
  });

  it("stelt geen begeleiding voor wanneer de vacature al begeleiding biedt", () => {
    const kansen = generateOpportunities(
      maakKandidaat({ techniquesWantsToLearn: ["cerec"] }),
      maakVacature({
        criteria: { equipment: { values: ["cerec"], level: "required" } },
        mentorship: true,
      }),
    );

    expect(kansen.some((k) => k.code === "offer_mentorship")).toBe(false);
  });

  it("stelt geen begeleiding voor zonder leerwens (kandidaat heeft al ervaring)", () => {
    const kansen = generateOpportunities(
      maakKandidaat({ equipmentExperience: ["cerec"] }),
      maakVacature({
        criteria: { equipment: { values: ["cerec"], level: "required" } },
        mentorship: false,
      }),
    );

    expect(kansen.some((k) => k.code === "offer_mentorship")).toBe(false);
  });
});

describe("opportunity-engine — accept_later_start", () => {
  it("stelt voor de harde uiterste startdatum op te schuiven naar de beschikbaarheidsdatum van de kandidaat", () => {
    const kandidaat = maakKandidaat({ availableFrom: new Date("2026-09-01T00:00:00Z") });
    const vacature = maakVacature({
      startBy: new Date("2026-08-01T00:00:00Z"),
      startByHard: true,
    });

    const basis = computeMatch(kandidaat, vacature);
    expect(basis.eligible).toBe(false);

    const kansen = generateOpportunities(kandidaat, vacature, basis);
    const start = kansen.find((k) => k.code === "accept_later_start");

    expect(start).toBeDefined();
    expect(start!.currentScore).toBe(0);
    expect(start!.projectedScore).toBeGreaterThan(0);
    expect(start!.requiresPracticeApproval).toBe(true);
    expect(start!.affectedCriteria).toEqual(["startBy"]);
    expect(start!.explanation).toContain("01-09-2026");
    expect(start!.explanation).toContain("01-08-2026");
  });
});

describe("opportunity-engine — alternative_contract", () => {
  it("maakt een ineligible kandidaat weer eligible door de contractvorm van de kandidaat toe te voegen", () => {
    const kandidaat = maakKandidaat({ contractTypes: ["zzp"] });
    const vacature = maakVacature({ contractTypes: ["loondienst"] });

    const basis = computeMatch(kandidaat, vacature);
    expect(basis.eligible).toBe(false);
    expect(basis.score).toBe(0);

    const kansen = generateOpportunities(kandidaat, vacature, basis);
    const contract = kansen.find((k) => k.code === "alternative_contract");

    expect(contract).toBeDefined();
    expect(contract!.currentScore).toBe(0);
    expect(contract!.projectedScore).toBeGreaterThan(0);
    // Beide partijen moeten akkoord gaan met een andere contractvorm.
    expect(contract!.requiresCandidateApproval).toBe(true);
    expect(contract!.requiresPracticeApproval).toBe(true);
    expect(contract!.affectedCriteria).toEqual(["contractTypes"]);
    expect(contract!.explanation).toContain("ZZP");

    // Het voorstel toegepast op een kopie maakt de match inderdaad weer eligible.
    const toegepast = computeMatch(kandidaat, {
      ...structuredClone(vacature),
      contractTypes: ["loondienst", "zzp"],
    });
    expect(toegepast.eligible).toBe(true);
    expect(toegepast.score).toBe(contract!.projectedScore);
  });
});

describe("opportunity-engine — computeMatchWithOpportunities", () => {
  it("is identiek aan computeMatch, maar met gevulde opportunities", () => {
    const { kandidaat, vacature } = rijkScenario();

    const basis = computeMatch(kandidaat, vacature);
    const metKansen = computeMatchWithOpportunities(kandidaat, vacature);

    expect(metKansen.opportunities.length).toBeGreaterThan(0);
    expect({ ...metKansen, opportunities: [] }).toStrictEqual(basis);
    expect(metKansen.opportunities).toStrictEqual(
      generateOpportunities(kandidaat, vacature, basis),
    );
  });
});

describe("opportunity-engine — geen mutatie en determinisme", () => {
  it("muteert de invoerobjecten niet (structuredClone-vergelijking)", () => {
    const kandidaat = maakKandidaat({
      availability: beschikbaarheid([
        ["di", "ochtend", "available"],
        ["do", "middag", "preferred"],
      ]),
      techniquesWantsToLearn: ["cerec"],
      contractTypes: ["zzp"],
      hoursMin: 24,
      hoursMax: 24,
      availableFrom: new Date("2026-09-01T00:00:00Z"),
    });
    const vacature = maakVacature({
      schedule: rooster([
        ["di", "ochtend", "preferred"],
        ["wo", "ochtend", "required"],
      ]),
      criteria: { equipment: { values: ["cerec"], level: "preferred" } },
      contractTypes: ["loondienst"],
      hoursMin: 32,
      hoursMax: 36,
      startBy: new Date("2026-08-01T00:00:00Z"),
      startByHard: true,
      mentorship: false,
    });

    const kandidaatKopie = structuredClone(kandidaat);
    const vacatureKopie = structuredClone(vacature);

    generateOpportunities(kandidaat, vacature);
    computeMatchWithOpportunities(kandidaat, vacature);

    expect(kandidaat).toStrictEqual(kandidaatKopie);
    expect(vacature).toStrictEqual(vacatureKopie);
  });

  it("is volledig deterministisch: identieke invoer geeft identieke voorstellen", () => {
    const bouwInvoer = () => rijkScenario();

    const eerste = bouwInvoer();
    const tweede = bouwInvoer();

    const kansenEerste = generateOpportunities(eerste.kandidaat, eerste.vacature);
    const kansenTweede = generateOpportunities(tweede.kandidaat, tweede.vacature);

    expect(kansenEerste).toStrictEqual(kansenTweede);
    // Herhaalde aanroep op dezelfde objecten geeft hetzelfde resultaat.
    expect(generateOpportunities(eerste.kandidaat, eerste.vacature)).toStrictEqual(kansenEerste);
  });
});
