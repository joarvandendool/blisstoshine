// Unit tests voor de deterministische matching-engine — puur domein, geen database.

import { describe, expect, it } from "vitest";

import {
  ALGORITHM_VERSION,
  MATCHING_CONFIG,
  computeMatch,
  type MatchCandidate,
  type MatchVacancy,
} from "@/domain/matching";
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matching-engine — beschikbaarheid", () => {
  it("geeft availability 100 bij perfecte dagoverlap", () => {
    const vacature = maakVacature({
      schedule: rooster([
        ["di", "ochtend", "required"],
        ["do", "ochtend", "required"],
      ]),
    });
    const kandidaat = maakKandidaat({
      availability: beschikbaarheid([
        ["di", "ochtend", "preferred"],
        ["do", "ochtend", "preferred"],
      ]),
    });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.eligible).toBe(true);
    expect(resultaat.categoryScores.availability).toBe(100);
    expect(
      resultaat.strengths.some((s) => s.message.includes("Dinsdag en donderdag sluiten volledig aan")),
    ).toBe(true);
  });

  it("laat een voorkeursdag ('preferred') hoger scoren dan 'available'", () => {
    const vacature = maakVacature({ schedule: rooster([["di", "ochtend", "required"]]) });
    const metVoorkeur = computeMatch(
      maakKandidaat({ availability: beschikbaarheid([["di", "ochtend", "preferred"]]) }),
      vacature,
    );
    const alleenBeschikbaar = computeMatch(
      maakKandidaat({ availability: beschikbaarheid([["di", "ochtend", "available"]]) }),
      vacature,
    );

    expect(metVoorkeur.categoryScores.availability).toBe(100);
    expect(alleenBeschikbaar.categoryScores.availability).toBe(75);
    expect(metVoorkeur.categoryScores.availability).toBeGreaterThan(
      alleenBeschikbaar.categoryScores.availability,
    );
  });

  it("scoort gedeeltelijke dagoverlap lager dan volledige overlap", () => {
    const vacature = maakVacature({
      schedule: rooster([
        ["di", "ochtend", "preferred"],
        ["do", "ochtend", "preferred"],
      ]),
    });
    const volledig = computeMatch(
      maakKandidaat({
        availability: beschikbaarheid([
          ["di", "ochtend", "preferred"],
          ["do", "ochtend", "preferred"],
        ]),
      }),
      vacature,
    );
    const gedeeltelijk = computeMatch(
      maakKandidaat({ availability: beschikbaarheid([["di", "ochtend", "preferred"]]) }),
      vacature,
    );

    expect(volledig.categoryScores.availability).toBe(100);
    expect(gedeeltelijk.categoryScores.availability).toBe(50);
    expect(gedeeltelijk.categoryScores.availability).toBeLessThan(
      volledig.categoryScores.availability,
    );
  });

  it("markeert een ontbrekend verplicht dagdeel als ineligible met Nederlandse reden", () => {
    const vacature = maakVacature({
      schedule: rooster([
        ["di", "ochtend", "required"],
        ["do", "ochtend", "preferred"],
      ]),
    });
    const kandidaat = maakKandidaat({
      availability: beschikbaarheid([["do", "ochtend", "preferred"]]),
    });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.label).toBe("ineligible");
    expect(resultaat.score).toBe(0);
    expect(resultaat.hardMismatchReasons).toHaveLength(1);
    expect(resultaat.hardMismatchReasons[0].message).toContain("dinsdag");
    expect(resultaat.hardMismatchReasons[0].message).toContain("verplichte");
    // Categoriescores worden informatief wél berekend.
    expect(resultaat.categoryScores.availability).toBeGreaterThan(0);
    expect(resultaat.summary).toContain("Geen match");
  });
});

describe("matching-engine — apparatuur, software en ontwikkelmatch", () => {
  it("scoort scannerervaring hoog (TRIOS verplicht en kandidaat heeft ervaring)", () => {
    const vacature = maakVacature({
      criteria: { equipment: { values: ["trios"], level: "required" } },
    });
    const kandidaat = maakKandidaat({ equipmentExperience: ["trios"] });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.categoryScores.equipmentAndSoftware).toBe(100);
    expect(resultaat.strengths.some((s) => s.message.includes("TRIOS"))).toBe(true);
  });

  it("laat 'TRIOS willen leren' met begeleiding hoger scoren dan zonder, met strength", () => {
    const kandidaat = maakKandidaat({ techniquesWantsToLearn: ["trios"] });
    const criteria = { equipment: { values: ["trios"], level: "required" as const } };

    const metBegeleiding = computeMatch(
      kandidaat,
      maakVacature({ criteria, mentorship: true }),
    );
    const zonderBegeleiding = computeMatch(
      kandidaat,
      maakVacature({ criteria, mentorship: false }),
    );

    expect(metBegeleiding.categoryScores.equipmentAndSoftware).toBe(80);
    expect(zonderBegeleiding.categoryScores.equipmentAndSoftware).toBe(50);
    expect(metBegeleiding.categoryScores.equipmentAndSoftware).toBeGreaterThan(
      zonderBegeleiding.categoryScores.equipmentAndSoftware,
    );
    expect(
      metBegeleiding.strengths.some(
        (s) => s.message.includes("leren") && s.message.includes("begeleiding"),
      ),
    ).toBe(true);
    expect(
      zonderBegeleiding.strengths.some(
        (s) => s.message.includes("leren") && s.message.includes("begeleiding"),
      ),
    ).toBe(false);
  });
});

describe("matching-engine — specialisaties", () => {
  it("verhoogt de score bij specialisatieoverlap", () => {
    const vacature = maakVacature({
      criteria: { specializations: { values: ["parodontologie"], level: "preferred" } },
    });
    const metOverlap = computeMatch(
      maakKandidaat({ specializations: ["parodontologie"] }),
      vacature,
    );
    const zonderOverlap = computeMatch(maakKandidaat(), vacature);

    expect(metOverlap.categoryScores.specializations).toBe(100);
    expect(metOverlap.categoryScores.specializations).toBeGreaterThan(
      zonderOverlap.categoryScores.specializations,
    );
    expect(metOverlap.score).toBeGreaterThan(zonderOverlap.score);
    expect(
      metOverlap.strengths.some((s) => s.message.includes("parodontologie")),
    ).toBe(true);
  });
});

describe("matching-engine — reistijd", () => {
  it("verlaagt de travel-score bij grotere afstand en geeft een attentionPoint boven het maximum", () => {
    const vacature = maakVacature({ latitude: 52.37, longitude: 4.89 });
    const dichtbij = computeMatch(
      maakKandidaat({ latitude: 52.37, longitude: 4.89, maxTravelMinutes: 30 }),
      vacature,
    );
    const middenin = computeMatch(
      maakKandidaat({ latitude: 52.2, longitude: 5.0, maxTravelMinutes: 30 }),
      vacature,
    );
    const veraf = computeMatch(
      maakKandidaat({ latitude: 52.09, longitude: 5.12, maxTravelMinutes: 30 }),
      vacature,
    );

    expect(dichtbij.categoryScores.travel).toBe(100);
    expect(middenin.categoryScores.travel).toBeLessThan(dichtbij.categoryScores.travel);
    expect(veraf.categoryScores.travel).toBeLessThan(middenin.categoryScores.travel);

    expect(middenin.attentionPoints.some((a) => a.category === "travel")).toBe(false);
    expect(veraf.attentionPoints.some((a) => a.category === "travel")).toBe(true);
    expect(
      veraf.attentionPoints.find((a) => a.category === "travel")?.message,
    ).toContain("reistijd");
  });
});

describe("matching-engine — harde mismatches", () => {
  it("markeert een ontbrekende verplichte registratie als ineligible", () => {
    const vacature = maakVacature({
      criteria: {
        registrations: { values: ["big_mondhygienist", "krm"], level: "required" },
      },
    });
    const kandidaat = maakKandidaat({ registrations: ["big_mondhygienist"] });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.label).toBe("ineligible");
    expect(resultaat.score).toBe(0);
    expect(
      resultaat.hardMismatchReasons.some((r) => r.message.includes("KRM-registratie")),
    ).toBe(true);
  });

  it("markeert het ontbreken van elke gemeenschappelijke contractvorm als ineligible", () => {
    const resultaat = computeMatch(
      maakKandidaat({ contractTypes: ["zzp"] }),
      maakVacature({ contractTypes: ["loondienst", "detachering"] }),
    );

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.label).toBe("ineligible");
    expect(
      resultaat.hardMismatchReasons.some((r) => r.message.includes("contractvorm")),
    ).toBe(true);
    // Informatieve categoriescore blijft berekend (urenoverlap telt nog mee).
    expect(resultaat.categoryScores.employment).toBe(60);
  });

  it("markeert een verkeerde functie als ineligible", () => {
    const resultaat = computeMatch(
      maakKandidaat({ role: "tandartsassistent" }),
      maakVacature({ role: "mondhygienist" }),
    );

    expect(resultaat.eligible).toBe(false);
    expect(
      resultaat.hardMismatchReasons.some((r) => r.message.includes("functie")),
    ).toBe(true);
  });

  it("markeert een te late startdatum als ineligible bij een harde uiterste startdatum", () => {
    const kandidaat = maakKandidaat({ availableFrom: new Date("2026-09-01T00:00:00Z") });
    const hard = computeMatch(
      kandidaat,
      maakVacature({ startBy: new Date("2026-08-01T00:00:00Z"), startByHard: true }),
    );
    const zacht = computeMatch(
      kandidaat,
      maakVacature({ startBy: new Date("2026-08-01T00:00:00Z"), startByHard: false }),
    );

    expect(hard.eligible).toBe(false);
    expect(hard.label).toBe("ineligible");
    expect(
      hard.hardMismatchReasons.some((r) => r.message.includes("startdatum")),
    ).toBe(true);
    expect(zacht.eligible).toBe(true);
  });
});

describe("matching-engine — robuustheid en determinisme", () => {
  it("houdt alle scores altijd tussen 0 en 100, ook bij extreme invoer", () => {
    const resultaat = computeMatch(
      maakKandidaat({
        latitude: Number.NaN,
        longitude: Number.POSITIVE_INFINITY,
        maxTravelMinutes: -5,
        hoursMin: 10000,
        hoursMax: -3,
        contractTypes: ["zzp"],
        registrations: undefined,
        availability: beschikbaarheid([["za", "avond", "unavailable"]]),
      }),
      maakVacature({
        contractTypes: ["zzp"],
        schedule: rooster([["za", "avond", "preferred"]]),
        hoursMin: -100,
        hoursMax: 100000,
      }),
    );

    expect(resultaat.score).toBeGreaterThanOrEqual(0);
    expect(resultaat.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(resultaat.score)).toBe(true);
    for (const waarde of Object.values(resultaat.categoryScores)) {
      expect(waarde).toBeGreaterThanOrEqual(0);
      expect(waarde).toBeLessThanOrEqual(100);
      expect(Number.isInteger(waarde)).toBe(true);
    }
  });

  it("geeft een neutrale categoriescore 60 bij ontbrekende gegevens", () => {
    const resultaat = computeMatch(maakKandidaat(), maakVacature());

    expect(resultaat.categoryScores.availability).toBe(60);
    expect(resultaat.categoryScores.equipmentAndSoftware).toBe(60);
    expect(resultaat.categoryScores.specializations).toBe(60);
    expect(resultaat.categoryScores.workplacePreferences).toBe(60);
  });

  it("is volledig deterministisch: identieke input geeft identiek resultaat", () => {
    const bouwInvoer = () =>
      [
        maakKandidaat({
          availability: beschikbaarheid([
            ["di", "ochtend", "preferred"],
            ["do", "middag", "available"],
          ]),
          equipmentExperience: ["trios"],
          specializations: ["parodontologie"],
          techniquesWantsToLearn: ["cerec"],
          mentorshipNeeded: true,
          availableFrom: new Date("2026-08-01T00:00:00Z"),
        }),
        maakVacature({
          schedule: rooster([
            ["di", "ochtend", "required"],
            ["do", "middag", "preferred"],
          ]),
          criteria: {
            equipment: { values: ["trios", "cerec"], level: "required" },
            specializations: { values: ["parodontologie"], level: "preferred" },
          },
          mentorship: true,
          startBy: new Date("2026-09-01T00:00:00Z"),
          startByHard: true,
        }),
      ] as const;

    const [kandidaatA, vacatureA] = bouwInvoer();
    const [kandidaatB, vacatureB] = bouwInvoer();

    expect(computeMatch(kandidaatA, vacatureA)).toStrictEqual(
      computeMatch(kandidaatB, vacatureB),
    );
  });

  it("gebruikt algorithmVersion 1.0.0 en laat opportunities leeg", () => {
    expect(ALGORITHM_VERSION).toBe("1.0.0");
    expect(MATCHING_CONFIG.algorithmVersion).toBe("1.0.0");

    const resultaat = computeMatch(maakKandidaat(), maakVacature());
    expect(resultaat.algorithmVersion).toBe("1.0.0");
    expect(resultaat.opportunities).toEqual([]);
  });

  it("levert een korte Nederlandse samenvatting met percentage en dagnamen", () => {
    const resultaat = computeMatch(
      maakKandidaat({
        availability: beschikbaarheid([
          ["di", "ochtend", "preferred"],
          ["do", "ochtend", "preferred"],
        ]),
      }),
      maakVacature({
        schedule: rooster([
          ["di", "ochtend", "required"],
          ["do", "ochtend", "required"],
        ]),
      }),
    );

    expect(resultaat.summary).toMatch(/^\d+% match — /);
    expect(resultaat.summary).toContain("dinsdag en donderdag sluiten volledig aan");
  });
});
