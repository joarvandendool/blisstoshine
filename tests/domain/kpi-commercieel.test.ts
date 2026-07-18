// Domeintests voor de commerciële KPI's (activatie, conversie, gebruik).
// Puur domein — geen database.

import { describe, expect, it } from "vitest";
import {
  capacityPlannerPractices,
  checkoutConversion,
  conversionByAcquisitionSource,
  conversionByPlan,
  firstInvitationShare,
  firstStrongMatchShare,
  interviewsScheduled,
  invitationsSent,
  matchStudioPractices,
  monthlyActivePractices,
  newPracticeAccounts,
  onboardingCompletionRate,
  placements,
  radarViewedShare,
  simulationsPerPractice,
  timeToActivationMedian,
  timeToPaidMedian,
  trialStarts,
  trialToPaidRate,
  weeklyActivePractices,
  type TrialConversionRow,
  type UsageEventRow,
} from "@/domain/kpi";

// ---------- hulpjes ----------

const NU = new Date("2026-07-18T12:00:00Z");

function dagenTerug(dagen: number): Date {
  return new Date(NU.getTime() - dagen * 24 * 60 * 60 * 1000);
}

function trialRij(overrides: Partial<TrialConversionRow> = {}): TrialConversionRow {
  return {
    orgId: "org-a",
    registeredAt: dagenTerug(30),
    convertedAt: null,
    plan: null,
    acquisitionSource: null,
    ...overrides,
  };
}

function gebruikEvent(
  name: string,
  organizationId: string | null,
  dagenGeleden: number,
): UsageEventRow {
  return { name, organizationId, createdAt: dagenTerug(dagenGeleden) };
}

// ---------- activatie ----------

describe("newPracticeAccounts", () => {
  it("telt alleen accounts binnen de periode van 30 dagen", () => {
    const resultaat = newPracticeAccounts(
      [
        { createdAt: dagenTerug(1) },
        { createdAt: dagenTerug(29) },
        { createdAt: dagenTerug(31) }, // buiten de periode
        { createdAt: new Date(NU.getTime() + 1000) }, // in de toekomst
      ],
      NU,
    );
    expect(resultaat.value).toBe(2);
    expect(resultaat.insufficientData).toBe(false);
    expect(resultaat.definition.length).toBeGreaterThan(0);
  });

  it("geeft 0 (geen onvoldoende data) zonder accounts", () => {
    const resultaat = newPracticeAccounts([], NU);
    expect(resultaat.value).toBe(0);
    expect(resultaat.insufficientData).toBe(false);
  });
});

describe("onboardingCompletionRate", () => {
  it("berekent het aandeel afgeronde onboardings", () => {
    const resultaat = onboardingCompletionRate([
      { onboardingCompleted: true },
      { onboardingCompleted: true },
      { onboardingCompleted: false },
      { onboardingCompleted: false },
    ]);
    expect(resultaat.value).toBe(0.5);
    expect(resultaat.insufficientData).toBe(false);
  });

  it("toont onvoldoende data onder het minimum van 3 accounts", () => {
    const resultaat = onboardingCompletionRate([
      { onboardingCompleted: true },
      { onboardingCompleted: true },
    ]);
    expect(resultaat.value).toBeNull();
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.definition.length).toBeGreaterThan(0);
  });
});

describe("timeToActivationMedian", () => {
  it("berekent de mediaan in dagen over geactiveerde praktijken", () => {
    const rows = [
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(18) }, // 2 dagen
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(16) }, // 4 dagen
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(10) }, // 10 dagen
      { createdAt: dagenTerug(20), activatedAt: null }, // telt niet mee
    ];
    const resultaat = timeToActivationMedian(rows);
    expect(resultaat.value).toBeCloseTo(4, 5);
    expect(resultaat.insufficientData).toBe(false);
  });

  it("middelt de twee middelste waarden bij een even aantal metingen", () => {
    const rows = [
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(19) }, // 1 dag
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(17) }, // 3 dagen
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(15) }, // 5 dagen
      { createdAt: dagenTerug(20), activatedAt: dagenTerug(13) }, // 7 dagen
    ];
    expect(timeToActivationMedian(rows).value).toBeCloseTo(4, 5);
  });

  it("negeert activaties vóór de accountaanmaak en toont dan onvoldoende data", () => {
    const rows = [
      { createdAt: dagenTerug(5), activatedAt: dagenTerug(10) }, // vóór aanmaak
      { createdAt: dagenTerug(5), activatedAt: dagenTerug(4) },
      { createdAt: dagenTerug(5), activatedAt: dagenTerug(3) },
    ];
    const resultaat = timeToActivationMedian(rows);
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.value).toBeNull();
  });
});

describe("activatiemijlpalen (radar, sterke match, uitnodiging)", () => {
  const rows = [
    { orgId: "a", achieved: true },
    { orgId: "b", achieved: false },
    { orgId: "c", achieved: true },
    { orgId: "d", achieved: true },
  ];

  it("berekent het aandeel praktijken dat de mijlpaal haalde", () => {
    expect(radarViewedShare(rows).value).toBe(0.75);
    expect(firstStrongMatchShare(rows).value).toBe(0.75);
    expect(firstInvitationShare(rows).value).toBe(0.75);
  });

  it("toont onvoldoende data onder het minimum van 3 praktijken", () => {
    const teWeinig = rows.slice(0, 2);
    for (const resultaat of [
      radarViewedShare(teWeinig),
      firstStrongMatchShare(teWeinig),
      firstInvitationShare(teWeinig),
    ]) {
      expect(resultaat.insufficientData).toBe(true);
      expect(resultaat.value).toBeNull();
    }
  });
});

// ---------- conversie ----------

describe("trialStarts en trialToPaidRate", () => {
  it("telt gestarte proefperiodes", () => {
    expect(trialStarts([trialRij(), trialRij({ orgId: "org-b" })]).value).toBe(2);
  });

  it("berekent trial-naar-betaald over alle proefperiodes", () => {
    const rows = [
      trialRij({ orgId: "a", convertedAt: dagenTerug(10), plan: "growth" }),
      trialRij({ orgId: "b", convertedAt: dagenTerug(5), plan: "essential" }),
      trialRij({ orgId: "c" }),
      trialRij({ orgId: "d" }),
      trialRij({ orgId: "e" }),
    ];
    const resultaat = trialToPaidRate(rows);
    expect(resultaat.value).toBeCloseTo(0.4, 5);
    expect(resultaat.insufficientData).toBe(false);
  });

  it("toont onvoldoende data onder het minimum van 5 proefperiodes", () => {
    const rows = [
      trialRij({ orgId: "a", convertedAt: dagenTerug(1) }),
      trialRij({ orgId: "b" }),
    ];
    const resultaat = trialToPaidRate(rows);
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.value).toBeNull();
  });
});

describe("timeToPaidMedian", () => {
  it("berekent de mediane tijd van registratie tot betaling", () => {
    const rows = [
      trialRij({ orgId: "a", registeredAt: dagenTerug(30), convertedAt: dagenTerug(28) }), // 2
      trialRij({ orgId: "b", registeredAt: dagenTerug(30), convertedAt: dagenTerug(24) }), // 6
      trialRij({ orgId: "c", registeredAt: dagenTerug(30), convertedAt: dagenTerug(16) }), // 14
      trialRij({ orgId: "d" }), // niet geconverteerd — telt niet mee
    ];
    expect(timeToPaidMedian(rows).value).toBeCloseTo(6, 5);
  });

  it("toont onvoldoende data onder het minimum van 3 conversies", () => {
    const resultaat = timeToPaidMedian([
      trialRij({ orgId: "a", convertedAt: dagenTerug(1) }),
    ]);
    expect(resultaat.insufficientData).toBe(true);
  });
});

describe("checkoutConversion", () => {
  it("deelt voltooide checkouts door gestarte checkouts", () => {
    const events = [
      ...Array.from({ length: 8 }, () => ({ name: "checkout_started" })),
      { name: "checkout_abandoned" },
      { name: "subscription_started" },
      { name: "subscription_upgraded" },
      { name: "subscription_downgraded" },
      { name: "match_viewed" }, // irrelevant event telt nergens mee
    ];
    const resultaat = checkoutConversion(events);
    expect(resultaat.value).toBeCloseTo(3 / 8, 5);
    expect(resultaat.insufficientData).toBe(false);
  });

  it("begrenst de conversie op 1 wanneer er meer wijzigingen dan checkouts zijn", () => {
    const events = [
      ...Array.from({ length: 5 }, () => ({ name: "checkout_started" })),
      ...Array.from({ length: 7 }, () => ({ name: "subscription_started" })),
    ];
    expect(checkoutConversion(events).value).toBe(1);
  });

  it("toont onvoldoende data onder het minimum van 5 gestarte checkouts", () => {
    const events = [
      { name: "checkout_started" },
      { name: "subscription_started" },
    ];
    const resultaat = checkoutConversion(events);
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.value).toBeNull();
  });
});

describe("conversionByPlan", () => {
  it("groepeert checkoutconversie per plan en markeert te kleine groepen", () => {
    const events = [
      // growth: 4 gestart, 2 voltooid
      { name: "checkout_started", plan: "growth" },
      { name: "checkout_started", plan: "growth" },
      { name: "checkout_started", plan: "growth" },
      { name: "checkout_started", plan: "growth" },
      { name: "subscription_started", plan: "growth" },
      { name: "subscription_upgraded", plan: "growth" },
      // essential: 2 gestart (te klein), 1 voltooid
      { name: "checkout_started", plan: "essential" },
      { name: "checkout_started", plan: "essential" },
      { name: "subscription_started", plan: "essential" },
      // zonder plan: telt niet mee
      { name: "checkout_started", plan: null },
    ];
    const resultaat = conversionByPlan(events);
    expect(resultaat.entries).toHaveLength(2);

    const [essential, growth] = resultaat.entries;
    expect(essential.segment).toBe("essential");
    expect(essential.insufficientData).toBe(true);
    expect(essential.rate).toBeNull();

    expect(growth.segment).toBe("growth");
    expect(growth.total).toBe(4);
    expect(growth.converted).toBe(2);
    expect(growth.rate).toBeCloseTo(0.5, 5);
    expect(growth.insufficientData).toBe(false);
  });
});

describe("conversionByAcquisitionSource", () => {
  it("groepeert trial-naar-betaald per bron; null wordt 'onbekend'", () => {
    const rows = [
      trialRij({ orgId: "a", acquisitionSource: "google", convertedAt: dagenTerug(1) }),
      trialRij({ orgId: "b", acquisitionSource: "google", convertedAt: dagenTerug(2) }),
      trialRij({ orgId: "c", acquisitionSource: "google" }),
      trialRij({ orgId: "d", acquisitionSource: null }),
      trialRij({ orgId: "e", acquisitionSource: null }),
    ];
    const resultaat = conversionByAcquisitionSource(rows);
    expect(resultaat.entries.map((e) => e.segment)).toEqual(["google", "onbekend"]);

    const [google, onbekend] = resultaat.entries;
    expect(google.total).toBe(3);
    expect(google.converted).toBe(2);
    expect(google.rate).toBeCloseTo(2 / 3, 5);
    expect(google.insufficientData).toBe(false);

    expect(onbekend.total).toBe(2);
    expect(onbekend.insufficientData).toBe(true);
    expect(onbekend.rate).toBeNull();
  });
});

// ---------- gebruik ----------

describe("weekly/monthly actieve praktijken", () => {
  const events: UsageEventRow[] = [
    gebruikEvent("vacancy_published", "org-a", 2),
    gebruikEvent("match_simulation_run", "org-a", 3), // zelfde org, telt één keer
    gebruikEvent("candidate_invited", "org-b", 6),
    gebruikEvent("talent_radar_viewed", "org-c", 20), // alleen maandelijks
    gebruikEvent("vacancy_published", "org-d", 40), // buiten beide vensters
    gebruikEvent("match_viewed", null, 1), // zonder organisatie telt niet mee
  ];

  it("telt distinct praktijken in het 7-daagse venster (WAP)", () => {
    expect(weeklyActivePractices(events, NU).value).toBe(2);
  });

  it("telt distinct praktijken in het 30-daagse venster (MAP)", () => {
    expect(monthlyActivePractices(events, NU).value).toBe(3);
  });
});

describe("Match Studio- en productgebruik", () => {
  const events: UsageEventRow[] = [
    gebruikEvent("match_simulation_run", "org-a", 1),
    gebruikEvent("match_simulation_run", "org-a", 2),
    gebruikEvent("match_simulation_run", "org-a", 3),
    gebruikEvent("match_simulation_run", "org-b", 4),
    gebruikEvent("match_simulation_run", "org-c", 45), // buiten het venster
    gebruikEvent("candidate_invited", "org-a", 5),
    gebruikEvent("candidate_invited", "org-b", 6),
    gebruikEvent("interview_scheduled", "org-a", 7),
    gebruikEvent("vacancy_filled", "org-b", 8),
    gebruikEvent("capacity_planner_viewed", "org-a", 9),
    gebruikEvent("capacity_planner_viewed", "org-a", 10),
  ];

  it("telt simulerende praktijken en simulaties per praktijk", () => {
    expect(matchStudioPractices(events, NU).value).toBe(2);
    expect(simulationsPerPractice(events, NU).value).toBeCloseTo(2, 5); // 4 / 2
  });

  it("toont onvoldoende data zonder simulerende praktijken", () => {
    const resultaat = simulationsPerPractice(
      [gebruikEvent("candidate_invited", "org-a", 1)],
      NU,
    );
    expect(resultaat.insufficientData).toBe(true);
    expect(resultaat.value).toBeNull();
  });

  it("telt uitnodigingen, gesprekken, plaatsingen en plannergebruik in 30 dagen", () => {
    expect(invitationsSent(events, NU).value).toBe(2);
    expect(interviewsScheduled(events, NU).value).toBe(1);
    expect(placements(events, NU).value).toBe(1);
    expect(capacityPlannerPractices(events, NU).value).toBe(1);
  });
});
