// Site-datalaag voor de openbare site (integratiefase): levert het
// frontend-contract van src/public-site/data/types.ts rechtstreeks uit de
// database, in-process (geen self-HTTP). De DirectDataSource in
// src/public-site/data/direct.ts roept uitsluitend deze functies aan;
// zo blijft Prisma buiten src/public-site/** en hergebruiken we de
// bestaande query- en mapperlaag (queries.ts / read-models.ts).
//
// Regels (identiek aan het API-read-model):
// - alleen gepubliceerde vacatures in lijsten; gesloten vacatures wél per
//   slug (status "closed") voor de vervuld-staat;
// - praktijken uitsluitend mét publicatie-consent;
// - locaties nooit exacter dan stad + postcode-4; géén kandidaatdata;
// - ontbrekende data eerlijk gemapt: geen salaris → salary: null; geen
//   omzetpercentage → revenueShare: null (het zzp-omzetpercentage is altijd
//   een geheel percentage 0–100, nooit een fractie of uurtarief).

import type {
  PublicAvailabilitySlot,
  PublicJobFilters,
  PublicJobSearchResult,
  PublicJobView,
  PublicPracticeView,
  PublicRequirement,
  PublicSalary,
  PublicTag,
} from "@/public-site/data/types";
import { label, type Daypart, type Weekday } from "@/domain/taxonomy";
import { ensureVacancySlug } from "@/server/vacancies";
import {
  getPublicJob,
  getPublicPractice,
  listPublicPractices,
  zoekGepubliceerdeVacatures,
  type PublicJobFilters as BackendJobFilters,
} from "./queries";
import {
  toPublicJobView,
  type PublicJobView as BackendJobView,
  type PublicPracticeView as BackendPracticeView,
} from "./read-models";

/** Paginagrootte van de openbare vacaturezoeker (gelijk aan JOBS_PAGE_SIZE). */
export const SITE_JOBS_PAGE_SIZE = 6;

/* ----------------------- mappers backend → site ------------------------ */

function naarTags(keys: string[]): PublicTag[] {
  return keys.map((key) => ({ key, label: label(key) }));
}

/**
 * Eisen/wensen: het backend-niveau "informational" (context, geen eis)
 * wordt op de site als "preferred" (bespreekbaar) getoond — het publieke
 * contract kent alleen die twee niveaus.
 */
function naarSiteRequirements(job: BackendJobView): PublicRequirement[] {
  return job.requirements.map((eis) => ({
    label: eis.label,
    level: eis.level === "required" ? "required" : "preferred",
  }));
}

function naarSiteAvailability(job: BackendJobView): PublicAvailabilitySlot[] {
  return job.availability.map((slot) => ({
    day: slot.day,
    dayparts: slot.dayparts as Daypart[],
    level: slot.level,
  }));
}

/**
 * Salaris: eerlijk gemapt. Geen salaris opgegeven → null. Is maar één grens
 * ingevuld, dan geldt die als beide grenzen (de site toont dan "€ x – € x"
 * — het echte bedrag, geen verzonnen bandbreedte).
 */
function naarSiteSalary(job: BackendJobView): PublicSalary | null {
  const salaris = job.salary;
  if (!salaris) return null;
  const min = salaris.minCents ?? salaris.maxCents;
  const max = salaris.maxCents ?? salaris.minCents;
  if (min === null || max === null) return null;
  return { minCents: min, maxCents: max };
}

/** Backend-jobview → frontend-contract (exact de sleutels van het contract). */
export function naarSiteJobView(job: BackendJobView): PublicJobView {
  return {
    slug: job.slug,
    canonicalUrl: job.canonicalUrl,
    title: job.title,
    role: { key: job.role.key, label: job.role.label },
    organization: { name: job.organization.name, slug: job.organization.slug },
    location: {
      city: job.location.city,
      region: job.location.region,
      // PC4 is in de praktijk altijd afleidbaar (postcode is verplicht);
      // bij onbruikbare data eerlijk leeg in plaats van verzonnen.
      postcode4: job.location.postcode4 ?? "",
    },
    description: job.description ?? "",
    responsibilities: job.responsibilities,
    requirements: naarSiteRequirements(job),
    availability: naarSiteAvailability(job),
    hoursMin: job.hoursMin ?? 0,
    hoursMax: job.hoursMax ?? 0,
    employmentTypes: naarTags(job.employmentTypes),
    salary: naarSiteSalary(job),
    revenueShare: job.revenueShare ? { maxPercent: job.revenueShare.maxPercent } : null,
    equipment: job.equipment,
    software: job.software,
    specializations: job.specializations,
    culture: job.culture,
    mentorship: job.mentorship,
    development: job.development,
    datePosted: job.datePosted,
    validThrough: job.validThrough ?? null,
    status: job.status,
    directApply: job.directApply,
    updatedAt: job.updatedAt,
  };
}

/** Backend-praktijkview → frontend-contract (exact de contractsleutels). */
export function naarSitePracticeView(praktijk: BackendPracticeView): PublicPracticeView {
  return {
    slug: praktijk.slug,
    canonicalUrl: praktijk.canonicalUrl,
    name: praktijk.name,
    description: praktijk.description,
    locations: praktijk.locations.map((locatie) => ({
      city: locatie.city,
      region: locatie.region,
      postcode4: locatie.postcode4 ?? "",
    })),
    treatmentRooms: praktijk.treatmentRooms,
    equipment: praktijk.equipment,
    software: praktijk.software,
    specializations: praktijk.specializations,
    population: praktijk.population,
    culture: praktijk.culture,
    mentorship: praktijk.mentorship,
    development: praktijk.development,
    practiceConsent: praktijk.practiceConsent,
    updatedAt: praktijk.updatedAt,
  };
}

/* ------------------------------- queries -------------------------------- */

function naarBackendFilters(filters: PublicJobFilters): BackendJobFilters {
  return {
    role: filters.role,
    city: filters.city,
    days: filters.days as Weekday[] | undefined,
    hoursMin: filters.hoursMin,
    hoursMax: filters.hoursMax,
    employmentType: filters.employmentType,
    equipment: filters.equipment,
    software: filters.software,
    specialization: filters.specialization,
    organization: filters.organization,
  };
}

/**
 * Openbare vacaturezoeker: gepubliceerde vacatures, gefilterd, nieuwste
 * eerst, gepagineerd op SITE_JOBS_PAGE_SIZE. De pagina wordt — net als in
 * de FixtureDataSource — geklemd op [1..totalPages].
 */
export async function siteJobSearch(
  filters: PublicJobFilters,
  page: number,
): Promise<PublicJobSearchResult> {
  const alles = await zoekGepubliceerdeVacatures(naarBackendFilters(filters));
  const totalPages = Math.max(1, Math.ceil(alles.length / SITE_JOBS_PAGE_SIZE));
  const veiligePagina = Math.min(Math.max(1, page), totalPages);
  const start = (veiligePagina - 1) * SITE_JOBS_PAGE_SIZE;

  // Alleen de geklemde pagina mappen (incl. lazy slugtoekenning).
  const items = await Promise.all(
    alles.slice(start, start + SITE_JOBS_PAGE_SIZE).map(async (vacancy) => {
      const slug = vacancy.slug ?? (await ensureVacancySlug(vacancy, vacancy.location.city));
      return naarSiteJobView(toPublicJobView(vacancy, slug));
    }),
  );

  return {
    items,
    total: alles.length,
    page: veiligePagina,
    pageSize: SITE_JOBS_PAGE_SIZE,
    totalPages,
  };
}

/**
 * Eén vacature op slug of ID. Gepubliceerd én gesloten (ooit gepubliceerd)
 * zijn opvraagbaar — de detailpagina toont voor "closed" de vervuld-staat.
 * Concepten en onbekende slugs: null.
 */
export async function siteJob(idOrSlug: string): Promise<PublicJobView | null> {
  const uitkomst = await getPublicJob(idOrSlug);
  if (uitkomst.kind === "not_found") return null;
  return naarSiteJobView(uitkomst.job);
}

/** Eén praktijk op slug — alleen mét publicatie-consent, anders null. */
export async function sitePractice(slug: string): Promise<PublicPracticeView | null> {
  const praktijk = await getPublicPractice(slug);
  return praktijk ? naarSitePracticeView(praktijk) : null;
}

/** Alle publieke praktijken (alleen mét publicatie-consent). */
export async function sitePractices(): Promise<PublicPracticeView[]> {
  const praktijken = await listPublicPractices();
  return praktijken.map(naarSitePracticeView);
}
