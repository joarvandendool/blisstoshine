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
  it("markeert een ontbrekende verplichte BIG-registratie als ineligible", () => {
    // Alleen functie-gebonden BIG-registraties sluiten hard uit (v1.1.0).
    const vacature = maakVacature({
      criteria: {
        registrations: { values: ["big_mondhygienist"], level: "required" },
      },
    });
    const kandidaat = maakKandidaat({ registrations: [] });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.eligible).toBe(false);
    expect(resultaat.label).toBe("ineligible");
    expect(resultaat.score).toBe(0);
    expect(
      resultaat.hardMismatchReasons.some((r) =>
        r.message.includes("BIG-registratie mondhygiënist"),
      ),
    ).toBe(true);
  });

  it("sluit NIET hard uit op een niet-vastgelegde registratie (KRM/KRT/röntgen) maar geeft een aandachtspunt", () => {
    // KRM legt het kandidaatprofiel niet vast; een verplichte KRM zou anders
    // de héle pool uitsluiten. Nu: eligible, met zacht aandachtspunt.
    const vacature = maakVacature({
      criteria: {
        registrations: { values: ["big_mondhygienist", "krm"], level: "required" },
      },
    });
    const kandidaat = maakKandidaat({ registrations: ["big_mondhygienist"] });

    const resultaat = computeMatch(kandidaat, vacature);

    expect(resultaat.eligible).toBe(true);
    expect(
      resultaat.hardMismatchReasons.some((r) => r.message.includes("KRM")),
    ).toBe(false);
    expect(
      resultaat.attentionPoints.some((r) => r.code === "registratie_niet_in_profiel"),
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
    // Informatieve categoriescore blijft berekend: urenoverlap (0,5) telt nog
    // mee, contractvorm-overlap is 0, beloning valt neutraal uit (0,6 × 0,25)
    // omdat er geen gedeelde contractvorm is → 50 + 0 + 15 = 65 (v1.1.0).
    expect(resultaat.categoryScores.employment).toBe(65);
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

  it("gebruikt algorithmVersion 1.1.0 en laat opportunities leeg", () => {
    expect(ALGORITHM_VERSION).toBe("1.1.0");
    expect(MATCHING_CONFIG.algorithmVersion).toBe("1.1.0");

    const resultaat = computeMatch(maakKandidaat(), maakVacature());
    expect(resultaat.algorithmVersion).toBe("1.1.0");
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

describe("matching-engine — beloning (zzp-omzetpercentage / loondienst-salaris)", () => {
  // Vaste opzet: uren én contractvorm sluiten volledig aan, zodat alleen de
  // beloning de dienstverbandscore stuurt. employment = uren 0,5 + contract
  // 0,25 + beloning 0,25 (× beloningratio), afgerond (v1.1.0).
  const zzpKandidaat = (revenueShareMin: number | null) =>
    maakKandidaat({ contractTypes: ["zzp"], revenueShareMin });
  const zzpVacature = (revenueShareMax: number | null) =>
    maakVacature({ contractTypes: ["zzp"], revenueShareMax });

  // Tabelgestuurde grenswaarden: omzetpercentage is een geheel getal 0–100,
  // nooit een fractie. bod ≥ wens → volledig; bod < wens → naar rato.
  const zzpGevallen: Array<{
    naam: string;
    wens: number;
    bod: number;
    employment: number;
    tekort: boolean;
  }> = [
    { naam: "bod boven wens (60 ≥ 50)", wens: 50, bod: 60, employment: 100, tekort: false },
    { naam: "bod gelijk aan wens (55 = 55)", wens: 55, bod: 55, employment: 100, tekort: false },
    { naam: "bod net onder wens (54 < 55)", wens: 55, bod: 54, employment: 100 - Math.round((1 - 54 / 55) * 25), tekort: true },
    { naam: "bod ruim onder wens (40 < 55)", wens: 55, bod: 40, employment: Math.round((0.5 + 0.25 + (40 / 55) * 0.25) * 100), tekort: true },
    { naam: "bod nul (0 < 55)", wens: 55, bod: 0, employment: Math.round((0.5 + 0.25) * 100), tekort: true },
  ];

  for (const g of zzpGevallen) {
    it(`zzp: ${g.naam}`, () => {
      const resultaat = computeMatch(zzpKandidaat(g.wens), zzpVacature(g.bod));
      expect(resultaat.eligible).toBe(true);
      expect(resultaat.categoryScores.employment).toBe(g.employment);
      if (g.tekort) {
        expect(resultaat.attentionPoints.some((r) => r.code === "beloning_onder_wens")).toBe(true);
        expect(resultaat.strengths.some((r) => r.code === "beloning_sluit_aan")).toBe(false);
      } else {
        expect(resultaat.strengths.some((r) => r.code === "beloning_sluit_aan")).toBe(true);
        expect(resultaat.attentionPoints.some((r) => r.code === "beloning_onder_wens")).toBe(false);
      }
    });
  }

  it("zzp: percentage wordt als geheel getal behandeld, niet als fractie", () => {
    // Een kandidaat die 55(%) wenst en een praktijk die 40(%) biedt levert
    // ratio 40/55 ≈ 0,727 — NIET 40/0,55 of iets met fracties.
    const resultaat = computeMatch(zzpKandidaat(55), zzpVacature(40));
    const verwacht = Math.round((0.5 + 0.25 + (40 / 55) * 0.25) * 100);
    expect(resultaat.categoryScores.employment).toBe(verwacht);
    expect(verwacht).toBeLessThan(94); // aantoonbaar onder een perfecte dienstverbandscore
  });

  it("loondienst: geboden salaris onder de wens verlaagt de score met aandachtspunt", () => {
    const kandidaat = maakKandidaat({ contractTypes: ["loondienst"], salaryMin: 400000 });
    const vacature = maakVacature({ contractTypes: ["loondienst"], salaryMax: 300000 });
    const resultaat = computeMatch(kandidaat, vacature);
    expect(resultaat.categoryScores.employment).toBe(
      Math.round((0.5 + 0.25 + (300000 / 400000) * 0.25) * 100),
    );
    expect(resultaat.attentionPoints.some((r) => r.code === "beloning_onder_wens")).toBe(true);
  });

  it("loondienst: passend salaris is een sterk punt", () => {
    const kandidaat = maakKandidaat({ contractTypes: ["loondienst"], salaryMin: 300000 });
    const vacature = maakVacature({ contractTypes: ["loondienst"], salaryMax: 350000 });
    const resultaat = computeMatch(kandidaat, vacature);
    expect(resultaat.categoryScores.employment).toBe(100);
    expect(resultaat.strengths.some((r) => r.code === "beloning_sluit_aan")).toBe(true);
  });

  it("ontbrekende beloningsgegevens vallen neutraal uit (geen straf, geen signaal)", () => {
    const kandidaat = maakKandidaat({ contractTypes: ["loondienst"], salaryMin: null });
    const vacature = maakVacature({ contractTypes: ["loondienst"], salaryMax: null });
    const resultaat = computeMatch(kandidaat, vacature);
    // uren 0,5 + contract 0,25 + neutrale beloning 0,6×0,25 = 0,90 → 90
    expect(resultaat.categoryScores.employment).toBe(90);
    expect(resultaat.attentionPoints.some((r) => r.code === "beloning_onder_wens")).toBe(false);
    expect(resultaat.strengths.some((r) => r.code === "beloning_sluit_aan")).toBe(false);
  });

  it("zzp-wens met loondienst-bod: geen gedeelde vorm → beloning neutraal", () => {
    // Kandidaat wil zzp (55%), vacature biedt alleen loondienst → contract is
    // een harde mismatch; de beloning wordt niet vergeleken over vormen heen.
    const resultaat = computeMatch(
      maakKandidaat({ contractTypes: ["zzp"], revenueShareMin: 55 }),
      maakVacature({ contractTypes: ["loondienst"], salaryMax: 300000 }),
    );
    expect(resultaat.eligible).toBe(false); // harde contractmismatch
    expect(resultaat.attentionPoints.some((r) => r.code === "beloning_onder_wens")).toBe(false);
  });
});
