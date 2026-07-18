// GET /api/public/v1/jobs/[idOrSlug] — één publieke vacature (fase 8).
// - gepubliceerd → 200 met de volledige PublicJobView;
// - ooit gepubliceerd maar inmiddels filled/expired/paused → 410 Gone met
//   dezelfde JSON-vorm en status "closed" (correcte gesloten status, zodat
//   Codex een nette "vacature gesloten"-pagina kan tonen);
// - onbekend, concept of nooit gepubliceerd → 404.
// Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
  publicError,
} from "@/server/public/http";
import { getPublicJob } from "@/server/public/queries";

export const dynamic = "force-dynamic";

export async function GET(
  verzoek: Request,
  { params }: { params: Promise<{ idOrSlug: string }> },
): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  const { idOrSlug } = await params;

  try {
    const uitkomst = await getPublicJob(idOrSlug);
    if (uitkomst.kind === "not_found") {
      return publicError(404, "not_found", "Deze vacature bestaat niet.");
    }
    // Gesloten vacature: 410 Gone met status "closed" in de body.
    return publicCacheResponse(verzoek, uitkomst.job, {
      status: uitkomst.kind === "closed" ? 410 : 200,
    });
  } catch (fout) {
    console.error("Publieke vacature ophalen mislukt:", fout);
    return publicError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
