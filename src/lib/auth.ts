// Lichte sessie-auth: e-mail + wachtwoord (bcrypt) en een HttpOnly-cookie met
// HMAC-ondertekende payload. Bewust minimaal; een volwaardige auth-provider
// (Auth.js, Clerk) kan later worden ingehangen zonder dat services wijzigen —
// alles in de app praat uitsluitend met getSessionUser()/requireUser().

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE_NAME = "mz_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 dagen

// Productiewaarschuwing bij elke koude start (module-init draait één keer per
// nieuwe serverless-instantie; bewust niet verder geflagd): zonder eigen
// SESSION_SECRET is het sessiegeheim afgeleid van de database-URL en kan
// iedereen met leestoegang tot die URL sessietokens smeden.
if (
  process.env.NODE_ENV === "production" &&
  !(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32)
) {
  console.warn(
    "SESSION_SECRET niet gezet — sessiegeheim wordt afgeleid van de database-URL. " +
      "Zet vóór echte livegang een eigen SESSION_SECRET (openssl rand -hex 32); " +
      "let op: rotatie logt alle sessies uit. Zie DEPLOYMENT.md.",
  );
}

/**
 * Sessiegeheim. Voorkeur: expliciete SESSION_SECRET (>= 32 tekens). Fallback:
 * afgeleid via HMAC uit de database-connectiestring die de Vercel/Supabase-
 * integratie injecteert — die is geheim en heeft hoge entropie, en de
 * afleiding is deterministisch over alle serverless-instanties. Indien env
 * SESSION_PEPPER is gezet wordt die als extra statische pepper in de
 * afleiding verwerkt (zonder pepper blijft de uitkomst ongewijzigd, zodat
 * bestaande sessies geldig blijven). Rotatie van de databasecredentials of
 * de pepper logt alle sessies uit; zet daarom in productie een eigen
 * SESSION_SECRET (die wint altijd). Zie DEPLOYMENT.md.
 */
export function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;

  const bron =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (bron) {
    const hmac = createHmac("sha256", "mondzorgwerkt-sessie-v1").update(bron);
    const pepper = process.env.SESSION_PEPPER;
    if (pepper) hmac.update(pepper);
    return hmac.digest("hex");
  }

  throw new Error("SESSION_SECRET ontbreekt of is korter dan 32 tekens");
}

/** Voor health checks: is er een bruikbaar sessiegeheim? */
export function hasSessionSecret(): boolean {
  try {
    secret();
    return true;
  } catch {
    return false;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAt, mac] = parts;
  const payload = `${userId}.${expiresAt}`;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expiresAt) < now) return null;
  return userId;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, isPlatformAdmin: true },
  });
  return user;
}

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
}): Promise<SessionUser> {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const email = input.email.toLowerCase().trim();

  // Bootstrap: platform-admin wordt uitsluitend automatisch toegekend wanneer
  // het e-mailadres exact overeenkomt met env PLATFORM_ADMIN_EMAIL
  // (hoofdletterongevoelig) én er nog geen enkele platform-admin bestaat.
  // Zo kan een verse (of gereset) productieomgeving eenmalig een beheerder
  // bootstrappen zonder dat "de eerste registrant" vanzelf admin wordt.
  // Extra admins worden bewust gezet via de seed of rechtstreeks in de
  // database. Zie DEPLOYMENT.md.
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase().trim();
  let wordtPlatformAdmin = false;
  if (adminEmail && adminEmail === email) {
    const bestaandeAdmins = await prisma.user.count({
      where: { isPlatformAdmin: true },
    });
    wordtPlatformAdmin = bestaandeAdmins === 0;
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: input.name,
      isPlatformAdmin: wordtPlatformAdmin,
    },
    select: { id: true, email: true, name: true, isPlatformAdmin: true },
  });
  return user;
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
