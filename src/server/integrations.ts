// Integratiebeheer (fase 9): API-sleutels, webhook-subscriptions en
// exportjobs voor één organisatie, plus de datafuncties achter de private
// integratie-API (/api/public/v1/org/*).
//
// Twee soorten functies, met verschillende autorisatie:
// - beheer (OrgContext): vereist capability org.manage én het entitlement
//   api_access (enforceEntitlement) — aangeroepen vanuit de integratiepagina;
// - org-API-data (organizationId): aangeroepen vanuit routes die de
//   organisatie al via een geverifieerde API-sleutel (verifyApiKey + scope)
//   hebben vastgesteld. Alle queries zijn op dat organizationId gescoped;
//   data van een andere organisatie is per constructie onbereikbaar.
//
// Privacy: kandidaatnamen verschijnen in API-responses en exports uitsluitend
// wanneer er een actieve CandidateConsent (scope contact_details) richting
// deze organisatie bestaat — dezelfde consentregel als de pipeline-UI.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApiKey, ExportJob, WebhookSubscription } from "@prisma/client";
import { AuthzError, roleCan, type OrgContext } from "@/lib/authz";
import {
  isApiScope,
  mintApiKey,
  type ApiScope,
} from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { enforceEntitlement } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  isWebhookEvent,
  subscribeWebhook,
  type WebhookEvent,
} from "@/lib/webhooks";
import { castStaffingTarget, castTeamSchedule } from "@/server/capacity";
import { ensureVacancySlug } from "@/server/vacancies";
import { DAYPARTS, WEEKDAYS, label, type Daypart, type Weekday } from "@/domain/taxonomy";

// ---------------------------------------------------------------------------
// Autorisatie-hulpfunctie voor beheer
// ---------------------------------------------------------------------------

/** Beheer vereist org.manage (owner/admin) én het entitlement api_access. */
async function vereisIntegratiebeheer(ctx: OrgContext): Promise<void> {
  if (!roleCan(ctx.role, "org.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag geen integraties beheren`, 403);
  }
  await enforceEntitlement(ctx.organizationId, "api_access");
}

// ---------------------------------------------------------------------------
// API-sleutels
// ---------------------------------------------------------------------------

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** Volledige sleutel — wordt PRECIES ÉÉN KEER getoond, daarna alleen de hash. */
  plaintext: string;
}

/** Alle sleutels van de organisatie (zonder hash), nieuwste eerst. */
export async function listApiKeys(ctx: OrgContext): Promise<ApiKey[]> {
  await vereisIntegratiebeheer(ctx);
  return prisma.apiKey.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
  });
}

/** Maakt een sleutel met gekozen scopes; geeft de plaintext één keer terug. */
export async function createApiKeyForOrg(
  ctx: OrgContext,
  name: string,
  scopes: ApiScope[],
): Promise<CreatedApiKey> {
  await vereisIntegratiebeheer(ctx);
  const naam = name.trim();
  if (!naam) throw new AuthzError("Geef de sleutel een naam", 400);
  const geldigeScopes = [...new Set(scopes)].filter(isApiScope);
  if (geldigeScopes.length === 0) {
    throw new AuthzError("Kies minstens één scope", 400);
  }

  const materiaal = mintApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: naam,
      prefix: materiaal.prefix,
      hashedKey: materiaal.hashedKey,
      scopes: geldigeScopes,
    },
  });

  await audit("api_key.create", "ApiKey", apiKey.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { name: naam, prefix: materiaal.prefix, scopes: geldigeScopes },
  });

  return { apiKey, plaintext: materiaal.plaintext };
}

/** Sleutel binnen de eigen organisatie opzoeken; anders 404. */
async function eigenApiKey(ctx: OrgContext, apiKeyId: string): Promise<ApiKey> {
  const sleutel = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, organizationId: ctx.organizationId },
  });
  if (!sleutel) throw new AuthzError("API-sleutel niet gevonden", 404);
  return sleutel;
}

/**
 * Rotatie: maakt een nieuwe sleutel met dezelfde naam en scopes en trekt de
 * oude direct in. De nieuwe plaintext wordt één keer teruggegeven.
 */
export async function rotateApiKey(
  ctx: OrgContext,
  apiKeyId: string,
): Promise<CreatedApiKey> {
  await vereisIntegratiebeheer(ctx);
  const oud = await eigenApiKey(ctx, apiKeyId);
  if (oud.revokedAt) throw new AuthzError("Deze sleutel is al ingetrokken", 400);

  const materiaal = mintApiKey();
  const [, nieuw] = await prisma.$transaction([
    prisma.apiKey.update({ where: { id: oud.id }, data: { revokedAt: new Date() } }),
    prisma.apiKey.create({
      data: {
        organizationId: ctx.organizationId,
        name: oud.name,
        prefix: materiaal.prefix,
        hashedKey: materiaal.hashedKey,
        scopes: oud.scopes,
      },
    }),
  ]);

  await audit("api_key.rotate", "ApiKey", nieuw.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { oldPrefix: oud.prefix, newPrefix: materiaal.prefix },
  });

  return { apiKey: nieuw, plaintext: materiaal.plaintext };
}

/** Intrekken: zet revokedAt — verificatie weigert de sleutel daarna direct. */
export async function revokeApiKey(ctx: OrgContext, apiKeyId: string): Promise<void> {
  await vereisIntegratiebeheer(ctx);
  const sleutel = await eigenApiKey(ctx, apiKeyId);
  if (sleutel.revokedAt) return; // al ingetrokken — idempotent

  await prisma.apiKey.update({
    where: { id: sleutel.id },
    data: { revokedAt: new Date() },
  });
  await audit("api_key.revoke", "ApiKey", sleutel.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { prefix: sleutel.prefix },
  });
}

// ---------------------------------------------------------------------------
// Webhook-subscriptions
// ---------------------------------------------------------------------------

export type WebhookSubscriptionOverzicht = Omit<WebhookSubscription, "secret"> & {
  deliveries: Array<{
    id: string;
    event: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    deliveredAt: Date | null;
  }>;
};

/** Subscriptions mét recente deliveries; het secret gaat nooit mee terug. */
export async function listWebhookSubscriptions(
  ctx: OrgContext,
): Promise<WebhookSubscriptionOverzicht[]> {
  await vereisIntegratiebeheer(ctx);
  const rijen = await prisma.webhookSubscription.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          event: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          deliveredAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  // Secret expliciet weglaten: die is alleen bij aanmaak zichtbaar.
  return rijen.map(({ secret: _secret, ...rest }) => rest);
}

export interface CreatedWebhookSubscriptionResult {
  subscriptionId: string;
  url: string;
  events: string[];
  /** Signing-secret — wordt PRECIES ÉÉN KEER getoond. */
  secret: string;
}

/** Nieuwe subscription; het signing-secret wordt één keer teruggegeven. */
export async function createWebhookSubscriptionForOrg(
  ctx: OrgContext,
  url: string,
  events: WebhookEvent[],
): Promise<CreatedWebhookSubscriptionResult> {
  await vereisIntegratiebeheer(ctx);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AuthzError("Ongeldige webhook-URL", 400);
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new AuthzError("De webhook-URL moet http(s) zijn", 400);
  }
  const geldigeEvents = [...new Set(events)].filter(isWebhookEvent);
  if (geldigeEvents.length === 0) throw new AuthzError("Kies minstens één event", 400);

  const { subscription, secret } = await subscribeWebhook(
    ctx.organizationId,
    parsedUrl.toString(),
    geldigeEvents,
  );

  await audit("webhook.subscribe", "WebhookSubscription", subscription.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { url: subscription.url, events: geldigeEvents },
  });

  return {
    subscriptionId: subscription.id,
    url: subscription.url,
    events: subscription.events,
    secret,
  };
}

/** Subscription (de)activeren binnen de eigen organisatie. */
export async function setWebhookSubscriptionActive(
  ctx: OrgContext,
  subscriptionId: string,
  active: boolean,
): Promise<void> {
  await vereisIntegratiebeheer(ctx);
  const rij = await prisma.webhookSubscription.findFirst({
    where: { id: subscriptionId, organizationId: ctx.organizationId },
  });
  if (!rij) throw new AuthzError("Webhook-subscription niet gevonden", 404);

  await prisma.webhookSubscription.update({
    where: { id: rij.id },
    data: { active },
  });
  await audit(active ? "webhook.activate" : "webhook.deactivate", "WebhookSubscription", rij.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
}

// ---------------------------------------------------------------------------
// Exportjobs (CSV)
// ---------------------------------------------------------------------------

export const EXPORT_KINDS = ["vacatures", "pipeline", "bezetting"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isExportKind(waarde: unknown): waarde is ExportKind {
  return (EXPORT_KINDS as readonly string[]).includes(waarde as string);
}

/** Basismap voor exports: .exports/ in de projectroot (gitignored). */
function exportsBasis(): string {
  return path.join(process.cwd(), ".exports");
}

function csvVeld(waarde: string | number | null | undefined): string {
  const tekst = waarde === null || waarde === undefined ? "" : String(waarde);
  return /[";\n\r]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
}

function csvRegels(rijen: Array<Array<string | number | null | undefined>>): string {
  return rijen.map((rij) => rij.map(csvVeld).join(";")).join("\r\n") + "\r\n";
}

export async function listExportJobs(ctx: OrgContext): Promise<ExportJob[]> {
  await vereisIntegratiebeheer(ctx);
  return prisma.exportJob.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

/**
 * Maakt een ExportJob (pending) en verwerkt hem direct synchroon: de CSV
 * wordt naar .exports/<orgId>/<jobId>.csv geschreven (tijdelijk pad,
 * gitignored) en de job gaat naar done met resultPath. In productie hoort
 * verwerking in een achtergrondjob; voor de beta is synchroon voldoende.
 */
export async function createAndRunExportJob(
  ctx: OrgContext,
  kind: ExportKind,
): Promise<ExportJob> {
  await vereisIntegratiebeheer(ctx);
  if (!isExportKind(kind)) throw new AuthzError("Onbekend exporttype", 400);

  const job = await prisma.exportJob.create({
    data: {
      organizationId: ctx.organizationId,
      kind,
      status: "pending",
      requestedByUserId: ctx.user.id,
    },
  });

  try {
    await prisma.exportJob.update({ where: { id: job.id }, data: { status: "running" } });
    const csv = await bouwCsv(ctx.organizationId, kind);

    const map = path.join(exportsBasis(), ctx.organizationId);
    await mkdir(map, { recursive: true });
    const bestandsPad = path.join(map, `${job.id}.csv`);
    await writeFile(bestandsPad, "\uFEFF" + csv, "utf-8"); // BOM voor Excel

    const klaar = await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "done", resultPath: bestandsPad, completedAt: new Date() },
    });
    await audit("export.run", "ExportJob", job.id, {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      meta: { kind },
    });
    return klaar;
  } catch (fout) {
    console.error(`Exportjob ${job.id} mislukt:`, fout);
    return prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "failed", completedAt: new Date() },
    });
  }
}

/** Inhoud van een afgeronde export teruglezen (voor de downloadactie). */
export async function readExportContent(
  ctx: OrgContext,
  jobId: string,
): Promise<{ filename: string; content: string }> {
  await vereisIntegratiebeheer(ctx);
  const job = await prisma.exportJob.findFirst({
    where: { id: jobId, organizationId: ctx.organizationId },
  });
  if (!job || job.status !== "done" || !job.resultPath) {
    throw new AuthzError("Export niet gevonden of nog niet klaar", 404);
  }
  const content = await readFile(job.resultPath, "utf-8");
  return { filename: `${job.kind}-${job.id}.csv`, content };
}

/** CSV-inhoud per exporttype, gescoped op de organisatie. */
async function bouwCsv(organizationId: string, kind: ExportKind): Promise<string> {
  if (kind === "vacatures") {
    const vacatures = await prisma.vacancy.findMany({
      where: { organizationId },
      include: { location: true },
      orderBy: { createdAt: "desc" },
    });
    return csvRegels([
      ["id", "slug", "titel", "functie", "status", "stad", "urenMin", "urenMax", "contractvormen", "gepubliceerdOp"],
      ...vacatures.map((v) => [
        v.id,
        v.slug,
        v.title,
        label(v.role),
        v.status,
        v.location.city,
        v.hoursMin,
        v.hoursMax,
        v.contractTypes.join(", "),
        v.publishedAt?.toISOString() ?? "",
      ]),
    ]);
  }

  if (kind === "pipeline") {
    const applications = await prisma.application.findMany({
      where: { vacancy: { organizationId } },
      include: { vacancy: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    });
    const consent = await consentSet(organizationId);
    const namen = await kandidaatNamen(
      applications
        .filter((a) => consentDekt(consent, a.candidateUserId, a.vacancyId))
        .map((a) => a.candidateUserId),
    );
    return csvRegels([
      ["applicationId", "vacancyId", "vacature", "status", "kandidaat", "aangemaaktOp"],
      ...applications.map((a) => [
        a.id,
        a.vacancy.id,
        a.vacancy.title,
        a.status,
        // Naam alleen met actieve consent; anders pseudoniem.
        namen.get(a.candidateUserId) ?? "anoniem",
        a.createdAt.toISOString(),
      ]),
    ]);
  }

  // bezetting
  const locaties = await prisma.practiceLocation.findMany({
    where: { organizationId },
    include: { teamMembers: true },
    orderBy: { createdAt: "asc" },
  });
  return csvRegels([
    ["locatie", "teamlid", "functie", "contracturen", "dienstverband"],
    ...locaties.flatMap((locatie) =>
      locatie.teamMembers.map((lid) => [
        locatie.name,
        lid.name,
        label(lid.role),
        lid.contractHours,
        lid.employmentType ?? "",
      ]),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Consent-hulpfuncties (zelfde regel als de pipeline-UI)
// ---------------------------------------------------------------------------

/**
 * Actieve consents (scope contact_details) richting deze organisatie als
 * opzoek-set: "<kandidaat>:" (organisatiebreed) of "<kandidaat>:<vacature>".
 */
async function consentSet(organizationId: string): Promise<Set<string>> {
  const rijen = await prisma.candidateConsent.findMany({
    where: { organizationId, scope: "contact_details", revokedAt: null },
    select: { candidateUserId: true, vacancyId: true },
  });
  return new Set(rijen.map((r) => `${r.candidateUserId}:${r.vacancyId ?? ""}`));
}

function consentDekt(
  consents: Set<string>,
  candidateUserId: string,
  vacancyId: string | null,
): boolean {
  return (
    consents.has(`${candidateUserId}:`) ||
    (vacancyId !== null && consents.has(`${candidateUserId}:${vacancyId}`))
  );
}

/** Namen van kandidaten mét consent, in één query. */
async function kandidaatNamen(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ---------------------------------------------------------------------------
// Org-API-data (aangeroepen na verifyApiKey + requireScope)
// ---------------------------------------------------------------------------

/** GET /org/vacancies (scope jobs:read): alle vacatures van de organisatie. */
export async function orgVacanciesForApi(organizationId: string) {
  const vacatures = await prisma.vacancy.findMany({
    where: { organizationId },
    include: { location: { select: { city: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    items: await Promise.all(
      vacatures.map(async (v) => ({
        id: v.id,
        slug:
          v.slug ??
          (v.status === "published" ? await ensureVacancySlug(v, v.location.city) : null),
        title: v.title,
        role: v.role,
        status: v.status,
        city: v.location.city,
        hoursMin: v.hoursMin,
        hoursMax: v.hoursMax,
        employmentTypes: v.contractTypes,
        publishedAt: v.publishedAt?.toISOString() ?? null,
        updatedAt: v.updatedAt.toISOString(),
      })),
    ),
  };
}

/**
 * GET /org/applications (scope pipeline:read): sollicitaties op vacatures van
 * de organisatie. Kandidaatnaam alleen bij actieve consent (contact_details);
 * anders alleen het pseudonieme candidateId.
 */
export async function orgApplicationsForApi(organizationId: string) {
  const applications = await prisma.application.findMany({
    where: { vacancy: { organizationId } },
    orderBy: { createdAt: "desc" },
  });
  const consents = await consentSet(organizationId);
  const namen = await kandidaatNamen(
    applications
      .filter((a) => consentDekt(consents, a.candidateUserId, a.vacancyId))
      .map((a) => a.candidateUserId),
  );
  return {
    items: applications.map((a) => {
      const consent = consentDekt(consents, a.candidateUserId, a.vacancyId);
      return {
        id: a.id,
        vacancyId: a.vacancyId,
        status: a.status,
        candidate: {
          id: a.candidateUserId, // pseudoniem
          name: consent ? (namen.get(a.candidateUserId) ?? null) : null,
          consent,
        },
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      };
    }),
  };
}

/** GET /org/interviews (scope pipeline:read): gesprekken op eigen vacatures. */
export async function orgInterviewsForApi(organizationId: string) {
  const vacancyIds = (
    await prisma.vacancy.findMany({ where: { organizationId }, select: { id: true } })
  ).map((v) => v.id);
  const interviews = vacancyIds.length
    ? await prisma.interview.findMany({
        where: { vacancyId: { in: vacancyIds } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  return {
    items: interviews.map((i) => ({
      id: i.id,
      vacancyId: i.vacancyId,
      candidateId: i.candidateUserId, // pseudoniem — geen naam zonder consent
      status: i.status,
      chosenSlot: i.chosenSlot?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
  };
}

/** GET /org/placements (scope pipeline:read): aangenomen kandidaten (hired). */
export async function orgPlacementsForApi(organizationId: string) {
  const placements = await prisma.application.findMany({
    where: { vacancy: { organizationId }, status: "hired" },
    include: { vacancy: { select: { id: true, title: true, role: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const consents = await consentSet(organizationId);
  const namen = await kandidaatNamen(
    placements
      .filter((p) => consentDekt(consents, p.candidateUserId, p.vacancyId))
      .map((p) => p.candidateUserId),
  );
  return {
    items: placements.map((p) => {
      const consent = consentDekt(consents, p.candidateUserId, p.vacancyId);
      return {
        id: p.id,
        vacancyId: p.vacancy.id,
        vacancyTitle: p.vacancy.title,
        role: p.vacancy.role,
        candidate: {
          id: p.candidateUserId,
          name: consent ? (namen.get(p.candidateUserId) ?? null) : null,
          consent,
        },
        hiredAt: p.updatedAt.toISOString(),
      };
    }),
  };
}

/**
 * GET /org/capacity-gaps (scope capacity:read): dagdelen waar de gewenste
 * minimale bezetting nu niet wordt gehaald. Vereenvoudigde momentopname:
 * teamleden tellen mee op hun vaste werkdagen, tenzij ze op dit moment
 * afwezig zijn (absentFrom/absentUntil of een TeamAbsence die nu loopt) of
 * hun start-/einddatum buiten vandaag valt.
 */
export async function orgCapacityGapsForApi(organizationId: string) {
  const nu = new Date();
  const locaties = await prisma.practiceLocation.findMany({
    where: { organizationId },
    include: { teamMembers: { include: { absences: true } } },
    orderBy: { createdAt: "asc" },
  });

  const gaps: Array<{
    locationId: string;
    locationName: string;
    day: Weekday;
    daypart: Daypart;
    present: number;
    target: number;
  }> = [];

  for (const locatie of locaties) {
    const target = castStaffingTarget(locatie.staffingTarget);
    const actieveTeamleden = locatie.teamMembers.filter((lid) => {
      if (lid.startDate && lid.startDate > nu) return false;
      if (lid.endDate && lid.endDate < nu) return false;
      if (lid.absentFrom && lid.absentFrom <= nu && (!lid.absentUntil || lid.absentUntil >= nu)) {
        return false;
      }
      return !lid.absences.some(
        (afwezigheid) => afwezigheid.from <= nu && (!afwezigheid.until || afwezigheid.until >= nu),
      );
    });
    const roosters = actieveTeamleden.map((lid) => castTeamSchedule(lid.schedule));

    for (const dag of WEEKDAYS) {
      for (const dagdeel of DAYPARTS) {
        const gewenst = target[dag][dagdeel];
        if (gewenst <= 0) continue;
        const aanwezig = roosters.filter((rooster) => rooster[dag][dagdeel]).length;
        if (aanwezig < gewenst) {
          gaps.push({
            locationId: locatie.id,
            locationName: locatie.name,
            day: dag,
            daypart: dagdeel,
            present: aanwezig,
            target: gewenst,
          });
        }
      }
    }
  }

  return { items: gaps };
}
