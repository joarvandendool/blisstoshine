// Data-adapter voor de openbare site (Workstream B, fase 5–7).
//
// De publieke pagina's (/, /vacatures/**, /praktijken/**) praten uitsluitend
// met de PublicDataSource-interface uit types.ts — nooit met Prisma of
// domeinservices (backend-eigendom, zie docs/parallel/CODEX_VISUAL_HANDOFF.md).
//
// Twee implementaties:
//   1. FixtureDataSource — development-fixtures (fixtures.ts, duidelijk
//      gemarkeerd als fictief). Dit is de DEFAULT zolang de public
//      read-model-API's (/api/public/v1/*, branch claude/scale-core) op
//      deze branch nog 404 geven.
//   2. HttpDataSource — roept /api/public/v1/* aan met fetch + revalidate.
//      Werkt zodra de backend-branch geïntegreerd is.
//
// Selectie via env: PUBLIC_DATA_SOURCE=fixtures | http (default: fixtures).
// Voor http kan PUBLIC_API_BASE_URL de absolute basis-URL zetten (server-side
// fetch heeft een absolute URL nodig); default http://localhost:3000.

import {
  CONTRACT_TYPES,
  DAYPARTS,
  EQUIPMENT,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  WEEKDAYS,
  label,
} from "@/domain/taxonomy";
import { FIXTURE_JOBS, FIXTURE_PRACTICES } from "./fixtures";
import type {
  PublicDataSource,
  PublicJobFilters,
  PublicJobSearchResult,
  PublicJobView,
  PublicPracticeView,
  PublicTaxonomyView,
} from "./types";

export const JOBS_PAGE_SIZE = 6;

/* ------------------------- taxonomie (gedeeld) ------------------------- */

function taxonomieView(): PublicTaxonomyView {
  const naarTags = (keys: readonly string[]) =>
    keys.map((key) => ({ key, label: label(key) }));
  return {
    roles: naarTags(ROLES),
    // Stage is (nog) geen publieke contractvorm in de zoekfilters.
    employmentTypes: naarTags(CONTRACT_TYPES.filter((c) => c !== "stage")),
    equipment: naarTags(EQUIPMENT),
    software: naarTags(SOFTWARE),
    specializations: naarTags(SPECIALIZATIONS),
    days: naarTags(WEEKDAYS),
    dayparts: naarTags(DAYPARTS),
  };
}

/* --------------------------- FixtureDataSource -------------------------- */

function bevatTag(tags: { key: string }[], key?: string): boolean {
  if (!key) return true;
  return tags.some((t) => t.key === key);
}

function matchtFilters(job: PublicJobView, filters: PublicJobFilters): boolean {
  if (filters.role && job.role.key !== filters.role) return false;
  if (filters.organization && job.organization.slug !== filters.organization) {
    return false;
  }
  if (filters.city) {
    const zoek = filters.city.trim().toLowerCase();
    const doel = `${job.location.city} ${job.location.region}`.toLowerCase();
    if (!doel.includes(zoek)) return false;
  }
  if (filters.days && filters.days.length > 0) {
    const dagen = new Set(job.availability.map((slot) => slot.day));
    if (!filters.days.every((d) => dagen.has(d))) return false;
  }
  // Urenrange: overlap tussen het gevraagde bereik en de vacature.
  if (filters.hoursMin !== undefined && job.hoursMax < filters.hoursMin) {
    return false;
  }
  if (filters.hoursMax !== undefined && job.hoursMin > filters.hoursMax) {
    return false;
  }
  if (
    filters.employmentType &&
    !bevatTag(job.employmentTypes, filters.employmentType)
  ) {
    return false;
  }
  if (!bevatTag(job.equipment, filters.equipment)) return false;
  if (!bevatTag(job.software, filters.software)) return false;
  if (!bevatTag(job.specializations, filters.specialization)) return false;
  return true;
}

/** Development-implementatie op basis van fixtures (fictieve data). */
export class FixtureDataSource implements PublicDataSource {
  async getJobs(
    filters: PublicJobFilters,
    page: number,
  ): Promise<PublicJobSearchResult> {
    // Alleen gepubliceerde vacatures in het overzicht; gesloten vacatures
    // blijven via hun slug bereikbaar (detail toont de gesloten staat).
    const alles = FIXTURE_JOBS.filter(
      (job) => job.status === "published" && matchtFilters(job, filters),
    ).sort((a, b) => b.datePosted.localeCompare(a.datePosted));

    const totalPages = Math.max(1, Math.ceil(alles.length / JOBS_PAGE_SIZE));
    const veiligePagina = Math.min(Math.max(1, page), totalPages);
    const start = (veiligePagina - 1) * JOBS_PAGE_SIZE;

    return {
      items: alles.slice(start, start + JOBS_PAGE_SIZE),
      total: alles.length,
      page: veiligePagina,
      pageSize: JOBS_PAGE_SIZE,
      totalPages,
    };
  }

  async getJob(idOrSlug: string): Promise<PublicJobView | null> {
    return FIXTURE_JOBS.find((job) => job.slug === idOrSlug) ?? null;
  }

  async getPractice(slug: string): Promise<PublicPracticeView | null> {
    const praktijk = FIXTURE_PRACTICES.find((p) => p.slug === slug) ?? null;
    // Consentregel: praktijken zonder publicatie-toestemming bestaan publiek
    // niet. (Het echte consentmechanisme is backend-eigendom; de http-bron
    // levert überhaupt alleen praktijken mét consent uit.)
    if (!praktijk || !praktijk.practiceConsent) return null;
    return praktijk;
  }

  async getPractices(): Promise<PublicPracticeView[]> {
    return FIXTURE_PRACTICES.filter((p) => p.practiceConsent);
  }

  async getTaxonomies(): Promise<PublicTaxonomyView> {
    return taxonomieView();
  }
}

/* ---------------------------- HttpDataSource ---------------------------- */

/** Zet filters om naar querystring-parameters van /api/public/v1/jobs. */
function filtersNaarQuery(filters: PublicJobFilters, page: number): string {
  const q = new URLSearchParams();
  if (filters.role) q.set("role", filters.role);
  if (filters.city) q.set("city", filters.city);
  for (const dag of filters.days ?? []) q.append("day", dag);
  if (filters.hoursMin !== undefined) q.set("hoursMin", String(filters.hoursMin));
  if (filters.hoursMax !== undefined) q.set("hoursMax", String(filters.hoursMax));
  if (filters.employmentType) q.set("employmentType", filters.employmentType);
  if (filters.equipment) q.set("equipment", filters.equipment);
  if (filters.software) q.set("software", filters.software);
  if (filters.specialization) q.set("specialization", filters.specialization);
  if (filters.organization) q.set("organization", filters.organization);
  q.set("page", String(page));
  q.set("pageSize", String(JOBS_PAGE_SIZE));
  return q.toString();
}

/**
 * Read-model-implementatie: /api/public/v1/* (branch claude/scale-core).
 * Fetch met ISR-revalidate; 404 → null zodat pagina's hun eigen
 * not-found-afhandeling doen.
 */
export class HttpDataSource implements PublicDataSource {
  constructor(
    private readonly baseUrl: string = process.env.PUBLIC_API_BASE_URL ??
      "http://localhost:3000",
    private readonly revalidateSeconds: number = 300,
  ) {}

  private async haalOp<T>(pad: string): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}/api/public/v1${pad}`, {
      next: { revalidate: this.revalidateSeconds },
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `Public read-model gaf ${res.status} voor ${pad} — controleer de backend-integratie of zet PUBLIC_DATA_SOURCE=fixtures.`,
      );
    }
    return (await res.json()) as T;
  }

  async getJobs(
    filters: PublicJobFilters,
    page: number,
  ): Promise<PublicJobSearchResult> {
    const resultaat = await this.haalOp<PublicJobSearchResult>(
      `/jobs?${filtersNaarQuery(filters, page)}`,
    );
    return (
      resultaat ?? {
        items: [],
        total: 0,
        page: 1,
        pageSize: JOBS_PAGE_SIZE,
        totalPages: 1,
      }
    );
  }

  async getJob(idOrSlug: string): Promise<PublicJobView | null> {
    return this.haalOp<PublicJobView>(`/jobs/${encodeURIComponent(idOrSlug)}`);
  }

  async getPractice(slug: string): Promise<PublicPracticeView | null> {
    const praktijk = await this.haalOp<PublicPracticeView>(
      `/practices/${encodeURIComponent(slug)}`,
    );
    if (!praktijk || !praktijk.practiceConsent) return null;
    return praktijk;
  }

  async getPractices(): Promise<PublicPracticeView[]> {
    const lijst = await this.haalOp<PublicPracticeView[]>(`/practices`);
    return (lijst ?? []).filter((p) => p.practiceConsent);
  }

  async getTaxonomies(): Promise<PublicTaxonomyView> {
    const taxonomie = await this.haalOp<PublicTaxonomyView>(`/taxonomies`);
    // Val terug op de gedeelde taxonomie zolang het endpoint ontbreekt.
    return taxonomie ?? taxonomieView();
  }
}

/* ------------------------------- selectie ------------------------------- */

/**
 * Kies de datasource via PUBLIC_DATA_SOURCE (fixtures | http).
 * Default: fixtures — de http-endpoints geven op deze branch nog 404;
 * de integratiefase zet de env om zonder verdere codewijziging.
 */
export function getPublicDataSource(): PublicDataSource {
  if (process.env.PUBLIC_DATA_SOURCE === "http") {
    return new HttpDataSource();
  }
  return new FixtureDataSource();
}
