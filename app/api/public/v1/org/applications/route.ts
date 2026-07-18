// GET /api/public/v1/org/applications — sollicitaties op eigen vacatures
// (fase 9). Vereist scope pipeline:read. Privacy: kandidaatnaam alleen bij
// actieve consent (CandidateConsent, scope contact_details); anders alleen
// het pseudonieme candidate.id.

import type { NextResponse } from "next/server";
import { orgApplicationsForApi } from "@/server/integrations";
import { handleOrgApi } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  return handleOrgApi(verzoek, "pipeline:read", (auth) =>
    orgApplicationsForApi(auth.organizationId),
  );
}
