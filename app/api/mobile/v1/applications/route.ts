// GET  /api/mobile/v1/applications — eigen sollicitaties.
// POST /api/mobile/v1/applications — solliciteren. Dubbel (ook bij race of
// herhaald verzoek na time-out) → 409 conflict; de app behandelt dat als
// "al gelukt" en herlaadt. Succes-UI pas na 201 van de server.

import {
  applyToVacancy,
  listApplicationsForCandidate,
} from "@/server/applications";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { applySchema } from "@/server/mobile/schemas";
import { toApplicationView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sollicitaties = await listApplicationsForCandidate();
    return okRespons({ applications: sollicitaties.map(toApplicationView) });
  } catch (fout) {
    return vangFout(fout);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const invoer = applySchema.parse(await leesJson(request));
    const sollicitatie = await applyToVacancy(invoer.vacancyId, invoer.motivation);
    return okRespons(
      {
        application: {
          id: sollicitatie.id,
          status: sollicitatie.status,
          createdAt: sollicitatie.createdAt.toISOString(),
        },
      },
      201,
    );
  } catch (fout) {
    return vangFout(fout);
  }
}
