// AVG-privacylaag (fase 10): inzage, export, verwijdering en bewaartermijnen.
//
// Ontwerpkeuzes:
// - EXPORT (art. 15/20): uitsluitend de eigen gegevens van de ingelogde
//   gebruiker — account, kandidaatprofiel, eigen sollicitaties/uitnodigingen,
//   eigen toestemmingen en notificatievoorkeuren. Nooit gegevens van andere
//   personen (geen namen van praktijkmedewerkers, geen andere kandidaten).
// - VERWIJDERING (art. 17): directe anonimisering in één transactie. Het
//   MatchSnapshot- en pipeline-journaal (PipelineStatusChange, AuditLog,
//   MatchDecisionFeedback) blijft bestaan als geanonimiseerde
//   bedrijfsadministratie: de rijen verwijzen alleen nog naar een user-id
//   waarvan naam/e-mail/profiel zijn gewist. Die afweging is bewust — het
//   journaal is nodig voor geschillen, fraudedetectie en KPI-integriteit, en
//   bevat na anonimisering geen direct identificeerbare persoonsgegevens
//   meer. Zie docs/OPERATIONS.md.
// - BEWAARTERMIJNEN: geëxporteerde constanten hieronder; de opruimfuncties
//   accepteren een geïnjecteerd "nu" (testbaar) en een apply-vlag (droogloop
//   standaard). scripts/retention.mjs draait ze periodiek.

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Bewaartermijnen — één bron van waarheid voor app én retention-script.
// ---------------------------------------------------------------------------

/** AnalyticsEvent: 24 maanden — daarna zijn trendcijfers geaggregeerd elders. */
export const RETENTIE_ANALYTICS_EVENT_MAANDEN = 24;
/** Notification (in-app meldingen): 6 maanden. */
export const RETENTIE_NOTIFICATIE_MAANDEN = 6;
/** OutboxEmail met status "sent": 3 maanden (pending/failed blijven staan). */
export const RETENTIE_OUTBOX_SENT_MAANDEN = 3;
/** RateLimitCounter: 7 dagen — vensters zijn minuten tot kwartieren. */
export const RETENTIE_RATE_LIMIT_DAGEN = 7;
/** Inactieve draft-kandidaatprofielen: na 18 maanden anonimiseren. */
export const RETENTIE_DRAFT_PROFIEL_MAANDEN = 18;

function maandenGeleden(nu: Date, maanden: number): Date {
  const d = new Date(nu);
  d.setMonth(d.getMonth() - maanden);
  return d;
}

function dagenGeleden(nu: Date, dagen: number): Date {
  return new Date(nu.getTime() - dagen * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Inzage (art. 15): overzicht per gegevenscategorie.
// ---------------------------------------------------------------------------

export interface GegevensCategorie {
  categorie: string;
  omschrijving: string;
  aantal: number;
}

/** Overzicht van de gegevens die het platform over deze gebruiker bewaart. */
export async function gegevensOverzicht(userId: string): Promise<GegevensCategorie[]> {
  const [profiel, sollicitaties, uitnodigingen, consents, notificaties, voorkeuren, verzoeken] =
    await Promise.all([
      prisma.candidateProfile.count({ where: { userId } }),
      prisma.application.count({ where: { candidateUserId: userId } }),
      prisma.invitation.count({ where: { candidateUserId: userId } }),
      prisma.candidateConsent.count({ where: { candidateUserId: userId } }),
      prisma.notification.count({ where: { userId } }),
      prisma.notificationPreference.count({ where: { userId } }),
      prisma.privacyRequest.count({ where: { userId } }),
    ]);

  return [
    {
      categorie: "Account",
      omschrijving: "Naam, e-mailadres en wachtwoord (versleuteld opgeslagen).",
      aantal: 1,
    },
    {
      categorie: "Kandidaatprofiel",
      omschrijving:
        "Functie, ervaring, postcode, beschikbaarheid, wensen en zichtbaarheidsinstellingen.",
      aantal: profiel,
    },
    {
      categorie: "Sollicitaties",
      omschrijving: "Je sollicitaties met status en motivatie.",
      aantal: sollicitaties,
    },
    {
      categorie: "Uitnodigingen",
      omschrijving: "Uitnodigingen die praktijken je stuurden, met je reactie.",
      aantal: uitnodigingen,
    },
    {
      categorie: "Toestemmingen",
      omschrijving:
        "Per praktijk: of je naam en contactgegevens gedeeld mogen worden (incl. ingetrokken toestemmingen).",
      aantal: consents,
    },
    {
      categorie: "Notificaties",
      omschrijving: "Je meldingen in de app.",
      aantal: notificaties,
    },
    {
      categorie: "Notificatievoorkeuren",
      omschrijving: "Per soort melding: in-app en/of e-mail.",
      aantal: voorkeuren,
    },
    {
      categorie: "Privacyverzoeken",
      omschrijving: "Eerdere export- en verwijderverzoeken.",
      aantal: verzoeken,
    },
  ];
}

// ---------------------------------------------------------------------------
// Export (art. 15/20): JSON met uitsluitend eigen gegevens.
// ---------------------------------------------------------------------------

/** Machineleesbare export van de eigen gegevens. Bevat NOOIT data van anderen. */
export async function exporteerEigenGegevens(userId: string): Promise<Record<string, unknown>> {
  const [user, profiel, sollicitaties, uitnodigingen, consents, voorkeuren] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, name: true, createdAt: true },
      }),
      prisma.candidateProfile.findUnique({ where: { userId } }),
      prisma.application.findMany({
        where: { candidateUserId: userId },
        select: {
          id: true,
          vacancyId: true,
          vacancy: { select: { title: true } },
          status: true,
          motivation: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.invitation.findMany({
        where: { candidateUserId: userId },
        select: {
          id: true,
          vacancyId: true,
          vacancy: { select: { title: true } },
          status: true,
          message: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.candidateConsent.findMany({
        where: { candidateUserId: userId },
        select: {
          organizationId: true,
          vacancyId: true,
          scope: true,
          grantedAt: true,
          revokedAt: true,
        },
        orderBy: { grantedAt: "asc" },
      }),
      prisma.notificationPreference.findMany({
        where: { userId },
        select: { type: true, inApp: true, email: true },
      }),
    ]);

  // Kandidaatprofiel zonder interne sleutels; de inhoudelijke velden zijn
  // allemaal eigen opgaven van de gebruiker zelf.
  const profielExport = profiel
    ? Object.fromEntries(
        Object.entries(profiel).filter(([sleutel]) => !["id", "userId"].includes(sleutel)),
      )
    : null;

  await prisma.privacyRequest.create({
    data: { userId, kind: "export", status: "afgerond", completedAt: new Date() },
  });
  await audit("privacy.export", "User", userId, { userId });

  return {
    exportVersie: 1,
    gegenereerdOp: new Date().toISOString(),
    toelichting:
      "Machineleesbare export van jouw gegevens bij mondzorgwerkt (AVG art. 15/20). " +
      "Bevat uitsluitend jouw eigen gegevens.",
    account: user,
    kandidaatprofiel: profielExport,
    sollicitaties: sollicitaties.map((s) => ({
      id: s.id,
      vacancyId: s.vacancyId,
      vacatureTitel: s.vacancy.title,
      status: s.status,
      motivatie: s.motivation,
      aangemaakt: s.createdAt,
      bijgewerkt: s.updatedAt,
    })),
    uitnodigingen: uitnodigingen.map((u) => ({
      id: u.id,
      vacancyId: u.vacancyId,
      vacatureTitel: u.vacancy.title,
      status: u.status,
      bericht: u.message,
      aangemaakt: u.createdAt,
    })),
    toestemmingen: consents,
    notificatievoorkeuren: voorkeuren,
  };
}

// ---------------------------------------------------------------------------
// Verwijdering (art. 17): directe anonimisering.
// ---------------------------------------------------------------------------

export const GEANONIMISEERDE_NAAM = "Verwijderde gebruiker";

export function geanonimiseerdEmail(userId: string): string {
  return `verwijderd+${userId}@anon.mondzorgwerkt.nl`;
}

/**
 * Kern van de anonimisering, binnen een transactie:
 * - naam → "Verwijderde gebruiker", e-mail → verwijderd+<id>@anon…,
 *   wachtwoordhash geroteerd naar een random waarde (inloggen onmogelijk;
 *   bcrypt.compare faalt altijd op een niet-bcrypt-hash);
 * - kandidaatprofiel hard verwijderd;
 * - toestemmingen ingetrokken (revokedAt), memberships ingetrokken;
 * - notificaties en notificatievoorkeuren verwijderd; verzonden outbox-mail
 *   naar het oude adres verwijderd.
 * MatchSnapshots en het pipeline-journaal blijven bewust staan (zie kop).
 */
async function anonimiseerGebruiker(
  tx: Prisma.TransactionClient,
  userId: string,
  nu: Date,
): Promise<void> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  await tx.candidateProfile.deleteMany({ where: { userId } });
  await tx.candidateConsent.updateMany({
    where: { candidateUserId: userId, revokedAt: null },
    data: { revokedAt: nu },
  });
  await tx.membership.updateMany({
    where: { userId, status: { not: "revoked" } },
    data: { status: "revoked" },
  });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.notificationPreference.deleteMany({ where: { userId } });
  // E-mails in de outbox aan het oude adres bevatten naam + adres: mee wissen.
  await tx.outboxEmail.deleteMany({ where: { toEmail: user.email } });

  await tx.user.update({
    where: { id: userId },
    data: {
      name: GEANONIMISEERDE_NAAM,
      email: geanonimiseerdEmail(userId),
      // Geen geldige bcrypt-hash → geen enkele wachtwoordpoging slaagt ooit.
      passwordHash: `verwijderd:${randomBytes(32).toString("hex")}`,
    },
  });
}

/**
 * Verwerkt een verwijderverzoek van de gebruiker zelf: registreert een
 * PrivacyRequest (kind=verwijdering) en anonimiseert direct. De aanroeper
 * (server action) is verantwoordelijk voor het uitloggen van de sessie.
 */
export async function verwijderAccount(userId: string): Promise<void> {
  const nu = new Date();
  await prisma.$transaction(async (tx) => {
    await anonimiseerGebruiker(tx, userId, nu);
    await tx.privacyRequest.create({
      data: {
        userId,
        kind: "verwijdering",
        status: "afgerond",
        note: "Direct geanonimiseerd op eigen verzoek via /instellingen/privacy.",
        completedAt: nu,
      },
    });
  });
  await audit("privacy.verwijdering", "User", userId, { userId });
}

// ---------------------------------------------------------------------------
// Bewaartermijnen: opruimfuncties (droogloop standaard, geïnjecteerd "nu").
// ---------------------------------------------------------------------------

export interface RetentieResultaat {
  analyticsEvents: number;
  notificaties: number;
  outboxEmails: number;
  rateLimitCounters: number;
  draftProfielen: number;
}

export async function retentieAnalyticsEvents(nu: Date, apply: boolean): Promise<number> {
  const grens = maandenGeleden(nu, RETENTIE_ANALYTICS_EVENT_MAANDEN);
  const where = { createdAt: { lt: grens } };
  if (!apply) return prisma.analyticsEvent.count({ where });
  return (await prisma.analyticsEvent.deleteMany({ where })).count;
}

export async function retentieNotificaties(nu: Date, apply: boolean): Promise<number> {
  const grens = maandenGeleden(nu, RETENTIE_NOTIFICATIE_MAANDEN);
  const where = { createdAt: { lt: grens } };
  if (!apply) return prisma.notification.count({ where });
  return (await prisma.notification.deleteMany({ where })).count;
}

export async function retentieOutboxEmails(nu: Date, apply: boolean): Promise<number> {
  // createdAt als grens: verzending volgt vrijwel direct op aanmaak, en
  // createdAt is (anders dan sentAt) altijd gezet.
  const grens = maandenGeleden(nu, RETENTIE_OUTBOX_SENT_MAANDEN);
  const where = { status: "sent", createdAt: { lt: grens } } as const;
  if (!apply) return prisma.outboxEmail.count({ where });
  return (await prisma.outboxEmail.deleteMany({ where })).count;
}

export async function retentieRateLimitCounters(nu: Date, apply: boolean): Promise<number> {
  const grens = dagenGeleden(nu, RETENTIE_RATE_LIMIT_DAGEN);
  const where = { windowStart: { lt: grens } };
  if (!apply) return prisma.rateLimitCounter.count({ where });
  return (await prisma.rateLimitCounter.deleteMany({ where })).count;
}

/**
 * Anonimiseert kandidaatprofielen die al 18+ maanden in "draft" staan
 * (onboarding gestart, nooit afgemaakt of geactiveerd). Gebruikers met een
 * actief praktijk-membership worden overgeslagen: hun account is dan niet
 * "inactief", alleen het conceptprofiel — dat wordt wel verwijderd zodra de
 * eigenaar zelf om verwijdering vraagt.
 */
export async function retentieDraftProfielen(nu: Date, apply: boolean): Promise<number> {
  const grens = maandenGeleden(nu, RETENTIE_DRAFT_PROFIEL_MAANDEN);
  const kandidaten = await prisma.candidateProfile.findMany({
    where: {
      status: "draft",
      updatedAt: { lt: grens },
      user: { memberships: { none: { status: "active" } } },
    },
    select: { userId: true },
  });
  if (!apply) return kandidaten.length;

  let verwerkt = 0;
  for (const { userId } of kandidaten) {
    await prisma.$transaction(async (tx) => {
      await anonimiseerGebruiker(tx, userId, nu);
      await tx.privacyRequest.create({
        data: {
          userId,
          kind: "verwijdering",
          status: "afgerond",
          note: `Automatisch geanonimiseerd: draft-profiel > ${RETENTIE_DRAFT_PROFIEL_MAANDEN} maanden inactief.`,
          completedAt: nu,
        },
      });
    });
    await audit("privacy.retentie.draft_profiel", "User", userId);
    verwerkt += 1;
  }
  return verwerkt;
}

/** Draait alle opruimfuncties; apply=false (standaard) telt alleen. */
export async function runRetentie(
  nu: Date = new Date(),
  apply = false,
): Promise<RetentieResultaat> {
  const resultaat: RetentieResultaat = {
    analyticsEvents: await retentieAnalyticsEvents(nu, apply),
    notificaties: await retentieNotificaties(nu, apply),
    outboxEmails: await retentieOutboxEmails(nu, apply),
    rateLimitCounters: await retentieRateLimitCounters(nu, apply),
    draftProfielen: await retentieDraftProfielen(nu, apply),
  };
  if (apply) {
    await audit("privacy.retentie.run", "Platform", "retention", {
      meta: { ...resultaat, nu: nu.toISOString() },
    });
  }
  return resultaat;
}
