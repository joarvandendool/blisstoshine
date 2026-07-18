// GET /api/public/v1/org/placements — aangenomen kandidaten (status hired)
// op eigen vacatures (fase 9). Vereist scope pipeline:read; kandidaatnaam
// alleen bij actieve consent.

import type { NextResponse } from "next/server";
import { orgPlacementsForApi } from "@/server/integrations";
import { handleOrgApi } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  return handleOrgApi(verzoek, "pipeline:read", (auth) =>
    orgPlacementsForApi(auth.organizationId),
  );
}
