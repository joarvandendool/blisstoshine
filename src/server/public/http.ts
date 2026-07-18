// HTTP-hulpfuncties voor de publieke read-model-API (fase 8):
// - publicCacheResponse: JSON met ETag (sha1 van de payload), If-None-Match →
//   304, en Cache-Control "public, s-maxage=300, stale-while-revalidate=600";
// - publicError: uniforme foutvorm { error: { code, message } };
// - enforcePublicRateLimit: 120 verzoeken per minuut per IP (fixed window op
//   RateLimitCounter via rateLimitPublic in src/lib/api-auth.ts).

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { rateLimitPublic } from "@/lib/api-auth";

/** Cachegedrag van alle publieke endpoints (5 min CDN, stale-while-revalidate). */
export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

/** Sterke ETag: sha1 van de exacte JSON-payload. */
export function etagVoor(body: string): string {
  return `"${createHash("sha1").update(body).digest("hex")}"`;
}

/** Bevat de If-None-Match-header deze ETag (ook W/-varianten en lijsten)? */
function ifNoneMatchTreft(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((deel) => deel.trim().replace(/^W\//, ""))
    .includes(etag);
}

/**
 * Cachebare JSON-respons met ETag. Stuurt 304 Not Modified (zonder body)
 * wanneer If-None-Match de huidige ETag bevat. `status` (standaard 200) wordt
 * ook op 410 gebruikt voor gesloten vacatures.
 */
export function publicCacheResponse(
  verzoek: Request,
  payload: unknown,
  opts: { status?: number } = {},
): NextResponse {
  const body = JSON.stringify(payload);
  const etag = etagVoor(body);
  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    "Content-Type": "application/json; charset=utf-8",
  };

  if (ifNoneMatchTreft(verzoek.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, { status: opts.status ?? 200, headers });
}

/** Uniforme publieke foutrespons: { error: { code, message } }, niet gecachet. */
export function publicError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Client-IP uit proxyheaders; "onbekend" wanneer niets is gezet. */
export function clientIp(verzoek: Request): string {
  const forwarded = verzoek.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return verzoek.headers.get("x-real-ip")?.trim() || "onbekend";
}

/**
 * Rate limiting per IP voor publieke endpoints. Geeft null terug wanneer het
 * verzoek is toegestaan, anders een kant-en-klare 429-respons.
 */
export async function enforcePublicRateLimit(verzoek: Request): Promise<NextResponse | null> {
  const toegestaan = await rateLimitPublic(clientIp(verzoek));
  if (toegestaan) return null;
  const respons = publicError(
    429,
    "rate_limited",
    "Te veel verzoeken vanaf dit IP-adres. Probeer het over een minuut opnieuw.",
  );
  respons.headers.set("Retry-After", "60");
  return respons;
}
