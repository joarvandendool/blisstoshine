// GET /api/mobile/v1/invitations — eigen uitnodigingen, nieuwste eerst.

import { listInvitationsForCandidate } from "@/server/invitations";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toInvitationView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const uitnodigingen = await listInvitationsForCandidate();
    return okRespons({ invitations: uitnodigingen.map(toInvitationView) });
  } catch (fout) {
    return vangFout(fout);
  }
}
