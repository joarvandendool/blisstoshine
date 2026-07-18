// Entitlement-logica — de enige plek waar planregels worden geëvalueerd.
// Services vragen hier "mag dit?" en "hoeveel nog?"; nergens anders in de
// codebase staan verspreide `if (plan === …)`-checks.
//
// Alle functies accepteren een injecteerbare catalogus (standaard
// PLAN_CATALOG) zodat versionering testbaar is zonder de echte catalogus te
// muteren.

import {
  ADDON_CATALOG,
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  PLAN_CATALOG,
  isAddonKey,
  type AddonCatalog,
  type EntitlementDefinition,
  type EntitlementKey,
  type PlanCatalog,
  type PlanCode,
  type PlanVersionDefinition,
} from "./catalog";

export * from "./catalog";

/** De effectieve entitlements van één planversie of abonnement. */
export type EntitlementSet = Record<EntitlementKey, EntitlementDefinition>;

// ---------- planversies ----------

/**
 * Zoekt een planversie op. Zonder `version` wordt de nieuwste actieve versie
 * teruggegeven (voor nieuwe abonnementen). Met expliciete `version` wordt die
 * versie teruggegeven — ook als die inmiddels inactief is, zodat bestaande
 * abonnementen hun oorspronkelijke entitlements behouden.
 */
export function getPlanVersion(
  code: PlanCode,
  version?: number,
  catalog: PlanCatalog = PLAN_CATALOG,
): PlanVersionDefinition {
  const plan = catalog[code];
  if (!plan) throw new Error(`Onbekend plan: ${code}`);

  if (version !== undefined) {
    const match = plan.versions.find((v) => v.version === version);
    if (!match) throw new Error(`Onbekende versie ${version} van plan ${code}`);
    return match;
  }

  const active = plan.versions.filter((v) => v.active);
  if (active.length === 0) throw new Error(`Plan ${code} heeft geen actieve versie`);
  return active.reduce((hoogste, kandidaat) =>
    kandidaat.version > hoogste.version ? kandidaat : hoogste,
  );
}

/**
 * Entitlements van een planversie als vers, muteerbaar record — wijzigingen
 * door aanroepers raken de catalogus nooit.
 */
export function entitlementsFor(
  code: PlanCode,
  version?: number,
  catalog: PlanCatalog = PLAN_CATALOG,
): EntitlementSet {
  const planVersion = getPlanVersion(code, version, catalog);
  const out = {} as EntitlementSet;
  for (const key of ENTITLEMENT_KEYS) {
    const def = planVersion.entitlements[key];
    out[key] = def.meta
      ? { enabled: def.enabled, limitInt: def.limitInt, meta: { ...def.meta } }
      : { enabled: def.enabled, limitInt: def.limitInt };
  }
  return out;
}

// ---------- uitbreidingen (subscription items) ----------

/** Eén abonnementsitem: een add-on-sleutel met een aantal. */
export interface SubscriptionItemInput {
  key: string;
  quantity: number;
}

/**
 * Past abonnementsitems (add-ons) toe op de basis-entitlements van een plan.
 * Puur en declaratief:
 * - limiet-add-ons tellen per stuk op bij de limiet (onbeperkt blijft
 *   onbeperkt; een uitgeschakelde limiet start bij 0 en wordt ingeschakeld);
 * - feature-add-ons schakelen het entitlement in (aantal > 1 heeft geen
 *   extra effect) en zetten eventuele metadata;
 * - onbekende sleutels en aantallen ≤ 0 worden genegeerd.
 * De invoer wordt nooit gemuteerd; het resultaat is een verse kopie.
 */
export function applySubscriptionItems(
  baseEntitlements: EntitlementSet,
  items: readonly SubscriptionItemInput[],
  addonCatalog: AddonCatalog = ADDON_CATALOG,
): EntitlementSet {
  const out = {} as EntitlementSet;
  for (const key of ENTITLEMENT_KEYS) {
    const def = baseEntitlements[key];
    out[key] = def.meta
      ? { enabled: def.enabled, limitInt: def.limitInt, meta: { ...def.meta } }
      : { enabled: def.enabled, limitInt: def.limitInt };
  }

  for (const item of items) {
    if (!isAddonKey(item.key)) continue;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const addon = addonCatalog[item.key];
    const quantity = Math.min(Math.floor(item.quantity), addon.maxQuantity);
    if (quantity <= 0) continue;

    const doel = out[addon.effect.entitlement];
    if (addon.effect.kind === "limit") {
      if (doel.enabled && doel.limitInt === null) continue; // onbeperkt blijft onbeperkt
      const basis = doel.enabled ? (doel.limitInt ?? 0) : 0;
      doel.enabled = true;
      doel.limitInt = basis + addon.effect.amountPerUnit * quantity;
    } else {
      doel.enabled = true;
      if (addon.effect.meta) {
        doel.meta = { ...doel.meta, ...addon.effect.meta };
      }
    }
  }

  return out;
}

// ---------- checks ----------

/** Is deze feature ingeschakeld? */
export function can(entitlements: EntitlementSet, key: EntitlementKey): boolean {
  return entitlements[key]?.enabled === true;
}

/**
 * Effectieve limiet: null = onbeperkt (indien enabled), 0 indien disabled.
 */
export function limitOf(entitlements: EntitlementSet, key: EntitlementKey): number | null {
  const def = entitlements[key];
  if (!def || !def.enabled) return 0;
  return def.limitInt;
}

export interface LimitCheck {
  allowed: boolean;
  /** null = onbeperkt */
  limit: number | null;
  /** resterende ruimte; null = onbeperkt */
  remaining: number | null;
  /** Nederlandse uitleg, alleen gezet wanneer niet toegestaan. */
  reason?: string;
}

/**
 * Mag er, gegeven het huidige gebruik, nog één bij? Blokkeert met een
 * Nederlandse reden inclusief upgrade-hint wanneer de limiet is bereikt of de
 * feature is uitgeschakeld.
 */
export function checkLimit(
  entitlements: EntitlementSet,
  key: EntitlementKey,
  currentUsage: number,
): LimitCheck {
  const label = ENTITLEMENT_LABELS[key];
  const limit = limitOf(entitlements, key);

  if (!can(entitlements, key)) {
    return {
      allowed: false,
      limit: 0,
      remaining: 0,
      reason: `Deze functie (${label}) is niet beschikbaar in je huidige abonnement. Upgrade naar een hoger plan om dit te gebruiken.`,
    };
  }

  if (limit === null) {
    return { allowed: true, limit: null, remaining: null };
  }

  if (currentUsage < limit) {
    return { allowed: true, limit, remaining: limit - currentUsage };
  }

  return {
    allowed: false,
    limit,
    remaining: 0,
    reason: `Je hebt de limiet van ${limit} ${label} van je huidige abonnement bereikt. Upgrade naar een hoger plan voor een ruimere limiet.`,
  };
}

// ---------- abonnementstoestand ----------

/** Opslagstatussen (gelijk aan de SubscriptionStatus-enum in de database). */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export type EffectiveSubscriptionState =
  | "active"
  | "trial_expired"
  | "past_due"
  | "canceled";

/** Bepalende abonnementsgegevens, los van Prisma. */
export interface SubscriptionSnapshot {
  planCode: PlanCode;
  planVersion: number;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  /**
   * Einde van de coulanceperiode na een mislukte betaling (dunning).
   * Alleen relevant bij status past_due: binnen de grace blijven de
   * entitlements gelden, daarna is het abonnement vergrendeld. Zonder
   * graceUntil (null/undefined) geldt de coulance onbeperkt — dat is het
   * gedrag van vóór de dunning-uitbreiding.
   */
  graceUntil?: Date | null;
}

/**
 * Effectieve toestand op moment `now`:
 * - canceled → canceled; past_due → past_due;
 * - trialing met verlopen trialEndsAt → trial_expired, anders active;
 * - active → active. Defensief: is de betaalperiode van een 'active'
 *   abonnement al verstreken (webhook-achterstand), dan geldt past_due.
 */
export function effectiveSubscriptionState(
  sub: SubscriptionSnapshot,
  now: Date,
): EffectiveSubscriptionState {
  switch (sub.status) {
    case "canceled":
      return "canceled";
    case "past_due":
      return "past_due";
    case "trialing":
      if (sub.trialEndsAt !== null && sub.trialEndsAt.getTime() < now.getTime()) {
        return "trial_expired";
      }
      return "active";
    case "active":
      if (sub.currentPeriodEnd.getTime() < now.getTime()) return "past_due";
      return "active";
  }
}

/**
 * Vergrendelde entitlements (read-only stand): alles uit en limiet 0, alleen
 * basis-analytics blijft leesbaar.
 */
export function lockedEntitlements(): EntitlementSet {
  const out = {} as EntitlementSet;
  for (const key of ENTITLEMENT_KEYS) {
    out[key] =
      key === "analytics_level"
        ? { enabled: true, limitInt: null, meta: { level: "basic" } }
        : { enabled: false, limitInt: 0 };
  }
  return out;
}

/**
 * Is de coulanceperiode (grace) van een past_due-abonnement verstreken?
 * Zonder graceUntil is er geen einde aan de coulance (legacy-gedrag).
 */
function graceVerstreken(sub: SubscriptionSnapshot, now: Date): boolean {
  return (
    sub.graceUntil !== undefined &&
    sub.graceUntil !== null &&
    sub.graceUntil.getTime() < now.getTime()
  );
}

/**
 * Geeft dit abonnement op moment `now` nog toegang tot zijn plan-entitlements?
 * - active (incl. lopende trial) → ja;
 * - past_due binnen de grace (of zonder graceUntil) → ja (coulance);
 * - past_due ná de grace, trial_expired of canceled → nee (vergrendeld).
 */
export function subscriptionHasAccess(sub: SubscriptionSnapshot, now: Date): boolean {
  const state = effectiveSubscriptionState(sub, now);
  if (state === "active") return true;
  if (state === "past_due") return !graceVerstreken(sub, now);
  return false;
}

/**
 * Effectieve entitlements van een abonnement op moment `now`:
 * - trial_expired of canceled → vergrendeld (alles uit, analytics basic);
 * - past_due binnen de grace → entitlements blijven gelden (coulance tijdens
 *   dunning); ná de grace (graceUntil verstreken) → vergrendeld;
 * - active → de entitlements van de vastgepinde planversie.
 */
export function entitlementsForSubscription(
  sub: SubscriptionSnapshot,
  now: Date,
  catalog: PlanCatalog = PLAN_CATALOG,
): EntitlementSet {
  if (!subscriptionHasAccess(sub, now)) {
    return lockedEntitlements();
  }
  return entitlementsFor(sub.planCode, sub.planVersion, catalog);
}
