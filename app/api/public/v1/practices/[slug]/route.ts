// GET /api/public/v1/practices/[slug] — publieke praktijkweergave (fase 8).
// Alleen actieve organisaties; alleen publiek-veilige velden (geen adres,
// geen leden, geen kandidaatdata). Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
  publicError,
} from "@/server/public/http";
import { getPublicPractice } from "@/server/public/queries";

export const dynamic = "force-dynamic";

export async function GET(
  verzoek: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  const { slug } = await params;

  try {
    const praktijk = await getPublicPractice(slug);
    if (!praktijk) {
      return publicError(404, "not_found", "Deze praktijk bestaat niet.");
    }
    return publicCacheResponse(verzoek, praktijk);
  } catch (fout) {
    console.error("Publieke praktijk ophalen mislukt:", fout);
    return publicError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
