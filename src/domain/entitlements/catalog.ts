// Plan- en entitlementcatalogus — configuratie als code, geversioneerd.
// Dit is de ENIGE plek met planlogica; de databaserijen (Plan, PlanVersion,
// Entitlement) worden hier later uit geseed. Pure domeinmodule: geen imports
// van buiten src/domain/**.

// ---------- entitlement-sleutels ----------

export const ENTITLEMENT_KEYS = [
  "max_locations",
  "max_active_vacancies",
  "max_members",
  "max_candidate_invites_per_month",
  "talent_radar",
  "opportunity_engine",
  "match_studio_full",
  "analytics_level",
  "export_enabled",
  "cross_location_matching",
  "api_access",
  "candidate_pools",
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

/** Nederlandse labels voor foutmeldingen en UI. */
export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  max_locations: "locaties",
  max_active_vacancies: "actieve vacatures",
  max_members: "teamleden",
  max_candidate_invites_per_month: "kandidaat-uitnodigingen per maand",
  talent_radar: "Talent Radar",
  opportunity_engine: "Opportunity-engine",
  match_studio_full: "volledige Match Studio",
  analytics_level: "analytics",
  export_enabled: "exporteren",
  cross_location_matching: "matching over locaties heen",
  api_access: "API-toegang",
  candidate_pools: "kandidaat-pools",
};

// ---------- plancodes en types ----------

export const PLAN_CODES = ["trial", "essential", "growth", "multi_location"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export type AnalyticsLevel = "basic" | "advanced";

export interface EntitlementDefinition {
  enabled: boolean;
  /**
   * Numerieke limiet. null = onbeperkt (indien enabled).
   * Voor aan/uit-features (zonder limiet) altijd null.
   */
  limitInt: number | null;
  /** Vrije metadata, bv. { level: "basic" | "advanced" } bij analytics_level. */
  meta?: Record<string, unknown>;
}

export interface PlanVersionDefinition {
  version: number;
  /** Alleen actieve versies worden aan nieuwe abonnementen verkocht. */
  active: boolean;
  priceMonthlyCents: number;
  /** Jaarprijs in centen, met circa twee maanden korting t.o.v. 12× maandprijs. */
  priceYearlyCents: number;
  currency: "EUR";
  /** Looptijd in dagen; alleen gezet voor het trialplan. */
  trialDays?: number;
  /** Vrije metadata op versieniveau, bv. { pricing: "contract" }. */
  meta?: Record<string, unknown>;
  entitlements: Record<EntitlementKey, EntitlementDefinition>;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  versions: PlanVersionDefinition[];
}

export type PlanCatalog = Record<PlanCode, PlanDefinition>;

// ---------- hulpfuncties voor leesbare definities ----------

/** Ingeschakeld met numerieke limiet (null = onbeperkt). */
function limiet(limitInt: number | null): EntitlementDefinition {
  return { enabled: true, limitInt };
}

/** Feature aan (zonder limiet), optioneel met metadata. */
function aan(meta?: Record<string, unknown>): EntitlementDefinition {
  return meta ? { enabled: true, limitInt: null, meta } : { enabled: true, limitInt: null };
}

/** Feature uit. */
function uit(): EntitlementDefinition {
  return { enabled: false, limitInt: null };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---------- de catalogus ----------

export const PLAN_CATALOG: PlanCatalog = deepFreeze({
  trial: {
    code: "trial",
    name: "Proefperiode",
    versions: [
      {
        version: 1,
        active: true,
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
        currency: "EUR",
        trialDays: 14,
        entitlements: {
          max_locations: limiet(1),
          max_active_vacancies: limiet(1),
          max_members: limiet(2),
          max_candidate_invites_per_month: limiet(5),
          talent_radar: uit(),
          opportunity_engine: uit(),
          match_studio_full: uit(),
          analytics_level: aan({ level: "basic" }),
          export_enabled: uit(),
          cross_location_matching: uit(),
          api_access: uit(),
          candidate_pools: uit(),
        },
      },
    ],
  },
  essential: {
    code: "essential",
    name: "Essential",
    versions: [
      {
        version: 1,
        active: true,
        priceMonthlyCents: 14_900, // € 149 per maand
        priceYearlyCents: 149_000, // 10 × maandprijs: ~2 maanden korting
        currency: "EUR",
        entitlements: {
          max_locations: limiet(1),
          max_active_vacancies: limiet(3),
          max_members: limiet(3),
          max_candidate_invites_per_month: limiet(25),
          talent_radar: uit(),
          opportunity_engine: uit(),
          match_studio_full: uit(), // basismatching wel, volledige Match Studio niet
          analytics_level: aan({ level: "basic" }),
          export_enabled: uit(),
          cross_location_matching: uit(),
          api_access: uit(),
          candidate_pools: uit(),
        },
      },
    ],
  },
  growth: {
    code: "growth",
    name: "Growth",
    versions: [
      {
        version: 1,
        active: true,
        priceMonthlyCents: 29_900, // € 299 per maand
        priceYearlyCents: 299_000, // 10 × maandprijs: ~2 maanden korting
        currency: "EUR",
        entitlements: {
          max_locations: limiet(1),
          max_active_vacancies: limiet(15),
          max_members: limiet(10),
          max_candidate_invites_per_month: limiet(100),
          talent_radar: aan(),
          opportunity_engine: aan(),
          match_studio_full: aan(),
          analytics_level: aan({ level: "advanced" }),
          export_enabled: aan(),
          cross_location_matching: uit(),
          api_access: uit(),
          candidate_pools: aan(),
        },
      },
    ],
  },
  multi_location: {
    code: "multi_location",
    name: "Multi-locatie",
    versions: [
      {
        version: 1,
        active: true,
        priceMonthlyCents: 0, // contractpricing — prijs op maat
        priceYearlyCents: 0,
        currency: "EUR",
        meta: { pricing: "contract" },
        entitlements: {
          max_locations: limiet(25),
          max_active_vacancies: limiet(null), // onbeperkt
          max_members: limiet(50),
          max_candidate_invites_per_month: limiet(null), // onbeperkt
          talent_radar: aan(),
          opportunity_engine: aan(),
          match_studio_full: aan(),
          analytics_level: aan({ level: "advanced" }),
          export_enabled: aan(),
          cross_location_matching: aan(),
          api_access: aan(),
          candidate_pools: aan(),
        },
      },
    ],
  },
});
