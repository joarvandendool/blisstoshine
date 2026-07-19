// Domeintests voor de analytics-eventdefinities en de envelope. Puur — geen database.

import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENTS,
  AnalyticsEnvelopeSchema,
  CANDIDATE_FUNNEL_EVENTS,
  CAPACITY_EVENTS,
  COMMERCIAL_EVENTS,
  ENGAGEMENT_EVENTS,
  PRACTICE_FUNNEL_EVENTS,
  PUBLIC_EVENTS,
  isAnalyticsEventName,
} from "@/domain/analytics";

describe("eventnamen", () => {
  it("kandidaatfunnel bevat exact de voorgeschreven events, in funnelvolgorde", () => {
    expect(CANDIDATE_FUNNEL_EVENTS).toEqual([
      "onboarding_started",
      "onboarding_step_completed",
      "candidate_profile_completed",
      "candidate_profile_activated",
      "match_viewed",
      "application_started",
      "application_submitted",
      "interview_scheduled",
      "candidate_hired",
    ]);
  });

  it("praktijkfunnel bevat exact de voorgeschreven events, in funnelvolgorde", () => {
    expect(PRACTICE_FUNNEL_EVENTS).toEqual([
      "organization_created",
      "location_created",
      "vacancy_started",
      "vacancy_published",
      "talent_radar_viewed",
      "match_simulation_run",
      "opportunity_viewed",
      "candidate_invited",
      "interview_scheduled",
      "vacancy_filled",
      "subscription_started",
      "subscription_upgraded",
      "subscription_downgraded",
      "subscription_cancelled",
    ]);
  });

  it("ANALYTICS_EVENTS bevat alle events van alle groepen, gededupliceerd", () => {
    for (const naam of [
      ...CANDIDATE_FUNNEL_EVENTS,
      ...PRACTICE_FUNNEL_EVENTS,
      ...COMMERCIAL_EVENTS,
      ...ENGAGEMENT_EVENTS,
      ...CAPACITY_EVENTS,
      ...PUBLIC_EVENTS,
    ]) {
      expect(ANALYTICS_EVENTS).toContain(naam);
    }
    // interview_scheduled staat in beide funnels en telt één keer
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
    expect(ANALYTICS_EVENTS).toHaveLength(
      CANDIDATE_FUNNEL_EVENTS.length +
        PRACTICE_FUNNEL_EVENTS.length +
        COMMERCIAL_EVENTS.length +
        ENGAGEMENT_EVENTS.length +
        CAPACITY_EVENTS.length +
        PUBLIC_EVENTS.length -
        1,
    );
    expect(
      ANALYTICS_EVENTS.filter((naam) => naam === "interview_scheduled"),
    ).toHaveLength(1);
  });

  it("commerciële en engagement-events zijn aanwezig", () => {
    expect(ANALYTICS_EVENTS).toContain("practice_activated");
    expect(ANALYTICS_EVENTS).toContain("paywall_viewed");
    expect(ANALYTICS_EVENTS).toContain("checkout_started");
    expect(ANALYTICS_EVENTS).toContain("interview_confirmed");
  });

  it("publieke discovery-events bevatten exact de vier voorgeschreven events", () => {
    expect(PUBLIC_EVENTS).toEqual([
      "public_page_viewed",
      "public_job_viewed",
      "public_apply_clicked",
      "public_register_clicked",
    ]);
    for (const naam of PUBLIC_EVENTS) {
      expect(isAnalyticsEventName(naam)).toBe(true);
    }
  });
});

describe("isAnalyticsEventName", () => {
  it("herkent geldige eventnamen uit beide funnels", () => {
    expect(isAnalyticsEventName("match_viewed")).toBe(true);
    expect(isAnalyticsEventName("subscription_upgraded")).toBe(true);
    expect(isAnalyticsEventName("interview_scheduled")).toBe(true);
  });

  it("wijst onbekende waarden en niet-strings af", () => {
    expect(isAnalyticsEventName("niet_bestaand_event")).toBe(false);
    expect(isAnalyticsEventName("")).toBe(false);
    expect(isAnalyticsEventName(42)).toBe(false);
    expect(isAnalyticsEventName(null)).toBe(false);
    expect(isAnalyticsEventName(undefined)).toBe(false);
  });
});

describe("AnalyticsEnvelopeSchema", () => {
  it("accepteert een volledige, geldige envelope", () => {
    const resultaat = AnalyticsEnvelopeSchema.safeParse({
      name: "vacancy_published",
      organizationId: "org_123",
      locationId: "loc_456",
      userId: "user_789",
      candidateId: "cand_abc",
      plan: "growth",
      acquisitionSource: "google_ads",
      context: { vacancyRole: "tandarts", stepIndex: 3, mentorship: true, note: null },
      timestamp: new Date("2026-07-18T12:00:00Z"),
    });
    expect(resultaat.success).toBe(true);
  });

  it("accepteert een minimale envelope met alleen een naam", () => {
    expect(
      AnalyticsEnvelopeSchema.safeParse({ name: "onboarding_started" }).success,
    ).toBe(true);
  });

  it("weigert een onbekende eventnaam", () => {
    const resultaat = AnalyticsEnvelopeSchema.safeParse({
      name: "niet_bestaand_event",
    });
    expect(resultaat.success).toBe(false);
    if (!resultaat.success) {
      expect(resultaat.error.issues[0].message).toBe(
        "Onbekende analytics-eventnaam",
      );
    }
  });

  it("weigert context met een email-sleutel (persoonsgegevens)", () => {
    const resultaat = AnalyticsEnvelopeSchema.safeParse({
      name: "match_viewed",
      context: { email: "kandidaat@example.com" },
    });
    expect(resultaat.success).toBe(false);
    if (!resultaat.success) {
      expect(resultaat.error.issues[0].message).toContain("persoonsgegevens");
    }
  });

  it("weigert ook samengestelde en Nederlandse persoonsgegevens-sleutels", () => {
    for (const context of [
      { userEmail: "x@example.com" },
      { "e-mail": "x@example.com" },
      { naam: "Joar" },
      { achternaam: "Van den Dool" },
      { telefoon: "0612345678" },
      { phoneNumber: "0612345678" },
    ]) {
      const resultaat = AnalyticsEnvelopeSchema.safeParse({
        name: "match_viewed",
        context,
      });
      expect(resultaat.success).toBe(false);
    }
  });

  it("weigert geneste context (dieper dan één niveau)", () => {
    const resultaat = AnalyticsEnvelopeSchema.safeParse({
      name: "match_viewed",
      context: { details: { score: 87 } },
    });
    expect(resultaat.success).toBe(false);
  });

  it("weigert arrays als contextwaarde", () => {
    expect(
      AnalyticsEnvelopeSchema.safeParse({
        name: "match_viewed",
        context: { roles: ["tandarts"] },
      }).success,
    ).toBe(false);
  });

  it("weigert onbekende velden op envelope-niveau (strict)", () => {
    expect(
      AnalyticsEnvelopeSchema.safeParse({
        name: "match_viewed",
        email: "x@example.com",
      }).success,
    ).toBe(false);
  });

  it("coercet een ISO-string naar een Date voor timestamp", () => {
    const resultaat = AnalyticsEnvelopeSchema.safeParse({
      name: "candidate_hired",
      timestamp: "2026-07-18T12:00:00.000Z",
    });
    expect(resultaat.success).toBe(true);
    if (resultaat.success) {
      expect(resultaat.data.timestamp).toBeInstanceOf(Date);
      expect(resultaat.data.timestamp?.toISOString()).toBe(
        "2026-07-18T12:00:00.000Z",
      );
    }
  });
});
