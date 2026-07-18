// Vaste-venster rate limiting op de RateLimitCounter-tabel — werkt over
// serverless-instanties heen zonder extra infrastructuur (geen Redis).
// Vensters zijn vast (afgerond op windowSeconds sinds epoch); de teller wordt
// atomair opgehoogd via upsert/increment. Bij databasefouten falen we bewust
// OPEN: beschikbaarheid gaat boven strengheid, met een console.error als spoor.

import { prisma } from "./db";

export type RateLimitOptions = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function vensterStart(nu: number, windowMs: number): Date {
  return new Date(Math.floor(nu / windowMs) * windowMs);
}

function secondenTotVolgendVenster(nu: number, start: Date, windowMs: number): number {
  return Math.max(1, Math.ceil((start.getTime() + windowMs - nu) / 1000));
}

function failOpen(opts: RateLimitOptions, err: unknown): RateLimitResult {
  console.error("rateLimit: databasefout — verzoek toegestaan (fail open)", err);
  return { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
}

/**
 * Telt één poging voor `key` in het huidige vaste venster en zegt of die
 * binnen de limiet valt. Ruimt in dezelfde aanroep verlopen vensters van
 * deze key op (ouder dan 2× het venster; goedkoop via de primaire sleutel).
 */
export async function rateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const windowMs = opts.windowSeconds * 1000;
  const nu = Date.now();
  const windowStart = vensterStart(nu, windowMs);
  try {
    const teller = await prisma.rateLimitCounter.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: 1 },
      update: { count: { increment: 1 } },
    });
    await prisma.rateLimitCounter.deleteMany({
      where: { key, windowStart: { lt: new Date(nu - 2 * windowMs) } },
    });
    const allowed = teller.count <= opts.limit;
    return {
      allowed,
      remaining: Math.max(0, opts.limit - teller.count),
      retryAfterSeconds: allowed ? 0 : secondenTotVolgendVenster(nu, windowStart, windowMs),
    };
  } catch (err) {
    return failOpen(opts, err);
  }
}

/**
 * Als rateLimit, maar zonder de teller op te hogen: kijkt alleen of het
 * huidige venster van `key` al vol is. Gebruikt voor lockout-checks vóór een
 * poging (bv. "is dit account geblokkeerd door mislukte logins?"), waarbij de
 * teller alleen bij een daadwerkelijke mislukking wordt opgehoogd.
 */
export async function peekRateLimit(
  key: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const windowMs = opts.windowSeconds * 1000;
  const nu = Date.now();
  const windowStart = vensterStart(nu, windowMs);
  try {
    const teller = await prisma.rateLimitCounter.findUnique({
      where: { key_windowStart: { key, windowStart } },
    });
    const count = teller?.count ?? 0;
    const allowed = count < opts.limit;
    return {
      allowed,
      remaining: Math.max(0, opts.limit - count),
      retryAfterSeconds: allowed ? 0 : secondenTotVolgendVenster(nu, windowStart, windowMs),
    };
  } catch (err) {
    return failOpen(opts, err);
  }
}
