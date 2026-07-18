// Account health — servicelaag: verzamelt de feiten per organisatie uit de
// database (events, abonnementen, pipeline), roept het pure domein
// (src/domain/health) aan, schrijft een AccountHealthSnapshot en levert een
// lijst voor het interne dashboard.
//
// UITSLUITEND INTERN GEBRUIK: geen klantgerichte berichten en geen
// automatische contractwijzigingen — dit is een signaal voor het eigen team.
//
// AUTORISATIE: deze module is platformbreed (over alle tenants heen) en mag
// daarom ALLEEN worden aangeroepen nadat de pagina of route handler
// requirePlatformAdmin() heeft gedaan. De afdwinging gebeurt bewust in de
// pagina, zodat de module ook in scripts en tests bruikbaar is.

import { Prisma } from "@prisma/client";
import {
  computeAccountHealth,
  type AccountHealth,
  type AccountHealthInput,
  type AccountHealthReason,
  type AccountHealthStatus,
  type Gebruikstrend,
} from "@/domain/health";
import { effectiveEntitlements, getActiveSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { responseStatsForOrg } from "@/server/response-stats";

const DAG_MS = 86_400_000;

/** Eventnamen die als "matches/kandidaatinzichten bekeken" tellen. */
const MATCH_EVENTNAMEN = ["match_viewed", "talent_radar_viewed", "opportunity_viewed"];

/** Hele dagen tussen twee momenten (naar beneden afgerond, minimaal 0). */
function dagenTussen(van: Date, tot: Date): number {
  return Math.max(0, Math.floor((tot.getTime() - van.getTime()) / DAG_MS));
}

/**
 * Gebruikstrend: aantal analytics-events in de laatste 30 dagen vergeleken
 * met de 30 dagen daarvoor. ≥ 20% meer → stijgend; ≥ 20% minder → dalend;
 * anders (of allebei nul) stabiel.
 */
function bepaalTrend(recent: number, ervoor: number): Gebruikstrend {
  if (recent === 0 && ervoor === 0) return "stabiel";
  if (ervoor === 0) return "stijgend";
  if (recent >= ervoor * 1.2) return "stijgend";
  if (recent <= ervoor * 0.8) return "dalend";
  return "stabiel";
}

/**
 * Verzamelt het feitenobject voor één organisatie. Puur lezen — er wordt
 * niets geschreven of gewijzigd.
 */
export async function collectAccountHealthInput(
  orgId: string,
  now: Date = new Date(),
): Promise<AccountHealthInput> {
  const d30 = new Date(now.getTime() - 30 * DAG_MS);
  const d60 = new Date(now.getTime() - 60 * DAG_MS);
  const d90 = new Date(now.getTime() - 90 * DAG_MS);

  const [
    org,
    laatsteEvent,
    actieveSeats,
    actieveLocaties,
    actieveVacatures,
    matchesBekeken30d,
    simulaties30d,
    uitnodigingen30d,
    gesprekken90d,
    plaatsingen90d,
    plannerEvents30d,
    plannerScenarios30d,
    events30d,
    events30tot60d,
    effectief,
    abonnement,
    responseStats,
  ] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { activatedAt: true },
    }),
    prisma.analyticsEvent.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.membership.count({ where: { organizationId: orgId, status: "active" } }),
    prisma.practiceLocation.count({ where: { organizationId: orgId } }),
    prisma.vacancy.count({ where: { organizationId: orgId, status: "published" } }),
    prisma.analyticsEvent.count({
      where: {
        organizationId: orgId,
        name: { in: MATCH_EVENTNAMEN },
        createdAt: { gte: d30 },
      },
    }),
    prisma.analyticsEvent.count({
      where: {
        organizationId: orgId,
        name: "match_simulation_run",
        createdAt: { gte: d30 },
      },
    }),
    prisma.invitation.count({
      where: { vacancy: { organizationId: orgId }, createdAt: { gte: d30 } },
    }),
    prisma.interview.count({
      where: {
        vacancyId: { in: await vacatureIds(orgId) },
        createdAt: { gte: d90 },
      },
    }),
    prisma.application.count({
      where: {
        vacancy: { organizationId: orgId },
        status: "hired",
        updatedAt: { gte: d90 },
      },
    }),
    prisma.analyticsEvent.count({
      where: {
        organizationId: orgId,
        name: "capacity_planner_viewed",
        createdAt: { gte: d30 },
      },
    }),
    prisma.staffingScenario.count({
      where: { organizationId: orgId, createdAt: { gte: d30 } },
    }),
    prisma.analyticsEvent.count({
      where: { organizationId: orgId, createdAt: { gte: d30 } },
    }),
    prisma.analyticsEvent.count({
      where: { organizationId: orgId, createdAt: { gte: d60, lt: d30 } },
    }),
    effectiveEntitlements(orgId),
    getActiveSubscription(orgId),
    responseStatsForOrg(orgId),
  ]);

  return {
    onboardingVoltooid: org.activatedAt !== null,
    laatsteActiviteitDagen: laatsteEvent
      ? dagenTussen(laatsteEvent.createdAt, now)
      : null,
    actieveSeats,
    actieveLocaties,
    actieveVacatures,
    matchesBekeken30d,
    simulaties30d,
    uitnodigingen30d,
    responseRate: responseStats.responseRate.value,
    gesprekken90d,
    plaatsingen90d,
    bezettingsplannerGebruik30d: plannerEvents30d + plannerScenarios30d,
    // Marktinzichten (fase 6) hebben nog geen per-organisatie events; tot die
    // er zijn is dit feit 0 en weegt het niet mee.
    marktinzichtenGebruik30d: 0,
    betaalstatus: effectief.status,
    gebruikstrend: bepaalTrend(events30d, events30tot60d),
    dagenTotVerlenging: abonnement
      ? Math.max(
          0,
          Math.ceil((abonnement.currentPeriodEnd.getTime() - now.getTime()) / DAG_MS),
        )
      : null,
  };
}

/** Vacature-ID's van een organisatie (Interview heeft geen org-relatie). */
async function vacatureIds(orgId: string): Promise<string[]> {
  const rijen = await prisma.vacancy.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  return rijen.map((r) => r.id);
}

/**
 * Herberekent de gezondheid van één organisatie, schrijft een
 * AccountHealthSnapshot en geeft het resultaat terug.
 */
export async function recomputeAccountHealth(
  orgId: string,
  now: Date = new Date(),
): Promise<AccountHealth> {
  const input = await collectAccountHealthInput(orgId, now);
  const health = computeAccountHealth(input, now);
  await prisma.accountHealthSnapshot.create({
    data: {
      organizationId: orgId,
      status: health.status,
      score: health.score,
      reasons: health.reasons as unknown as Prisma.InputJsonValue,
      version: health.version,
      calculatedAt: health.calculatedAt,
    },
  });
  return health;
}

/** Herberekent alle actieve organisaties; geeft het aantal verwerkte terug. */
export async function recomputeAllAccountHealth(
  now: Date = new Date(),
): Promise<number> {
  const orgs = await prisma.organization.findMany({
    where: { status: "active" },
    select: { id: true },
  });
  for (const org of orgs) {
    await recomputeAccountHealth(org.id, now);
  }
  return orgs.length;
}

// ---------- lijst voor het interne dashboard ----------

export interface AccountHealthListRow {
  organizationId: string;
  naam: string;
  slug: string;
  /** null wanneer er nog nooit een snapshot is berekend. */
  status: AccountHealthStatus | null;
  score: number | null;
  reasons: AccountHealthReason[];
  version: string | null;
  calculatedAt: Date | null;
  laatsteActiviteit: Date | null;
  verlengdatum: Date | null;
}

const HEALTH_STATUSSEN: ReadonlySet<string> = new Set([
  "healthy",
  "attention",
  "at_risk",
  "onboarding_incomplete",
]);

function alsStatus(waarde: string): AccountHealthStatus | null {
  return HEALTH_STATUSSEN.has(waarde) ? (waarde as AccountHealthStatus) : null;
}

function alsReasons(waarde: Prisma.JsonValue): AccountHealthReason[] {
  if (!Array.isArray(waarde)) return [];
  return waarde.flatMap((item) => {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).code === "string" &&
      typeof (item as Record<string, unknown>).uitleg === "string" &&
      typeof (item as Record<string, unknown>).impact === "number"
    ) {
      const r = item as { code: string; uitleg: string; impact: number };
      return [{ code: r.code, uitleg: r.uitleg, impact: r.impact }];
    }
    return [];
  });
}

/**
 * Lijst voor intern gebruik: per actieve organisatie de laatste snapshot
 * (status, score, redenen), de laatste activiteit en de verlengdatum.
 * ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function listAccountHealth(): Promise<AccountHealthListRow[]> {
  const orgs = await prisma.organization.findMany({
    where: { status: "active" },
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  return Promise.all(
    orgs.map(async (org) => {
      const [snapshot, laatsteEvent, abonnement] = await Promise.all([
        prisma.accountHealthSnapshot.findFirst({
          where: { organizationId: org.id },
          orderBy: { calculatedAt: "desc" },
        }),
        prisma.analyticsEvent.findFirst({
          where: { organizationId: org.id },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        prisma.subscription.findFirst({
          where: { organizationId: org.id, status: { not: "canceled" } },
          orderBy: { createdAt: "desc" },
          select: { currentPeriodEnd: true },
        }),
      ]);

      return {
        organizationId: org.id,
        naam: org.name,
        slug: org.slug,
        status: snapshot ? alsStatus(snapshot.status) : null,
        score: snapshot?.score ?? null,
        reasons: snapshot ? alsReasons(snapshot.reasons) : [],
        version: snapshot?.version ?? null,
        calculatedAt: snapshot?.calculatedAt ?? null,
        laatsteActiviteit: laatsteEvent?.createdAt ?? null,
        verlengdatum: abonnement?.currentPeriodEnd ?? null,
      };
    }),
  );
}
