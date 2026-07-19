// DELETE /api/mobile/v1/account — accountverwijdering starten vanuit de app
// (App Store-vereiste). Zelfde anonimisering als de webflow
// (src/server/privacy.ts), plus intrekking van álle mobiele sessies en
// verwijdering van alle pushtokens.

import { revokeAllMobileSessions } from "@/lib/mobile-auth";
import { verwijderAccount } from "@/server/privacy";
import { requireMobileSession } from "@/server/mobile/context";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { accountDeleteSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    accountDeleteSchema.parse(await leesJson(request));

    await verwijderAccount(ctx.user.id);
    await revokeAllMobileSessions(ctx.user.id, "account_deleted");

    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
