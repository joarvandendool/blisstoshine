// Domeintests voor de plan- en entitlementlaag. Puur — geen database.

import { describe, expect, it } from "vitest";
import {
  PLAN_CATALOG,
  can,
  checkLimit,
  effectiveSubscriptionState,
  entitlementsFor,
  entitlementsForSubscription,
  getPlanVersion,
  limitOf,
  type PlanCatalog,
  type SubscriptionSnapshot,
} from "@/domain/entitlements";

const NOW = new Date("2026-07-18T12:00:00Z");

function abonnement(overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    planCode: "growth",
    planVersion: 1,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

describe("plancatalogus", () => {
  it("trial: 14 dagen, prijs 0, 1 locatie, 1 vacature, 2 leden, 5 uitnodigingen, alles premium uit", () => {
    const versie = getPlanVersion("trial");
    expect(versie.trialDays).toBe(14);
    expect(versie.priceMonthlyCents).toBe(0);
    expect(versie.priceYearlyCents).toBe(0);

    const ents = entitlementsFor("trial");
    expect(limitOf(ents, "max_locations")).toBe(1);
    expect(limitOf(ents, "max_active_vacancies")).toBe(1);
    expect(limitOf(ents, "max_members")).toBe(2);
    expect(limitOf(ents, "max_candidate_invites_per_month")).toBe(5);
    expect(can(ents, "match_studio_full")).toBe(false);
    expect(can(ents, "talent_radar")).toBe(false);
    expect(can(ents, "opportunity_engine")).toBe(false);
    expect(can(ents, "export_enabled")).toBe(false);
    expect(can(ents, "analytics_level")).toBe(true);
    expect(ents.analytics_level.meta).toEqual({ level: "basic" });
  });

  it("essential: € 149/maand, jaarprijs met ~2 maanden korting, basismatching zonder premium features", () => {
    const versie = getPlanVersion("essential");
    expect(versie.priceMonthlyCents).toBe(14_900);
    expect(versie.priceYearlyCents).toBe(10 * versie.priceMonthlyCents);
    expect(versie.currency).toBe("EUR");

    const ents = entitlementsFor("essential");
    expect(limitOf(ents, "max_locations")).toBe(1);
    expect(limitOf(ents, "max_active_vacancies")).toBe(3);
    expect(limitOf(ents, "max_members")).toBe(3);
    expect(limitOf(ents, "max_candidate_invites_per_month")).toBe(25);
    expect(can(ents, "match_studio_full")).toBe(false);
    expect(can(ents, "talent_radar")).toBe(false);
    expect(can(ents, "opportunity_engine")).toBe(false);
    expect(can(ents, "export_enabled")).toBe(false);
    expect(can(ents, "candidate_pools")).toBe(false);
    expect(ents.analytics_level.meta).toEqual({ level: "basic" });
  });

  it("growth: € 299/maand, Talent Radar en Opportunity-engine aan, analytics advanced, export aan", () => {
    const versie = getPlanVersion("growth");
    expect(versie.priceMonthlyCents).toBe(29_900);
    expect(versie.priceYearlyCents).toBe(10 * versie.priceMonthlyCents);

    const ents = entitlementsFor("growth");
    expect(limitOf(ents, "max_active_vacancies")).toBe(15);
    expect(limitOf(ents, "max_members")).toBe(10);
    expect(limitOf(ents, "max_candidate_invites_per_month")).toBe(100);
    expect(can(ents, "talent_radar")).toBe(true);
    expect(can(ents, "opportunity_engine")).toBe(true);
    expect(can(ents, "match_studio_full")).toBe(true);
    expect(can(ents, "export_enabled")).toBe(true);
    expect(can(ents, "candidate_pools")).toBe(true);
    expect(can(ents, "cross_location_matching")).toBe(false);
    expect(can(ents, "api_access")).toBe(false);
    expect(ents.analytics_level.meta).toEqual({ level: "advanced" });
  });

  it("multi_location: contractpricing, 25 locaties, onbeperkte vacatures en uitnodigingen, alles aan", () => {
    const versie = getPlanVersion("multi_location");
    expect(versie.priceMonthlyCents).toBe(0);
    expect(versie.meta).toEqual({ pricing: "contract" });

    const ents = entitlementsFor("multi_location");
    expect(limitOf(ents, "max_locations")).toBe(25);
    expect(limitOf(ents, "max_active_vacancies")).toBeNull(); // onbeperkt
    expect(limitOf(ents, "max_members")).toBe(50);
    expect(limitOf(ents, "max_candidate_invites_per_month")).toBeNull(); // onbeperkt
    expect(can(ents, "cross_location_matching")).toBe(true);
    expect(can(ents, "api_access")).toBe(true);
    expect(can(ents, "talent_radar")).toBe(true);
    expect(can(ents, "match_studio_full")).toBe(true);
  });

  it("gooit een Nederlandse fout bij een onbekende planversie", () => {
    expect(() => getPlanVersion("growth", 99)).toThrowError(
      "Onbekende versie 99 van plan growth",
    );
  });
});

describe("checkLimit", () => {
  it("staat toe onder de limiet en rekent de resterende ruimte uit", () => {
    const ents = entitlementsFor("essential");
    const check = checkLimit(ents, "max_active_vacancies", 2);
    expect(check.allowed).toBe(true);
    expect(check.limit).toBe(3);
    expect(check.remaining).toBe(1);
    expect(check.reason).toBeUndefined();
  });

  it("blokkeert op de limiet met een Nederlandse reden inclusief upgrade-hint", () => {
    const ents = entitlementsFor("essential");
    const check = checkLimit(ents, "max_active_vacancies", 3);
    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
    expect(check.reason).toContain("limiet van 3 actieve vacatures");
    expect(check.reason).toContain("Upgrade");
  });

  it("blokkeert een uitgeschakelde feature met uitleg en upgrade-hint", () => {
    const ents = entitlementsFor("essential");
    const check = checkLimit(ents, "talent_radar", 0);
    expect(check.allowed).toBe(false);
    expect(check.limit).toBe(0);
    expect(check.reason).toContain("Talent Radar");
    expect(check.reason).toContain("Upgrade");
  });

  it("limitInt null betekent onbeperkt: hoog gebruik blijft toegestaan", () => {
    const ents = entitlementsFor("multi_location");
    const check = checkLimit(ents, "max_candidate_invites_per_month", 10_000);
    expect(check.allowed).toBe(true);
    expect(check.limit).toBeNull();
    expect(check.remaining).toBeNull();
  });
});

describe("planwijziging", () => {
  it("essential → growth past limieten en features aan", () => {
    const voor = entitlementsFor("essential");
    const na = entitlementsFor("growth");
    expect(limitOf(voor, "max_active_vacancies")).toBe(3);
    expect(limitOf(na, "max_active_vacancies")).toBe(15);
    expect(limitOf(voor, "max_candidate_invites_per_month")).toBe(25);
    expect(limitOf(na, "max_candidate_invites_per_month")).toBe(100);
    expect(can(voor, "talent_radar")).toBe(false);
    expect(can(na, "talent_radar")).toBe(true);

    // wat op essential geblokkeerd was, mag op growth weer
    expect(checkLimit(voor, "max_active_vacancies", 3).allowed).toBe(false);
    expect(checkLimit(na, "max_active_vacancies", 3).allowed).toBe(true);
  });
});

describe("versionering", () => {
  /** Testcatalogus met een kunstmatige versie 2 van growth — de echte
   *  PLAN_CATALOG blijft onaangetast. */
  function catalogusMetGrowthV2(): PlanCatalog {
    const kopie = structuredClone(PLAN_CATALOG) as PlanCatalog;
    const v1 = kopie.growth.versions[0];
    kopie.growth.versions.push({
      ...structuredClone(v1),
      version: 2,
      priceMonthlyCents: 34_900,
      priceYearlyCents: 349_000,
      entitlements: {
        ...structuredClone(v1.entitlements),
        max_active_vacancies: { enabled: true, limitInt: 20 },
      },
    });
    return kopie;
  }

  it("zonder versie wordt de nieuwste actieve versie gekozen", () => {
    const catalogus = catalogusMetGrowthV2();
    expect(getPlanVersion("growth", undefined, catalogus).version).toBe(2);
    expect(limitOf(entitlementsFor("growth", undefined, catalogus), "max_active_vacancies")).toBe(20);
  });

  it("een abonnement op versie 1 behoudt de versie-1-entitlements na introductie van versie 2", () => {
    const catalogus = catalogusMetGrowthV2();
    const ents = entitlementsFor("growth", 1, catalogus);
    expect(limitOf(ents, "max_active_vacancies")).toBe(15);

    const sub = abonnement({ planCode: "growth", planVersion: 1 });
    const subEnts = entitlementsForSubscription(sub, NOW, catalogus);
    expect(limitOf(subEnts, "max_active_vacancies")).toBe(15);
  });

  it("een expliciet opgevraagde versie wordt ook teruggegeven als die inactief is", () => {
    const catalogus = catalogusMetGrowthV2();
    catalogus.growth.versions[0].active = false;
    expect(getPlanVersion("growth", 1, catalogus).version).toBe(1);
    expect(getPlanVersion("growth", undefined, catalogus).version).toBe(2);
  });

  it("de echte catalogus wordt niet gemuteerd door de testcatalogus", () => {
    catalogusMetGrowthV2();
    expect(PLAN_CATALOG.growth.versions).toHaveLength(1);
    expect(limitOf(entitlementsFor("growth"), "max_active_vacancies")).toBe(15);
  });

  it("entitlementsFor geeft een kopie terug: muteren raakt de catalogus niet", () => {
    const ents = entitlementsFor("growth");
    ents.max_active_vacancies.limitInt = 999;
    expect(limitOf(entitlementsFor("growth"), "max_active_vacancies")).toBe(15);
  });
});

describe("effectieve abonnementstoestand", () => {
  it("lopende trial → active met normale trial-entitlements", () => {
    const sub = abonnement({
      planCode: "trial",
      status: "trialing",
      trialEndsAt: new Date("2026-07-25T00:00:00Z"), // in de toekomst
    });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("active");
    const ents = entitlementsForSubscription(sub, NOW);
    expect(limitOf(ents, "max_active_vacancies")).toBe(1);
    expect(checkLimit(ents, "max_active_vacancies", 0).allowed).toBe(true);
  });

  it("verlopen trial → trial_expired en alles geblokkeerd behalve basis-analytics", () => {
    const sub = abonnement({
      planCode: "trial",
      status: "trialing",
      trialEndsAt: new Date("2026-07-10T00:00:00Z"), // in het verleden
    });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("trial_expired");

    const ents = entitlementsForSubscription(sub, NOW);
    expect(can(ents, "max_active_vacancies")).toBe(false);
    expect(limitOf(ents, "max_active_vacancies")).toBe(0);
    expect(checkLimit(ents, "max_active_vacancies", 0).allowed).toBe(false);
    expect(checkLimit(ents, "max_candidate_invites_per_month", 0).allowed).toBe(false);
    expect(can(ents, "talent_radar")).toBe(false);
    // read-only stand: basis-analytics blijft zichtbaar
    expect(can(ents, "analytics_level")).toBe(true);
    expect(ents.analytics_level.meta).toEqual({ level: "basic" });
  });

  it("canceled → geblokkeerd behalve basis-analytics", () => {
    const sub = abonnement({ planCode: "growth", status: "canceled" });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("canceled");

    const ents = entitlementsForSubscription(sub, NOW);
    expect(checkLimit(ents, "max_active_vacancies", 0).allowed).toBe(false);
    expect(can(ents, "talent_radar")).toBe(false);
    expect(can(ents, "export_enabled")).toBe(false);
    expect(can(ents, "analytics_level")).toBe(true);
    expect(ents.analytics_level.meta).toEqual({ level: "basic" });
  });

  it("active → normale entitlements van de vastgepinde planversie", () => {
    const sub = abonnement({ planCode: "growth", status: "active" });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("active");

    const ents = entitlementsForSubscription(sub, NOW);
    expect(can(ents, "talent_radar")).toBe(true);
    expect(limitOf(ents, "max_active_vacancies")).toBe(15);
    expect(checkLimit(ents, "max_active_vacancies", 14).allowed).toBe(true);
  });

  it("past_due → toestand past_due, entitlements blijven gelden (coulance tijdens dunning)", () => {
    const sub = abonnement({ planCode: "growth", status: "past_due" });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("past_due");

    const ents = entitlementsForSubscription(sub, NOW);
    expect(can(ents, "talent_radar")).toBe(true);
    expect(limitOf(ents, "max_active_vacancies")).toBe(15);
  });

  it("active met verstreken betaalperiode wordt defensief als past_due behandeld", () => {
    const sub = abonnement({
      status: "active",
      currentPeriodEnd: new Date("2026-07-01T00:00:00Z"), // in het verleden
    });
    expect(effectiveSubscriptionState(sub, NOW)).toBe("past_due");
  });
});
