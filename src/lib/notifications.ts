// Provider-onafhankelijke notificatielaag.
//
// - Kanalen: in-app (Notification-tabel) en e-mail (OutboxEmail; in dev/beta
//   een outbox zonder echte verzending — een productieprovider haakt later in
//   op verzendOutbox()).
// - Idempotent: dedupeKey voorkomt dubbele meldingen; een tweede send met
//   dezelfde sleutel is een stil succes.
// - Voorkeuren: NotificationPreference per gebruiker per type (of "all");
//   zonder rij geldt de standaard (beide kanalen aan).
// - Faalt zacht: een notificatiefout mag nooit een productflow breken.

import { prisma } from "./db";
import { track } from "./analytics";

/** Stabiele notificatietypes (ook de sleutel voor voorkeuren). */
export const NOTIFICATION_TYPES = [
  "invitation_received", // nieuwe uitnodiging voor kandidaat
  "invitation_interested", // kandidaat toont interesse (naar praktijk)
  "interview_proposed", // gesprek voorgesteld (naar kandidaat)
  "interview_confirmed", // gesprek bevestigd (naar beide)
  "no_response_reminder", // geen reactie na ingestelde termijn
  "vacancy_expiring", // vacature dreigt te verlopen (naar praktijk)
  "strong_match_found", // nieuw sterk matchresultaat
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface SendNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
  /** Verplicht en stabiel: maakt de melding idempotent. */
  dedupeKey: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface SendResult {
  created: boolean; // false = dedupe (bestond al) of door voorkeur onderdrukt
  notificationId?: string;
}

async function kanaalVoorkeuren(
  userId: string,
  type: NotificationType,
): Promise<{ inApp: boolean; email: boolean }> {
  const rijen = await prisma.notificationPreference.findMany({
    where: { userId, type: { in: [type, "all"] } },
  });
  const specifiek = rijen.find((r) => r.type === type);
  const alles = rijen.find((r) => r.type === "all");
  const bron = specifiek ?? alles;
  return bron ? { inApp: bron.inApp, email: bron.email } : { inApp: true, email: true };
}

/**
 * Verstuur een notificatie via de kanalen die de gebruiker toestaat.
 * Idempotent op dedupeKey; faalt zacht.
 */
export async function sendNotification(
  input: SendNotificationInput,
): Promise<SendResult> {
  try {
    const bestaand = await prisma.notification.findUnique({
      where: { dedupeKey: input.dedupeKey },
      select: { id: true },
    });
    if (bestaand) return { created: false, notificationId: bestaand.id };

    const voorkeur = await kanaalVoorkeuren(input.userId, input.type);
    if (!voorkeur.inApp && !voorkeur.email) return { created: false };

    const notificatie = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        dedupeKey: input.dedupeKey,
        meta: input.meta ?? undefined,
        // in-app uitgezet → direct als gelezen markeren zodat er geen badge komt
        readAt: voorkeur.inApp ? null : new Date(),
      },
    });

    if (voorkeur.email) {
      const gebruiker = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true },
      });
      if (gebruiker) {
        await prisma.outboxEmail.create({
          data: {
            toEmail: gebruiker.email,
            subject: `mondzorgwerkt — ${input.title}`,
            body: `${input.body}\n\n${input.href ? `Bekijk: ${input.href}` : ""}`.trim(),
            notificationId: notificatie.id,
          },
        });
      }
    }

    // Mobiele push (kandidaat-app): zelfde gebeurtenis, apart kanaal.
    // Dynamische import — de pushmodule is optioneel en faalt zacht; de
    // dedupeKey hierboven garandeert hooguit één push per notificatie.
    try {
      const { sendPushForNotification } = await import("@/server/mobile/push");
      await sendPushForNotification({
        userId: input.userId,
        type: input.type,
        title: input.title,
        href: input.href ?? null,
        notificationId: notificatie.id,
      });
    } catch (pushFout) {
      console.error("Push versturen faalde (zacht):", pushFout);
    }

    // Sleutelnaam bewust zonder "email": het PII-filter van de analytics-
    // envelope weigert sleutels die op persoonsgegevens lijken.
    await track("notification_sent", {
      userId: input.userId,
      context: { type: input.type, viaOutbox: voorkeur.email },
    });
    return { created: true, notificationId: notificatie.id };
  } catch (fout) {
    console.error("sendNotification faalde (zacht):", fout);
    return { created: false };
  }
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function setPreference(
  userId: string,
  type: NotificationType | "all",
  kanalen: { inApp: boolean; email: boolean },
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: { userId, type, ...kanalen },
    update: kanalen,
  });
}

export async function getPreferences(userId: string) {
  return prisma.notificationPreference.findMany({ where: { userId } });
}
