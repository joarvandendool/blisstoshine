// Notificatie-API voor de ingelogde gebruiker (kandidaat, praktijk of intern).
//
// GET  → ongelezen aantal + de laatste meldingen van de ingelogde gebruiker.
// POST → markeert alle meldingen van de ingelogde gebruiker als gelezen.
//
// AUTORISATIE: requireUser() — de userId komt uitsluitend uit de sessie,
// nooit uit client-input, dus een gebruiker kan alleen eigen meldingen zien
// en markeren.

import { NextResponse } from "next/server";
import { AuthzError, requireUser } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/security";
import {
  listNotifications,
  markAllRead,
  unreadCount,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Wire-contract — NotificationBell.tsx importeert deze types type-only.
// ---------------------------------------------------------------------------

export interface NotificatieWire {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  /** ISO-tijdstip of null wanneer nog ongelezen. */
  readAt: string | null;
  /** ISO-tijdstip van aanmaken. */
  createdAt: string;
}

export interface NotificatiesWire {
  unreadCount: number;
  meldingen: NotificatieWire[];
}

export interface NotificatieFoutWire {
  fout: string;
}

function foutRespons(fout: unknown): NextResponse {
  if (fout instanceof AuthzError) {
    return NextResponse.json<NotificatieFoutWire>(
      { fout: fout.message },
      { status: fout.status },
    );
  }
  console.error("Notificatie-API faalde:", fout);
  return NextResponse.json<NotificatieFoutWire>(
    { fout: "Er ging iets mis. Probeer het later opnieuw." },
    { status: 500 },
  );
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const [aantalOngelezen, meldingen] = await Promise.all([
      unreadCount(user.id),
      listNotifications(user.id, 20),
    ]);
    return NextResponse.json<NotificatiesWire>({
      unreadCount: aantalOngelezen,
      meldingen: meldingen.map((melding) => ({
        id: melding.id,
        type: melding.type,
        title: melding.title,
        body: melding.body,
        href: melding.href ?? null,
        readAt: melding.readAt ? melding.readAt.toISOString() : null,
        createdAt: melding.createdAt.toISOString(),
      })),
    });
  } catch (fout) {
    return foutRespons(fout);
  }
}

export async function POST(verzoek: Request): Promise<NextResponse> {
  try {
    // CSRF: muterend cookie-endpoint — alleen eigen origin (src/lib/security.ts).
    assertSameOrigin(verzoek);
    const user = await requireUser();
    await markAllRead(user.id);
    return NextResponse.json({ ok: true });
  } catch (fout) {
    return foutRespons(fout);
  }
}
