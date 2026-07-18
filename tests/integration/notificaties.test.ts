// Notificatietests (Deel 5 van de private-betafase):
// - sendNotification is idempotent op dedupeKey
// - voorkeur email=false → geen OutboxEmail-rij
// - een gebruiker ziet alleen eigen meldingen via listNotifications

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
  // Alleen ./helpers importeren — @/lib/auth zou een circulaire dynamic
  // import veroorzaken (auth importeert zelf next/headers).
  const { sessieHouder, createTestSessionToken } = await import("./helpers");
  return {
    cookies: async () => ({
      get: (naam: string) =>
        naam === "mz_session" && sessieHouder.userId
          ? { value: createTestSessionToken(sessieHouder.userId) }
          : undefined,
      set: () => {},
      delete: () => {},
    }),
  };
});

import { prisma } from "@/lib/db";
import {
  listNotifications,
  sendNotification,
  setPreference,
  unreadCount,
} from "@/lib/notifications";
import { prepareTestDb, maakGebruiker } from "./helpers";

let anna: Awaited<ReturnType<typeof maakGebruiker>>;
let bram: Awaited<ReturnType<typeof maakGebruiker>>;

beforeAll(async () => {
  await prepareTestDb();
  anna = await maakGebruiker("anna@test.nl", "Anna Kandidaat");
  bram = await maakGebruiker("bram@test.nl", "Bram Praktijk");
});

describe("sendNotification", () => {
  it("is idempotent op dedupeKey: tweede send → created:false en één rij", async () => {
    const invoer = {
      userId: anna.id,
      type: "invitation_received" as const,
      title: "Nieuwe uitnodiging",
      body: "Praktijk Alfa nodigt je uit voor de vacature Mondhygiënist.",
      href: "/kandidaat",
      dedupeKey: "uitnodiging:vac-1:anna",
    };

    const eerste = await sendNotification(invoer);
    expect(eerste.created).toBe(true);
    expect(eerste.notificationId).toBeDefined();

    const tweede = await sendNotification(invoer);
    expect(tweede.created).toBe(false);
    expect(tweede.notificationId).toBe(eerste.notificationId);

    const rijen = await prisma.notification.count({
      where: { dedupeKey: invoer.dedupeKey },
    });
    expect(rijen).toBe(1);

    // Standaardvoorkeur (geen rij) heeft beide kanalen aan → wél een
    // outbox-e-mail, maar door de dedupe precies één.
    const outbox = await prisma.outboxEmail.count({
      where: { toEmail: "anna@test.nl" },
    });
    expect(outbox).toBe(1);
  });

  it("maakt geen OutboxEmail-rij wanneer de e-mailvoorkeur uit staat", async () => {
    await setPreference(bram.id, "strong_match_found", {
      inApp: true,
      email: false,
    });

    const resultaat = await sendNotification({
      userId: bram.id,
      type: "strong_match_found",
      title: "Nieuwe sterke match",
      body: "Er is een nieuwe sterke match voor je vacature Tandarts.",
      dedupeKey: "match:vac-2:bram",
    });
    expect(resultaat.created).toBe(true);

    // In-app melding bestaat en is ongelezen …
    expect(await unreadCount(bram.id)).toBe(1);

    // … maar er is géén e-mail in de outbox beland.
    const perNotificatie = await prisma.outboxEmail.count({
      where: { notificationId: resultaat.notificationId },
    });
    const perAdres = await prisma.outboxEmail.count({
      where: { toEmail: "bram@test.nl" },
    });
    expect(perNotificatie).toBe(0);
    expect(perAdres).toBe(0);
  });
});

describe("listNotifications", () => {
  it("geeft uitsluitend eigen meldingen terug", async () => {
    // Beide gebruikers hebben inmiddels een melding; geef Bram er nog één.
    await sendNotification({
      userId: bram.id,
      type: "invitation_interested",
      title: "Kandidaat toont interesse",
      body: "Een kandidaat toont interesse in je vacature.",
      dedupeKey: "interesse:vac-2:kandidaat-x",
    });

    const vanAnna = await listNotifications(anna.id);
    const vanBram = await listNotifications(bram.id);

    expect(vanAnna.length).toBe(1);
    expect(vanAnna.every((m) => m.userId === anna.id)).toBe(true);
    expect(vanAnna.some((m) => m.userId === bram.id)).toBe(false);

    expect(vanBram.length).toBe(2);
    expect(vanBram.every((m) => m.userId === bram.id)).toBe(true);
    expect(vanBram.some((m) => m.userId === anna.id)).toBe(false);
  });
});
