// Domeintests voor de financiële KPI's (Fase 11): ARR, reactivatie, GRR/NRR,
// logo-retentie, contractmix, concentratie top-N en unit economics.
// Puur domein — geen database.

import { describe, expect, it } from "vitest";
import {
  arpa,
  arpo,
  arr,
  cac,
  cacPerKanaal,
  failedPaymentsCount,
  grossMarginCacPayback,
  grr,
  kortingenTotaal,
  logoRetention,
  ltv,
  maandVsJaarMix,
  newMrr,
  nrr,
  reactivationMrr,
  refundsTotaal,
  revenueConcentrationTopN,
  type ItemPricesCents,
  type MrrSnapshot,
  type SubscriptionRow,
} from "@/domain/kpi";

// ---------- hulpjes ----------

function abonnement(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    organizationId: "org-a",
    planCode: "growth",
    status: "active",
    planPriceMonthlyCents: 29_900,
    items: [],
    ...overrides,
  };
}

const ITEM_PRIJZEN: ItemPricesCents = {
  extra_location: 4_900,
};

/** Snapshotreeks van betalende organisaties met gelijke MRR. */
function betalend(orgIds: string[], mrrCents = 10_000): MrrSnapshot[] {
  return orgIds.map((orgId) => ({ orgId, mrrCents }));
}

// ---------- ARR ----------

describe("arr", () => {
  it("is MRR × 12 (run-rate) over actieve abonnementen inclusief items", () => {
    const abonnementen = [
      abonnement({
        organizationId: "org-a",
        planPriceMonthlyCents: 29_900,
        items: [{ key: "extra_location", quantity: 1 }],
      }),
      abonnement({ organizationId: "org-b", planPriceMonthlyCents: 14_900 }),
      abonnement({ organizationId: "org-c", status: "trialing" }),
    ];
    const waarde = arr(abonnementen, ITEM_PRIJZEN);
    // (29.900 + 4.900 + 14.900) × 12 = 596.400
    expect(waarde.value).toBe(596_400);
    expect(waarde.insufficientData).toBe(false);
  });

  it("documenteert ARR expliciet als run-rate, geen boekhoudkundige omzet", () => {
    const waarde = arr([], ITEM_PRIJZEN);
    expect(waarde.definition).toContain("run-rate");
    expect(waarde.definition).toContain("boekhoudkundige");
  });

  it("zonder abonnementen is ARR 0 (geen onvoldoende data: de meting is compleet)", () => {
    const waarde = arr([], ITEM_PRIJZEN);
    expect(waarde.value).toBe(0);
    expect(waarde.insufficientData).toBe(false);
  });
});

// ---------- reactivatie-MRR ----------

describe("reactivationMrr", () => {
  it("telt alleen organisaties die van bekende 0 terug naar > 0 gaan", () => {
    const vorige: MrrSnapshot[] = [
      { orgId: "org-terug", mrrCents: 0 }, // bekend met 0 → reactivatie
      { orgId: "org-stabiel", mrrCents: 14_900 },
    ];
    const huidige: MrrSnapshot[] = [
      { orgId: "org-terug", mrrCents: 14_900 },
      { orgId: "org-stabiel", mrrCents: 14_900 },
      { orgId: "org-onbekend", mrrCents: 9_900 }, // niet in vorige → nieuw
    ];
    expect(reactivationMrr(vorige, huidige).value).toBe(14_900);
  });

  it("nieuwe MRR blijft reactivaties bevatten (nieuw = echt nieuw + reactivatie)", () => {
    const vorige: MrrSnapshot[] = [{ orgId: "org-terug", mrrCents: 0 }];
    const huidige: MrrSnapshot[] = [
      { orgId: "org-terug", mrrCents: 14_900 },
      { orgId: "org-onbekend", mrrCents: 9_900 },
    ];
    expect(newMrr(vorige, huidige).value).toBe(24_800);
    expect(reactivationMrr(vorige, huidige).value).toBe(14_900);
  });

  it("zonder reactivaties is de waarde 0", () => {
    const waarde = reactivationMrr(betalend(["a"]), betalend(["a"]));
    expect(waarde.value).toBe(0);
    expect(waarde.insufficientData).toBe(false);
  });
});

// ---------- GRR en NRR ----------

describe("grr", () => {
  // Startbasis van 4 betalende orgs à € 100: één churnt, één krimpt € 50,
  // één groeit € 50 (mag GRR niet verhogen), één blijft gelijk.
  const vorige: MrrSnapshot[] = [
    { orgId: "churn", mrrCents: 10_000 },
    { orgId: "krimp", mrrCents: 10_000 },
    { orgId: "groei", mrrCents: 10_000 },
    { orgId: "stabiel", mrrCents: 10_000 },
  ];
  const huidige: MrrSnapshot[] = [
    { orgId: "krimp", mrrCents: 5_000 },
    { orgId: "groei", mrrCents: 15_000 },
    { orgId: "stabiel", mrrCents: 10_000 },
    { orgId: "nieuw", mrrCents: 99_000 }, // nieuw telt niet mee
  ];

  it("is (start − churned − contraction) / start; expansion telt niet mee", () => {
    // (40.000 − 10.000 − 5.000) / 40.000 = 0,625
    expect(grr(vorige, huidige).value).toBe(0.625);
  });

  it("zonder start-MRR → onvoldoende data", () => {
    expect(grr([], huidige).insufficientData).toBe(true);
    expect(grr([{ orgId: "a", mrrCents: 0 }], huidige).insufficientData).toBe(true);
  });

  it("met minder dan 3 betalende organisaties aan de start → onvoldoende data", () => {
    expect(grr(betalend(["a", "b"]), betalend(["a", "b"])).insufficientData).toBe(true);
    expect(grr(betalend(["a", "b", "c"]), betalend(["a", "b", "c"])).value).toBe(1);
  });

  it("volledige retentie zonder churn of krimp is exact 1", () => {
    const basis = betalend(["a", "b", "c"]);
    expect(grr(basis, basis).value).toBe(1);
  });
});

describe("nrr", () => {
  const vorige: MrrSnapshot[] = [
    { orgId: "churn", mrrCents: 10_000 },
    { orgId: "krimp", mrrCents: 10_000 },
    { orgId: "groei", mrrCents: 10_000 },
    { orgId: "stabiel", mrrCents: 10_000 },
  ];
  const huidige: MrrSnapshot[] = [
    { orgId: "krimp", mrrCents: 5_000 },
    { orgId: "groei", mrrCents: 15_000 },
    { orgId: "stabiel", mrrCents: 10_000 },
  ];

  it("is (start + expansion − churned − contraction) / start", () => {
    // (40.000 + 5.000 − 10.000 − 5.000) / 40.000 = 0,75
    expect(nrr(vorige, huidige).value).toBe(0.75);
  });

  it("reactivaties tellen NIET mee in NRR", () => {
    const start: MrrSnapshot[] = [
      ...betalend(["a", "b", "c"], 10_000),
      { orgId: "terug", mrrCents: 0 }, // bekend met 0
    ];
    const eind: MrrSnapshot[] = [
      ...betalend(["a", "b", "c"], 10_000),
      { orgId: "terug", mrrCents: 50_000 }, // reactivatie: geen expansion
    ];
    expect(nrr(start, eind).value).toBe(1);
    expect(nrr(start, eind).definition).toContain("reactivaties");
  });

  it("zonder start-MRR of met te weinig betalende organisaties → onvoldoende data", () => {
    expect(nrr([], huidige).insufficientData).toBe(true);
    expect(nrr(betalend(["a", "b"]), betalend(["a", "b"])).insufficientData).toBe(true);
  });
});

// ---------- ARPA (alias van ARPO) ----------

describe("arpa", () => {
  it("is dezelfde meting als arpo (beide exports beschikbaar)", () => {
    const abonnementen = [
      abonnement({ organizationId: "org-a", planPriceMonthlyCents: 29_900 }),
      abonnement({ organizationId: "org-b", planPriceMonthlyCents: 14_900 }),
    ];
    expect(arpa(abonnementen, ITEM_PRIJZEN)).toEqual(arpo(abonnementen, ITEM_PRIJZEN));
    expect(arpa(abonnementen, ITEM_PRIJZEN).value).toBe(22_400);
  });
});

// ---------- logo-retentie ----------

describe("logoRetention", () => {
  it("is het aandeel betalende organisaties dat aan het einde nog betaalt", () => {
    const vorige = betalend(["a", "b", "c", "d", "e"]);
    const huidige = betalend(["a", "b", "c", "d"]);
    expect(logoRetention(vorige, huidige).value).toBe(0.8);
  });

  it("een organisatie die naar 0 zakt telt niet als behouden", () => {
    const vorige = betalend(["a", "b", "c", "d", "e"]);
    const huidige: MrrSnapshot[] = [
      ...betalend(["a", "b", "c", "d"]),
      { orgId: "e", mrrCents: 0 },
    ];
    expect(logoRetention(vorige, huidige).value).toBe(0.8);
  });

  it("met minder dan 5 betalende organisaties aan de start → onvoldoende data", () => {
    const vorige = betalend(["a", "b", "c", "d"]);
    expect(logoRetention(vorige, vorige).insufficientData).toBe(true);
  });
});

// ---------- contractmix (maand vs. jaar) ----------

describe("maandVsJaarMix", () => {
  it("berekent het MRR-aandeel uit jaarcontracten", () => {
    const waarde = maandVsJaarMix([
      { mrrCents: 30_000, interval: "monthly" },
      { mrrCents: 10_000, interval: "yearly" },
    ]);
    expect(waarde.value).toBe(0.25);
    expect(waarde.insufficientData).toBe(false);
  });

  it("zonder interval-bron (null) → onvoldoende data", () => {
    const waarde = maandVsJaarMix(null);
    expect(waarde.value).toBeNull();
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.definition).toContain("jaarcontracten");
  });

  it("zonder betalende MRR → onvoldoende data", () => {
    expect(maandVsJaarMix([]).insufficientData).toBe(true);
    expect(
      maandVsJaarMix([{ mrrCents: 0, interval: "yearly" }]).insufficientData,
    ).toBe(true);
  });
});

// ---------- omzetconcentratie top-N ----------

describe("revenueConcentrationTopN", () => {
  const snapshots: MrrSnapshot[] = [
    { orgId: "groot", mrrCents: 40_000 },
    { orgId: "middel", mrrCents: 30_000 },
    { orgId: "kleiner", mrrCents: 20_000 },
    { orgId: "klein", mrrCents: 10_000 },
  ];

  it("top-3: gezamenlijk aandeel van de drie grootste klanten", () => {
    // (40.000 + 30.000 + 20.000) / 100.000 = 0,9
    expect(revenueConcentrationTopN(snapshots, 3).value).toBe(0.9);
  });

  it("top-1 komt overeen met de bestaande top-1-concentratie", () => {
    expect(revenueConcentrationTopN(snapshots, 1).value).toBe(0.4);
  });

  it("telt meerdere abonnementen van dezelfde organisatie eerst bij elkaar op", () => {
    const dubbel: MrrSnapshot[] = [
      { orgId: "groot", mrrCents: 25_000 },
      { orgId: "groot", mrrCents: 25_000 },
      { orgId: "klein", mrrCents: 50_000 },
    ];
    expect(revenueConcentrationTopN(dubbel, 1).value).toBe(0.5);
  });

  it("met minder betalende organisaties dan N is de concentratie 1", () => {
    expect(revenueConcentrationTopN(betalend(["a", "b"]), 3).value).toBe(1);
  });

  it("zonder omzet → onvoldoende data", () => {
    expect(revenueConcentrationTopN([], 3).insufficientData).toBe(true);
  });
});

// ---------- betalingsmetingen zonder invoerbron ----------

describe("kortingen, refunds en mislukte betalingen", () => {
  it("retourneren altijd onvoldoende data met een eerlijke Stripe-definitie", () => {
    for (const waarde of [kortingenTotaal(), refundsTotaal(), failedPaymentsCount()]) {
      expect(waarde.value).toBeNull();
      expect(waarde.insufficientData).toBe(true);
      expect(waarde.definition).toContain("Stripe");
    }
  });
});

// ---------- unit economics: CAC, payback en LTV ----------

describe("cac", () => {
  it("zonder kosteninvoer → onvoldoende data (kostendata ontbreekt)", () => {
    const waarde = cac(null);
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.definition).toContain("kostendata ontbreekt");
  });

  it("met kosteninvoer: kosten gedeeld door nieuwe betalende klanten", () => {
    const waarde = cac({ acquisitionCostCents: 300_000, newPayingCustomers: 4 });
    expect(waarde.value).toBe(75_000);
    expect(waarde.insufficientData).toBe(false);
  });

  it("zonder nieuwe klanten in de periode → onvoldoende data", () => {
    expect(
      cac({ acquisitionCostCents: 300_000, newPayingCustomers: 0 }).insufficientData,
    ).toBe(true);
  });
});

describe("cacPerKanaal", () => {
  it("zonder kosteninvoer → onvoldoende data (kostendata ontbreekt)", () => {
    const resultaat = cacPerKanaal(null);
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.entries).toEqual([]);
    expect(resultaat.definition).toContain("kostendata ontbreekt");
  });

  it("berekent CAC per kanaal, gesorteerd; kanalen zonder klanten tonen onvoldoende data", () => {
    const resultaat = cacPerKanaal([
      { channel: "verwijzing", acquisitionCostCents: 50_000, newPayingCustomers: 5 },
      { channel: "advertenties", acquisitionCostCents: 200_000, newPayingCustomers: 2 },
      { channel: "beurs", acquisitionCostCents: 80_000, newPayingCustomers: 0 },
    ]);
    expect(resultaat.insufficientData).toBe(false);
    expect(resultaat.entries).toEqual([
      { channel: "advertenties", cacCents: 100_000, insufficientData: false },
      { channel: "beurs", cacCents: null, insufficientData: true },
      { channel: "verwijzing", cacCents: 10_000, insufficientData: false },
    ]);
  });
});

describe("grossMarginCacPayback", () => {
  it("zonder kosteninvoer → onvoldoende data (kostendata ontbreekt)", () => {
    const waarde = grossMarginCacPayback(null);
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.definition).toContain("kostendata ontbreekt");
  });

  it("is CAC gedeeld door (maandelijkse ARPA × brutomarge), in maanden", () => {
    const waarde = grossMarginCacPayback({
      cacCents: 90_000,
      arpaMonthlyCents: 22_500,
      grossMarginFraction: 0.8,
    });
    // 90.000 / (22.500 × 0,8) = 5 maanden
    expect(waarde.value).toBe(5);
  });

  it("bij marge × ARPA ≤ 0 → onvoldoende data", () => {
    expect(
      grossMarginCacPayback({
        cacCents: 90_000,
        arpaMonthlyCents: 22_500,
        grossMarginFraction: 0,
      }).insufficientData,
    ).toBe(true);
  });
});

describe("ltv", () => {
  it("zonder kosten-/margedata → onvoldoende data (kostendata ontbreekt)", () => {
    const waarde = ltv(null);
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.definition).toContain("kostendata ontbreekt");
  });

  it("is (maandelijkse ARPA × brutomarge) / maandelijkse logo-churn", () => {
    const waarde = ltv({
      arpaMonthlyCents: 20_000,
      grossMarginFraction: 0.8,
      monthlyLogoChurnFraction: 0.02,
    });
    // (20.000 × 0,8) / 0,02 = 800.000 centen
    expect(waarde.value).toBe(800_000);
  });

  it("bij churn ≤ 0 → onvoldoende data (levensduur niet meetbaar, niet oneindig)", () => {
    expect(
      ltv({
        arpaMonthlyCents: 20_000,
        grossMarginFraction: 0.8,
        monthlyLogoChurnFraction: 0,
      }).insufficientData,
    ).toBe(true);
  });
});
