// POST /api/mobile/v1/auth/logout — trekt de huidige mobiele sessie in en
// verwijdert de pushtokens van dit apparaat. De app wist daarnaast zelf alle
// lokale caches en SecureStore-items.

import { revokeMobileSession } from "@/lib/mobile-auth";
import { requireMobileSession } from "@/server/mobile/context";
import { okRespons, vangFout } from "@/server/mobile/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    await revokeMobileSession(ctx.sessionId, "logout");
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
