// Domeintests voor de centrale KPI-definities. Puur — geen database.

import { describe, expect, it } from "vitest";
import {
  activeCandidates,
  activePractices,
  activeVacancies,
  applicationConversion,
  arpo,
  churnedMrr,
  cohortRetention,
  contractionMrr,
  coverageByRoleRegion,
  expansionMrr,
  invitationAcceptance,
  logoChurnMonthly,
  matchesPerVacancy,
  mrr,
  newMrr,
  payingOrganizations,
  revenueConcentration,
  revenuePerPlan,
  subscriptionMrrCents,
  timeToFirstMatch,
  timeToPlacement,
  trialOrganizations,
  vacancyFillRate,
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

function meting(startIso: string, dagen: number) {
  const startAt = new Date(startIso);
  return { startAt, endAt: new Date(startAt.getTime() + dagen * 24 * 60 * 60 * 1000) };
}

const ITEM_PRIJZEN: ItemPricesCents = {
  extra_location: 4_900,
  recruiter_seat: 2_500,
};

// ---------- marketplace ----------

describe("marktplaats-tellingen", () => {
  it("telt alleen actieve kandidaten, praktijken en gepubliceerde vacatures", () => {
    const kandidaten = activeCandidates([
      { status: "active" },
      { status: "active" },
      { status: "draft" },
      { status: "paused" },
      { status: "archived" },
    ]);
    expect(kandidaten.value).toBe(2);
    expect(kandidaten.insufficientData).toBe(false);
    expect(kandidaten.definition.length).toBeGreaterThan(0);

    expect(
      activePractices([
        { status: "active" },
        { status: "suspended" },
        { status: "archived" },
      ]).value,
    ).toBe(1);

    expect(
      activeVacancies([
        { status: "published" },
        { status: "published" },
        { status: "draft" },
        { status: "filled" },
      ]).value,
    ).toBe(2);
  });
});

describe("matchesPerVacancy", () => {
  it("berekent het gemiddelde aantal eligible matches per vacature", () => {
    const waarde = matchesPerVacancy([
      { eligibleMatches: 2 },
      { eligibleMatches: 4 },
      { eligibleMatches: 9 },
    ]);
    expect(waarde.value).toBe(5);
    expect(waarde.insufficientData).toBe(false);
  });

  it("zonder vacatures → onvoldoende data", () => {
    const waarde = matchesPerVacancy([]);
    expect(waarde.value).toBeNull();
    expect(waarde.insufficientData).toBe(true);
  });
});

describe("applicationConversion", () => {
  it("met te weinig weergaven (< 10) → insufficientData = true", () => {
    const events = [
      ...Array.from({ length: 5 }, () => ({ name: "match_viewed" })),
      { name: "application_submitted" },
    ];
    const waarde = applicationConversion(events);
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.value).toBeNull();
    expect(waarde.definition).toContain("match_viewed");
  });

  it("berekent application_submitted / match_viewed bij voldoende data", () => {
    const events = [
      ...Array.from({ length: 20 }, () => ({ name: "match_viewed" })),
      ...Array.from({ length: 5 }, () => ({ name: "application_submitted" })),
      { name: "application_started" }, // telt niet mee
    ];
    const waarde = applicationConversion(events);
    expect(waarde.value).toBe(0.25);
    expect(waarde.insufficientData).toBe(false);
  });
});

describe("invitationAcceptance", () => {
  it("met minder dan 5 uitnodigingen → onvoldoende data", () => {
    const waarde = invitationAcceptance([
      { status: "accepted" },
      { status: "sent" },
    ]);
    expect(waarde.insufficientData).toBe(true);
  });

  it("berekent het aandeel geaccepteerde uitnodigingen", () => {
    const waarde = invitationAcceptance([
      { status: "accepted" },
      { status: "accepted" },
      { status: "declined" },
      { status: "sent" },
      { status: "expired" },
    ]);
    expect(waarde.value).toBe(0.4);
    expect(waarde.insufficientData).toBe(false);
  });
});

describe("doorlooptijd-medianen", () => {
  it("mediaan bij een oneven aantal metingen: de middelste waarde in dagen", () => {
    const waarde = timeToPlacement([
      meting("2026-01-01T00:00:00Z", 2),
      meting("2026-02-01T00:00:00Z", 40),
      meting("2026-03-01T00:00:00Z", 10),
    ]);
    expect(waarde.value).toBe(10);
    expect(waarde.insufficientData).toBe(false);
  });

  it("mediaan bij een even aantal metingen: het gemiddelde van de twee middelste", () => {
    const waarde = timeToFirstMatch([
      meting("2026-01-01T00:00:00Z", 1),
      meting("2026-01-02T00:00:00Z", 2),
      meting("2026-01-03T00:00:00Z", 3),
      meting("2026-01-04T00:00:00Z", 10),
    ]);
    expect(waarde.value).toBe(2.5);
  });

  it("werkt ook met gedeeltelijke dagen (12 uur = 0,5 dag)", () => {
    const waarde = timeToFirstMatch([
      meting("2026-01-01T00:00:00Z", 0.5),
      meting("2026-01-02T00:00:00Z", 0.5),
      meting("2026-01-03T00:00:00Z", 4),
    ]);
    expect(waarde.value).toBe(0.5);
  });

  it("met minder dan 3 metingen → onvoldoende data", () => {
    const waarde = timeToPlacement([
      meting("2026-01-01T00:00:00Z", 2),
      meting("2026-02-01T00:00:00Z", 4),
    ]);
    expect(waarde.value).toBeNull();
    expect(waarde.insufficientData).toBe(true);
  });
});

describe("vacancyFillRate", () => {
  it("met minder dan 5 vacatures → onvoldoende data", () => {
    expect(
      vacancyFillRate([{ status: "filled" }, { status: "published" }])
        .insufficientData,
    ).toBe(true);
  });

  it("berekent het aandeel vervulde vacatures", () => {
    const waarde = vacancyFillRate([
      { status: "filled" },
      { status: "filled" },
      { status: "published" },
      { status: "expired" },
      { status: "published" },
    ]);
    expect(waarde.value).toBe(0.4);
  });
});

describe("coverageByRoleRegion", () => {
  it("berekent vraag/aanbod per functie+regio en laat te kleine groepen weg", () => {
    const kandidaten = [
      // utrecht/tandarts: 4 kandidaten
      ...Array.from({ length: 4 }, () => ({ role: "tandarts", region: "utrecht" })),
      // zeeland/mondhygienist: 1 kandidaat → groep te klein (1 + 1 = 2 < 5)
      { role: "mondhygienist", region: "zeeland" },
    ];
    const vacatures = [
      // utrecht/tandarts: 2 vacatures → groep van 6, ratio 2/4
      { role: "tandarts", region: "utrecht" },
      { role: "tandarts", region: "utrecht" },
      { role: "mondhygienist", region: "zeeland" },
    ];
    const resultaat = coverageByRoleRegion(kandidaten, vacatures);
    expect(resultaat.entries).toEqual([
      {
        role: "tandarts",
        region: "utrecht",
        candidateCount: 4,
        vacancyCount: 2,
        demandSupplyRatio: 0.5,
      },
    ]);
    expect(resultaat.definition).toContain("functie");
  });

  it("groep zonder kandidaten maar met genoeg vacatures: ratio null (geen aanbod)", () => {
    const resultaat = coverageByRoleRegion(
      [],
      Array.from({ length: 5 }, () => ({ role: "tandarts", region: "groningen" })),
    );
    expect(resultaat.entries).toHaveLength(1);
    expect(resultaat.entries[0].demandSupplyRatio).toBeNull();
    expect(resultaat.entries[0].vacancyCount).toBe(5);
  });
});

// ---------- SaaS ----------

describe("mrr", () => {
  it("telt maandprijs planversie plus subscription items × itemprijs, alleen voor actieve abonnementen", () => {
    const abonnementen = [
      abonnement({
        organizationId: "org-a",
        planCode: "growth",
        planPriceMonthlyCents: 29_900,
        items: [
          { key: "extra_location", quantity: 2 }, // 2 × 4.900
          { key: "recruiter_seat", quantity: 1 }, // 1 × 2.500
        ],
      }),
      abonnement({
        organizationId: "org-b",
        planCode: "essential",
        planPriceMonthlyCents: 14_900,
      }),
      abonnement({
        organizationId: "org-c",
        planCode: "trial",
        status: "trialing",
        planPriceMonthlyCents: 0,
      }),
      abonnement({ organizationId: "org-d", status: "canceled" }),
    ];

    const waarde = mrr(abonnementen, ITEM_PRIJZEN);
    // 29.900 + 9.800 + 2.500 + 14.900 = 57.100
    expect(waarde.value).toBe(57_100);
    expect(waarde.insufficientData).toBe(false);
  });

  it("subscriptionMrrCents telt onbekende itemsleutels als 0", () => {
    const cents = subscriptionMrrCents(
      abonnement({ items: [{ key: "onbekend_item", quantity: 3 }] }),
      ITEM_PRIJZEN,
    );
    expect(cents).toBe(29_900);
  });

  it("trial- en betalende organisaties worden apart geteld", () => {
    const abonnementen = [
      abonnement({ organizationId: "org-a" }),
      abonnement({ organizationId: "org-b" }),
      abonnement({ organizationId: "org-c", status: "trialing" }),
      abonnement({ organizationId: "org-d", status: "canceled" }),
    ];
    expect(payingOrganizations(abonnementen).value).toBe(2);
    expect(trialOrganizations(abonnementen).value).toBe(1);
  });
});

describe("MRR-beweging (maand-op-maand)", () => {
  const vorige: MrrSnapshot[] = [
    { orgId: "org-upgrade", mrrCents: 14_900 },
    { orgId: "org-downgrade", mrrCents: 29_900 },
    { orgId: "org-churn", mrrCents: 29_900 },
    { orgId: "org-stabiel", mrrCents: 14_900 },
  ];
  const huidige: MrrSnapshot[] = [
    { orgId: "org-upgrade", mrrCents: 29_900 }, // upgrade → expansion
    { orgId: "org-downgrade", mrrCents: 14_900 }, // downgrade → contraction
    // org-churn ontbreekt → churned
    { orgId: "org-stabiel", mrrCents: 14_900 }, // ongewijzigd → geen beweging
    { orgId: "org-nieuw", mrrCents: 14_900 }, // nieuw → new
  ];

  it("upgrade → expansionMrr met het verschil", () => {
    expect(expansionMrr(vorige, huidige).value).toBe(15_000);
  });

  it("downgrade → contractionMrr met het (positieve) verschil", () => {
    expect(contractionMrr(vorige, huidige).value).toBe(15_000);
  });

  it("annulering → churnedMrr met de volledige vorige MRR", () => {
    expect(churnedMrr(vorige, huidige).value).toBe(29_900);
  });

  it("nieuwe betalende organisatie → newMrr met de volledige huidige MRR", () => {
    expect(newMrr(vorige, huidige).value).toBe(14_900);
  });

  it("van 0 naar betalend telt als new; van betalend naar 0 als churned", () => {
    const eerst: MrrSnapshot[] = [{ orgId: "org-x", mrrCents: 0 }];
    const daarna: MrrSnapshot[] = [{ orgId: "org-x", mrrCents: 14_900 }];
    expect(newMrr(eerst, daarna).value).toBe(14_900);
    expect(churnedMrr(daarna, eerst).value).toBe(14_900);
    expect(expansionMrr(eerst, daarna).value).toBe(0);
  });
});

describe("arpo en revenuePerPlan", () => {
  it("arpo = MRR gedeeld door het aantal betalende organisaties", () => {
    const abonnementen = [
      abonnement({ organizationId: "org-a", planPriceMonthlyCents: 29_900 }),
      abonnement({
        organizationId: "org-b",
        planCode: "essential",
        planPriceMonthlyCents: 14_900,
      }),
    ];
    expect(arpo(abonnementen, ITEM_PRIJZEN).value).toBe(22_400);
  });

  it("arpo zonder betalende organisaties → onvoldoende data", () => {
    const waarde = arpo([abonnement({ status: "trialing" })], ITEM_PRIJZEN);
    expect(waarde.insufficientData).toBe(true);
  });

  it("revenuePerPlan verdeelt de MRR per plancode, gesorteerd", () => {
    const abonnementen = [
      abonnement({ organizationId: "org-a", planCode: "growth", planPriceMonthlyCents: 29_900 }),
      abonnement({
        organizationId: "org-b",
        planCode: "growth",
        planPriceMonthlyCents: 29_900,
        items: [{ key: "extra_location", quantity: 1 }],
      }),
      abonnement({ organizationId: "org-c", planCode: "essential", planPriceMonthlyCents: 14_900 }),
      abonnement({ organizationId: "org-d", planCode: "essential", status: "canceled" }),
    ];
    expect(revenuePerPlan(abonnementen, ITEM_PRIJZEN).entries).toEqual([
      { planCode: "essential", mrrCents: 14_900 },
      { planCode: "growth", mrrCents: 64_700 },
    ]);
  });
});

describe("logoChurnMonthly", () => {
  it("met minder dan 5 betalende organisaties vorige maand → onvoldoende data", () => {
    const vorige: MrrSnapshot[] = [
      { orgId: "a", mrrCents: 14_900 },
      { orgId: "b", mrrCents: 14_900 },
    ];
    expect(logoChurnMonthly(vorige, []).insufficientData).toBe(true);
  });

  it("berekent het aandeel vertrokken betalende organisaties", () => {
    const vorige: MrrSnapshot[] = ["a", "b", "c", "d", "e"].map((orgId) => ({
      orgId,
      mrrCents: 14_900,
    }));
    const huidige: MrrSnapshot[] = ["a", "b", "c", "d"].map((orgId) => ({
      orgId,
      mrrCents: 14_900,
    }));
    expect(logoChurnMonthly(vorige, huidige).value).toBe(0.2);
  });
});

describe("cohortRetention", () => {
  it("per startmaand het aandeel nog actieve organisaties; te kleine cohorten → onvoldoende data", () => {
    const resultaat = cohortRetention([
      { orgId: "a", startMonth: "2026-01", active: true },
      { orgId: "b", startMonth: "2026-01", active: true },
      { orgId: "c", startMonth: "2026-01", active: false },
      { orgId: "d", startMonth: "2026-02", active: true },
      { orgId: "e", startMonth: "2026-02", active: true },
    ]);

    expect(resultaat.cohorts).toHaveLength(2);

    const jan = resultaat.cohorts[0];
    expect(jan.startMonth).toBe("2026-01");
    expect(jan.organizationCount).toBe(3);
    expect(jan.activeCount).toBe(2);
    expect(jan.retention).toBeCloseTo(2 / 3, 10);
    expect(jan.insufficientData).toBe(false);

    const feb = resultaat.cohorts[1];
    expect(feb.startMonth).toBe("2026-02");
    expect(feb.organizationCount).toBe(2);
    expect(feb.retention).toBeNull();
    expect(feb.insufficientData).toBe(true);
  });
});

describe("revenueConcentration", () => {
  it("berekent het aandeel van de grootste klant in de totale MRR", () => {
    const waarde = revenueConcentration([
      { orgId: "groot", mrrCents: 70_000 },
      { orgId: "middel", mrrCents: 20_000 },
      { orgId: "klein", mrrCents: 10_000 },
    ]);
    expect(waarde.value).toBe(0.7);
    expect(waarde.insufficientData).toBe(false);
  });

  it("telt meerdere abonnementen van dezelfde organisatie bij elkaar op", () => {
    const waarde = revenueConcentration([
      { orgId: "groot", mrrCents: 30_000 },
      { orgId: "groot", mrrCents: 30_000 },
      { orgId: "klein", mrrCents: 40_000 },
    ]);
    expect(waarde.value).toBe(0.6);
  });

  it("zonder omzet → onvoldoende data", () => {
    expect(revenueConcentration([]).insufficientData).toBe(true);
    expect(
      revenueConcentration([{ orgId: "a", mrrCents: 0 }]).insufficientData,
    ).toBe(true);
  });
});
