// Publieke read models (fase 8): pure mappers van Prisma-rijen naar de
// stabiele publieke types die Codex (Workstream B) gebruikt voor de publieke
// vacature- en praktijkpagina's. Contract gedocumenteerd in
// docs/parallel/PUBLIC_READ_MODEL.md.
//
// Regels:
// - ALLEEN gepubliceerde data; NOOIT kandidaatdata (geen namen, e-mail,
//   telefoon, sollicitaties of profielvelden) — er komt hier per constructie
//   geen enkel kandidaatmodel binnen;
// - identifiers (id, slug) wijzigen nooit; velden worden alleen additief
//   uitgebreid;
// - postcode alleen als PC4 (vier cijfers) — nooit de volledige postcode;
// - dit bestand is puur (geen prisma-imports); queries staan in ./queries.ts.

import type { Organization, PracticeLocation, Vacancy } from "@prisma/client";
import {
  CONTRACT_TYPES,
  CULTURE,
  DAYPARTS,
  DEVELOPMENT,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  PATIENT_POPULATION,
  PRACTICE_SIZES,
  REGISTRATIONS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  TEAM_PREFERENCES,
  TREATMENTS,
  WEEKDAYS,
  WORK_PACES,
  label,
  type CriterionLevel,
  type Weekday,
} from "@/domain/taxonomy";
import { castCriteria, castSchedule } from "@/server/vacancies";

// ---------------------------------------------------------------------------
// Publieke types (stabiel contract)
// ---------------------------------------------------------------------------

/** Taxonomiewaarde: stabiele sleutel (opslag/filtering) + Nederlands label. */
export interface PublicKeyLabel {
  /** Stabiele taxonomiesleutel, bv. "mondhygienist" of "trios". */
  key: string;
  /** Nederlands weergavelabel, bv. "Mondhygiënist". */
  label: string;
}

/** Samenvatting van de organisatie achter een vacature. */
export interface PublicOrganizationSummary {
  /** Praktijknaam zoals publiek getoond. */
  name: string;
  /** Stabiele organisatie-slug; identifier voor /practices/[slug]. */
  slug: string;
}

/** Publieke locatie-aanduiding — bewust grof (privacy: geen exact adres). */
export interface PublicLocation {
  /** Plaatsnaam van de praktijklocatie. */
  city: string;
  /** Provincie, afgeleid van postcode/stad; valt terug op de stad zelf. */
  region: string;
  /** Alleen de eerste vier cijfers van de postcode (PC4); null bij onbekend. */
  postcode4: string | null;
}

/** Eis of wens uit de vacature, met niveau. */
export interface PublicRequirement {
  /** Nederlandse omschrijving, bv. "BIG-registratie mondhygiënist". */
  label: string;
  /** required = harde eis, preferred = wens, informational = context. */
  level: CriterionLevel;
}

/** Gevraagde werkdag met dagdelen, per niveau gegroepeerd. */
export interface PublicAvailability {
  /** Weekdagsleutel: ma | di | wo | do | vr | za | zo. */
  day: Weekday;
  /** Dagdelen op deze dag met dit niveau: ochtend | middag | avond. */
  dayparts: string[];
  /** required = verplichte werkdag(delen), preferred = gewenst. */
  level: "required" | "preferred";
}

/** Salarisindicatie bij loondienst, altijd per maand in eurocenten. */
export interface PublicCompensation {
  /** Ondergrens in eurocenten per maand; null indien niet opgegeven. */
  minCents: number | null;
  /** Bovengrens in eurocenten per maand; null indien niet opgegeven. */
  maxCents: number | null;
  /** Altijd "month" — maandsalaris. */
  period: "month";
}

/**
 * Omzetdeling bij zzp: behandelaren werken met een percentage van de omzet,
 * niet met een uurtarief. Alleen aanwezig wanneer de vacature zzp toestaat
 * en een percentage biedt.
 */
export interface PublicRevenueShare {
  /** Maximaal geboden omzetpercentage (geheel getal, 0–100). */
  maxPercent: number;
}

/** Volledige publieke weergave van één gepubliceerde vacature. */
export interface PublicJobView {
  /** Stabiel intern ID (cuid); wijzigt nooit. */
  id: string;
  /** Stabiele publieke slug (titel-stad-hash); wijzigt nooit na toekenning. */
  slug: string;
  /** Canoniek pad op de publieke site: /vacatures/[slug] (pagina is van Codex). */
  canonicalUrl: string;
  /** Vacaturetitel. */
  title: string;
  /** Functie als taxonomiewaarde, bv. { key: "tandarts", label: "Tandarts" }. */
  role: PublicKeyLabel;
  /** Organisatie achter de vacature. */
  organization: PublicOrganizationSummary;
  /** Grove publieke locatie (stad, provincie, PC4). */
  location: PublicLocation;
  /** Vrije omschrijving; null wanneer niet ingevuld. */
  description: string | null;
  /** Werkzaamheden, afgeleid van de gevraagde behandeltypen (Nederlandse labels). */
  responsibilities: string[];
  /** Eisen en wensen: registraties + minimaal ervaringsniveau, met niveau. */
  requirements: PublicRequirement[];
  /** Gevraagde werkdagen/dagdelen, gegroepeerd per dag en niveau. */
  availability: PublicAvailability[];
  /** Minimaal aantal uur per week; afwezig = niet gespecificeerd. */
  hoursMin?: number;
  /** Maximaal aantal uur per week; afwezig = niet gespecificeerd. */
  hoursMax?: number;
  /** Contractvormen (taxonomiesleutels): loondienst | zzp | detachering | stage. */
  employmentTypes: string[];
  /** Salarisindicatie (loondienst); afwezig wanneer niet opgegeven. */
  salary?: PublicCompensation;
  /** Omzetpercentage (zzp); afwezig wanneer niet opgegeven. */
  revenueShare?: PublicRevenueShare;
  /** Gevraagde/aanwezige apparatuur uit de vacaturecriteria. */
  equipment: PublicKeyLabel[];
  /** Gevraagde praktijksoftware uit de vacaturecriteria. */
  software: PublicKeyLabel[];
  /** Gevraagde specialisaties uit de vacaturecriteria. */
  specializations: PublicKeyLabel[];
  /** Praktijkcultuur van de vacature (taxonomie CULTURE), gelabeld. */
  culture: PublicKeyLabel[];
  /** Is er begeleiding/mentorschap voor deze rol? */
  mentorship: boolean;
  /** Ontwikkelmogelijkheden (taxonomie DEVELOPMENT), gelabeld. */
  development: PublicKeyLabel[];
  /** Publicatiedatum, ISO 8601. */
  datePosted: string;
  /** Sluitingsdatum, ISO 8601; afwezig wanneer geen einddatum is gezet. */
  validThrough?: string;
  /** "published" = open; "closed" = vervuld/verlopen/gepauzeerd. */
  status: "published" | "closed";
  /** Altijd true: solliciteren gebeurt direct op het platform. */
  directApply: true;
  /** Laatste wijziging, ISO 8601. */
  updatedAt: string;
}

/** Gepagineerd zoekresultaat van GET /api/public/v1/jobs. */
export interface PublicJobSearchResult {
  /**
   * Vacatures van deze pagina, gesorteerd op datePosted (nieuwste eerst).
   * Sinds de site-integratie zijn dit volledige PublicJobViews (additief
   * t.o.v. de eerdere compacte samenvatting: alle oude velden bestaan nog).
   */
  items: PublicJobView[];
  /** Totaal aantal treffers over alle pagina's. */
  total: number;
  /** Huidige pagina (1-based). */
  page: number;
  /** Paginagrootte (maximaal 50). */
  pageSize: number;
  /** Totaal aantal pagina's (minimaal 1), afgeleid van total/pageSize. */
  totalPages: number;
}

/**
 * Publieke weergave van een praktijk(organisatie). Alleen praktijken mét
 * publicatie-consent (Organization.publicConsent) worden uitgeleverd.
 */
export interface PublicPracticeView {
  /** Stabiele organisatie-slug; wijzigt nooit. */
  slug: string;
  /** Canoniek pad op de publieke site: /praktijken/[slug]. */
  canonicalUrl: string;
  /** Praktijknaam. */
  name: string;
  /** Publieke omschrijving; lege string wanneer niet ingevuld. */
  description: string;
  /** Stad van de (hoofd)locatie. */
  city: string;
  /** Provincie, afgeleid van postcode/stad. */
  region: string;
  /** Alle locaties, grof (stad + provincie + PC4) — nooit een adres. */
  locations: PublicLocation[];
  /** Aantal behandelkamers van de (hoofd)locatie. */
  treatmentRooms: number;
  /** Praktijkkenmerken (cultuur/traits) van de hoofdlocatie, gelabeld. */
  traits: PublicKeyLabel[];
  /** Aanwezige apparatuur (unie over alle locaties), gelabeld. */
  equipment: PublicKeyLabel[];
  /** Gebruikte software (unie over alle locaties), gelabeld. */
  software: PublicKeyLabel[];
  /** Specialisaties (unie over alle locaties), gelabeld. */
  specializations: PublicKeyLabel[];
  /** Patiëntpopulatie (unie over alle locaties), gelabeld. */
  population: PublicKeyLabel[];
  /** Praktijkcultuur: unie van de traits over alle locaties, gelabeld. */
  culture: PublicKeyLabel[];
  /** Biedt minstens één gepubliceerde vacature begeleiding? */
  mentorship: boolean;
  /** Ontwikkelmogelijkheden (unie over gepubliceerde vacatures), gelabeld. */
  development: PublicKeyLabel[];
  /** Altijd true in API-uitvoer: zonder consent bestaat de praktijk publiek niet. */
  practiceConsent: boolean;
  /** Laatste wijziging van de organisatie, ISO 8601. */
  updatedAt: string;
  /** Aantal op dit moment gepubliceerde vacatures. */
  openJobs: number;
}

/** Eén taxonomiegroep met alle waarden. */
export interface PublicTaxonomyGroup {
  /** Stabiele groepssleutel, bv. "roles" of "equipment". */
  key: string;
  /** Nederlands label van de groep. */
  label: string;
  /** Alle waarden met sleutel + label. */
  values: PublicKeyLabel[];
}

/** Volledige taxonomie van GET /api/public/v1/taxonomies. */
export interface PublicTaxonomyView {
  groups: PublicTaxonomyGroup[];
}

/** Eén geaggregeerd, privacyveilig marktinzicht. */
export interface PublicMarketInsightItem {
  /** Soort inzicht, bv. "open_vacatures_per_functie". */
  view: string;
  /** Dimensiesleutel, bv. "mondhygienist" of "Utrecht". */
  dimension: string;
  /** Groepsgrootte waarop het cijfer is gebaseerd (altijd ≥ minGroupSize). */
  sampleSize: number;
  /** De geaggregeerde cijfers zelf (alleen aantallen, nooit herleidbaar). */
  data: Record<string, number>;
}

/** Antwoord van GET /api/public/v1/market-insights. */
export interface PublicMarketInsightView {
  /** Periode van de cijfers, bv. "2026-07". */
  period: string;
  /** Genereermoment, ISO 8601. */
  generatedAt: string;
  /** Minimale groepsgrootte: kleinere groepen worden nooit getoond. */
  minGroupSize: number;
  insights: PublicMarketInsightItem[];
}

// ---------------------------------------------------------------------------
// Regio (provincie) — via de stedentabel van src/server/geo.ts
// ---------------------------------------------------------------------------

/** Stad → provincie voor de steden uit de geo-tabel. Terugval: de stad zelf. */
const STAD_PROVINCIE: Record<string, string> = {
  Amsterdam: "Noord-Holland",
  Alkmaar: "Noord-Holland",
  Haarlem: "Noord-Holland",
  Almere: "Flevoland",
  Leiden: "Zuid-Holland",
  "Den Haag": "Zuid-Holland",
  Delft: "Zuid-Holland",
  Gouda: "Zuid-Holland",
  Rotterdam: "Zuid-Holland",
  Utrecht: "Utrecht",
  Amersfoort: "Utrecht",
  Middelburg: "Zeeland",
  Breda: "Noord-Brabant",
  Tilburg: "Noord-Brabant",
  "Den Bosch": "Noord-Brabant",
  Eindhoven: "Noord-Brabant",
  Maastricht: "Limburg",
  Nijmegen: "Gelderland",
  Arnhem: "Gelderland",
  Apeldoorn: "Gelderland",
  Enschede: "Overijssel",
  Zwolle: "Overijssel",
  Leeuwarden: "Friesland",
  Assen: "Drenthe",
  Groningen: "Groningen",
};

/** Provincie van een stad; onbekende steden vallen terug op de stadsnaam. */
export function regionForCity(city: string): string {
  return STAD_PROVINCIE[city] ?? city;
}

/** Postcode → alleen de vier cijfers (PC4); null bij onbruikbare invoer. */
export function postcode4Van(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const match = /^(\d{4})/.exec(postcode.trim().replace(/\s+/g, ""));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Hulpmappers
// ---------------------------------------------------------------------------

function naarKeyLabels(keys: string[]): PublicKeyLabel[] {
  return keys.map((key) => ({ key, label: label(key) }));
}

function naarPublicLocation(locatie: PracticeLocation): PublicLocation {
  return {
    city: locatie.city,
    region: regionForCity(locatie.city),
    postcode4: postcode4Van(locatie.postcode),
  };
}

/** VacancySchedule → PublicAvailability[], per dag gegroepeerd op niveau. */
function naarAvailability(vacancy: Vacancy): PublicAvailability[] {
  const rooster = castSchedule(vacancy.schedule);
  const uit: PublicAvailability[] = [];
  for (const dag of WEEKDAYS) {
    for (const niveau of ["required", "preferred"] as const) {
      const dagdelen = DAYPARTS.filter((dagdeel) => rooster[dag][dagdeel] === niveau);
      if (dagdelen.length > 0) {
        uit.push({ day: dag, dayparts: [...dagdelen], level: niveau });
      }
    }
  }
  return uit;
}

/** Criteria → eisen/wensen (registraties + minimaal ervaringsniveau). */
function naarRequirements(vacancy: Vacancy): PublicRequirement[] {
  const criteria = castCriteria(vacancy.criteria);
  const uit: PublicRequirement[] = [];
  for (const waarde of criteria.registrations?.values ?? []) {
    uit.push({ label: label(waarde), level: criteria.registrations?.level ?? "preferred" });
  }
  if (vacancy.experienceLevel) {
    uit.push({
      label: `Ervaringsniveau: minimaal ${label(vacancy.experienceLevel).toLowerCase()}`,
      level: "preferred",
    });
  }
  return uit;
}

function naarSalary(vacancy: Vacancy): PublicCompensation | undefined {
  if (vacancy.salaryMin === null && vacancy.salaryMax === null) return undefined;
  return { minCents: vacancy.salaryMin, maxCents: vacancy.salaryMax, period: "month" };
}

function naarRevenueShare(vacancy: Vacancy): PublicRevenueShare | undefined {
  if (vacancy.revenueShareMax === null) return undefined;
  return { maxPercent: vacancy.revenueShareMax };
}

export function canonicalJobPath(slug: string): string {
  return `/vacatures/${slug}`;
}

export function canonicalPracticePath(slug: string): string {
  return `/praktijken/${slug}`;
}

// ---------------------------------------------------------------------------
// Mappers Prisma → publieke types
// ---------------------------------------------------------------------------

export type VacancyMetContext = Vacancy & {
  location: PracticeLocation;
  organization: Organization;
};

/**
 * Vacature → volledige publieke weergave. `slug` is verplicht: de aanroeper
 * (queries.ts) garandeert via ensureVacancySlug dat die bestaat.
 */
export function toPublicJobView(vacancy: VacancyMetContext, slug: string): PublicJobView {
  const criteria = castCriteria(vacancy.criteria);
  const salary = naarSalary(vacancy);
  const revenueShare = naarRevenueShare(vacancy);
  const validThrough = vacancy.expiresAt?.toISOString();

  return {
    id: vacancy.id,
    slug,
    canonicalUrl: canonicalJobPath(slug),
    title: vacancy.title,
    role: { key: vacancy.role, label: label(vacancy.role) },
    organization: { name: vacancy.organization.name, slug: vacancy.organization.slug },
    location: naarPublicLocation(vacancy.location),
    description: vacancy.description,
    responsibilities: (criteria.treatments?.values ?? []).map((waarde) => label(waarde)),
    requirements: naarRequirements(vacancy),
    availability: naarAvailability(vacancy),
    hoursMin: vacancy.hoursMin,
    hoursMax: vacancy.hoursMax,
    employmentTypes: vacancy.contractTypes,
    ...(salary ? { salary } : {}),
    ...(revenueShare ? { revenueShare } : {}),
    equipment: naarKeyLabels(criteria.equipment?.values ?? []),
    software: naarKeyLabels(criteria.software?.values ?? []),
    specializations: naarKeyLabels(criteria.specializations?.values ?? []),
    culture: naarKeyLabels(vacancy.culture),
    mentorship: vacancy.mentorship,
    development: naarKeyLabels(vacancy.development),
    datePosted: (vacancy.publishedAt ?? vacancy.createdAt).toISOString(),
    ...(validThrough ? { validThrough } : {}),
    status: vacancy.status === "published" ? "published" : "closed",
    directApply: true,
    updatedAt: vacancy.updatedAt.toISOString(),
  };
}

/** Geordende unie van taxonomiesleutels over meerdere bronnen. */
function unie(...groepen: string[][]): string[] {
  return [...new Set(groepen.flat())];
}

/**
 * Organisatie + locaties + gepubliceerde vacatures → publieke praktijk.
 * De aanroeper (queries.ts) garandeert dat er consent is en dat er minstens
 * één locatie bestaat; de hoofdlocatie is de oudste (eerste) locatie.
 * mentorship/development worden afgeleid uit de gepubliceerde vacatures:
 * dat zijn de enige publieke bronnen van die praktijkkenmerken.
 */
export function toPublicPracticeView(
  organization: Organization,
  locations: PracticeLocation[],
  publishedVacancies: Pick<Vacancy, "mentorship" | "development">[],
): PublicPracticeView {
  const hoofdlocatie = locations[0];
  return {
    slug: organization.slug,
    canonicalUrl: canonicalPracticePath(organization.slug),
    name: organization.name,
    description: organization.publicDescription ?? "",
    city: hoofdlocatie.city,
    region: regionForCity(hoofdlocatie.city),
    locations: locations.map(naarPublicLocation),
    treatmentRooms: hoofdlocatie.treatmentRooms,
    traits: naarKeyLabels(hoofdlocatie.traits),
    equipment: naarKeyLabels(unie(...locations.map((l) => l.equipment))),
    software: naarKeyLabels(unie(...locations.map((l) => l.software))),
    specializations: naarKeyLabels(unie(...locations.map((l) => l.specializations))),
    population: naarKeyLabels(unie(...locations.map((l) => l.patientPopulation))),
    culture: naarKeyLabels(unie(...locations.map((l) => l.traits))),
    mentorship: publishedVacancies.some((v) => v.mentorship),
    development: naarKeyLabels(unie(...publishedVacancies.map((v) => v.development))),
    practiceConsent: organization.publicConsent,
    updatedAt: organization.updatedAt.toISOString(),
    openJobs: publishedVacancies.length,
  };
}

// ---------------------------------------------------------------------------
// Taxonomie
// ---------------------------------------------------------------------------

const TAXONOMIE_GROEPEN: ReadonlyArray<
  [key: string, groepLabel: string, waarden: readonly string[]]
> = [
  ["roles", "Functies", ROLES],
  ["experienceLevels", "Ervaringsniveaus", EXPERIENCE_LEVELS],
  ["contractTypes", "Contractvormen", CONTRACT_TYPES],
  ["registrations", "Registraties", REGISTRATIONS],
  ["equipment", "Apparatuur", EQUIPMENT],
  ["software", "Software", SOFTWARE],
  ["specializations", "Specialisaties", SPECIALIZATIONS],
  ["treatments", "Behandelingen", TREATMENTS],
  ["patientPopulation", "Patiëntpopulatie", PATIENT_POPULATION],
  ["culture", "Praktijkcultuur", CULTURE],
  ["development", "Ontwikkelmogelijkheden", DEVELOPMENT],
  ["practiceSizes", "Praktijkgroottes", PRACTICE_SIZES],
  ["workPaces", "Werktempo", WORK_PACES],
  ["teamPreferences", "Teamvoorkeuren", TEAM_PREFERENCES],
  ["weekdays", "Weekdagen", WEEKDAYS],
  ["dayparts", "Dagdelen", DAYPARTS],
];

/** Alle taxonomiegroepen met key + label — puur, geen database nodig. */
export function buildPublicTaxonomyView(): PublicTaxonomyView {
  return {
    groups: TAXONOMIE_GROEPEN.map(([key, groepLabel, waarden]) => ({
      key,
      label: groepLabel,
      values: naarKeyLabels([...waarden]),
    })),
  };
}
