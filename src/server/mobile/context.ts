// Sessiecontext voor mobiele routes die het sessie-id zelf nodig hebben
// (logout, apparaatbeheer, pushtokens). Routes die alleen kandidaatservices
// aanroepen gebruiken dit niet: daar loopt de identiteit via requireUser()/
// requireCandidate() en de Bearer-brug in src/lib/auth.ts.

import { AuthzError } from "@/lib/authz";
import {
  mobileSessionFromAuthorization,
  type MobileSessionContext,
} from "@/lib/mobile-auth";

export async function requireMobileSession(
  request: Request,
): Promise<MobileSessionContext> {
  const ctx = await mobileSessionFromAuthorization(
    request.headers.get("authorization"),
  );
  if (!ctx) {
    throw new AuthzError("Niet ingelogd. Log in om verder te gaan.", 401);
  }
  return ctx;
}
