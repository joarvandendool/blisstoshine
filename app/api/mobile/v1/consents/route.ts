// GET /api/mobile/v1/consents — actieve toestemmingen van de kandidaat.

import { requireCandidate } from "@/lib/authz";
import { listActiveConsents } from "@/server/pipeline";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toConsentView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { user } = await requireCandidate();
    const consents = await listActiveConsents(user.id);
    return okRespons({ consents: consents.map(toConsentView) });
  } catch (fout) {
    return vangFout(fout);
  }
}
