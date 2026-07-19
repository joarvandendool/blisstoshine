// POST /api/mobile/v1/invitations/:id/respond — interesse tonen of afwijzen.
// Alleen een openstaande uitnodiging (sent) kan worden beantwoord; bij twee
// apparaten tegelijk wint de eerste en krijgt de tweede 409. shareContact
// legt server-side consent vast (grantConsent).

import { respondToInvitation } from "@/server/invitations";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { invitationRespondSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitationId: string }> },
): Promise<Response> {
  try {
    const { invitationId } = await params;
    const invoer = invitationRespondSchema.parse(await leesJson(request));
    const uitnodiging = await respondToInvitation(invitationId, invoer);
    return okRespons({
      invitation: { id: uitnodiging.id, status: uitnodiging.status },
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
