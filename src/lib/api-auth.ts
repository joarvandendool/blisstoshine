// API-sleutelbeheer en rate limiting voor de integratie-API (fase 9) en de
// publieke read-model-API (fase 8).
//
// Sleutelmodel:
// - formaat: "mzw_<omgeving>_<40 hex tekens>" (omgeving: "live" of "test");
// - de volledige sleutel wordt PRECIES ÉÉN KEER getoond bij aanmaak/rotatie;
// - opgeslagen wordt alleen de sha256-hash (hashedKey) plus een publiek
//   prefix (mzw_<omgeving>_<eerste 8 tekens>) om de rij op te zoeken;
// - intrekken = revokedAt zetten: verificatie weigert daarna direct.
//
// Rate limiting: eigen kleine fixed-window-teller op RateLimitCounter, bewust
// lokaal gehouden (rateLimitPublic / rateLimitApiKey) zodat dit bestand niet
// afhangt van een generieke rate-limit-module van een andere werkstroom.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKey } from "@prisma/client";
import { appEnv } from "@/lib/config";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/** Alle geldige API-scopes. Sleutels krijgen een subset hiervan. */
export const API_SCOPES = [
  "jobs:read",
  "pipeline:read",
  "capacity:read",
  "webhooks:manage",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(waarde: unknown): waarde is ApiScope {
  return (API_SCOPES as readonly string[]).includes(waarde as string);
}

// ---------------------------------------------------------------------------
// Fouten
// ---------------------------------------------------------------------------

/** Autorisatie-/limietfout van de integratie-API, met machineleesbare code. */
export class ApiAuthError extends Error {
  readonly status: number;
  /** Stabiele foutcode voor { error: { code } } in responses. */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Sleutelmateriaal
// ---------------------------------------------------------------------------

/** Omgevingsdeel van de sleutel: productie → "live", anders "test". */
function omgevingsDeel(): "live" | "test" {
  return appEnv === "production" ? "live" : "test";
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface MintedApiKey {
  /** De volledige sleutel — alleen op dit moment beschikbaar, daarna nooit meer. */
  plaintext: string;
  /** Publiek, opzoekbaar deel (uniek in de database). */
  prefix: string;
  /** sha256-hex van de volledige sleutel (dit wordt opgeslagen). */
  hashedKey: string;
}

/** Genereert nieuw sleutelmateriaal; slaat zelf niets op. */
export function mintApiKey(): MintedApiKey {
  const random = randomBytes(20).toString("hex"); // 40 hex-tekens
  const plaintext = `mzw_${omgevingsDeel()}_${random}`;
  return {
    plaintext,
    prefix: `mzw_${omgevingsDeel()}_${random.slice(0, 8)}`,
    hashedKey: hashApiKey(plaintext),
  };
}

// ---------------------------------------------------------------------------
// Verificatie
// ---------------------------------------------------------------------------

/** Geverifieerde context van een geldige API-sleutel. */
export interface ApiKeyContext {
  apiKeyId: string;
  organizationId: string;
  scopes: string[];
}

const SLEUTEL_PATROON = /^mzw_(live|test)_([0-9a-f]{40})$/;

/** Requests per sleutel per minuut. */
export const API_KEY_RATE_LIMIT_PER_MINUTE = 300;

/**
 * Verifieert een Authorization-header ("Bearer mzw_…") en geeft de
 * organisatie + scopes van de sleutel terug. Gooit ApiAuthError bij:
 * ontbrekende/misvormde header (401), onbekende of ingetrokken sleutel (401)
 * en overschreden rate limit (429). Werkt lastUsedAt bij.
 */
export async function verifyApiKey(
  authorizationHeader: string | null | undefined,
): Promise<ApiKeyContext> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new ApiAuthError(
      "Autorisatie ontbreekt: gebruik 'Authorization: Bearer <api-sleutel>'.",
      401,
      "unauthorized",
    );
  }
  const aangeboden = authorizationHeader.slice("Bearer ".length).trim();
  const match = SLEUTEL_PATROON.exec(aangeboden);
  if (!match) {
    throw new ApiAuthError("Ongeldige API-sleutel.", 401, "unauthorized");
  }

  const prefix = `mzw_${match[1]}_${match[2].slice(0, 8)}`;
  const rij = await prisma.apiKey.findUnique({ where: { prefix } });
  if (!rij || !hashKomtOvereen(rij, aangeboden)) {
    throw new ApiAuthError("Ongeldige API-sleutel.", 401, "unauthorized");
  }
  if (rij.revokedAt) {
    throw new ApiAuthError("Deze API-sleutel is ingetrokken.", 401, "key_revoked");
  }

  // Rate limiting per sleutel (fixed window van één minuut).
  const binnenLimiet = await fixedWindowToegestaan(
    `api:${prefix}`,
    API_KEY_RATE_LIMIT_PER_MINUTE,
  );
  if (!binnenLimiet) {
    throw new ApiAuthError(
      "Te veel verzoeken met deze API-sleutel. Probeer het over een minuut opnieuw.",
      429,
      "rate_limited",
    );
  }

  await prisma.apiKey.update({
    where: { id: rij.id },
    data: { lastUsedAt: new Date() },
  });

  return { apiKeyId: rij.id, organizationId: rij.organizationId, scopes: rij.scopes };
}

/** Timing-safe vergelijking van de sha256-hash. */
function hashKomtOvereen(rij: ApiKey, aangeboden: string): boolean {
  const verwacht = Buffer.from(rij.hashedKey, "hex");
  const gekregen = Buffer.from(hashApiKey(aangeboden), "hex");
  return verwacht.length === gekregen.length && timingSafeEqual(verwacht, gekregen);
}

/** Gooit ApiAuthError 403 wanneer de sleutel de scope niet heeft. */
export function requireScope(ctx: ApiKeyContext, scope: ApiScope): void {
  if (!ctx.scopes.includes(scope)) {
    throw new ApiAuthError(
      `Deze API-sleutel mist de scope "${scope}".`,
      403,
      "insufficient_scope",
    );
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (fixed window op RateLimitCounter)
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;

/** Requests per IP per minuut op de publieke endpoints. */
export const PUBLIC_RATE_LIMIT_PER_MINUTE = 120;

/**
 * Kleine fixed-window-teller over serverless-instanties heen: één rij per
 * (key, minuutvenster) in RateLimitCounter. Geeft true zolang de teller de
 * limiet niet overschrijdt. Faalt open (true) bij databasefouten: rate
 * limiting mag publieke reads nooit hard breken.
 */
async function fixedWindowToegestaan(
  key: string,
  limiet: number,
  nu: Date = new Date(),
): Promise<boolean> {
  const windowStart = new Date(Math.floor(nu.getTime() / WINDOW_MS) * WINDOW_MS);
  try {
    const teller = await prisma.rateLimitCounter.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    return teller.count <= limiet;
  } catch (fout) {
    console.error(`Rate-limit-teller bijwerken mislukt voor ${key}:`, fout);
    return true;
  }
}

/**
 * Publieke rate limiting per IP (120 verzoeken per minuut, fixed window).
 * true = toegestaan. Eigen minimale helper — bewust niet gedeeld met
 * src/lib/rate-limit.ts van een parallelle werkstroom.
 */
export async function rateLimitPublic(
  ip: string,
  limiet: number = PUBLIC_RATE_LIMIT_PER_MINUTE,
): Promise<boolean> {
  return fixedWindowToegestaan(`pub:${ip || "onbekend"}`, limiet);
}
