// POST /api/mobile/v1/invitations/viewed — markeert openstaande
// uitnodigingsnotificaties als gezien (idempotent).

import { markInvitationsViewed } from "@/server/invitations";
import { okRespons, vangFout } from "@/server/mobile/http";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    await markInvitationsViewed();
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
