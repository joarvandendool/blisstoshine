// GET /api/public/v1/practices — lijst van publieke praktijken
// (site-integratie). Uitsluitend actieve organisaties mét publicatie-consent;
// alleen publiek-veilige velden (stad + PC4, geen adres, geen leden, geen
// kandidaatdata). Zelfde caching/rate-limiting als de overige publieke
// endpoints. Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
  publicError,
} from "@/server/public/http";
import { listPublicPractices } from "@/server/public/queries";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  try {
    const praktijken = await listPublicPractices();
    return publicCacheResponse(verzoek, {
      items: praktijken,
      total: praktijken.length,
    });
  } catch (fout) {
    console.error("Publieke praktijkenlijst mislukt:", fout);
    return publicError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
