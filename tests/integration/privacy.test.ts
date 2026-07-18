// Privacy/AVG-tests (fase 10 — productiehardening):
// (a) export bevat uitsluitend eigen gegevens, nooit die van anderen
// (b) verwijdering anonimiseert de gebruiker, wist het profiel en trekt
//     consents in, terwijl het pipeline-journaal en MatchSnapshots blijven
// (c) retentiefuncties verwijderen alleen data buiten de termijn
//     (geïnjecteerd "nu"; droogloop wijzigt niets)
// (d) assertSameOrigin weigert vreemde origins en accepteert eigen host

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
import { AuthzError } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/security";
import {
  GEANONIMISEERDE_NAAM,
  exporteerEigenGegevens,
  geanonimiseerdEmail,
  gegevensOverzicht,
  retentieAnalyticsEvents,
  retentieDraftProfielen,
  retentieNotificaties,
  retentieOutboxEmails,
  retentieRateLimitCounters,
  verwijderAccount,
} from "@/server/privacy";
import { prepareTestDb, maakGebruiker, maakKandidaat } from "./helpers";

let anna: Awaited<ReturnType<typeof maakKandidaat>>;
let bram: Awaited<ReturnType<typeof maakKandidaat>>;
let org: { id: string };
let vacature: { id: string };

const NU = new Date("2026-07-18T12:00:00Z");

function maandenTerug(basis: Date, maanden: number): Date {
  const d = new Date(basis);
  d.setMonth(d.getMonth() - maanden);
  return d;
}

beforeAll(async () => {
  await prepareTestDb();

  anna = await maakKandidaat("anna@test.nl", "Anna Kandidaat");
  bram = await maakKandidaat("bram@test.nl", "Bram Andere-Kandidaat");

  // Minimale organisatie + vacature als fixture (rechtstreeks via Prisma;
  // de servicelaag is elders getest).
  const organisatie = await prisma.organization.create({
    data: { name: "Praktijk Privacy", slug: "praktijk-privacy" },
  });
  org = organisatie;
  const locatie = await prisma.practiceLocation.create({
    data: {
      organizationId: org.id,
      name: "Privacy Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      latitude: 52.0907,
      longitude: 5.1214,
    },
  });
  vacature = await prisma.vacancy.create({
    data: {
      organizationId: org.id,
      locationId: locatie.id,
      title: "Mondhygiënist privacyproef",
      role: "mondhygienist",
      schedule: {},
      criteria: {},
      hoursMin: 16,
      hoursMax: 32,
      status: "published",
      publishedAt: NU,
    },
  });

  // Eigen dossier van Anna: sollicitatie, uitnodiging, consent, notificatie,
  // voorkeur, snapshot en journaal.
  await prisma.application.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId: anna.user.id,
      motivation: "Ik werk graag preventiegericht.",
    },
  });
  await prisma.invitation.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId: anna.user.id,
      message: "Kom je kennismaken?",
    },
  });
  await prisma.candidateConsent.create({
    data: { candidateUserId: anna.user.id, organizationId: org.id },
  });
  await prisma.notification.create({
    data: {
      userId: anna.user.id,
      type: "invitation_received",
      title: "Nieuwe uitnodiging",
      body: "Praktijk Privacy nodigt je uit.",
      dedupeKey: "privacy-test:anna:1",
    },
  });
  await prisma.notificationPreference.create({
    data: { userId: anna.user.id, type: "invitation_received", inApp: true, email: false },
  });
  await prisma.matchSnapshot.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId: anna.user.id,
      context: "invitation",
      score: 82,
      label: "sterk",
      algorithmVersion: "1.0.0",
      result: {},
      profileData: { role: "mondhygienist" },
      vacancyData: { title: "Mondhygiënist privacyproef" },
    },
  });
  await prisma.pipelineStatusChange.createMany({
    data: [
      {
        vacancyId: vacature.id,
        candidateUserId: anna.user.id,
        toStatus: "invited",
        actorType: "practice",
      },
      {
        vacancyId: vacature.id,
        candidateUserId: anna.user.id,
        fromStatus: "invited",
        toStatus: "applied",
        actorType: "candidate",
        actorUserId: anna.user.id,
      },
    ],
  });
  await prisma.outboxEmail.create({
    data: {
      toEmail: "anna@test.nl",
      subject: "mondzorgwerkt — Nieuwe uitnodiging",
      body: "Praktijk Privacy nodigt je uit.",
    },
  });

  // Dossier van Bram — mag NOOIT in Anna's export opduiken.
  await prisma.application.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId: bram.user.id,
      motivation: "Geheime motivatie van Bram.",
    },
  });
});

describe("exporteerEigenGegevens", () => {
  it("bevat de eigen gegevens per categorie", async () => {
    const export_ = await exporteerEigenGegevens(anna.user.id);

    expect(export_.account).toMatchObject({ email: "anna@test.nl", name: "Anna Kandidaat" });
    expect(export_.kandidaatprofiel).toMatchObject({ role: "mondhygienist" });
    // Geen interne sleutels of wachtwoordhash in de export.
    expect(JSON.stringify(export_)).not.toContain("passwordHash");

    const sollicitaties = export_.sollicitaties as Array<Record<string, unknown>>;
    expect(sollicitaties).toHaveLength(1);
    expect(sollicitaties[0]).toMatchObject({
      vacatureTitel: "Mondhygiënist privacyproef",
      motivatie: "Ik werk graag preventiegericht.",
    });

    const uitnodigingen = export_.uitnodigingen as Array<Record<string, unknown>>;
    expect(uitnodigingen).toHaveLength(1);
    expect(uitnodigingen[0]).toMatchObject({ bericht: "Kom je kennismaken?" });

    expect(export_.toestemmingen).toHaveLength(1);
    expect(export_.notificatievoorkeuren).toEqual([
      { type: "invitation_received", inApp: true, email: false },
    ]);
  });

  it("bevat géén gegevens van andere gebruikers", async () => {
    const alsTekst = JSON.stringify(await exporteerEigenGegevens(anna.user.id));
    expect(alsTekst).not.toContain("bram@test.nl");
    expect(alsTekst).not.toContain("Bram Andere-Kandidaat");
    expect(alsTekst).not.toContain("Geheime motivatie van Bram.");
  });

  it("registreert een PrivacyRequest (kind=export)", async () => {
    const verzoeken = await prisma.privacyRequest.count({
      where: { userId: anna.user.id, kind: "export", status: "afgerond" },
    });
    expect(verzoeken).toBeGreaterThanOrEqual(1);
  });

  it("gegevensOverzicht telt per categorie", async () => {
    const overzicht = await gegevensOverzicht(anna.user.id);
    const per = new Map(overzicht.map((c) => [c.categorie, c.aantal]));
    expect(per.get("Kandidaatprofiel")).toBe(1);
    expect(per.get("Sollicitaties")).toBe(1);
    expect(per.get("Uitnodigingen")).toBe(1);
    expect(per.get("Toestemmingen")).toBe(1);
  });
});

describe("verwijderAccount", () => {
  it("anonimiseert de gebruiker, wist profiel/notificaties en trekt consents in; journaal en snapshots blijven", async () => {
    const journaalVoor = await prisma.pipelineStatusChange.count({
      where: { candidateUserId: anna.user.id },
    });
    const snapshotsVoor = await prisma.matchSnapshot.count({
      where: { candidateUserId: anna.user.id },
    });
    expect(journaalVoor).toBe(2);
    expect(snapshotsVoor).toBe(1);

    await verwijderAccount(anna.user.id);

    // Gebruiker geanonimiseerd; inloggen onmogelijk (geen bcrypt-hash meer).
    const user = await prisma.user.findUniqueOrThrow({ where: { id: anna.user.id } });
    expect(user.name).toBe(GEANONIMISEERDE_NAAM);
    expect(user.email).toBe(geanonimiseerdEmail(anna.user.id));
    expect(user.email).toBe(`verwijderd+${anna.user.id}@anon.mondzorgwerkt.nl`);
    expect(user.passwordHash.startsWith("verwijderd:")).toBe(true);

    // Profiel hard weg; notificaties/voorkeuren weg; outbox naar oud adres weg.
    expect(
      await prisma.candidateProfile.findUnique({ where: { userId: anna.user.id } }),
    ).toBeNull();
    expect(await prisma.notification.count({ where: { userId: anna.user.id } })).toBe(0);
    expect(
      await prisma.notificationPreference.count({ where: { userId: anna.user.id } }),
    ).toBe(0);
    expect(await prisma.outboxEmail.count({ where: { toEmail: "anna@test.nl" } })).toBe(0);

    // Consents ingetrokken, niet verwijderd (bewijs van de intrekking blijft).
    const consents = await prisma.candidateConsent.findMany({
      where: { candidateUserId: anna.user.id },
    });
    expect(consents).toHaveLength(1);
    expect(consents[0].revokedAt).not.toBeNull();

    // Geanonimiseerde bedrijfsadministratie blijft bestaan.
    expect(
      await prisma.pipelineStatusChange.count({ where: { candidateUserId: anna.user.id } }),
    ).toBe(journaalVoor);
    expect(
      await prisma.matchSnapshot.count({ where: { candidateUserId: anna.user.id } }),
    ).toBe(snapshotsVoor);

    // Verzoek vastgelegd en afgerond.
    const verzoek = await prisma.privacyRequest.findFirst({
      where: { userId: anna.user.id, kind: "verwijdering" },
    });
    expect(verzoek?.status).toBe("afgerond");
    expect(verzoek?.completedAt).not.toBeNull();

    // Andere gebruikers onaangeroerd.
    const bramNa = await prisma.user.findUniqueOrThrow({ where: { id: bram.user.id } });
    expect(bramNa.email).toBe("bram@test.nl");
  });
});

describe("retentiefuncties (geïnjecteerd nu)", () => {
  it("AnalyticsEvent: alleen ouder dan 24 maanden; droogloop wijzigt niets", async () => {
    await prisma.analyticsEvent.createMany({
      data: [
        { name: "match_viewed", createdAt: maandenTerug(NU, 25) },
        { name: "match_viewed", createdAt: maandenTerug(NU, 23) },
      ],
    });

    expect(await retentieAnalyticsEvents(NU, false)).toBe(1);
    expect(await prisma.analyticsEvent.count()).toBe(2); // droogloop: niets weg

    expect(await retentieAnalyticsEvents(NU, true)).toBe(1);
    expect(await prisma.analyticsEvent.count()).toBe(1);
  });

  it("Notification: alleen ouder dan 6 maanden", async () => {
    await prisma.notification.createMany({
      data: [
        {
          userId: bram.user.id,
          type: "invitation_received",
          title: "Oud",
          body: "x",
          dedupeKey: "ret:oud",
          createdAt: maandenTerug(NU, 7),
        },
        {
          userId: bram.user.id,
          type: "invitation_received",
          title: "Nieuw",
          body: "x",
          dedupeKey: "ret:nieuw",
          createdAt: maandenTerug(NU, 5),
        },
      ],
    });

    expect(await retentieNotificaties(NU, true)).toBe(1);
    const over = await prisma.notification.findMany({ where: { userId: bram.user.id } });
    expect(over.map((n) => n.title)).toEqual(["Nieuw"]);
  });

  it("OutboxEmail: alleen status sent én ouder dan 3 maanden", async () => {
    await prisma.outboxEmail.createMany({
      data: [
        { toEmail: "x@test.nl", subject: "oud-sent", body: "x", status: "sent", createdAt: maandenTerug(NU, 4) },
        { toEmail: "x@test.nl", subject: "oud-pending", body: "x", status: "pending", createdAt: maandenTerug(NU, 4) },
        { toEmail: "x@test.nl", subject: "nieuw-sent", body: "x", status: "sent", createdAt: maandenTerug(NU, 2) },
      ],
    });

    expect(await retentieOutboxEmails(NU, true)).toBe(1);
    const over = await prisma.outboxEmail.findMany({ where: { toEmail: "x@test.nl" } });
    expect(over.map((m) => m.subject).sort()).toEqual(["nieuw-sent", "oud-pending"]);
  });

  it("RateLimitCounter: alleen vensters ouder dan 7 dagen", async () => {
    await prisma.rateLimitCounter.createMany({
      data: [
        { key: "login:1.2.3.4", windowStart: new Date(NU.getTime() - 8 * 24 * 60 * 60 * 1000) },
        { key: "login:1.2.3.4", windowStart: new Date(NU.getTime() - 60 * 1000) },
      ],
    });

    expect(await retentieRateLimitCounters(NU, true)).toBe(1);
    expect(await prisma.rateLimitCounter.count({ where: { key: "login:1.2.3.4" } })).toBe(1);
  });

  it("draft-profielen: anonimiseert alleen inactieve drafts ouder dan 18 maanden", async () => {
    const oudeDraft = await maakKandidaat("oude-draft@test.nl", "Oude Draft", {
      status: "draft",
    });
    const verseDraft = await maakKandidaat("verse-draft@test.nl", "Verse Draft", {
      status: "draft",
    });
    const oudActief = await maakKandidaat("oud-actief@test.nl", "Oud Actief", {
      status: "active",
    });
    // updatedAt expliciet terugzetten (na create, anders overschrijft @updatedAt).
    await prisma.candidateProfile.updateMany({
      where: { userId: { in: [oudeDraft.user.id, oudActief.user.id] } },
      data: { updatedAt: maandenTerug(NU, 19) },
    });

    // Droogloop telt er precies één (de oude draft) en wijzigt niets.
    expect(await retentieDraftProfielen(NU, false)).toBe(1);
    expect(
      await prisma.candidateProfile.count({ where: { userId: oudeDraft.user.id } }),
    ).toBe(1);

    expect(await retentieDraftProfielen(NU, true)).toBe(1);

    const geanonimiseerd = await prisma.user.findUniqueOrThrow({
      where: { id: oudeDraft.user.id },
    });
    expect(geanonimiseerd.name).toBe(GEANONIMISEERDE_NAAM);
    expect(
      await prisma.candidateProfile.findUnique({ where: { userId: oudeDraft.user.id } }),
    ).toBeNull();

    // Verse draft en oud-maar-actief profiel blijven onaangeroerd.
    const vers = await prisma.user.findUniqueOrThrow({ where: { id: verseDraft.user.id } });
    expect(vers.email).toBe("verse-draft@test.nl");
    const actief = await prisma.user.findUniqueOrThrow({ where: { id: oudActief.user.id } });
    expect(actief.email).toBe("oud-actief@test.nl");
  });
});

describe("assertSameOrigin", () => {
  function verzoek(headers: Record<string, string>): Request {
    return new Request("https://app.mondzorgwerkt.nl/api/events", {
      method: "POST",
      headers,
    });
  }

  it("weigert een vreemde origin (AuthzError 403)", () => {
    const request = verzoek({
      origin: "https://evil.example",
      "x-forwarded-host": "app.mondzorgwerkt.nl",
    });
    expect(() => assertSameOrigin(request)).toThrowError(AuthzError);
    try {
      assertSameOrigin(request);
    } catch (fout) {
      expect((fout as AuthzError).status).toBe(403);
    }
  });

  it('weigert de letterlijke "null"-origin', () => {
    const request = verzoek({
      origin: "null",
      "x-forwarded-host": "app.mondzorgwerkt.nl",
    });
    expect(() => assertSameOrigin(request)).toThrowError(AuthzError);
  });

  it("accepteert de eigen host (x-forwarded-host)", () => {
    const request = verzoek({
      origin: "https://app.mondzorgwerkt.nl",
      "x-forwarded-host": "app.mondzorgwerkt.nl",
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("accepteert deployment-hosts uit de omgeving (VERCEL_URL)", () => {
    process.env.VERCEL_URL = "preview-abc.vercel.app";
    try {
      const request = verzoek({
        origin: "https://preview-abc.vercel.app",
        "x-forwarded-host": "app.mondzorgwerkt.nl",
      });
      expect(() => assertSameOrigin(request)).not.toThrow();
    } finally {
      delete process.env.VERCEL_URL;
    }
  });

  it("staat verzoeken zonder Origin-header toe (niet-browserclients)", () => {
    const request = verzoek({ "x-forwarded-host": "app.mondzorgwerkt.nl" });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });
});
