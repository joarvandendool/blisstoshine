// GET/PUT /api/mobile/v1/notifications/preferences — kanaalvoorkeuren per
// notificatietype (in-app, e-mail, push). Zonder rij gelden de defaults
// (alles aan) — de GET vult die aan zodat de app altijd een complete lijst
// heeft.

import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  getPreferences,
  NOTIFICATION_TYPES,
  type NotificationType,
} from "@/lib/notifications";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { notificationPreferenceSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const rijen = await getPreferences(user.id);
    const perType = new Map(rijen.map((rij) => [rij.type, rij]));
    const preferences = [...NOTIFICATION_TYPES, "all" as const].map((type) => {
      const rij = perType.get(type);
      return {
        type,
        inApp: rij?.inApp ?? true,
        email: rij?.email ?? true,
        push: rij?.push ?? true,
      };
    });
    return okRespons({ preferences });
  } catch (fout) {
    return vangFout(fout);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const user = await requireUser();
    const invoer = notificationPreferenceSchema.parse(await leesJson(request));
    await prisma.notificationPreference.upsert({
      where: { userId_type: { userId: user.id, type: invoer.type } },
      create: {
        userId: user.id,
        type: invoer.type as NotificationType | "all",
        inApp: invoer.inApp,
        email: invoer.email,
        push: invoer.push,
      },
      update: { inApp: invoer.inApp, email: invoer.email, push: invoer.push },
    });
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
