// GET /api/mobile/v1/interviews — voorgestelde en bevestigde gesprekken.

import { listInterviewsForCandidate } from "@/server/pipeline";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toInterviewView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const interviews = await listInterviewsForCandidate();
    return okRespons({ interviews: interviews.map(toInterviewView) });
  } catch (fout) {
    return vangFout(fout);
  }
}
