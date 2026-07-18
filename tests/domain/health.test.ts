// Domeintests voor account health — puur, geen database.
//
// Vereisten uit de opdracht:
// - elke status is bereikbaar;
// - de redenen verklaren de score (basis + som van impacts = score);
// - de versie is aanwezig;
// - onboarding_incomplete overheerst;
// - de berekening is deterministisch.

import { describe, expect, it } from "vitest";
import {
  HEALTH_BASE_SCORE,
  HEALTH_STATUS_THRESHOLDS,
  HEALTH_VERSION,
  HEALTH_WEIGHTS,
  computeAccountHealth,
  type AccountHealthInput,
} from "@/domain/health";

const NOW = new Date("2026-07-18T12:00:00Z");

/** Basisinput: rustig account zonder uitschieters. */
function input(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return {
    onboardingVoltooid: true,
    laatsteActiviteitDagen: 20, // niet recent, niet lang inactief
    actieveSeats: 1,
    actieveLocaties: 1,
    actieveVacatures: 0,
    matchesBekeken30d: 0,
    simulaties30d: 0,
    uitnodigingen30d: 0,
    responseRate: null,
    gesprekken90d: 0,
    plaatsingen90d: 0,
    bezettingsplannerGebruik30d: 0,
    marktinzichtenGebruik30d: 0,
    betaalstatus: "active",
    gebruikstrend: "stabiel",
    dagenTotVerlenging: 200,
    ...overrides,
  };
}

/** Gezond, actief account (zonder dat de score op 100 wordt afgekapt). */
function gezondeInput(overrides: Partial<AccountHealthInput> = {}): AccountHealthInput {
  return input({
    laatsteActiviteitDagen: 2, // recent_actief
    actieveVacatures: 2, // actieve_vacatures
    matchesBekeken30d: 5, // matches_bekeken
    uitnodigingen30d: 3, // uitnodigingen_verstuurd
    responseRate: 0.8, // goede_responsrate
    ...overrides,
  });
}

describe("computeAccountHealth — statussen", () => {
  it("healthy is bereikbaar bij een actief, gezond account", () => {
    const health = computeAccountHealth(gezondeInput(), NOW);
    expect(health.status).toBe("healthy");
    expect(health.score).toBeGreaterThanOrEqual(HEALTH_STATUS_THRESHOLDS.healthy);
  });

  it("attention is bereikbaar bij een middelmatig account", () => {
    // Geen vacatures (-5), verder neutraal: score 45 → attention.
    const health = computeAccountHealth(input(), NOW);
    expect(health.status).toBe("attention");
    expect(health.score).toBeGreaterThanOrEqual(HEALTH_STATUS_THRESHOLDS.attention);
    expect(health.score).toBeLessThan(HEALTH_STATUS_THRESHOLDS.healthy);
  });

  it("at_risk is bereikbaar via een lage score", () => {
    const health = computeAccountHealth(
      input({
        laatsteActiviteitDagen: null, // lang_inactief
        gebruikstrend: "dalend", // gebruik_dalend (verlenging ver weg)
      }),
      NOW,
    );
    expect(health.status).toBe("at_risk");
    expect(health.score).toBeLessThan(HEALTH_STATUS_THRESHOLDS.attention);
  });

  it("onboarding_incomplete is bereikbaar en heeft een reden met impact", () => {
    const health = computeAccountHealth(input({ onboardingVoltooid: false }), NOW);
    expect(health.status).toBe("onboarding_incomplete");
    const reden = health.reasons.find((r) => r.code === "onboarding_onvolledig");
    expect(reden).toBeDefined();
    expect(reden!.impact).toBe(HEALTH_WEIGHTS.onboarding_onvolledig);
  });

  it("past_due dwingt at_risk af, ook wanneer de score hoger uitkomt", () => {
    const health = computeAccountHealth(
      gezondeInput({ betaalstatus: "past_due" }),
      NOW,
    );
    expect(health.status).toBe("at_risk");
    expect(health.score).toBeGreaterThanOrEqual(HEALTH_STATUS_THRESHOLDS.attention);
    expect(health.reasons.some((r) => r.code === "betaling_achterstallig")).toBe(true);
  });

  it("dalend gebruik vlak vóór de verlenging dwingt at_risk af met een eigen reden", () => {
    const health = computeAccountHealth(
      gezondeInput({ gebruikstrend: "dalend", dagenTotVerlenging: 10 }),
      NOW,
    );
    expect(health.status).toBe("at_risk");
    expect(health.reasons.some((r) => r.code === "gebruik_dalend")).toBe(true);
    expect(health.reasons.some((r) => r.code === "dalend_voor_verlenging")).toBe(true);
  });

  it("dalend gebruik ver vóór de verlenging dwingt géén at_risk af", () => {
    const health = computeAccountHealth(
      gezondeInput({ gebruikstrend: "dalend", dagenTotVerlenging: 120 }),
      NOW,
    );
    expect(health.status).not.toBe("at_risk");
    expect(health.reasons.some((r) => r.code === "dalend_voor_verlenging")).toBe(false);
  });
});

describe("computeAccountHealth — uitlegbaarheid", () => {
  it("de redenen verklaren de score: basis + som van impacts = score", () => {
    const gevallen: AccountHealthInput[] = [
      input(),
      gezondeInput(),
      input({ laatsteActiviteitDagen: null, gebruikstrend: "dalend" }),
      gezondeInput({ betaalstatus: "past_due" }),
      input({ onboardingVoltooid: false, actieveVacatures: 1 }),
    ];
    for (const geval of gevallen) {
      const health = computeAccountHealth(geval, NOW);
      const som = health.reasons.reduce((acc, r) => acc + r.impact, 0);
      expect(health.score).toBe(
        Math.min(100, Math.max(0, HEALTH_BASE_SCORE + som)),
      );
    }
  });

  it("elke reden heeft een stabiele code, Nederlandse uitleg en de impact uit HEALTH_WEIGHTS", () => {
    const health = computeAccountHealth(
      gezondeInput({
        gesprekken90d: 2,
        plaatsingen90d: 1,
        simulaties30d: 3,
        bezettingsplannerGebruik30d: 2,
        marktinzichtenGebruik30d: 1,
        actieveSeats: 3,
        gebruikstrend: "stijgend",
      }),
      NOW,
    );
    expect(health.reasons.length).toBeGreaterThan(5);
    for (const reden of health.reasons) {
      expect(reden.code in HEALTH_WEIGHTS).toBe(true);
      expect(reden.impact).toBe(HEALTH_WEIGHTS[reden.code as keyof typeof HEALTH_WEIGHTS]);
      expect(reden.uitleg.length).toBeGreaterThan(10);
    }
  });

  it("de score blijft binnen 0–100, ook bij extreme inputs", () => {
    const top = computeAccountHealth(
      gezondeInput({
        gesprekken90d: 5,
        plaatsingen90d: 3,
        simulaties30d: 9,
        bezettingsplannerGebruik30d: 4,
        marktinzichtenGebruik30d: 2,
        actieveSeats: 6,
        gebruikstrend: "stijgend",
      }),
      NOW,
    );
    expect(top.score).toBeLessThanOrEqual(100);

    const bodem = computeAccountHealth(
      input({
        onboardingVoltooid: false,
        laatsteActiviteitDagen: null,
        betaalstatus: "canceled",
        gebruikstrend: "dalend",
        dagenTotVerlenging: 5,
        responseRate: 0.1,
      }),
      NOW,
    );
    expect(bodem.score).toBeGreaterThanOrEqual(0);
  });
});

describe("computeAccountHealth — dominantie en determinisme", () => {
  it("onboarding_incomplete overheerst álle andere statussen", () => {
    // Zelfs met past_due (dat anders at_risk afdwingt) wint onboarding.
    const health = computeAccountHealth(
      gezondeInput({ onboardingVoltooid: false, betaalstatus: "past_due" }),
      NOW,
    );
    expect(health.status).toBe("onboarding_incomplete");
  });

  it("versie en calculatedAt zijn aanwezig", () => {
    const health = computeAccountHealth(input(), NOW);
    expect(health.version).toBe(HEALTH_VERSION);
    expect(HEALTH_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(health.calculatedAt).toEqual(NOW);
  });

  it("is deterministisch: gelijke input geeft een identiek resultaat", () => {
    const a = computeAccountHealth(gezondeInput(), NOW);
    const b = computeAccountHealth(gezondeInput(), NOW);
    expect(b).toEqual(a);
  });
});
