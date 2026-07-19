// GET /api/mobile/v1/notifications — ongelezen aantal + laatste meldingen.

import { requireUser } from "@/lib/authz";
import { listNotifications, unreadCount } from "@/lib/notifications";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toNotificationView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const [aantalOngelezen, meldingen] = await Promise.all([
      unreadCount(user.id),
      listNotifications(user.id, 30),
    ]);
    return okRespons({
      unreadCount: aantalOngelezen,
      notifications: meldingen.map((melding) =>
        toNotificationView({ ...melding, href: melding.href ?? null }),
      ),
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
