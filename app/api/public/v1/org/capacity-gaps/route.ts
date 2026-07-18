// GET /api/public/v1/org/capacity-gaps — dagdelen waar de gewenste minimale
// bezetting nu niet wordt gehaald, per locatie (fase 9). Vereist scope
// capacity:read. Alleen eigen teamdata; nooit kandidaatdata.

import type { NextResponse } from "next/server";
import { orgCapacityGapsForApi } from "@/server/integrations";
import { handleOrgApi } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  return handleOrgApi(verzoek, "capacity:read", (auth) =>
    orgCapacityGapsForApi(auth.organizationId),
  );
}
