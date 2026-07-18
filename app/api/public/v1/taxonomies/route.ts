// GET /api/public/v1/taxonomies — alle taxonomiegroepen met key + label
// (fase 8). Puur uit code (src/domain/taxonomy); geen database, geen auth.
// Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
} from "@/server/public/http";
import { getPublicTaxonomies } from "@/server/public/queries";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;
  return publicCacheResponse(verzoek, getPublicTaxonomies());
}
