// GET /api/public/v1/market-insights — geaggregeerde, privacyveilige
// arbeidsmarktcijfers (fase 8). Hergebruikt MarketInsightSnapshot-data
// (fase 6) wanneer aanwezig; anders een compacte eigen aggregatie. Groepen
// kleiner dan 5 worden nooit getoond. Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
  publicError,
} from "@/server/public/http";
import { getPublicMarketInsights } from "@/server/public/queries";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  try {
    return publicCacheResponse(verzoek, await getPublicMarketInsights());
  } catch (fout) {
    console.error("Publieke marktinzichten mislukt:", fout);
    return publicError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
