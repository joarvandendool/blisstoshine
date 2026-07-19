// HTTP-helpers voor /api/mobile/v1/*: uniforme fout-envelope
// { error: { code, message } }, JSON-parsing en rate-limit-antwoorden.
// Zie MOBILE_API_CONTRACT.md §3.

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { MobileAuthError } from "@/lib/mobile-auth";

export type MobileErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid"
  | "revoked"
  | "gone"
  | "server_error";

export function foutRespons(
  status: number,
  code: MobileErrorCode,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...extraHeaders } },
  );
}

function codeVoorStatus(status: number): MobileErrorCode {
  switch (status) {
    case 400:
      return "invalid";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 410:
      return "gone";
    case 429:
      return "rate_limited";
    default:
      return "server_error";
  }
}

/** Service-/validatiefouten → nette envelope; onbekend → 500 met log. */
export function vangFout(fout: unknown): NextResponse {
  if (fout instanceof MobileAuthError) {
    return foutRespons(fout.status, fout.code as MobileErrorCode, fout.message);
  }
  if (fout instanceof AuthzError) {
    return foutRespons(fout.status, codeVoorStatus(fout.status), fout.message);
  }
  if (fout instanceof z.ZodError) {
    const eerste = fout.issues[0];
    const pad = eerste?.path?.join(".") ?? "";
    return foutRespons(
      400,
      "invalid",
      pad ? `Ongeldige invoer bij "${pad}".` : "Ongeldige invoer.",
    );
  }
  if (
    fout instanceof Prisma.PrismaClientKnownRequestError &&
    fout.code === "P2002"
  ) {
    return foutRespons(409, "conflict", "Deze actie is al uitgevoerd.");
  }
  console.error("Mobile API-fout:", fout);
  return foutRespons(500, "server_error", "Er ging iets mis. Probeer het later opnieuw.");
}

/** 200-antwoord zonder caching (kandidaatdata is altijd persoonlijk). */
export function okRespons(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** JSON-body parsen; ongeldige JSON → AuthzError 400. */
export async function leesJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AuthzError("Verzoek bevat geen geldige JSON.", 400);
  }
}

/** Best-effort client-IP (Vercel/hosting zet x-forwarded-for). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "onbekend";
}

/** 429 met Retry-After. */
export function rateLimitRespons(retryAfterSeconds: number): NextResponse {
  return foutRespons(
    429,
    "rate_limited",
    "Te veel verzoeken. Probeer het zo weer.",
    { "Retry-After": String(Math.max(1, retryAfterSeconds)) },
  );
}
