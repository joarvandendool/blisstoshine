// POST /api/mobile/v1/notifications/read-all — alles gelezen (idempotent).

import { requireUser } from "@/lib/authz";
import { markAllRead } from "@/lib/notifications";
import { okRespons, vangFout } from "@/server/mobile/http";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const user = await requireUser();
    await markAllRead(user.id);
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
