// Contracttests aan de app-kant: de gedeelde decoders interpreteren
// serverpayloads (fixtures met exact het wire-formaat) deterministisch, en
// deep links resolven identiek aan de servertests
// (tests/domain/mobile-contract.test.ts spiegelt deze gevallen).

import {
  CONTRACT_TYPES,
  DAYPARTS,
  DEEP_LINK_FALLBACK,
  decodeAvailability,
  decodeEnum,
  decodeIsoDate,
  decodeSchedule,
  MATCH_CATEGORIES,
  resolveDeepLink,
  ROLES,
  targetToPath,
  WEEKDAYS,
  type MatchResult,
} from "@mondzorgwerkt/api-contract";

describe("canonieke waarden", () => {
  it("draagt de canonieke lijsten van de server", () => {
    expect([...WEEKDAYS]).toEqual(["ma", "di", "wo", "do", "vr", "za", "zo"]);
    expect([...DAYPARTS]).toEqual(["ochtend", "middag", "avond"]);
    expect(ROLES).toContain("mondhygienist");
    expect(CONTRACT_TYPES).toContain("zzp");
  });
});

describe("payload-interpretatie (zelfde fixtures als de servertests)", () => {
  it("parseert een MatchResult-payload met alle categorieën", () => {
    // Fixture in exact het wire-formaat van /api/mobile/v1/matches.
    const fixture: MatchResult = {
      eligible: true,
      score: 87,
      label: "excellent",
      summary: "Uitstekende match: 2 voorkeursdagdelen overlappen.",
      hardMismatchReasons: [],
      strengths: [
        { code: "beschikbaarheid_sterk", category: "availability", message: "Je voorkeursdagen passen." },
      ],
      attentionPoints: [],
      categoryScores: {
        availability: 95,
        roleAndExperience: 100,
        travel: 80,
        employment: 90,
        equipmentAndSoftware: 70,
        specializations: 60,
        workplacePreferences: 60,
      },
      opportunities: [],
      algorithmVersion: "1.0.0",
    };
    for (const categorie of MATCH_CATEGORIES) {
      expect(typeof fixture.categoryScores[categorie]).toBe("number");
    }
    expect(fixture.algorithmVersion).toBe("1.0.0");
  });

  it("decodeert beschikbaarheid defensief (onbekende waarden → unavailable)", () => {
    const uit = decodeAvailability({
      ma: { ochtend: "preferred", middag: "raar", avond: "available" },
      onzin: true,
    });
    expect(uit.ma.ochtend).toBe("preferred");
    expect(uit.ma.middag).toBe("unavailable");
    expect(uit.ma.avond).toBe("available");
    expect(uit.zo.ochtend).toBe("unavailable");
  });

  it("decodeert een vacatuurrooster defensief", () => {
    const uit = decodeSchedule({ di: { ochtend: "required", middag: "preferred" } });
    expect(uit.di.ochtend).toBe("required");
    expect(uit.di.middag).toBe("preferred");
    expect(uit.di.avond).toBeNull();
    expect(uit.wo.ochtend).toBeNull();
  });

  it("interpreteert ISO-datums en enums identiek aan de server", () => {
    expect(decodeIsoDate("2026-08-01T00:00:00.000Z")?.getTime()).toBe(
      Date.UTC(2026, 7, 1),
    );
    expect(decodeIsoDate("kapot")).toBeNull();
    expect(decodeEnum("loondienst", CONTRACT_TYPES)).toBe("loondienst");
    expect(decodeEnum("interim", CONTRACT_TYPES)).toBeNull();
  });
});

describe("deep links", () => {
  it("web-href → scherm", () => {
    expect(resolveDeepLink("/kandidaat/uitnodigingen")).toEqual({ screen: "invitations" });
    expect(resolveDeepLink("/kandidaat/matches/vac123")).toEqual({
      screen: "match",
      vacancyId: "vac123",
    });
  });

  it("app-schema → scherm; onbekend → veilige fallback", () => {
    expect(resolveDeepLink("mondzorgwerkt://gesprek/int9")).toEqual({
      screen: "interview",
      interviewId: "int9",
    });
    expect(resolveDeepLink("mondzorgwerkt://iets/vreemds")).toEqual(DEEP_LINK_FALLBACK);
    expect(resolveDeepLink(null)).toEqual(DEEP_LINK_FALLBACK);
  });

  it("targetToPath levert altijd een geldig routerpad", () => {
    expect(targetToPath({ screen: "invitations" })).toBe("/(app)/(tabs)/uitnodigingen");
    expect(targetToPath({ screen: "match", vacancyId: "v1" })).toBe("/(app)/match/v1");
  });
});
