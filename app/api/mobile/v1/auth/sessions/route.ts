// GET /api/mobile/v1/auth/sessions — actieve mobiele sessies (apparaten)
// van de ingelogde gebruiker, voor het instellingenscherm.

import { listMobileSessions } from "@/lib/mobile-auth";
import { requireMobileSession } from "@/server/mobile/context";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toSessionView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    const sessies = await listMobileSessions(ctx.user.id);
    return okRespons({
      sessions: sessies.map((sessie) => toSessionView(sessie, ctx.sessionId)),
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
