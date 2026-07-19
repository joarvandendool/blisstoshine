// Contracttests web ↔ mobiel (MOBILE_API_CONTRACT.md §9): bewijzen dat het
// gedeelde pakket packages/api-contract exact dezelfde canonieke waarden
// draagt als de serverbronnen, en dat de gedeelde decoders payloads identiek
// interpreteren aan de serverlogica.

import { describe, expect, it } from "vitest";

// Serverbronnen (bronwaarheid)
import * as taxonomie from "@/domain/taxonomy";
import {
  FEEDBACK_REASON_CODES as SERVER_FEEDBACK_REASON_CODES,
  FEEDBACK_REASON_LABELS as SERVER_FEEDBACK_REASON_LABELS,
  PIPELINE_STATUSES as SERVER_PIPELINE_STATUSES,
} from "@/server/pipeline";
import { NOTIFICATION_TYPES as SERVER_NOTIFICATION_TYPES } from "@/lib/notifications";
import {
  ApplicationStatus,
  CandidateStatus,
  InterviewStatus,
  InvitationStatus,
  ProfileVisibility,
  VacancyStatus,
} from "@prisma/client";
import { castAvailability } from "@/server/candidates";

// Gedeeld contract (wat de app gebruikt)
import * as contract from "../../packages/api-contract/src";

describe("mobiel contract: taxonomie is letterlijk gedeeld", () => {
  it("her-exporteert dezelfde referenties (geen kopieën)", () => {
    // Zelfde array-instantie bewijst: één bron, geen drift mogelijk.
    expect(contract.WEEKDAYS).toBe(taxonomie.WEEKDAYS);
    expect(contract.DAYPARTS).toBe(taxonomie.DAYPARTS);
    expect(contract.ROLES).toBe(taxonomie.ROLES);
    expect(contract.EXPERIENCE_LEVELS).toBe(taxonomie.EXPERIENCE_LEVELS);
    expect(contract.CONTRACT_TYPES).toBe(taxonomie.CONTRACT_TYPES);
    expect(contract.EQUIPMENT).toBe(taxonomie.EQUIPMENT);
    expect(contract.SOFTWARE).toBe(taxonomie.SOFTWARE);
    expect(contract.SPECIALIZATIONS).toBe(taxonomie.SPECIALIZATIONS);
    expect(contract.TREATMENTS).toBe(taxonomie.TREATMENTS);
    expect(contract.PATIENT_POPULATION).toBe(taxonomie.PATIENT_POPULATION);
    expect(contract.PRACTICE_SIZES).toBe(taxonomie.PRACTICE_SIZES);
    expect(contract.WORK_PACES).toBe(taxonomie.WORK_PACES);
    expect(contract.TEAM_PREFERENCES).toBe(taxonomie.TEAM_PREFERENCES);
    expect(contract.LABELS).toBe(taxonomie.LABELS);
  });
});

describe("mobiel contract: statuswaarden zijn identiek aan de server", () => {
  it("pipeline-statussen", () => {
    expect([...contract.PIPELINE_STATUSES]).toEqual([...SERVER_PIPELINE_STATUSES]);
  });

  it("redencodes en labels", () => {
    expect([...contract.FEEDBACK_REASON_CODES]).toEqual([
      ...SERVER_FEEDBACK_REASON_CODES,
    ]);
    expect(contract.FEEDBACK_REASON_LABELS).toEqual(SERVER_FEEDBACK_REASON_LABELS);
  });

  it("notificatietypen", () => {
    expect([...contract.NOTIFICATION_TYPES]).toEqual([...SERVER_NOTIFICATION_TYPES]);
    for (const type of contract.CANDIDATE_NOTIFICATION_TYPES) {
      expect(contract.NOTIFICATION_TYPES).toContain(type);
    }
  });

  it("Prisma-enums (vacature, sollicitatie, uitnodiging, gesprek, profiel)", () => {
    expect([...contract.VACANCY_STATUSES].sort()).toEqual(
      Object.values(VacancyStatus).sort(),
    );
    expect([...contract.APPLICATION_STATUSES].sort()).toEqual(
      Object.values(ApplicationStatus).sort(),
    );
    expect([...contract.INVITATION_STATUSES].sort()).toEqual(
      Object.values(InvitationStatus).sort(),
    );
    expect([...contract.INTERVIEW_STATUSES].sort()).toEqual(
      Object.values(InterviewStatus).sort(),
    );
    expect([...contract.CANDIDATE_STATUSES].sort()).toEqual(
      Object.values(CandidateStatus).sort(),
    );
    expect([...contract.PROFILE_VISIBILITIES].sort()).toEqual(
      Object.values(ProfileVisibility).sort(),
    );
  });

  it("matchcategorieën dekken het CategoryScores-contract", () => {
    // Compile-time bewaakt het type; runtime bewaken we de volledigheid.
    const voorbeeld: contract.CategoryScores = {
      availability: 1,
      roleAndExperience: 1,
      travel: 1,
      employment: 1,
      equipmentAndSoftware: 1,
      specializations: 1,
      workplacePreferences: 1,
    };
    expect(Object.keys(voorbeeld).sort()).toEqual([...contract.MATCH_CATEGORIES].sort());
    expect(Object.keys(contract.MATCH_CATEGORY_LABELS).sort()).toEqual(
      [...contract.MATCH_CATEGORIES].sort(),
    );
  });
});

describe("mobiel contract: decoders interpreteren payloads als de server", () => {
  it("decodeAvailability is gelijk aan castAvailability voor dezelfde input", () => {
    const gevallen: unknown[] = [
      null,
      {},
      { ma: { ochtend: "preferred", middag: "available", avond: "unavailable" } },
      { di: { ochtend: "FOUT", middag: 3, avond: "available" }, onzin: 1 },
      { zo: { ochtend: "preferred" } },
      [1, 2, 3],
      "geen object",
    ];
    for (const geval of gevallen) {
      expect(contract.decodeAvailability(geval)).toEqual(castAvailability(geval));
    }
  });

  it("decodeSchedule laat alleen geldige roostereisen door", () => {
    const uit = contract.decodeSchedule({
      ma: { ochtend: "required", middag: "preferred", avond: "nee" },
      onbekend: { ochtend: "required" },
    });
    expect(uit.ma).toEqual({ ochtend: "required", middag: "preferred", avond: null });
    expect(uit.di).toEqual({ ochtend: null, middag: null, avond: null });
    expect("onbekend" in uit).toBe(false);
  });

  it("decodeIsoDate en decodeEnum zijn defensief", () => {
    expect(contract.decodeIsoDate("2026-08-01T00:00:00.000Z")?.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
    expect(contract.decodeIsoDate("geen datum")).toBeNull();
    expect(contract.decodeIsoDate(null)).toBeNull();
    expect(contract.decodeEnum("zzp", contract.CONTRACT_TYPES)).toBe("zzp");
    expect(contract.decodeEnum("freelance", contract.CONTRACT_TYPES)).toBeNull();
  });
});

describe("mobiel contract: deep links", () => {
  it("vertaalt web-href's uit notificaties naar het juiste scherm", () => {
    expect(contract.resolveDeepLink("/kandidaat/uitnodigingen")).toEqual({
      screen: "invitations",
    });
    expect(contract.resolveDeepLink("/kandidaat/matches/abc123")).toEqual({
      screen: "match",
      vacancyId: "abc123",
    });
    expect(contract.resolveDeepLink("/kandidaat")).toEqual({ screen: "matches" });
    expect(contract.resolveDeepLink("/kandidaat/profiel")).toEqual({
      screen: "profile",
    });
  });

  it("vertaalt app-schema-URL's", () => {
    expect(contract.resolveDeepLink("mondzorgwerkt://match/xyz")).toEqual({
      screen: "match",
      vacancyId: "xyz",
    });
    expect(contract.resolveDeepLink("mondzorgwerkt://uitnodigingen")).toEqual({
      screen: "invitations",
    });
    expect(contract.resolveDeepLink("mondzorgwerkt://gesprek/int1")).toEqual({
      screen: "interview",
      interviewId: "int1",
    });
  });

  it("valt veilig terug bij onbekende of verdwenen content", () => {
    expect(contract.resolveDeepLink(null)).toEqual(contract.DEEP_LINK_FALLBACK);
    expect(contract.resolveDeepLink("")).toEqual(contract.DEEP_LINK_FALLBACK);
    expect(contract.resolveDeepLink("/praktijk/geheim/dashboard")).toEqual(
      contract.DEEP_LINK_FALLBACK,
    );
    expect(contract.resolveDeepLink("https://kwaadaardig.nl/phish")).toEqual(
      contract.DEEP_LINK_FALLBACK,
    );
  });

  it("elke DeepLinkTarget heeft een routerpad", () => {
    expect(contract.targetToPath({ screen: "matches" })).toContain("(tabs)");
    expect(contract.targetToPath({ screen: "match", vacancyId: "v1" })).toContain("v1");
    expect(
      contract.targetToPath({ screen: "interview", interviewId: "i1" }),
    ).toContain("i1");
  });
});
