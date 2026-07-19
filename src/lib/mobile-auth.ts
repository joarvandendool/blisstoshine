// Mobiel sessiemodel voor de kandidaat-app (MOBILE_API_CONTRACT.md §2).
//
// Anders dan de stateless webcookie is een mobiele sessie een databaserij en
// dus per direct intrekbaar. Tokenmateriaal:
// - access-token  "mzm_at_<64 hex>" — 30 minuten geldig, sha256-hash opgeslagen;
// - refresh-token "mzm_rt_<64 hex>" — 30 dagen geldig, single-use met rotatie.
// Hergebruik van een al geroteerd refresh-token (previousRefreshTokenHash)
// is een replay-/diefstalsignaal en trekt de hele sessie in.
//
// De webbeveiliging wijzigt niet: cookies blijven zoals ze zijn en de
// Origin-CSRF-controle blijft op cookie-endpoints van kracht. Bearer-tokens
// worden nooit via cookies gedragen.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { MobileSession } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./auth";

export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minuten
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 dagen

const ACCESS_PREFIX = "mzm_at_";
const REFRESH_PREFIX = "mzm_rt_";
const TOKEN_PATTERN = /^mzm_(at|rt)_[0-9a-f]{64}$/;

export class MobileAuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "MobileAuthError";
    this.status = status;
    this.code = code;
  }
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function timingSafeGelijk(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MintedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function mintTokenPaar(nu: Date): MintedTokens {
  return {
    accessToken: `${ACCESS_PREFIX}${randomBytes(32).toString("hex")}`,
    accessTokenExpiresAt: new Date(nu.getTime() + ACCESS_TOKEN_TTL_MS),
    refreshToken: `${REFRESH_PREFIX}${randomBytes(32).toString("hex")}`,
    refreshTokenExpiresAt: new Date(nu.getTime() + REFRESH_TOKEN_TTL_MS),
  };
}

/** Start een nieuwe mobiele sessie voor een geverifieerde gebruiker. */
export async function createMobileSession(
  userId: string,
  device?: { deviceName?: string; platform?: string },
  nu: Date = new Date(),
): Promise<{ session: MobileSession; tokens: MintedTokens }> {
  const tokens = mintTokenPaar(nu);
  const session = await prisma.mobileSession.create({
    data: {
      userId,
      accessTokenHash: hashToken(tokens.accessToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenHash: hashToken(tokens.refreshToken),
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      deviceName: device?.deviceName?.slice(0, 100) ?? null,
      platform: device?.platform?.slice(0, 20) ?? null,
      createdAt: nu,
      lastSeenAt: nu,
    },
  });
  return { session, tokens };
}

export interface MobileSessionContext {
  sessionId: string;
  user: SessionUser;
}

/**
 * Verifieert een mobiele access-token ("Bearer mzm_at_…"). Geeft null terug
 * bij elk ongeldig, verlopen of ingetrokken token — de aanroeper behandelt
 * dat als "niet ingelogd" (401 via requireUser). Werkt lastSeenAt bij
 * (best effort, hooguit één keer per minuut).
 */
export async function verifyMobileAccessToken(
  token: string,
  nu: Date = new Date(),
): Promise<MobileSessionContext | null> {
  if (!TOKEN_PATTERN.test(token) || !token.startsWith(ACCESS_PREFIX)) return null;

  const hash = hashToken(token);
  const session = await prisma.mobileSession.findUnique({
    where: { accessTokenHash: hash },
    include: {
      // geen relatievelden nodig
    },
  });
  if (!session) return null;
  if (!timingSafeGelijk(session.accessTokenHash, hash)) return null;
  if (session.revokedAt) return null;
  if (session.accessTokenExpiresAt.getTime() < nu.getTime()) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, isPlatformAdmin: true },
  });
  if (!user) return null;

  if (nu.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.mobileSession
      .update({ where: { id: session.id }, data: { lastSeenAt: nu } })
      .catch(() => {});
  }

  return { sessionId: session.id, user };
}

/** Leest "Authorization: Bearer mzm_at_…" en verifieert; anders null. */
export async function mobileSessionFromAuthorization(
  authorization: string | null | undefined,
  nu: Date = new Date(),
): Promise<MobileSessionContext | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  return verifyMobileAccessToken(token, nu);
}

/**
 * Roteert een refresh-token: geeft een volledig nieuw tokenpaar en maakt het
 * oude refresh-token ongeldig. Replay-detectie: wordt een al geroteerd token
 * (previousRefreshTokenHash) opnieuw aangeboden, dan wordt de sessie
 * ingetrokken en faalt de aanroep met 401/revoked.
 */
export async function rotateMobileSession(
  refreshToken: string,
  nu: Date = new Date(),
): Promise<{ session: MobileSession; tokens: MintedTokens }> {
  if (!TOKEN_PATTERN.test(refreshToken) || !refreshToken.startsWith(REFRESH_PREFIX)) {
    throw new MobileAuthError("Ongeldige sessie. Log opnieuw in.", 401, "unauthorized");
  }
  const hash = hashToken(refreshToken);

  // Replay: token dat al geroteerd is → sessie compromitteerbaar → intrekken.
  const geroteerd = await prisma.mobileSession.findUnique({
    where: { previousRefreshTokenHash: hash },
  });
  if (geroteerd) {
    if (!geroteerd.revokedAt) {
      await prisma.mobileSession.update({
        where: { id: geroteerd.id },
        data: { revokedAt: nu, revokedReason: "replay_detected" },
      });
      await prisma.mobilePushToken.deleteMany({ where: { sessionId: geroteerd.id } });
    }
    throw new MobileAuthError(
      "Deze sessie is om veiligheidsredenen beëindigd. Log opnieuw in.",
      401,
      "revoked",
    );
  }

  const session = await prisma.mobileSession.findUnique({
    where: { refreshTokenHash: hash },
  });
  if (
    !session ||
    !timingSafeGelijk(session.refreshTokenHash, hash) ||
    session.revokedAt ||
    session.refreshTokenExpiresAt.getTime() < nu.getTime()
  ) {
    throw new MobileAuthError("Ongeldige sessie. Log opnieuw in.", 401, "unauthorized");
  }

  const tokens = mintTokenPaar(nu);
  const bijgewerkt = await prisma.mobileSession.update({
    where: { id: session.id },
    data: {
      accessTokenHash: hashToken(tokens.accessToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenHash: hashToken(tokens.refreshToken),
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      previousRefreshTokenHash: session.refreshTokenHash,
      lastSeenAt: nu,
    },
  });
  return { session: bijgewerkt, tokens };
}

/** Trekt één sessie in en ruimt de bijbehorende pushtokens op. */
export async function revokeMobileSession(
  sessionId: string,
  reason: string,
  nu: Date = new Date(),
): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: nu, revokedReason: reason },
  });
  await prisma.mobilePushToken.deleteMany({ where: { sessionId } });
}

/** Trekt álle mobiele sessies van een gebruiker in (accountverwijdering). */
export async function revokeAllMobileSessions(
  userId: string,
  reason: string,
  nu: Date = new Date(),
): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: nu, revokedReason: reason },
  });
  await prisma.mobilePushToken.deleteMany({ where: { userId } });
}

/** Actieve sessies van een gebruiker (apparaatbeheer). */
export async function listMobileSessions(userId: string): Promise<MobileSession[]> {
  return prisma.mobileSession.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: "desc" },
  });
}
