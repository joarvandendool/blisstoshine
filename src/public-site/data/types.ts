// Publieke read-model-types voor de openbare site (homepage, /vacatures,
// /praktijken). Dit is het afgesproken contract met de backend-werkstroom
// (docs/parallel/CODEX_VISUAL_HANDOFF.md § Backenddata-koppeling): de
// backend levert deze vormen via /api/public/v1/*; deze werkstroom rendert
// ze alleen. GEEN Prisma-types importeren in src/public-site/** — de
// koppeling loopt uitsluitend via dit contract.

import type { Daypart, Weekday } from "@/domain/taxonomy";

/** Taxonomie-item: stabiele sleutel + Nederlands weergavelabel. */
export interface PublicTag {
  key: string;
  label: string;
}

/** Locatie zoals publiek getoond: nooit exacter dan stad + postcode-4. */
export interface PublicLocation {
  city: string;
  region: string;
  /** Eerste vier cijfers van de postcode (privacy: geen volledig adres). */
  postcode4: string;
}

/** Eis of wens uit de vacature; `required` = verplicht, `preferred` = bespreekbaar. */
export interface PublicRequirement {
  label: string;
  level: "required" | "preferred";
}

/** Gevraagde werkdag met dagdelen; `required` = nodig, `preferred` = gewenst. */
export interface PublicAvailabilitySlot {
  day: Weekday;
  dayparts: Daypart[];
  level: "required" | "preferred";
}

export interface PublicSalary {
  minCents: number;
  maxCents: number;
}

export interface PublicRevenueShare {
  /** Maximaal geboden omzetpercentage (zzp). */
  maxPercent: number;
}

export type PublicJobStatus = "published" | "closed";

/** Eén openbare vacature zoals de detailpagina hem nodig heeft. */
export interface PublicJobView {
  slug: string;
  canonicalUrl: string;
  title: string;
  /** Functie (taxonomierol) — basis voor de functie-filter. */
  role: PublicTag;
  organization: {
    name: string;
    slug: string;
  };
  location: PublicLocation;
  description: string;
  responsibilities: string[];
  requirements: PublicRequirement[];
  availability: PublicAvailabilitySlot[];
  hoursMin: number;
  hoursMax: number;
  employmentTypes: PublicTag[];
  salary: PublicSalary | null;
  revenueShare: PublicRevenueShare | null;
  equipment: PublicTag[];
  software: PublicTag[];
  specializations: PublicTag[];
  /** Team & cultuur / begeleiding & ontwikkeling (detailpagina-secties). */
  culture: PublicTag[];
  mentorship: boolean;
  development: PublicTag[];
  datePosted: string; // ISO 8601
  validThrough: string | null; // ISO 8601
  status: PublicJobStatus;
  /** Mag "Solliciteer direct" getoond worden? */
  directApply: boolean;
  updatedAt: string; // ISO 8601
}

/** Openbare praktijkpagina. Alleen praktijken met consent zijn opvraagbaar. */
export interface PublicPracticeView {
  slug: string;
  canonicalUrl: string;
  name: string;
  description: string;
  locations: PublicLocation[];
  treatmentRooms: number;
  equipment: PublicTag[];
  software: PublicTag[];
  specializations: PublicTag[];
  population: PublicTag[];
  culture: PublicTag[];
  mentorship: boolean;
  development: PublicTag[];
  /**
   * Publicatie-toestemming van de praktijk. Het échte consentmechanisme
   * (vastleggen, intrekken, audit) is backend-eigendom en leeft bij het
   * read-model; de backend levert alléén praktijken met consent uit.
   * De vlag staat hier zodat de adapter dezelfde regel afdwingt op
   * fixtures én zodat de UI hem nooit hoeft te raden.
   */
  practiceConsent: boolean;
  updatedAt: string; // ISO 8601
}

/** Filters van de openbare vacaturezoeker (alle velden optioneel). */
export interface PublicJobFilters {
  /** Taxonomierol, bv. "mondhygienist". */
  role?: string;
  /** Plaats of regio (case-insensitief deelmatch). */
  city?: string;
  /** Gevraagde werkdagen: vacature matcht als hij álle gekozen dagen vraagt. */
  days?: Weekday[];
  /** Urenrange: overlap met hoursMin–hoursMax van de vacature. */
  hoursMin?: number;
  hoursMax?: number;
  /** Contractvorm-taxonomiesleutel, bv. "zzp". */
  employmentType?: string;
  /** Apparatuur-taxonomiesleutel. */
  equipment?: string;
  /** Software-taxonomiesleutel. */
  software?: string;
  /** Specialisatie-taxonomiesleutel. */
  specialization?: string;
  /** Praktijk-slug: alleen vacatures van deze organisatie. */
  organization?: string;
}

export interface PublicJobSearchResult {
  items: PublicJobView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Taxonomieën voor de filterbalk (sleutels + Nederlandse labels). */
export interface PublicTaxonomyView {
  roles: PublicTag[];
  employmentTypes: PublicTag[];
  equipment: PublicTag[];
  software: PublicTag[];
  specializations: PublicTag[];
  days: PublicTag[];
  dayparts: PublicTag[];
}

/** Datasource-interface — twee implementaties, zie adapter.ts. */
export interface PublicDataSource {
  getJobs(
    filters: PublicJobFilters,
    page: number,
  ): Promise<PublicJobSearchResult>;
  getJob(idOrSlug: string): Promise<PublicJobView | null>;
  getPractice(slug: string): Promise<PublicPracticeView | null>;
  getPractices(): Promise<PublicPracticeView[]>;
  getTaxonomies(): Promise<PublicTaxonomyView>;
}
