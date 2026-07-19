// POST /api/mobile/v1/interviews/:id/confirm — kandidaat kiest één van de
// voorgestelde gespreksmomenten. Ongeldig slot of al afgehandeld → 400/409.

import { confirmInterview } from "@/server/pipeline";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { interviewConfirmSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ interviewId: string }> },
): Promise<Response> {
  try {
    const { interviewId } = await params;
    const invoer = interviewConfirmSchema.parse(await leesJson(request));
    const interview = await confirmInterview(interviewId, invoer.chosenSlot);
    return okRespons({
      interview: {
        id: interview.id,
        status: interview.status,
        chosenSlot: interview.chosenSlot?.toISOString() ?? null,
      },
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
