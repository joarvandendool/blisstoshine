// Servicelaag voor vacatures. Alle lees- en schrijfacties zijn gescoped op de
// organisatie uit het geverifieerde membership (OrgContext) — een vacature van
// organisatie B is voor organisatie A onvindbaar (404), nooit alleen verboden.

import { createHash } from "node:crypto";
import { Prisma, type PracticeLocation, type Vacancy, type VacancyStatus } from "@prisma/client";
import { AuthzError, roleCan, type OrgContext } from "@/lib/authz";
import { dispatchEvent } from "@/lib/webhooks";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { enforceLimit } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  DAYPARTS,
  WEEKDAYS,
  emptySchedule,
  type CriterionSpec,
  type VacancyCriteria,
  type VacancySchedule,
} from "@/domain/taxonomy";
import type { MatchVacancy } from "@/domain/matching";
import { planCodeVoorAnalytics } from "@/server/organizations";

/** Vacature inclusief de praktijklocatie — de vorm die schermen meestal nodig hebben. */
export type VacancyWithLocation = Vacancy & { location: PracticeLocation };

export interface VacancyInput {
  locationId: string;
  title: string;
  role: string;
  description?: string | null;
  experienceLevel?: string | null;
  schedule?: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  contractTypes?: string[];
  startBy?: Date | null;
  startByHard?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  /** Maximaal geboden omzetpercentage bij zzp (geheel getal, 0–100). */
  revenueShareMax?: number | null;
  criteria?: VacancyCriteria;
  culture?: string[];
  mentorship?: boolean;
  development?: string[];
  flexibilityNote?: string | null;
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

/** Locatie ophalen binnen de eigen organisatie; anders 404. */
async function eigenLocatie(ctx: OrgContext, locationId: string): Promise<PracticeLocation> {
  const locatie = await prisma.practiceLocation.findFirst({
    where: { id: locationId, organizationId: ctx.organizationId },
  });
  if (!locatie) throw new AuthzError("Locatie niet gevonden", 404);
  return locatie;
}

/** Vacature ophalen binnen de eigen organisatie; anders 404. */
async function eigenVacature(ctx: OrgContext, id: string): Promise<VacancyWithLocation> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { location: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);
  return vacature;
}

function vereis(ctx: OrgContext, capability: string): void {
  if (!roleCan(ctx.role, capability)) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: ${capability}`, 403);
  }
}

// ---------------------------------------------------------------------------
// Publieke slug (fase 8)
// ---------------------------------------------------------------------------
//
// Elke gepubliceerde vacature krijgt een stabiele publieke slug van
// titel + stad + korte hash van het vacature-ID, bv.
// "mondhygienist-3-dagen-utrecht-a1b2c3". De slug wordt toegekend bij de
// eerste publicatie (of lazily voor al gepubliceerde vacatures zonder slug)
// en verandert daarna NOOIT meer — ook niet bij een titelwijziging. Codex
// bouwt hier /vacatures/[slug] op; de hash maakt de slug uniek zonder
// volgnummers.

/** Tekst → url-veilig slugdeel: kleine letters, geen diakrieten, koppeltekens. */
function slugDeel(tekst: string): string {
  return tekst
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diakrieten weg (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Korte, deterministische hash van het vacature-ID (uniekmaker in de slug). */
function slugHash(vacancyId: string, lengte = 6): string {
  return createHash("sha1").update(vacancyId).digest("hex").slice(0, lengte);
}

/** Pure slugopbouw: titel + stad + korte hash. Exported voor tests. */
export function buildVacancySlug(titel: string, stad: string, vacancyId: string, hashLengte = 6): string {
  const delen = [slugDeel(titel), slugDeel(stad)].filter(Boolean).join("-");
  return `${delen || "vacature"}-${slugHash(vacancyId, hashLengte)}`;
}

/**
 * Zorgt dat de vacature een slug heeft en geeft die terug. Bestaat er al
 * één, dan is die het antwoord (slugs wijzigen nooit). Toekenning is
 * race-veilig (updateMany op slug=null) en bij een — theoretische —
 * hash-botsing wordt één keer opnieuw geprobeerd met een langere hash.
 * Wordt gebruikt bij publicatie én lazily voor bestaande gepubliceerde
 * vacatures zonder slug (via de publieke read models).
 */
export async function ensureVacancySlug(
  vacancy: Pick<Vacancy, "id" | "slug" | "title" | "locationId">,
  city?: string,
): Promise<string> {
  if (vacancy.slug) return vacancy.slug;

  let stad = city;
  if (stad === undefined) {
    const locatie = await prisma.practiceLocation.findUnique({
      where: { id: vacancy.locationId },
      select: { city: true },
    });
    stad = locatie?.city ?? "";
  }

  for (const hashLengte of [6, 12]) {
    const kandidaat = buildVacancySlug(vacancy.title, stad, vacancy.id, hashLengte);
    try {
      // Alleen zetten wanneer nog geen slug is toegekend (race-veilig).
      await prisma.vacancy.updateMany({
        where: { id: vacancy.id, slug: null },
        data: { slug: kandidaat },
      });
      break;
    } catch (fout) {
      const botsing =
        fout instanceof Prisma.PrismaClientKnownRequestError && fout.code === "P2002";
      if (!botsing || hashLengte === 12) throw fout;
    }
  }

  const vers = await prisma.vacancy.findUniqueOrThrow({
    where: { id: vacancy.id },
    select: { slug: true },
  });
  if (!vers.slug) throw new Error(`Slug toekennen mislukt voor vacature ${vacancy.id}`);
  return vers.slug;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Maakt een conceptvacature aan (status draft). Capability: vacancy.manage. */
export async function createDraftVacancy(
  ctx: OrgContext,
  input: VacancyInput,
): Promise<VacancyWithLocation> {
  vereis(ctx, "vacancy.manage");
  const locatie = await eigenLocatie(ctx, input.locationId);

  const vacature = await prisma.vacancy.create({
    data: {
      organizationId: ctx.organizationId,
      locationId: locatie.id,
      title: input.title,
      role: input.role,
      description: input.description ?? null,
      experienceLevel: input.experienceLevel ?? null,
      schedule: (input.schedule ?? emptySchedule()) as unknown as Prisma.InputJsonValue,
      hoursMin: input.hoursMin,
      hoursMax: input.hoursMax,
      contractTypes: input.contractTypes ?? [],
      startBy: input.startBy ?? null,
      startByHard: input.startByHard ?? false,
      salaryMin: input.salaryMin ?? null,
      salaryMax: input.salaryMax ?? null,
      revenueShareMax: input.revenueShareMax ?? null,
      criteria: (input.criteria ?? {}) as unknown as Prisma.InputJsonValue,
      culture: input.culture ?? [],
      mentorship: input.mentorship ?? false,
      development: input.development ?? [],
      flexibilityNote: input.flexibilityNote ?? null,
    },
    include: { location: true },
  });

  await track("vacancy_started", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    context: { vacancyId: vacature.id, role: input.role },
  });

  return vacature;
}

/** Werkt een vacature bij; alleen meegegeven velden veranderen. */
export async function updateVacancy(
  ctx: OrgContext,
  id: string,
  input: Partial<VacancyInput>,
): Promise<VacancyWithLocation> {
  vereis(ctx, "vacancy.manage");
  await eigenVacature(ctx, id);
  if (input.locationId !== undefined) await eigenLocatie(ctx, input.locationId);

  return prisma.vacancy.update({
    where: { id },
    data: {
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.experienceLevel !== undefined
        ? { experienceLevel: input.experienceLevel }
        : {}),
      ...(input.schedule !== undefined
        ? { schedule: input.schedule as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.hoursMin !== undefined ? { hoursMin: input.hoursMin } : {}),
      ...(input.hoursMax !== undefined ? { hoursMax: input.hoursMax } : {}),
      ...(input.contractTypes !== undefined ? { contractTypes: input.contractTypes } : {}),
      ...(input.startBy !== undefined ? { startBy: input.startBy } : {}),
      ...(input.startByHard !== undefined ? { startByHard: input.startByHard } : {}),
      ...(input.salaryMin !== undefined ? { salaryMin: input.salaryMin } : {}),
      ...(input.salaryMax !== undefined ? { salaryMax: input.salaryMax } : {}),
      ...(input.revenueShareMax !== undefined
        ? { revenueShareMax: input.revenueShareMax }
        : {}),
      ...(input.criteria !== undefined
        ? { criteria: input.criteria as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.culture !== undefined ? { culture: input.culture } : {}),
      ...(input.mentorship !== undefined ? { mentorship: input.mentorship } : {}),
      ...(input.development !== undefined ? { development: input.development } : {}),
      ...(input.flexibilityNote !== undefined
        ? { flexibilityNote: input.flexibilityNote }
        : {}),
    },
    include: { location: true },
  });
}

/** Eén vacature (inclusief locatie), altijd binnen de eigen organisatie. */
export async function getVacancy(ctx: OrgContext, id: string): Promise<VacancyWithLocation> {
  return eigenVacature(ctx, id);
}

/** Vacatures van de eigen organisatie, optioneel gefilterd op status. */
export async function listVacancies(
  ctx: OrgContext,
  status?: VacancyStatus,
): Promise<VacancyWithLocation[]> {
  return prisma.vacancy.findMany({
    where: { organizationId: ctx.organizationId, ...(status ? { status } : {}) },
    include: { location: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Statusovergangen
// ---------------------------------------------------------------------------

/**
 * Publiceert een vacature. Capability: vacancy.publish. De limiet
 * max_active_vacancies wordt gecontroleerd tegen het huidige aantal
 * gepubliceerde vacatures van de organisatie.
 */
export async function publishVacancy(ctx: OrgContext, id: string): Promise<VacancyWithLocation> {
  vereis(ctx, "vacancy.publish");
  const vacature = await eigenVacature(ctx, id);
  if (vacature.status === "published") return vacature;

  const aantalGepubliceerd = await prisma.vacancy.count({
    where: { organizationId: ctx.organizationId, status: "published" },
  });
  await enforceLimit(ctx.organizationId, "max_active_vacancies", aantalGepubliceerd);

  // Stabiele publieke slug: toegekend bij eerste publicatie, wijzigt nooit meer.
  const slug = await ensureVacancySlug(vacature, vacature.location.city);

  const gepubliceerd = await prisma.vacancy.update({
    where: { id: vacature.id },
    data: { status: "published", publishedAt: new Date() },
    include: { location: true },
  });

  await track("vacancy_published", {
    organizationId: ctx.organizationId,
    locationId: vacature.locationId,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { vacancyId: vacature.id, role: vacature.role },
  });
  await audit("vacancy.publish", "Vacancy", vacature.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { title: vacature.title },
  });

  // Webhook-event voor integraties (fase 9). dispatchEvent faalt zacht:
  // een kapotte webhook mag publiceren nooit blokkeren.
  await dispatchEvent(ctx.organizationId, "vacancy.published", {
    vacancyId: gepubliceerd.id,
    slug,
    title: gepubliceerd.title,
    role: gepubliceerd.role,
    city: gepubliceerd.location.city,
    publishedAt: gepubliceerd.publishedAt?.toISOString() ?? null,
  });

  return gepubliceerd;
}

/** Markeert een vacature als vervuld. Capability: vacancy.manage. */
export async function markFilled(ctx: OrgContext, id: string): Promise<VacancyWithLocation> {
  vereis(ctx, "vacancy.manage");
  const vacature = await eigenVacature(ctx, id);

  // vacancy_filled telt precies één keer per plaatsing: alleen bij de
  // daadwerkelijke overgang naar "filled". Een herhaalde markFilled (of een
  // al vervulde vacature) vuurt het event niet opnieuw — het is de énige
  // emitter van vacancy_filled (updateApplicationStatus doet dit bewust niet).
  const wasAlVervuld = vacature.status === "filled";

  const vervuld = await prisma.vacancy.update({
    where: { id: vacature.id },
    data: { status: "filled" },
    include: { location: true },
  });

  if (!wasAlVervuld) {
    await track("vacancy_filled", {
      organizationId: ctx.organizationId,
      locationId: vacature.locationId,
      userId: ctx.user.id,
      context: { vacancyId: vacature.id, role: vacature.role },
    });
    await audit("vacancy.fill", "Vacancy", vacature.id, {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
    });
  }

  return vervuld;
}

// ---------------------------------------------------------------------------
// Mapping naar het matching-contract
// ---------------------------------------------------------------------------

/** Json-kolom → VacancySchedule, defensief (ontbrekend = niet gevraagd). */
export function castSchedule(waarde: unknown): VacancySchedule {
  const basis = emptySchedule();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        const eis = (rij as Record<string, unknown>)[dagdeel];
        if (eis === "required" || eis === "preferred") basis[dag][dagdeel] = eis;
      }
    }
  }
  return basis;
}

const CRITERIA_SLEUTELS = [
  "registrations",
  "equipment",
  "software",
  "specializations",
  "treatments",
  "population",
] as const;

/** Json-kolom → VacancyCriteria, defensief (alleen herkenbare specs blijven over). */
export function castCriteria(waarde: unknown): VacancyCriteria {
  const uit: VacancyCriteria = {};
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) return uit;
  for (const sleutel of CRITERIA_SLEUTELS) {
    const spec = (waarde as Record<string, unknown>)[sleutel];
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) continue;
    const { values, level } = spec as Record<string, unknown>;
    if (!Array.isArray(values)) continue;
    const niveau =
      level === "required" || level === "preferred" || level === "informational"
        ? level
        : "preferred";
    uit[sleutel] = {
      values: values.filter((v): v is string => typeof v === "string"),
      level: niveau,
    } satisfies CriterionSpec;
  }
  return uit;
}

/** Behandelkamers → praktijkgrootte-taxonomie: ≤2 klein, ≤5 middel, anders groot. */
export function practiceSizeVanKamers(treatmentRooms: number): string {
  if (treatmentRooms <= 2) return "klein";
  if (treatmentRooms <= 5) return "middel";
  return "groot";
}

/** Opgeslagen vacature + locatie → MatchVacancy voor de matching-engine. Pure mapper. */
export function vacancyToMatchVacancy(
  vacancy: Vacancy,
  location: PracticeLocation,
): MatchVacancy {
  return {
    id: vacancy.id,
    role: vacancy.role,
    experienceLevel: vacancy.experienceLevel,
    latitude: location.latitude,
    longitude: location.longitude,
    schedule: castSchedule(vacancy.schedule),
    hoursMin: vacancy.hoursMin,
    hoursMax: vacancy.hoursMax,
    contractTypes: vacancy.contractTypes,
    salaryMax: vacancy.salaryMax,
    revenueShareMax: vacancy.revenueShareMax,
    startBy: vacancy.startBy,
    startByHard: vacancy.startByHard,
    criteria: castCriteria(vacancy.criteria),
    culture: vacancy.culture,
    mentorship: vacancy.mentorship,
    development: vacancy.development,
    practiceSize: practiceSizeVanKamers(location.treatmentRooms),
    patientPopulation: location.patientPopulation,
  };
}
