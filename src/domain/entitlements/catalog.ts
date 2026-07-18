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
  "extended_history",
  "premium_market_insights",
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
  extended_history: "uitgebreide historie",
  premium_market_insights: "premium marktinzichten",
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
  /**
   * Uitkomstregel voor de abonnementspagina — voor wie is dit plan?
   * Bv. "Voor praktijken die structureel willen werven en plannen".
   */
  tagline?: string;
  /**
   * Concrete uitkomsten/inhoud van het plan als korte Nederlandse regels,
   * voor de plankaarten. Optioneel zodat bestaande structuren niet breken.
   */
  outcomes?: readonly string[];
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
    tagline: "Probeer Mondzorgwerkt 14 dagen vrijblijvend",
    outcomes: [
      "Zet je eerste vacature online en zie direct passende kandidaten",
      "Ervaar de matching zonder verplichtingen",
    ],
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
          extended_history: uit(),
          premium_market_insights: uit(),
        },
      },
    ],
  },
  essential: {
    code: "essential",
    name: "Essential",
    tagline: "Voor één praktijk met incidentele vacatures",
    outcomes: [
      "Eén locatie en een beperkt aantal actieve vacatures",
      "Basismatching: zie direct welke kandidaten bij je vacature passen",
      "Nodig kandidaten uit en volg iedereen in één kandidatenpipeline",
    ],
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
          extended_history: uit(),
          premium_market_insights: uit(),
        },
      },
    ],
  },
  growth: {
    code: "growth",
    name: "Growth",
    tagline: "Voor praktijken die structureel willen werven en plannen",
    outcomes: [
      "Volledige Match Studio: zie welke aanpassing je kandidatenpool vergroot",
      "Talent Radar en 'Maak deze match mogelijk' bij elke vacature",
      "Meerdere teamleden en uitgebreide kandidatenpools",
      "Bezettingsinzichten en conversieanalytics voor je planning",
    ],
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
          extended_history: uit(),
          premium_market_insights: uit(),
        },
      },
    ],
  },
  multi_location: {
    code: "multi_location",
    name: "Multi-locatie",
    tagline: "Voor ketens en praktijkgroepen",
    outcomes: [
      "Centraal beheer over meerdere locaties",
      "Cross-locatiematching: één kandidatenpool voor de hele groep",
      "Geavanceerde rollen en consolidatierapportages",
      "Integraties (API-toegang) en contractpricing op maat",
    ],
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
          extended_history: aan(),
          premium_market_insights: aan(),
        },
      },
    ],
  },
});

// ---------- uitbreidingen (add-ons) ----------
//
// Add-ons zijn configureerbare abonnementsitems (SubscriptionItem in de
// database): per item een vaste maandprijs en een declaratief effect op de
// entitlements van het onderliggende plan. GEEN klantspecifieke uitzonderingen
// in code — alles loopt via deze catalogus en de aantallen per abonnement.

export const ADDON_KEYS = [
  "extra_location",
  "extra_seat",
  "extra_active_vacancy",
  "invite_pack_25",
  "analytics_advanced_addon",
  "api_access_addon",
  "extended_history",
  "premium_market_insights",
] as const;

export type AddonKey = (typeof ADDON_KEYS)[number];

/** Declaratief effect van een add-on op de entitlements van het plan. */
export type AddonEffect =
  | {
      /** Telt per stuk op bij een numerieke limiet (onbeperkt blijft onbeperkt). */
      kind: "limit";
      entitlement: EntitlementKey;
      /** Verhoging van de limiet per aangeschaft stuk. */
      amountPerUnit: number;
    }
  | {
      /** Schakelt een feature in (kwantiteit boven 1 heeft geen extra effect). */
      kind: "feature";
      entitlement: EntitlementKey;
      /** Metadata die op het entitlement wordt gezet, bv. { level: "advanced" }. */
      meta?: Record<string, unknown>;
    };

export interface AddonDefinition {
  key: AddonKey;
  name: string;
  /** Nederlandse omschrijving voor de abonnements-UI. */
  description: string;
  priceMonthlyCents: number;
  currency: "EUR";
  /** Maximaal aantal per abonnement (features altijd 1). */
  maxQuantity: number;
  effect: AddonEffect;
}

export type AddonCatalog = Record<AddonKey, AddonDefinition>;

export const ADDON_CATALOG: AddonCatalog = deepFreeze({
  extra_location: {
    key: "extra_location",
    name: "Extra locatie",
    description: "Eén extra praktijklocatie bovenop de locaties van je plan.",
    priceMonthlyCents: 4_900, // € 49 per maand per locatie
    currency: "EUR",
    maxQuantity: 10,
    effect: { kind: "limit", entitlement: "max_locations", amountPerUnit: 1 },
  },
  extra_seat: {
    key: "extra_seat",
    name: "Extra teamlid",
    description: "Eén extra teamlid (seat) bovenop de teamleden van je plan.",
    priceMonthlyCents: 1_500, // € 15 per maand per seat
    currency: "EUR",
    maxQuantity: 25,
    effect: { kind: "limit", entitlement: "max_members", amountPerUnit: 1 },
  },
  extra_active_vacancy: {
    key: "extra_active_vacancy",
    name: "Extra actieve vacature",
    description: "Eén extra gelijktijdig gepubliceerde vacature.",
    priceMonthlyCents: 2_500, // € 25 per maand per vacature
    currency: "EUR",
    maxQuantity: 25,
    effect: { kind: "limit", entitlement: "max_active_vacancies", amountPerUnit: 1 },
  },
  invite_pack_25: {
    key: "invite_pack_25",
    name: "Uitnodigingenpakket (25)",
    description: "25 extra kandidaat-uitnodigingen per maand, per pakket.",
    priceMonthlyCents: 3_900, // € 39 per maand per pakket
    currency: "EUR",
    maxQuantity: 10,
    effect: {
      kind: "limit",
      entitlement: "max_candidate_invites_per_month",
      amountPerUnit: 25,
    },
  },
  analytics_advanced_addon: {
    key: "analytics_advanced_addon",
    name: "Uitgebreide analytics",
    description:
      "Conversie- en funnelanalytics op het niveau van het Growth-plan.",
    priceMonthlyCents: 4_900, // € 49 per maand
    currency: "EUR",
    maxQuantity: 1,
    effect: {
      kind: "feature",
      entitlement: "analytics_level",
      meta: { level: "advanced" },
    },
  },
  api_access_addon: {
    key: "api_access_addon",
    name: "API-toegang",
    description: "Programmatische toegang tot je eigen gegevens via de API.",
    priceMonthlyCents: 9_900, // € 99 per maand
    currency: "EUR",
    maxQuantity: 1,
    effect: { kind: "feature", entitlement: "api_access" },
  },
  extended_history: {
    key: "extended_history",
    name: "Uitgebreide historie",
    description:
      "Langere bewaartermijn voor pipeline-, match- en bezettingshistorie.",
    priceMonthlyCents: 1_900, // € 19 per maand
    currency: "EUR",
    maxQuantity: 1,
    effect: { kind: "feature", entitlement: "extended_history" },
  },
  premium_market_insights: {
    key: "premium_market_insights",
    name: "Premium marktinzichten",
    description:
      "Verdiepende arbeidsmarktinzichten voor jouw regio en functiegroepen.",
    priceMonthlyCents: 5_900, // € 59 per maand
    currency: "EUR",
    maxQuantity: 1,
    effect: { kind: "feature", entitlement: "premium_market_insights" },
  },
});

/** Type guard: is deze waarde een geldige add-on-sleutel? */
export function isAddonKey(value: unknown): value is AddonKey {
  return typeof value === "string" && (ADDON_KEYS as readonly string[]).includes(value);
}
