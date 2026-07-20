// Data-adapter voor de openbare site.
//
// De publieke pagina's (/, /vacatures/**, /praktijken/**) praten uitsluitend
// met de PublicDataSource-interface uit types.ts — nooit rechtstreeks met
// Prisma of domeinservices.
//
// Drie implementaties:
//   1. DirectDataSource (DEFAULT) — échte databasegegevens, in-process via
//      de site-datalaag (src/server/public/site-queries.ts). Geen self-HTTP:
//      op Vercel draait de pagina-render in dezelfde deployment als de
//      /api/public/v1-routes, en een fetch naar de eigen preview-URL strandt
//      daar op Deployment Protection (401) en kost sowieso een extra
//      netwerkronde. In-process is dus zowel correcter als sneller; de
//      HTTP-API blijft bestaan voor externe afnemers.
//   2. FixtureDataSource — development-fixtures (fixtures.ts, duidelijk
//      gemarkeerd als fictief). Alleen expliciet voor tests/demo's:
//      PUBLIC_DATA_SOURCE=fixtures (zo draait de Playwright-suite, zodat de
//      visuele baselines stabiel blijven).
//   3. HttpDataSource — roept /api/public/v1/* aan en mapt de API-vormen
//      naar het frontend-contract. Voor de situatie waarin de site en de
//      API gescheiden draaien: PUBLIC_DATA_SOURCE=http, met
//      PUBLIC_API_BASE_URL als absolute basis (default http://localhost:3000;
//      op Vercel valt hij terug op https://$VERCEL_URL).

import { naarSiteJobView, naarSitePracticeView } from "@/server/public/site-queries";
import type {
  PublicJobView as ApiJobView,
  PublicPracticeView as ApiPracticeView,
  PublicTaxonomyView as ApiTaxonomyView,
} from "@/server/public/read-models";
import { DirectDataSource } from "./direct";
import { FIXTURE_JOBS, FIXTURE_PRACTICES } from "./fixtures";
import { taxonomieView } from "./taxonomie";
import type {
  PublicDataSource,
  PublicJobFilters,
  PublicJobSearchResult,
  PublicJobView,
  PublicPracticeView,
  PublicTag,
  PublicTaxonomyView,
} from "./types";

export const JOBS_PAGE_SIZE = 6;

export { DirectDataSource } from "./direct";

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
    // niet — dezelfde regel als in de echte datalaag.
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

/** API-antwoord van GET /jobs (backend-vormen + paginering). */
interface ApiJobsResult {
  items: ApiJobView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

/** Basis-URL voor http-modus: env → Vercel-URL → localhost. */
function httpBaseUrl(): string {
  if (process.env.PUBLIC_API_BASE_URL) return process.env.PUBLIC_API_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * Read-model-implementatie over HTTP: /api/public/v1/*. Fetch met
 * ISR-revalidate; 404 → null zodat pagina's hun eigen not-found-afhandeling
 * doen; 410 (gesloten vacature) levert wél een body met status "closed".
 * De API-vormen (src/server/public/read-models.ts) worden hier naar het
 * frontend-contract gemapt met dezelfde mappers als de DirectDataSource.
 */
export class HttpDataSource implements PublicDataSource {
  constructor(
    private readonly baseUrl: string = httpBaseUrl(),
    private readonly revalidateSeconds: number = 300,
  ) {}

  private async haalOp<T>(
    pad: string,
    opts: { accepteerGone?: boolean } = {},
  ): Promise<T | null> {
    const res = await fetch(`${this.baseUrl}/api/public/v1${pad}`, {
      next: { revalidate: this.revalidateSeconds },
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    // 410 Gone: gesloten vacature mét volledige body (vervuld-staat).
    if (res.status === 410 && opts.accepteerGone) {
      return (await res.json()) as T;
    }
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
    const resultaat = await this.haalOp<ApiJobsResult>(
      `/jobs?${filtersNaarQuery(filters, page)}`,
    );
    if (!resultaat) {
      return { items: [], total: 0, page: 1, pageSize: JOBS_PAGE_SIZE, totalPages: 1 };
    }
    return {
      items: resultaat.items.map(naarSiteJobView),
      total: resultaat.total,
      page: resultaat.page,
      pageSize: resultaat.pageSize,
      // totalPages afleiden wanneer de API hem (nog) niet levert.
      totalPages:
        resultaat.totalPages ??
        Math.max(1, Math.ceil(resultaat.total / Math.max(1, resultaat.pageSize))),
    };
  }

  async getJob(idOrSlug: string): Promise<PublicJobView | null> {
    const job = await this.haalOp<ApiJobView>(
      `/jobs/${encodeURIComponent(idOrSlug)}`,
      { accepteerGone: true },
    );
    return job ? naarSiteJobView(job) : null;
  }

  async getPractice(slug: string): Promise<PublicPracticeView | null> {
    const praktijk = await this.haalOp<ApiPracticeView>(
      `/practices/${encodeURIComponent(slug)}`,
    );
    if (!praktijk || !praktijk.practiceConsent) return null;
    return naarSitePracticeView(praktijk);
  }

  async getPractices(): Promise<PublicPracticeView[]> {
    const resultaat = await this.haalOp<{ items: ApiPracticeView[] }>(`/practices`);
    return (resultaat?.items ?? [])
      .filter((p) => p.practiceConsent)
      .map(naarSitePracticeView);
  }

  async getTaxonomies(): Promise<PublicTaxonomyView> {
    const taxonomie = await this.haalOp<ApiTaxonomyView>(`/taxonomies`);
    if (!taxonomie?.groups) return taxonomieView();
    const groep = (key: string): PublicTag[] =>
      taxonomie.groups.find((g) => g.key === key)?.values ?? [];
    return {
      roles: groep("roles"),
      // Stage is (nog) geen publieke contractvorm in de zoekfilters.
      employmentTypes: groep("contractTypes").filter((t) => t.key !== "stage"),
      equipment: groep("equipment"),
      software: groep("software"),
      specializations: groep("specializations"),
      days: groep("weekdays"),
      dayparts: groep("dayparts"),
    };
  }
}

/* ------------------------------- selectie ------------------------------- */

/**
 * Kies de datasource via PUBLIC_DATA_SOURCE:
 * - (onbeschikbaar/onbekend/"direct") → DirectDataSource: échte data,
 *   in-process — de standaard;
 * - "fixtures" → FixtureDataSource: uitsluitend expliciet voor tests en
 *   demo's (o.a. de Playwright-baselines);
 * - "http" → HttpDataSource: echte data via /api/public/v1/* wanneer site
 *   en API gescheiden draaien (zie PUBLIC_API_BASE_URL).
 */
export function getPublicDataSource(): PublicDataSource {
  switch (process.env.PUBLIC_DATA_SOURCE) {
    case "fixtures":
      return new FixtureDataSource();
    case "http":
      return new HttpDataSource();
    default:
      return new DirectDataSource();
  }
}
