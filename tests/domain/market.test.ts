// Unit tests voor de marktmonitor-domeinmodule (fase 6) — puur domein, geen
// database. Kern: de privacyregels worden in het DOMEIN afgedwongen
// (celonderdrukking, weigering van >2 dimensies, sampleSize op elke uitkomst)
// en alle aggregaties zijn deterministisch.

import { describe, expect, it } from "vitest";

import {
  MARKET_MIN_GROUP,
  aandeelWaarde,
  afgerond,
  doorlooptijdenDagen,
  fillRate,
  flexibiliteitInvloed,
  kruisVerdeling,
  maandTrend,
  maandVan,
  maskeerCel,
  mediaanWaarde,
  provincieVanStad,
  telWaarde,
  timeToHire,
  timeToResponse,
  verdeling,
  type TrajectEventFeit,
} from "@/domain/market";

const OPTIES = { period: "2026-07", definition: "testdefinitie" };

function traject(
  trajectId: string,
  toStatus: string,
  dagOffset: number,
): TrajectEventFeit {
  return {
    trajectId,
    role: "mondhygienist",
    regio: "Utrecht",
    toStatus,
    createdAt: new Date(Date.UTC(2026, 6, 1 + dagOffset)),
  };
}

describe("celonderdrukking (minimumgroepsgrootte)", () => {
  it("maskeert tellers onder de drempel als null", () => {
    expect(maskeerCel(4)).toBeNull();
    expect(maskeerCel(5)).toBe(5);
    expect(maskeerCel(2, 3)).toBeNull();
    expect(maskeerCel(3, 3)).toBe(3);
  });

  it("onderdrukt kleine cellen in een verdeling maar telt ze wél in sampleSize", () => {
    const rijen = [
      ...Array(6).fill("loondienst"),
      ...Array(3).fill("zzp"), // onder de drempel van 5 → null
    ];
    const uitkomst = verdeling(rijen, OPTIES);

    expect(uitkomst.sampleSize).toBe(9);
    expect(uitkomst.insufficientData).toBe(false);
    expect(uitkomst.entries).toEqual([
      { key: "loondienst", count: 6 },
      { key: "zzp", count: null }, // onderdrukt, geen klein aantal zichtbaar
    ]);
  });

  it("markeert een hele verdeling onder de drempel als insufficientData", () => {
    const uitkomst = verdeling(["zzp", "zzp"], OPTIES);
    expect(uitkomst.insufficientData).toBe(true);
    expect(uitkomst.entries.every((e) => e.count === null)).toBe(true);
  });

  it("geeft mediaan en aandeel als 'onvoldoende data' onder de drempel", () => {
    const mediaanKlein = mediaanWaarde([24, 32, 28], OPTIES);
    expect(mediaanKlein.value).toBeNull();
    expect(mediaanKlein.insufficientData).toBe(true);

    const aandeelKlein = aandeelWaarde(3, 2, OPTIES);
    expect(aandeelKlein.value).toBeNull();
    expect(aandeelKlein.insufficientData).toBe(true);

    const telKlein = telWaarde(4, OPTIES);
    expect(telKlein.value).toBeNull();
    expect(telKlein.insufficientData).toBe(true);
  });

  it("respecteert een afwijkende minimumgroepsgrootte als parameter", () => {
    const uitkomst = mediaanWaarde([24, 32, 28], { ...OPTIES, minGroupSize: 3 });
    expect(uitkomst.value).toBe(28);
    expect(uitkomst.insufficientData).toBe(false);
  });
});

describe("weigering van risicovolle combinaties (>2 dimensies)", () => {
  const rijen = [{ rol: "tandarts", regio: "Utrecht", contract: "zzp" }];

  it("staat één en twee dimensies toe", () => {
    expect(() => kruisVerdeling(rijen, ["rol"], OPTIES)).not.toThrow();
    expect(() => kruisVerdeling(rijen, ["rol", "regio"], OPTIES)).not.toThrow();
  });

  it("weigert drie of meer dimensies met een privacyfout", () => {
    expect(() => kruisVerdeling(rijen, ["rol", "regio", "contract"], OPTIES)).toThrow(
      /Privacy.*2 dimensies/,
    );
  });

  it("weigert nul dimensies", () => {
    expect(() => kruisVerdeling(rijen, [], OPTIES)).toThrow();
  });
});

describe("sampleSize, periode en definitie op elke uitkomst", () => {
  it("draagt period, sampleSize en Nederlandse definitie op MarketValue", () => {
    const uitkomst = mediaanWaarde([1, 2, 3, 4, 5, 6], OPTIES);
    expect(uitkomst.period).toBe("2026-07");
    expect(uitkomst.sampleSize).toBe(6);
    expect(uitkomst.definition).toBe("testdefinitie");
    expect(uitkomst.value).toBe(4); // mediaan 3.5 → afgerond (kleine steekproef)
  });

  it("vermijdt schijnprecisie: hele getallen bij kleine steekproef", () => {
    expect(afgerond(3.5, 6)).toBe(4); // n < 30 → geheel getal
    expect(afgerond(3.55, 40)).toBe(3.6); // n ≥ 30 → één decimaal
  });

  it("zet sampleSize op verdelingen en fillRate", () => {
    const vulling = fillRate(["filled", "published", "draft", "filled", "expired", "published"], {
      period: "2026-07",
    });
    // draft telt niet mee: 5 relevante vacatures, 2 vervuld
    expect(vulling.sampleSize).toBe(5);
    expect(vulling.value).toBe(0.4);
    expect(vulling.period).toBe("2026-07");
    expect(vulling.definition).toContain("vervuld");
  });
});

describe("determinisme", () => {
  it("geeft identieke uitvoer bij identieke invoer, ongeacht invoervolgorde van gelijke groottes", () => {
    const rijen = ["a", "b", "a", "b", "a", "b", "a", "b", "a", "b"];
    const eerste = verdeling(rijen, OPTIES);
    const tweede = verdeling([...rijen].reverse(), OPTIES);
    expect(tweede).toEqual(eerste);
    // gelijke aantallen → alfabetische volgorde (deterministische tie-break)
    expect(eerste.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("berekent doorlooptijden deterministisch uit trajectevents", () => {
    const events = [
      traject("t1", "invited", 0),
      traject("t1", "interested", 2),
      traject("t2", "invited", 0),
      traject("t2", "declined", 4),
      traject("t3", "applied", 1),
      traject("t3", "hired", 11),
    ];
    expect(doorlooptijdenDagen(events, ["invited", "applied"], ["interested", "declined"])).toEqual([2, 4]);
    expect(doorlooptijdenDagen(events, ["invited", "applied"], ["hired"])).toEqual([10]);

    // Onder de drempel → onvoldoende data, boven de drempel → mediaan.
    expect(timeToResponse(events, { period: "2026-07" }).insufficientData).toBe(true);
    const veel = Array.from({ length: 5 }, (_, i) => [
      traject(`x${i}`, "invited", 0),
      traject(`x${i}`, "hired", i + 1),
    ]).flat();
    const hire = timeToHire(veel, { period: "2026-07" });
    expect(hire.insufficientData).toBe(false);
    expect(hire.value).toBe(3); // mediaan van 1..5
    expect(hire.sampleSize).toBe(5);
  });
});

describe("trend per maand", () => {
  it("groepeert per maand, sorteert chronologisch en onderdrukt kleine maanden", () => {
    const maanden = [
      ...Array(6).fill("2026-06"),
      ...Array(3).fill("2026-07"), // onder de drempel → null
      ...Array(5).fill("2026-05"),
      null, // geen maand → telt niet mee
      "geen-maand", // ongeldig formaat → telt niet mee
    ];
    const trend = maandTrend(maanden, { definition: "testtrend" });

    expect(trend.sampleSize).toBe(14);
    expect(trend.punten).toEqual([
      { maand: "2026-05", count: 5 },
      { maand: "2026-06", count: 6 },
      { maand: "2026-07", count: null },
    ]);
    expect(trend.definition).toBe("testtrend");
  });

  it("leidt de maand deterministisch af uit een datum (UTC)", () => {
    expect(maandVan(new Date(Date.UTC(2026, 6, 18)))).toBe("2026-07");
    expect(maandVan(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });
});

describe("flexibiliteit en regio", () => {
  it("groepeert bereik per flexibiliteitsband met celonderdrukking", () => {
    const rijen = [
      // ruim beschikbaar (≥ 9 dagdelen): 5 kandidaten
      ...Array.from({ length: 5 }, (_, i) => ({ dagdelen: 10, bereik: 6 + i })),
      // beperkt (≤ 4 dagdelen): slechts 2 kandidaten → onderdrukt
      { dagdelen: 3, bereik: 1 },
      { dagdelen: 2, bereik: 2 },
    ];
    const invloed = flexibiliteitInvloed(rijen, { period: "2026-07" });

    expect(invloed.sampleSize).toBe(7);
    const ruim = invloed.banden.find((b) => b.band === "ruim")!;
    expect(ruim.medianBereik).toBe(8);
    expect(ruim.insufficientData).toBe(false);
    const beperkt = invloed.banden.find((b) => b.band === "beperkt")!;
    expect(beperkt.medianBereik).toBeNull();
    expect(beperkt.insufficientData).toBe(true);
  });

  it("vertaalt steden naar provincies met 'onbekend' als terugval", () => {
    expect(provincieVanStad("Utrecht")).toBe("Utrecht");
    expect(provincieVanStad("Groningen")).toBe("Groningen");
    expect(provincieVanStad("Eindhoven")).toBe("Noord-Brabant");
    expect(provincieVanStad("Atlantis")).toBe("onbekend");
    expect(provincieVanStad(null)).toBe("onbekend");
  });

  it("hanteert 5 als standaard minimumgroepsgrootte", () => {
    expect(MARKET_MIN_GROUP).toBe(5);
  });
});
