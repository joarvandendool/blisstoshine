// GET /api/public/v1/org/vacancies — alle vacatures van de eigen organisatie
// (fase 9). Vereist Bearer API-sleutel met scope jobs:read; data is altijd
// gescoped op de organisatie van de sleutel.

import type { NextResponse } from "next/server";
import { orgVacanciesForApi } from "@/server/integrations";
import { handleOrgApi } from "../helpers";

export const dynamic = "force-dynamic";

export async function GET(verzoek: Request): Promise<NextResponse> {
  return handleOrgApi(verzoek, "jobs:read", (auth) =>
    orgVacanciesForApi(auth.organizationId),
  );
}
