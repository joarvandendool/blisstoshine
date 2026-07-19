// POST /api/mobile/v1/applications/:id/withdraw — eigen sollicitatie
// terugtrekken; afgeronde sollicitaties → 409.

import { withdrawApplication } from "@/server/applications";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { withdrawSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ applicationId: string }> },
): Promise<Response> {
  try {
    const { applicationId } = await params;
    const invoer = withdrawSchema.parse(await leesJson(request));
    const sollicitatie = await withdrawApplication(applicationId, invoer);
    return okRespons({
      application: { id: sollicitatie.id, status: sollicitatie.status },
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
