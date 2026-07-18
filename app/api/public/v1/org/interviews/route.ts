// GET /api/public/v1/org/interviews — gesprekken op eigen vacatures (fase 9).
// Vereist scope pipeline:read; kandidaten alleen als pseudoniem ID.

import type { NextResponse } from "next/server";
import { orgInterviewsForApi } from "@/server/integrations";
import { handleOrgApi } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  return handleOrgApi(verzoek, "pipeline:read", (auth) =>
    orgInterviewsForApi(auth.organizationId),
  );
}
