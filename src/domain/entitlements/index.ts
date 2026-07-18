// Entitlement-logica — de enige plek waar planregels worden geëvalueerd.
// Services vragen hier "mag dit?" en "hoeveel nog?"; nergens anders in de
// codebase staan verspreide `if (plan === …)`-checks.
//
// Alle functies accepteren een injecteerbare catalogus (standaard
// PLAN_CATALOG) zodat versionering testbaar is zonder de echte catalogus te
// muteren.

import {
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  PLAN_CATALOG,
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
 * Effectieve entitlements van een abonnement op moment `now`:
 * - trial_expired of canceled → vergrendeld (alles uit, analytics basic);
 * - past_due → entitlements blijven gelden (coulanceperiode tijdens dunning);
 * - active → de entitlements van de vastgepinde planversie.
 */
export function entitlementsForSubscription(
  sub: SubscriptionSnapshot,
  now: Date,
  catalog: PlanCatalog = PLAN_CATALOG,
): EntitlementSet {
  const state = effectiveSubscriptionState(sub, now);
  if (state === "trial_expired" || state === "canceled") {
    return lockedEntitlements();
  }
  return entitlementsFor(sub.planCode, sub.planVersion, catalog);
}
