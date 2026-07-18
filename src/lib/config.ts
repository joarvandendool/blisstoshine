// Centrale configuratie — de enige plek waar omgevingsvariabelen en
// platformconstanten worden gelezen. Services en routes importeren hieruit;
// nergens anders staat losse `process.env`-logica voor deze waarden.

import { getPlanVersion } from "@/domain/entitlements";

// ---------- omgeving ----------

export type AppEnv = "dev" | "test" | "production";

function resolveAppEnv(): AppEnv {
  const raw = process.env.APP_ENV;
  if (raw === "dev" || raw === "test" || raw === "production") return raw;
  // Terugval op NODE_ENV wanneer APP_ENV niet (geldig) is gezet.
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "dev";
}

/** Actieve applicatie-omgeving (uit APP_ENV, met NODE_ENV als terugval). */
export const appEnv: AppEnv = resolveAppEnv();

export const isProduction: boolean = appEnv === "production";

// ---------- feature flags ----------

/**
 * Leest een feature flag uit de omgeving: `featureFlag("nieuw_dashboard")`
 * kijkt naar `FLAG_NIEUW_DASHBOARD`. Aan bij "1", "true", "yes" of "on"
 * (hoofdletterongevoelig); alles anders — inclusief afwezig — is uit.
 */
export function featureFlag(name: string): boolean {
  const envKey = `FLAG_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const value = process.env[envKey];
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

// ---------- platformconstanten ----------

/**
 * Minimale groepsgrootte voor Talent Radar-aggregaties: onder deze grens
 * tonen we geen cijfers, zodat individuele kandidaten nooit herleidbaar zijn.
 */
export const TALENT_RADAR_MIN_GROUP = 5;

/**
 * Lengte van de proefperiode in dagen. Gelezen uit de plancatalogus
 * (src/domain/entitlements) zodat er één bron van waarheid is; 14 als
 * defensieve terugval mocht het trialplan ooit geen trialDays definiëren.
 */
export const TRIAL_DAYS: number = getPlanVersion("trial").trialDays ?? 14;
