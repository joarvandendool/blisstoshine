// Pushverzending naar de kandidaat-app via de Expo Push API.
//
// Principes (MOBILE_API_CONTRACT.md §5.8 en de privacy-eisen):
// - push alleen voor REEDS BESTAANDE notificatie-events: deze module wordt
//   uitsluitend aangeroepen vanuit sendNotification (src/lib/notifications.ts)
//   nadat dedupeKey en gebruikersvoorkeuren zijn toegepast;
// - de zichtbare tekst bevat NOOIT kandidaatdata of gevoelige inhoud: alleen
//   de generieke titel van het notificatietype en een neutrale bodytekst.
//   Details staan achter de deep link, ná ontgrendelen en inloggen;
// - dedupliceren gebeurt door de Notification-laag (dedupeKey) — één
//   notificatie is hooguit één push per apparaat;
// - vanuit development/preview wordt NIET naar echte gebruikers gestuurd:
//   verzenden gebeurt alleen wanneer appEnv "production" is; anders wordt
//   alleen gelogd.
// - faalt zacht: pushproblemen breken nooit een productflow.

import { appEnv } from "@/lib/config";
import { prisma } from "@/lib/db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Neutrale bodytekst — nooit persoonsgegevens op het lockscreen. */
const NEUTRALE_BODY = "Open de app voor de details.";

export interface PushNotificatieInput {
  userId: string;
  type: string;
  /** Generieke titel (bv. "Persoonlijke uitnodiging ontvangen"). */
  title: string;
  /** Webpad voor de deep link (Notification.href). */
  href?: string | null;
  notificationId?: string;
}

async function pushVoorkeur(userId: string, type: string): Promise<boolean> {
  const rijen = await prisma.notificationPreference.findMany({
    where: { userId, type: { in: [type, "all"] } },
  });
  const specifiek = rijen.find((rij) => rij.type === type);
  const alles = rijen.find((rij) => rij.type === "all");
  return (specifiek ?? alles)?.push ?? true;
}

/**
 * Stuurt (best effort) een push naar alle geregistreerde apparaten van de
 * gebruiker. Ongeldige tokens (DeviceNotRegistered) worden opgeruimd.
 */
export async function sendPushForNotification(
  input: PushNotificatieInput,
): Promise<void> {
  try {
    if (!(await pushVoorkeur(input.userId, input.type))) return;

    const tokens = await prisma.mobilePushToken.findMany({
      where: { userId: input.userId },
      select: { id: true, token: true },
    });
    if (tokens.length === 0) return;

    const berichten = tokens.map((rij) => ({
      to: rij.token,
      title: input.title,
      body: NEUTRALE_BODY,
      data: { href: input.href ?? null, type: input.type },
      sound: "default" as const,
    }));

    // Buiten productie nooit echte pushes — alleen een logspoor.
    if (appEnv !== "production") {
      console.info(
        `push (onderdrukt, appEnv=${appEnv}): ${input.type} → ${tokens.length} apparaat/apparaten`,
      );
      return;
    }

    const respons = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(berichten),
    });
    if (!respons.ok) {
      console.error(`Expo Push API antwoordde ${respons.status}`);
      return;
    }
    const uitkomst = (await respons.json()) as {
      data?: Array<{ status: string; details?: { error?: string } }>;
    };

    // Tokens die niet meer bestaan opruimen.
    const opTeRuimen: string[] = [];
    uitkomst.data?.forEach((ticket, index) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        const token = tokens[index];
        if (token) opTeRuimen.push(token.id);
      }
    });
    if (opTeRuimen.length > 0) {
      await prisma.mobilePushToken.deleteMany({ where: { id: { in: opTeRuimen } } });
    }
  } catch (fout) {
    console.error("sendPushForNotification faalde (zacht):", fout);
  }
}
