// Queries voor de publieke read-model-API (fase 8). Dit is de enige plek waar
// de publieke endpoints de database raken. Uitgangspunten:
// - uitsluitend gepubliceerde (of ooit gepubliceerde, inmiddels gesloten)
//   vacatures en actieve organisaties — NOOIT kandidaatdata;
// - slugs worden lazily toegekend aan bestaande gepubliceerde vacatures
//   zonder slug (ensureVacancySlug), zodat het contract altijd klopt;
// - filters op regio werken op de afgeleide provincie en worden daarom in
//   JS toegepast; alle andere filters gaan mee in de Prisma-query.

import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import { ensureVacancySlug } from "@/server/vacancies";
import {
  buildPublicTaxonomyView,
  regionForCity,
  toPublicJobSummary,
  toPublicJobView,
  toPublicPracticeView,
  type PublicJobSearchResult,
  type PublicJobView,
  type PublicMarketInsightItem,
  type PublicMarketInsightView,
  type PublicPracticeView,
  type PublicTaxonomyView,
  type VacancyMetContext,
} from "./read-models";

export const MAX_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Vacatures
// ---------------------------------------------------------------------------

export interface PublicJobFilters {
  /** Functiesleutel, bv. "mondhygienist". */
  role?: string;
  /** Plaatsnaam (hoofdletterongevoelig, exact). */
  city?: string;
  /** Provincie (hoofdletterongevoelig, exact) — afgeleid van de stad. */
  region?: string;
  /** Contractvorm, bv. "zzp". */
  employmentType?: string;
  /** Alleen vacatures die op of na dit moment zijn bijgewerkt. */
  updatedSince?: Date;
  /** Pagina (1-based); standaard 1. */
  page?: number;
  /** Paginagrootte (1–50); standaard 20. */
  pageSize?: number;
}

const VACANCY_INCLUDE = { location: true, organization: true } as const;

/** Slug garanderen (lazily toekennen aan oude gepubliceerde vacatures). */
async function metSlug(vacancy: VacancyMetContext): Promise<string> {
  return vacancy.slug ?? ensureVacancySlug(vacancy, vacancy.location.city);
}

/**
 * Gepubliceerde vacatures, gefilterd, gesorteerd op datePosted (nieuwste
 * eerst) en gepagineerd. Regiofilter loopt over de afgeleide provincie.
 */
export async function listPublicJobs(
  filters: PublicJobFilters = {},
): Promise<PublicJobSearchResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 20));

  const vacatures = (await prisma.vacancy.findMany({
    where: {
      status: "published",
      organization: { status: "active" },
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.employmentType ? { contractTypes: { has: filters.employmentType } } : {}),
      ...(filters.city
        ? { location: { city: { equals: filters.city, mode: "insensitive" } } }
        : {}),
      ...(filters.updatedSince ? { updatedAt: { gte: filters.updatedSince } } : {}),
    },
    include: VACANCY_INCLUDE,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  })) as VacancyMetContext[];

  const regio = filters.region?.trim().toLowerCase();
  const gefilterd = regio
    ? vacatures.filter((v) => regionForCity(v.location.city).toLowerCase() === regio)
    : vacatures;

  const paginaRijen = gefilterd.slice((page - 1) * pageSize, page * pageSize);
  const items = await Promise.all(
    paginaRijen.map(async (vacancy) => toPublicJobSummary(vacancy, await metSlug(vacancy))),
  );

  return { items, total: gefilterd.length, page, pageSize };
}

export type PublicJobLookup =
  | { kind: "not_found" }
  | { kind: "published"; job: PublicJobView }
  | { kind: "closed"; job: PublicJobView };

/**
 * Eén vacature op slug of ID. Uitkomsten:
 * - "published": open vacature, volledige weergave;
 * - "closed": ooit gepubliceerd maar inmiddels filled/expired/paused —
 *   de weergave heeft status "closed" (endpoint antwoordt 410);
 * - "not_found": onbekend, concept of nooit gepubliceerd (endpoint: 404).
 */
export async function getPublicJob(idOrSlug: string): Promise<PublicJobLookup> {
  const vacancy = (await prisma.vacancy.findFirst({
    where: {
      OR: [{ slug: idOrSlug }, { id: idOrSlug }],
      organization: { status: "active" },
    },
    include: VACANCY_INCLUDE,
  })) as VacancyMetContext | null;

  // Concepten en nooit-gepubliceerde vacatures bestaan publiek niet.
  if (!vacancy || vacancy.status === "draft" || vacancy.publishedAt === null) {
    return { kind: "not_found" };
  }

  const job = toPublicJobView(vacancy, await metSlug(vacancy));
  return vacancy.status === "published"
    ? { kind: "published", job }
    : { kind: "closed", job };
}

// ---------------------------------------------------------------------------
// Praktijken
// ---------------------------------------------------------------------------

/**
 * Publieke praktijkweergave op organisatie-slug: naam, (hoofd)locatie-
 * kenmerken en het aantal gepubliceerde vacatures. null bij onbekend of
 * niet-actief.
 */
export async function getPublicPractice(slug: string): Promise<PublicPracticeView | null> {
  const organization = await prisma.organization.findUnique({ where: { slug } });
  if (!organization || organization.status !== "active") return null;

  // Hoofdlocatie = oudste locatie (de eerste die is aangemaakt).
  const location = await prisma.practiceLocation.findFirst({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (!location) return null;

  const openJobs = await prisma.vacancy.count({
    where: { organizationId: organization.id, status: "published" },
  });

  return toPublicPracticeView(organization, location, openJobs);
}

// ---------------------------------------------------------------------------
// Taxonomie
// ---------------------------------------------------------------------------

export function getPublicTaxonomies(): PublicTaxonomyView {
  return buildPublicTaxonomyView();
}

// ---------------------------------------------------------------------------
// Marktinzichten (privacyveilig geaggregeerd)
// ---------------------------------------------------------------------------

/** "2026-07" voor een datum. */
function periodeVan(datum: Date): string {
  return `${datum.getUTCFullYear()}-${String(datum.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Geaggregeerde marktinzichten. Bron in volgorde van voorkeur:
 * 1. MarketInsightSnapshot-rijen (fase 6, parallelle werkstroom) van de
 *    meest recente periode — alleen rijen met sampleSize ≥ minimumgroep;
 * 2. anders een compacte eigen aggregatie over gepubliceerde vacatures
 *    (aantallen per functie en per provincie), waarbij groepen kleiner dan
 *    TALENT_RADAR_MIN_GROUP (5) worden weggelaten.
 * Er komt nooit een cijfer over individuen of kleine groepen naar buiten.
 */
export async function getPublicMarketInsights(): Promise<PublicMarketInsightView> {
  const nu = new Date();

  // 1) Snapshots van fase 6 hergebruiken wanneer die bestaan.
  const nieuwste = await prisma.marketInsightSnapshot.findFirst({
    orderBy: { period: "desc" },
    select: { period: true },
  });
  if (nieuwste) {
    const snapshots = await prisma.marketInsightSnapshot.findMany({
      where: { period: nieuwste.period, sampleSize: { gte: TALENT_RADAR_MIN_GROUP } },
      orderBy: [{ view: "asc" }, { dimensionKey: "asc" }],
    });
    if (snapshots.length > 0) {
      return {
        period: nieuwste.period,
        generatedAt: nu.toISOString(),
        minGroupSize: TALENT_RADAR_MIN_GROUP,
        insights: snapshots.map((snapshot) => ({
          view: snapshot.view,
          dimension: snapshot.dimensionKey,
          sampleSize: snapshot.sampleSize,
          data: naarCijfers(snapshot.data),
        })),
      };
    }
  }

  // 2) Eigen compacte aggregatie: open vacatures per functie en per regio.
  const vacatures = await prisma.vacancy.findMany({
    where: { status: "published", organization: { status: "active" } },
    select: { role: true, location: { select: { city: true } } },
  });

  const perFunctie = new Map<string, number>();
  const perRegio = new Map<string, number>();
  for (const vacature of vacatures) {
    perFunctie.set(vacature.role, (perFunctie.get(vacature.role) ?? 0) + 1);
    const regio = regionForCity(vacature.location.city);
    perRegio.set(regio, (perRegio.get(regio) ?? 0) + 1);
  }

  const insights: PublicMarketInsightItem[] = [];
  for (const [functie, aantal] of perFunctie) {
    if (aantal < TALENT_RADAR_MIN_GROUP) continue;
    insights.push({
      view: "open_vacatures_per_functie",
      dimension: functie,
      sampleSize: aantal,
      data: { openVacancies: aantal },
    });
  }
  for (const [regio, aantal] of perRegio) {
    if (aantal < TALENT_RADAR_MIN_GROUP) continue;
    insights.push({
      view: "open_vacatures_per_regio",
      dimension: regio,
      sampleSize: aantal,
      data: { openVacancies: aantal },
    });
  }

  return {
    period: periodeVan(nu),
    generatedAt: nu.toISOString(),
    minGroupSize: TALENT_RADAR_MIN_GROUP,
    insights,
  };
}

/** Snapshot-Json → alleen numerieke velden (defensief: nooit vrije tekst). */
function naarCijfers(waarde: unknown): Record<string, number> {
  const uit: Record<string, number> = {};
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const [sleutel, cijfer] of Object.entries(waarde)) {
      if (typeof cijfer === "number" && Number.isFinite(cijfer)) uit[sleutel] = cijfer;
    }
  }
  return uit;
}
