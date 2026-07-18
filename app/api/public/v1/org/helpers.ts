// Gedeelde afhandeling voor de private integratie-API (/api/public/v1/org/*):
// Bearer API-sleutel verifiëren, scope afdwingen en fouten uniform als
// { error: { code, message } } teruggeven. Responses zijn idempotent (puur
// lezen) en nooit gecachet (privé data achter een sleutel).

import { NextResponse } from "next/server";
import {
  ApiAuthError,
  requireScope,
  verifyApiKey,
  type ApiKeyContext,
  type ApiScope,
} from "@/lib/api-auth";

export function orgApiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Voert een org-API-handler uit: sleutel verifiëren (401), scope afdwingen
 * (403), rate limit (429) en de payload — altijd gescoped op de organisatie
 * van de sleutel — als niet-gecachte JSON teruggeven.
 */
export async function handleOrgApi(
  verzoek: Request,
  scope: ApiScope,
  handler: (auth: ApiKeyContext) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const auth = await verifyApiKey(verzoek.headers.get("authorization"));
    requireScope(auth, scope);
    const payload = await handler(auth);
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (fout) {
    if (fout instanceof ApiAuthError) {
      return orgApiError(fout.status, fout.code, fout.message);
    }
    console.error("Org-API-verzoek mislukt:", fout);
    return orgApiError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
