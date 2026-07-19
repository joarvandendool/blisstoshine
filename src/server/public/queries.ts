// Queries voor de publieke read-model-API (fase 8). Dit is de enige plek waar
// de publieke endpoints de database raken. Uitgangspunten:
// - uitsluitend gepubliceerde (of ooit gepubliceerde, inmiddels gesloten)
//   vacatures en actieve organisaties — NOOIT kandidaatdata;
// - slugs worden lazily toegekend aan bestaande gepubliceerde vacatures
//   zonder slug (ensureVacancySlug), zodat het contract altijd klopt;
// - filters op regio werken op de afgeleide provincie en worden daarom in
//   JS toegepast; alle andere filters gaan mee in de Prisma-query.

import type { Weekday } from "@/domain/taxonomy";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import { castCriteria, castSchedule, ensureVacancySlug } from "@/server/vacancies";
import {
  buildPublicTaxonomyView,
  regionForCity,
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
  /**
   * Plaats of regio: hoofdletterongevoelige deelmatch op "stad provincie"
   * (dezelfde semantiek als de openbare site) — "utrecht", "Zuid-Holland"
   * en "utre" matchen dus allemaal.
   */
  city?: string;
  /** Provincie (hoofdletterongevoelig, exact) — afgeleid van de stad. */
  region?: string;
  /**
   * Gevraagde werkdagen: een vacature matcht wanneer hij ál deze dagen
   * vraagt (required of preferred), niet slechts één ervan.
   */
  days?: Weekday[];
  /** Urenrange: overlap met hoursMin–hoursMax van de vacature. */
  hoursMin?: number;
  hoursMax?: number;
  /** Contractvorm, bv. "zzp". */
  employmentType?: string;
  /** Apparatuur-taxonomiesleutel uit de vacaturecriteria. */
  equipment?: string;
  /** Software-taxonomiesleutel uit de vacaturecriteria. */
  software?: string;
  /** Specialisatie-taxonomiesleutel uit de vacaturecriteria. */
  specialization?: string;
  /** Organisatie-slug: alleen vacatures van deze praktijk. */
  organization?: string;
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

/** Bevat het criterium deze taxonomiesleutel? Geen filter = altijd waar. */
function criteriumBevat(values: string[] | undefined, sleutel?: string): boolean {
  if (!sleutel) return true;
  return (values ?? []).includes(sleutel);
}

/**
 * Filters die niet (efficiënt) in Prisma kunnen: afgeleide provincie,
 * deelmatch op "stad provincie", werkdagen uit het Json-rooster, urenoverlap
 * en criteria-sleutels. Zelfde semantiek als de openbare-site-filterbalk.
 */
function matchtJsFilters(vacancy: VacancyMetContext, filters: PublicJobFilters): boolean {
  if (filters.region) {
    const regio = filters.region.trim().toLowerCase();
    if (regionForCity(vacancy.location.city).toLowerCase() !== regio) return false;
  }
  if (filters.city) {
    const zoek = filters.city.trim().toLowerCase();
    const doel =
      `${vacancy.location.city} ${regionForCity(vacancy.location.city)}`.toLowerCase();
    if (!doel.includes(zoek)) return false;
  }
  if (filters.days && filters.days.length > 0) {
    const rooster = castSchedule(vacancy.schedule);
    const gevraagd = (dag: Weekday) =>
      Object.values(rooster[dag]).some((eis) => eis !== null);
    if (!filters.days.every(gevraagd)) return false;
  }
  // Urenrange: overlap tussen het gevraagde bereik en de vacature.
  if (filters.hoursMin !== undefined && vacancy.hoursMax < filters.hoursMin) return false;
  if (filters.hoursMax !== undefined && vacancy.hoursMin > filters.hoursMax) return false;
  if (filters.equipment || filters.software || filters.specialization) {
    const criteria = castCriteria(vacancy.criteria);
    if (!criteriumBevat(criteria.equipment?.values, filters.equipment)) return false;
    if (!criteriumBevat(criteria.software?.values, filters.software)) return false;
    if (!criteriumBevat(criteria.specializations?.values, filters.specialization)) {
      return false;
    }
  }
  return true;
}

/**
 * Alle gepubliceerde vacatures die aan de filters voldoen, gesorteerd op
 * datePosted (nieuwste eerst). Bouwsteen voor listPublicJobs én de
 * site-datalaag (site-queries.ts), die zelf pagineert/klemt.
 */
export async function zoekGepubliceerdeVacatures(
  filters: PublicJobFilters = {},
): Promise<VacancyMetContext[]> {
  const vacatures = (await prisma.vacancy.findMany({
    where: {
      status: "published",
      organization: {
        status: "active",
        ...(filters.organization ? { slug: filters.organization } : {}),
      },
      ...(filters.role ? { role: filters.role } : {}),
      ...(filters.employmentType ? { contractTypes: { has: filters.employmentType } } : {}),
      ...(filters.updatedSince ? { updatedAt: { gte: filters.updatedSince } } : {}),
    },
    include: VACANCY_INCLUDE,
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
  })) as VacancyMetContext[];

  return vacatures.filter((vacancy) => matchtJsFilters(vacancy, filters));
}

/**
 * Gepubliceerde vacatures, gefilterd, gesorteerd op datePosted (nieuwste
 * eerst) en gepagineerd. Een pagina buiten bereik geeft een lege items-lijst
 * (bestaand API-gedrag; de site-datalaag klemt zelf op totalPages).
 */
export async function listPublicJobs(
  filters: PublicJobFilters = {},
): Promise<PublicJobSearchResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 20));

  const gefilterd = await zoekGepubliceerdeVacatures(filters);

  const paginaRijen = gefilterd.slice((page - 1) * pageSize, page * pageSize);
  const items = await Promise.all(
    paginaRijen.map(async (vacancy) => toPublicJobView(vacancy, await metSlug(vacancy))),
  );

  return {
    items,
    total: gefilterd.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(gefilterd.length / pageSize)),
  };
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
 * Bouwt de publieke praktijkweergave voor een organisatie waarvan al
 * vaststaat dat ze actief is en publicatie-consent heeft. null zonder
 * locaties (een praktijk zonder locatie is publiek niet representeerbaar).
 */
async function bouwPracticeView(
  organization: NonNullable<Awaited<ReturnType<typeof prisma.organization.findUnique>>>,
): Promise<PublicPracticeView | null> {
  // Hoofdlocatie = oudste locatie (de eerste die is aangemaakt).
  const locations = await prisma.practiceLocation.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "asc" },
  });
  if (locations.length === 0) return null;

  const gepubliceerd = await prisma.vacancy.findMany({
    where: { organizationId: organization.id, status: "published" },
    select: { mentorship: true, development: true },
  });

  return toPublicPracticeView(organization, locations, gepubliceerd);
}

/**
 * Publieke praktijkweergave op organisatie-slug. Alleen actieve organisaties
 * mét publicatie-consent (Organization.publicConsent) bestaan publiek;
 * anders null (endpoint: 404).
 */
export async function getPublicPractice(slug: string): Promise<PublicPracticeView | null> {
  const organization = await prisma.organization.findUnique({ where: { slug } });
  if (!organization || organization.status !== "active" || !organization.publicConsent) {
    return null;
  }
  return bouwPracticeView(organization);
}

/**
 * Alle publieke praktijken: actieve organisaties mét publicatie-consent en
 * minstens één locatie, alfabetisch op naam.
 */
export async function listPublicPractices(): Promise<PublicPracticeView[]> {
  const organisaties = await prisma.organization.findMany({
    where: { status: "active", publicConsent: true },
    orderBy: { name: "asc" },
  });
  const views = await Promise.all(organisaties.map(bouwPracticeView));
  return views.filter((view): view is PublicPracticeView => view !== null);
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
