// Seed met realistische Nederlandse demodata. Idempotent: upserts op vaste
// sleutels (e-mailadressen, slugs, titels, idempotencyKeys); de seed kan
// onbeperkt opnieuw draaien met `npm run db:seed`.
//
// Datumbeleid: pipeline-historie (events, sollicitaties, snapshots) gebruikt
// VASTE ISO-datums zodat KPI's reproduceerbaar zijn. Alleen operationele
// toestand die anders zou verlopen (abonnementsperiodes, trialeinde) wordt
// relatief aan het draaimoment gezet.

import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  Prisma,
  type CandidateProfile,
  type CandidateStatus,
  type PracticeLocation,
  type ProfileVisibility,
  type SnapshotContext,
  type User,
  type Vacancy,
  type VacancyStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncPlanCatalog } from "@/lib/billing";
import { getPlanVersion, type PlanCode } from "@/domain/entitlements";
import { ALGORITHM_VERSION, MATCHING_CONFIG } from "@/domain/matching";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import {
  DAYPARTS,
  WEEKDAYS,
  emptyAvailability,
  emptySchedule,
  type AvailabilityLevel,
  type CandidateAvailability,
  type Daypart,
  type ScheduleRequirement,
  type VacancyCriteria,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";
import { geocodePostcode } from "@/server/geo";
import { berekenCompleteness, profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";

// ---------------------------------------------------------------------------
// Inloggegevens (demo)
// ---------------------------------------------------------------------------

const WACHTWOORD_ADMIN = "demo-admin-2026";
const WACHTWOORD_PRAKTIJK = "demo-praktijk-2026";
const WACHTWOORD_KANDIDAAT = "demo-kandidaat-2026";

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

const DAG_MS = 86_400_000;

function alsJson(waarde: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(waarde)) as Prisma.InputJsonValue;
}

/** Beschikbaarheid opbouwen: alles unavailable behalve de opgegeven dagdelen. */
function beschikbaarheid(
  spec: Partial<Record<Weekday, Partial<Record<Daypart, AvailabilityLevel>>>>,
): CandidateAvailability {
  const basis = emptyAvailability();
  for (const dag of WEEKDAYS) {
    const dagdelen = spec[dag];
    if (!dagdelen) continue;
    for (const dagdeel of DAYPARTS) {
      const niveau = dagdelen[dagdeel];
      if (niveau) basis[dag][dagdeel] = niveau;
    }
  }
  return basis;
}

/** Vacatuurrooster opbouwen: niets gevraagd behalve de opgegeven dagdelen. */
function rooster(
  spec: Partial<Record<Weekday, Partial<Record<Daypart, ScheduleRequirement>>>>,
): VacancySchedule {
  const basis = emptySchedule();
  for (const dag of WEEKDAYS) {
    const dagdelen = spec[dag];
    if (!dagdelen) continue;
    for (const dagdeel of DAYPARTS) {
      const eis = dagdelen[dagdeel];
      if (eis !== undefined) basis[dag][dagdeel] = eis;
    }
  }
  return basis;
}

async function zorgGebruiker(
  email: string,
  name: string,
  passwordHash: string,
  isPlatformAdmin = false,
): Promise<User> {
  return prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash, isPlatformAdmin },
    update: { name, passwordHash, isPlatformAdmin },
  });
}

async function zorgLid(
  userId: string,
  organizationId: string,
  role: "owner" | "admin" | "recruiter" | "hiring_manager" | "viewer",
): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: { userId, organizationId, role },
    update: { role, status: "active" },
  });
}

interface LocatieSeed {
  name: string;
  street: string;
  houseNumber: string;
  postcode: string;
  phone?: string;
  treatmentRooms: number;
  traits?: string[];
  equipment?: string[];
  software?: string[];
  specializations?: string[];
  patientPopulation?: string[];
}

async function zorgLocatie(
  organizationId: string,
  seed: LocatieSeed,
): Promise<PracticeLocation> {
  const geo = geocodePostcode(seed.postcode);
  if (!geo) throw new Error(`Onbekende postcode in seed: ${seed.postcode}`);
  const data = {
    street: seed.street,
    houseNumber: seed.houseNumber,
    postcode: seed.postcode,
    city: geo.city,
    latitude: geo.latitude,
    longitude: geo.longitude,
    phone: seed.phone ?? null,
    treatmentRooms: seed.treatmentRooms,
    traits: seed.traits ?? [],
    equipment: seed.equipment ?? [],
    software: seed.software ?? [],
    specializations: seed.specializations ?? [],
    patientPopulation: seed.patientPopulation ?? [],
  };
  const bestaand = await prisma.practiceLocation.findFirst({
    where: { organizationId, name: seed.name },
  });
  if (bestaand) {
    return prisma.practiceLocation.update({ where: { id: bestaand.id }, data });
  }
  return prisma.practiceLocation.create({
    data: { organizationId, name: seed.name, ...data },
  });
}

/** Abonnement van een organisatie op het gewenste plan en de gewenste status zetten. */
async function zorgAbonnement(
  organizationId: string,
  planCode: PlanCode,
  status: "active" | "trialing",
): Promise<void> {
  const catalogusVersie = getPlanVersion(planCode);
  const planVersion = await prisma.planVersion.findFirst({
    where: { plan: { code: planCode }, version: catalogusVersie.version },
  });
  if (!planVersion) {
    throw new Error(`Planversie ${planCode} v${catalogusVersie.version} ontbreekt — draai syncPlanCatalog eerst`);
  }

  // Operationele toestand: periodes lopen vanaf het draaimoment, zodat de
  // demo-omgeving nooit met een verlopen trial of periode start.
  const nu = new Date();
  const trialEindeAt =
    status === "trialing"
      ? new Date(nu.getTime() + (catalogusVersie.trialDays ?? 14) * DAG_MS)
      : null;
  const periodeEinde = trialEindeAt ?? new Date(nu.getTime() + 30 * DAG_MS);
  const data = {
    planVersionId: planVersion.id,
    status,
    currentPeriodStart: nu,
    currentPeriodEnd: periodeEinde,
    trialEndsAt: trialEindeAt,
  };

  const bestaand = await prisma.subscription.findFirst({
    where: { organizationId, status: { not: "canceled" } },
    orderBy: { createdAt: "desc" },
  });
  if (bestaand) {
    await prisma.subscription.update({ where: { id: bestaand.id }, data });
  } else {
    await prisma.subscription.create({ data: { organizationId, ...data } });
  }
}

interface KandidaatSeed {
  email: string;
  name: string;
  role: string;
  experienceLevel: string;
  postcode: string;
  maxTravelMinutes: number;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  salaryMin?: number;
  salaryMax?: number;
  hourlyRateMin?: number;
  availability: CandidateAvailability;
  equipmentExperience?: string[];
  equipmentWantsToWork?: string[];
  techniquesWantsToLearn?: string[];
  softwareSkills?: string[];
  specializations?: string[];
  treatmentInterests?: string[];
  preferredPopulation?: string[];
  mentorshipNeeded?: boolean;
  developmentGoals?: string[];
  preferredPracticeSize?: string | null;
  workPace?: string | null;
  teamPreferences?: string[];
  visibility: ProfileVisibility;
  status: CandidateStatus;
  /** Heeft de kandidaat de zichtbaarheidskeuze bevestigd? (volledigheidsgroep) */
  keuzeBevestigd?: boolean;
}

async function zorgKandidaat(
  seed: KandidaatSeed,
  passwordHash: string,
): Promise<{ user: User; profile: CandidateProfile }> {
  const user = await zorgGebruiker(seed.email, seed.name, passwordHash);
  const geo = geocodePostcode(seed.postcode);
  if (!geo) throw new Error(`Onbekende postcode in seed: ${seed.postcode}`);

  const bevestigd = seed.keuzeBevestigd ?? true;
  const kern = {
    role: seed.role,
    experienceLevel: seed.experienceLevel,
    postcode: seed.postcode,
    latitude: geo.latitude,
    longitude: geo.longitude,
    maxTravelMinutes: seed.maxTravelMinutes,
    hoursMin: seed.hoursMin,
    hoursMax: seed.hoursMax,
    contractTypes: seed.contractTypes,
    salaryMin: seed.salaryMin ?? null,
    salaryMax: seed.salaryMax ?? null,
    hourlyRateMin: seed.hourlyRateMin ?? null,
    equipmentExperience: seed.equipmentExperience ?? [],
    equipmentWantsToWork: seed.equipmentWantsToWork ?? [],
    techniquesWantsToLearn: seed.techniquesWantsToLearn ?? [],
    softwareSkills: seed.softwareSkills ?? [],
    specializations: seed.specializations ?? [],
    treatmentInterests: seed.treatmentInterests ?? [],
    preferredPopulation: seed.preferredPopulation ?? [],
    mentorshipNeeded: seed.mentorshipNeeded ?? false,
    developmentGoals: seed.developmentGoals ?? [],
    preferredPracticeSize: seed.preferredPracticeSize ?? null,
    workPace: seed.workPace ?? null,
    teamPreferences: seed.teamPreferences ?? [],
    visibility: seed.visibility,
    status: seed.status,
  };
  const anonymitySettings = bevestigd ? { keuzeBevestigd: true } : null;
  const completenessScore = berekenCompleteness({
    ...kern,
    availability: seed.availability,
    anonymitySettings,
  });
  const data = {
    ...kern,
    availability: seed.availability as unknown as Prisma.InputJsonValue,
    anonymitySettings: anonymitySettings === null ? Prisma.DbNull : alsJson(anonymitySettings),
    completenessScore,
  };

  const profile = await prisma.candidateProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });
  return { user, profile };
}

interface VacatureSeed {
  title: string;
  role: string;
  description: string;
  experienceLevel?: string | null;
  schedule: VacancySchedule;
  hoursMin: number;
  hoursMax: number;
  contractTypes: string[];
  salaryMin?: number;
  salaryMax?: number;
  hourlyRateMax?: number;
  criteria: VacancyCriteria;
  culture?: string[];
  mentorship?: boolean;
  development?: string[];
  flexibilityNote?: string;
  status: VacancyStatus;
  publishedAt?: Date;
  /** Vaste updatedAt voor historie (bv. het vervullingsmoment). */
  updatedAt?: Date;
}

type VacatureMetLocatie = Vacancy & { location: PracticeLocation };

async function zorgVacature(
  organizationId: string,
  locationId: string,
  seed: VacatureSeed,
): Promise<VacatureMetLocatie> {
  const data = {
    locationId,
    title: seed.title,
    role: seed.role,
    description: seed.description,
    experienceLevel: seed.experienceLevel ?? null,
    schedule: seed.schedule as unknown as Prisma.InputJsonValue,
    hoursMin: seed.hoursMin,
    hoursMax: seed.hoursMax,
    contractTypes: seed.contractTypes,
    salaryMin: seed.salaryMin ?? null,
    salaryMax: seed.salaryMax ?? null,
    hourlyRateMax: seed.hourlyRateMax ?? null,
    criteria: seed.criteria as unknown as Prisma.InputJsonValue,
    culture: seed.culture ?? [],
    mentorship: seed.mentorship ?? false,
    development: seed.development ?? [],
    flexibilityNote: seed.flexibilityNote ?? null,
    status: seed.status,
    publishedAt: seed.publishedAt ?? null,
    ...(seed.updatedAt ? { updatedAt: seed.updatedAt } : {}),
  };
  const bestaand = await prisma.vacancy.findFirst({
    where: { organizationId, title: seed.title },
  });
  if (bestaand) {
    return prisma.vacancy.update({
      where: { id: bestaand.id },
      data,
      include: { location: true },
    });
  }
  return prisma.vacancy.create({
    data: { organizationId, ...data },
    include: { location: true },
  });
}

/**
 * MatchSnapshot met echt berekend resultaat (zelfde engine als runtime).
 * Idempotent per vacature+kandidaat+context.
 */
async function zorgSnapshot(
  vacature: VacatureMetLocatie,
  profiel: CandidateProfile,
  context: SnapshotContext,
  createdAt: Date,
): Promise<string> {
  const kandidaat = profileToMatchCandidate(profiel);
  const matchVacature = vacancyToMatchVacancy(vacature, vacature.location);
  const resultaat = computeMatchWithOpportunities(kandidaat, matchVacature);
  const data = {
    score: resultaat.score,
    label: resultaat.label,
    algorithmVersion: resultaat.algorithmVersion,
    result: alsJson(resultaat),
    profileData: alsJson(kandidaat),
    vacancyData: alsJson(matchVacature),
    createdAt,
  };
  const bestaand = await prisma.matchSnapshot.findFirst({
    where: { vacancyId: vacature.id, candidateUserId: profiel.userId, context },
  });
  if (bestaand) {
    await prisma.matchSnapshot.update({ where: { id: bestaand.id }, data });
    return bestaand.id;
  }
  const nieuw = await prisma.matchSnapshot.create({
    data: {
      vacancyId: vacature.id,
      candidateUserId: profiel.userId,
      context,
      ...data,
    },
  });
  return nieuw.id;
}

// ---------------------------------------------------------------------------
// Hoofdprogramma
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Seed gestart …");

  // 1. Plancatalogus en matchingconfiguratie.
  await syncPlanCatalog();
  await prisma.matchingConfigVersion.upsert({
    where: { version: ALGORITHM_VERSION },
    create: { version: ALGORITHM_VERSION, config: alsJson(MATCHING_CONFIG) },
    update: { config: alsJson(MATCHING_CONFIG) },
  });
  console.log(`Plancatalogus en matchingconfiguratie v${ALGORITHM_VERSION} gesynchroniseerd.`);

  const [adminHash, praktijkHash, kandidaatHash] = await Promise.all([
    bcrypt.hash(WACHTWOORD_ADMIN, 10),
    bcrypt.hash(WACHTWOORD_PRAKTIJK, 10),
    bcrypt.hash(WACHTWOORD_KANDIDAAT, 10),
  ]);

  // 2. Platform-admin (demo).
  await zorgGebruiker("admin@mondzorgwerkt.nl", "Platformbeheer", adminHash, true);

  // 2b. Eigenaarsaccount. Wachtwoord komt uit ADMIN_PASSWORD of wordt eenmalig
  // willekeurig gegenereerd en alleen in de console getoond — nooit in de repo.
  // Bij een bestaand account wordt het wachtwoord NIET overschreven.
  const eigenaarEmail = "info@joarvandendool.com";
  const bestaandeEigenaar = await prisma.user.findUnique({
    where: { email: eigenaarEmail },
  });
  let eigenaarWachtwoordMelding = "(bestaand wachtwoord ongewijzigd)";
  if (bestaandeEigenaar) {
    await prisma.user.update({
      where: { email: eigenaarEmail },
      data: { isPlatformAdmin: true },
    });
  } else {
    const eigenaarWachtwoord =
      process.env.ADMIN_PASSWORD ?? `mzw-${randomBytes(9).toString("base64url")}`;
    await prisma.user.create({
      data: {
        email: eigenaarEmail,
        name: "Joar van den Dool",
        passwordHash: await bcrypt.hash(eigenaarWachtwoord, 10),
        isPlatformAdmin: true,
      },
    });
    eigenaarWachtwoordMelding = process.env.ADMIN_PASSWORD
      ? "(wachtwoord uit ADMIN_PASSWORD)"
      : `wachtwoord: ${eigenaarWachtwoord}  ← bewaar dit, wordt niet opnieuw getoond`;
  }

  // 3. Praktijk 1: Mondzorgpraktijk De Lindeboom (Utrecht, growth).
  const lindeboomOwner = await zorgGebruiker(
    "praktijk@delindeboom.nl",
    "Karin van der Linde",
    praktijkHash,
  );
  const lindeboomRecruiter = await zorgGebruiker(
    "recruiter@delindeboom.nl",
    "Mark Hendriks",
    praktijkHash,
  );
  const lindeboom = await prisma.organization.upsert({
    where: { slug: "mondzorgpraktijk-de-lindeboom" },
    create: {
      name: "Mondzorgpraktijk De Lindeboom",
      slug: "mondzorgpraktijk-de-lindeboom",
      kvkNumber: "64821973",
      billingEmail: "administratie@delindeboom.nl",
      acquisitionSource: "vakblad",
    },
    update: { name: "Mondzorgpraktijk De Lindeboom", status: "active" },
  });
  const lindeboomLocatie = await zorgLocatie(lindeboom.id, {
    name: "De Lindeboom — Utrecht Centrum",
    street: "Lange Nieuwstraat",
    houseNumber: "42",
    postcode: "3511 AB",
    phone: "030 231 44 55",
    treatmentRooms: 4,
    traits: ["informeel", "leergericht", "patientgericht"],
    equipment: ["trios", "opg"],
    software: ["exquise"],
    specializations: ["parodontologie", "implantologie"],
    patientPopulation: ["kinderen", "volwassenen", "ouderen"],
  });
  await zorgLid(lindeboomOwner.id, lindeboom.id, "owner");
  await zorgLid(lindeboomRecruiter.id, lindeboom.id, "recruiter");
  await zorgAbonnement(lindeboom.id, "growth", "active");

  // 4. Praktijk 2: Tandartsen aan de Maas (Rotterdam, trial).
  const maasOwner = await zorgGebruiker(
    "praktijk@aandemaas.nl",
    "Pieter de Graaf",
    praktijkHash,
  );
  const aanDeMaas = await prisma.organization.upsert({
    where: { slug: "tandartsen-aan-de-maas" },
    create: {
      name: "Tandartsen aan de Maas",
      slug: "tandartsen-aan-de-maas",
      kvkNumber: "77410258",
      billingEmail: "praktijk@aandemaas.nl",
      acquisitionSource: "google",
    },
    update: { name: "Tandartsen aan de Maas", status: "active" },
  });
  const maasLocatie = await zorgLocatie(aanDeMaas.id, {
    name: "Tandartsen aan de Maas",
    street: "Wijnhaven",
    houseNumber: "107",
    postcode: "3011 WN",
    phone: "010 411 78 20",
    treatmentRooms: 2,
    traits: ["gestructureerd", "patientgericht"],
    equipment: ["itero"],
    software: ["simplex"],
    specializations: [],
    patientPopulation: ["volwassenen", "ouderen"],
  });
  await zorgLid(maasOwner.id, aanDeMaas.id, "owner");
  await zorgAbonnement(aanDeMaas.id, "trial", "trialing");

  console.log("Praktijken, leden en abonnementen aangemaakt.");

  // 5. Tien kandidaten (gevarieerd in rol, stad, beschikbaarheid en apparatuur).
  //
  // Sanne de Vries is het productvisie-voorbeeld: dinsdag+donderdag preferred,
  // woensdag unavailable. De Lindeboom-vacature hieronder vraagt woensdag-
  // ochtend verplicht, waardoor Sanne een bijna-match is; de opportunity-
  // engine stelt voor woensdag flexibel te maken → match van 96%.
  const sanne = await zorgKandidaat(
    {
      email: "kandidaat@demo.nl",
      name: "Sanne de Vries",
      role: "mondhygienist",
      experienceLevel: "medior",
      postcode: "3511 BD",
      maxTravelMinutes: 45,
      hoursMin: 24,
      hoursMax: 32,
      contractTypes: ["loondienst"],
      salaryMin: 320_000,
      salaryMax: 400_000,
      availability: beschikbaarheid({
        ma: { ochtend: "available", middag: "available" },
        di: { ochtend: "preferred", middag: "preferred" },
        do: { ochtend: "preferred", middag: "preferred" },
        vr: { ochtend: "available", middag: "available" },
      }),
      equipmentExperience: ["trios", "airflow"],
      softwareSkills: ["exquise"],
      specializations: ["parodontologie"],
      treatmentInterests: ["gebitsreiniging", "periodieke_controle"],
      preferredPopulation: ["volwassenen", "ouderen"],
      mentorshipNeeded: true,
      developmentGoals: ["specialisatietraject"],
      preferredPracticeSize: "middel",
      workPace: "gemiddeld",
      teamPreferences: ["veel_overleg"],
      visibility: "visible",
      status: "active",
    },
    kandidaatHash,
  );

  // Femke is de 86%-match op dezelfde vacature (alle gevraagde dagen kunnen,
  // wil TRIOS leren werken, iets langere reistijd vanuit Amsterdam).
  const femke = await zorgKandidaat(
    {
      email: "femke.jansen@demo.nl",
      name: "Femke Jansen",
      role: "mondhygienist",
      experienceLevel: "medior",
      postcode: "1011 AC",
      maxTravelMinutes: 50,
      hoursMin: 24,
      hoursMax: 32,
      contractTypes: ["loondienst"],
      salaryMin: 330_000,
      salaryMax: 410_000,
      availability: beschikbaarheid({
        ma: { ochtend: "available" },
        di: { ochtend: "preferred", middag: "preferred" },
        wo: { ochtend: "preferred", middag: "preferred" },
        do: { ochtend: "preferred", middag: "preferred" },
      }),
      equipmentExperience: ["airflow"],
      equipmentWantsToWork: ["trios"],
      softwareSkills: ["exquise"],
      visibility: "anonymous",
      status: "active",
    },
    kandidaatHash,
  );

  const lotte = await zorgKandidaat(
    {
      email: "lotte@demo.nl",
      name: "Lotte van Dijk",
      role: "tandartsassistent",
      experienceLevel: "medior",
      postcode: "3511 CE",
      maxTravelMinutes: 30,
      hoursMin: 16,
      hoursMax: 24,
      contractTypes: ["loondienst"],
      salaryMin: 240_000,
      salaryMax: 290_000,
      availability: beschikbaarheid({
        ma: { ochtend: "preferred", middag: "preferred" },
        di: { ochtend: "preferred", middag: "preferred" },
        wo: { ochtend: "available", middag: "available" },
      }),
      equipmentExperience: ["opg"],
      softwareSkills: ["exquise"],
      treatmentInterests: ["periodieke_controle"],
      preferredPopulation: ["kinderen"],
      preferredPracticeSize: "middel",
      visibility: "visible",
      status: "active",
    },
    kandidaatHash,
  );

  const daan = await zorgKandidaat(
    {
      email: "daan@demo.nl",
      name: "Daan Bakker",
      role: "tandartsassistent",
      experienceLevel: "starter",
      postcode: "3811 GH",
      maxTravelMinutes: 45,
      hoursMin: 20,
      hoursMax: 32,
      contractTypes: ["loondienst"],
      salaryMin: 220_000,
      salaryMax: 260_000,
      availability: beschikbaarheid({
        ma: { ochtend: "available", middag: "available" },
        di: { ochtend: "available", middag: "available" },
        wo: { ochtend: "available", middag: "available" },
        do: { ochtend: "available", middag: "available" },
        vr: { ochtend: "available", middag: "available" },
      }),
      techniquesWantsToLearn: ["opg"],
      softwareSkills: ["exquise"],
      mentorshipNeeded: true,
      developmentGoals: ["interne_opleiding"],
      visibility: "anonymous",
      status: "active",
    },
    kandidaatHash,
  );

  const yusuf = await zorgKandidaat(
    {
      email: "yusuf@demo.nl",
      name: "Yusuf Demir",
      role: "tandarts",
      experienceLevel: "senior",
      postcode: "3011 BR",
      maxTravelMinutes: 40,
      hoursMin: 24,
      hoursMax: 36,
      contractTypes: ["zzp"],
      hourlyRateMin: 9_500,
      availability: beschikbaarheid({
        ma: { ochtend: "preferred", middag: "preferred" },
        di: { ochtend: "preferred", middag: "preferred" },
        do: { ochtend: "preferred", middag: "preferred" },
        vr: { ochtend: "preferred", middag: "preferred" },
      }),
      equipmentExperience: ["itero", "cbct"],
      softwareSkills: ["simplex"],
      specializations: ["implantologie"],
      treatmentInterests: ["implantaten", "kronen_bruggen"],
      preferredPopulation: ["volwassenen", "ouderen"],
      workPace: "hoog",
      visibility: "visible",
      status: "active",
    },
    kandidaatHash,
  );

  const emma = await zorgKandidaat(
    {
      email: "emma@demo.nl",
      name: "Emma Visser",
      role: "preventieassistent",
      experienceLevel: "medior",
      postcode: "2311 EZ",
      maxTravelMinutes: 60,
      hoursMin: 8,
      hoursMax: 16,
      contractTypes: ["loondienst"],
      salaryMin: 90_000,
      salaryMax: 130_000,
      availability: beschikbaarheid({
        ma: { ochtend: "preferred" },
        do: { ochtend: "available", middag: "available" },
      }),
      softwareSkills: ["oase"],
      treatmentInterests: ["gebitsreiniging"],
      preferredPopulation: ["kinderen"],
      visibility: "visible",
      status: "active",
    },
    kandidaatHash,
  );

  const thomas = await zorgKandidaat(
    {
      email: "thomas@demo.nl",
      name: "Thomas Mulder",
      role: "mondhygienist",
      experienceLevel: "senior",
      postcode: "8011 NB",
      maxTravelMinutes: 60,
      hoursMin: 16,
      hoursMax: 24,
      contractTypes: ["zzp"],
      hourlyRateMin: 8_500,
      availability: beschikbaarheid({
        ma: { ochtend: "preferred", middag: "preferred" },
        di: { ochtend: "preferred", middag: "preferred" },
        wo: { ochtend: "available" },
        do: { ochtend: "available", middag: "available" },
      }),
      equipmentExperience: ["trios"],
      softwareSkills: ["evolution"],
      specializations: ["parodontologie"],
      visibility: "anonymous",
      status: "active",
    },
    kandidaatHash,
  );

  const nadia = await zorgKandidaat(
    {
      email: "nadia@demo.nl",
      name: "Nadia el Amrani",
      role: "tandartsassistent",
      experienceLevel: "medior",
      postcode: "2511 CJ",
      maxTravelMinutes: 30,
      hoursMin: 24,
      hoursMax: 32,
      contractTypes: ["loondienst"],
      availability: beschikbaarheid({
        ma: { ochtend: "available", middag: "available" },
        di: { ochtend: "available", middag: "available" },
        wo: { ochtend: "available", middag: "available" },
        do: { ochtend: "available", middag: "available" },
      }),
      softwareSkills: ["exquise"],
      // Verborgen profiel: onvindbaar voor praktijken, solliciteert alleen zelf.
      visibility: "hidden",
      status: "active",
    },
    kandidaatHash,
  );

  const ruben = await zorgKandidaat(
    {
      email: "ruben@demo.nl",
      name: "Ruben de Boer",
      role: "tandarts",
      experienceLevel: "medior",
      postcode: "9711 LM",
      maxTravelMinutes: 30,
      hoursMin: 32,
      hoursMax: 40,
      contractTypes: ["loondienst"],
      availability: beschikbaarheid({
        ma: { ochtend: "available", middag: "available" },
        di: { ochtend: "available", middag: "available" },
      }),
      // Onboarding halverwege: vakinhoud en voorkeuren nog leeg.
      visibility: "anonymous",
      status: "draft",
      keuzeBevestigd: false,
    },
    kandidaatHash,
  );

  const iris = await zorgKandidaat(
    {
      email: "iris@demo.nl",
      name: "Iris Smit",
      role: "mondhygienist",
      experienceLevel: "starter",
      postcode: "5611 AZ",
      maxTravelMinutes: 45,
      hoursMin: 12,
      hoursMax: 20,
      contractTypes: ["loondienst"],
      salaryMin: 260_000,
      salaryMax: 320_000,
      availability: beschikbaarheid({
        di: { ochtend: "available", middag: "available" },
        wo: { ochtend: "preferred", middag: "preferred" },
        do: { ochtend: "preferred", middag: "preferred" },
      }),
      techniquesWantsToLearn: ["trios"],
      softwareSkills: ["exquise"],
      mentorshipNeeded: true,
      developmentGoals: ["interne_opleiding", "intervisie"],
      visibility: "anonymous",
      status: "active",
    },
    kandidaatHash,
  );

  console.log("Tien kandidaten aangemaakt.");

  // 6. Vacatures.
  //
  // (1) Het productvisie-voorbeeld: woensdagochtend staat op verplicht,
  // waardoor Sanne (woensdag unavailable) buiten de boot valt — de
  // opportunity-engine stelt voor woensdag flexibel te maken (match → 96%).
  const vacatureMondhygienist = await zorgVacature(lindeboom.id, lindeboomLocatie.id, {
    title: "Mondhygiënist 24–32 uur",
    role: "mondhygienist",
    description:
      "Wij zoeken een mondhygiënist voor onze praktijk in het centrum van Utrecht. " +
      "Je werkt in een eigen kamer met TRIOS-scanner en AirFlow, met veel ruimte " +
      "voor eigen regie en parodontologie. Begeleiding door onze ervaren " +
      "parodontoloog is vanzelfsprekend.",
    schedule: rooster({
      di: { ochtend: "required", middag: "required" },
      wo: { ochtend: "required" },
      do: { ochtend: "required", middag: "required" },
    }),
    hoursMin: 24,
    hoursMax: 32,
    contractTypes: ["loondienst", "zzp"],
    salaryMin: 320_000,
    salaryMax: 410_000,
    criteria: {
      registrations: { values: ["big_mondhygienist"], level: "required" },
      equipment: { values: ["trios"], level: "preferred" },
      software: { values: ["exquise"], level: "preferred" },
      specializations: { values: ["parodontologie"], level: "preferred" },
    },
    culture: ["informeel", "leergericht", "patientgericht"],
    mentorship: true,
    development: ["interne_opleiding", "congresbudget"],
    flexibilityNote: "De woensdagochtend is bespreekbaar bij de juiste kandidaat.",
    status: "published",
    publishedAt: new Date("2026-07-05T08:30:00.000Z"),
  });

  // (2) Perfecte match voor Lotte (en een goede voor Daan en Nadia).
  const vacatureAssistent = await zorgVacature(lindeboom.id, lindeboomLocatie.id, {
    title: "Tandartsassistent 16–24 uur",
    role: "tandartsassistent",
    description:
      "Ter versterking van ons team zoeken we een tandartsassistent voor de " +
      "maandag en dinsdag. Je assisteert aan de stoel, beheert de agenda in " +
      "Exquise en maakt röntgenopnames (OPG).",
    schedule: rooster({
      ma: { ochtend: "required", middag: "required" },
      di: { ochtend: "preferred", middag: "preferred" },
    }),
    hoursMin: 16,
    hoursMax: 24,
    contractTypes: ["loondienst"],
    salaryMin: 230_000,
    salaryMax: 290_000,
    criteria: {
      equipment: { values: ["opg"], level: "preferred" },
      software: { values: ["exquise"], level: "preferred" },
    },
    culture: ["informeel", "patientgericht"],
    status: "published",
    publishedAt: new Date("2026-06-25T09:00:00.000Z"),
  });

  // (3) Trial-praktijk: hiermee is de limiet van 1 actieve vacature bereikt.
  const vacatureTandarts = await zorgVacature(aanDeMaas.id, maasLocatie.id, {
    title: "Tandarts 3–4 dagen",
    role: "tandarts",
    description:
      "Tandartsen aan de Maas zoekt een tandarts voor drie tot vier dagen per " +
      "week. Moderne praktijk aan de Wijnhaven met iTero-scanner; " +
      "patiëntenbestand met veel volwassenen en ouderen.",
    experienceLevel: "medior",
    schedule: rooster({
      ma: { ochtend: "required", middag: "required" },
      di: { ochtend: "required", middag: "required" },
      do: { ochtend: "preferred", middag: "preferred" },
      vr: { ochtend: "preferred", middag: "preferred" },
    }),
    hoursMin: 24,
    hoursMax: 36,
    contractTypes: ["loondienst", "zzp"],
    hourlyRateMax: 11_000,
    criteria: {
      registrations: { values: ["big_tandarts"], level: "required" },
      equipment: { values: ["itero"], level: "preferred" },
      software: { values: ["simplex"], level: "preferred" },
    },
    culture: ["gestructureerd", "patientgericht"],
    status: "published",
    publishedAt: new Date("2026-07-10T10:00:00.000Z"),
  });

  // (4) Concept in de wizard.
  await zorgVacature(lindeboom.id, lindeboomLocatie.id, {
    title: "Tandarts met focus op implantologie (concept)",
    role: "tandarts",
    description:
      "Conceptvacature: tandarts met interesse in implantologie voor twee tot " +
      "drie dagen per week. Nog niet gepubliceerd.",
    schedule: rooster({
      ma: { ochtend: "required", middag: "required" },
      vr: { ochtend: "preferred" },
    }),
    hoursMin: 16,
    hoursMax: 24,
    contractTypes: ["loondienst", "zzp"],
    criteria: {
      registrations: { values: ["big_tandarts"], level: "required" },
      specializations: { values: ["implantologie"], level: "preferred" },
    },
    culture: ["leergericht", "hightech"],
    status: "draft",
  });

  // (5) Historie voor de KPI's: in mei gepubliceerd, in juni vervuld (Emma).
  const vacaturePreventie = await zorgVacature(lindeboom.id, lindeboomLocatie.id, {
    title: "Preventieassistent 2 dagen",
    role: "preventieassistent",
    description:
      "Preventieassistent voor twee dagen per week: gebitsreiniging, " +
      "poetsinstructie en sealants, in nauwe samenwerking met onze mondhygiënisten.",
    schedule: rooster({
      ma: { ochtend: "required" },
      do: { ochtend: "preferred", middag: "preferred" },
    }),
    hoursMin: 8,
    hoursMax: 16,
    contractTypes: ["loondienst"],
    salaryMin: 90_000,
    salaryMax: 130_000,
    criteria: {
      software: { values: ["exquise"], level: "preferred" },
    },
    culture: ["informeel", "patientgericht"],
    status: "filled",
    publishedAt: new Date("2026-05-12T09:00:00.000Z"),
    updatedAt: new Date("2026-06-20T14:00:00.000Z"),
  });

  console.log("Vijf vacatures aangemaakt (3 gepubliceerd, 1 concept, 1 vervuld).");

  // 7. Pipeline-historie: snapshots, sollicitaties, uitnodigingen, gebruik.
  const snapshotEmma = await zorgSnapshot(
    vacaturePreventie,
    emma.profile,
    "application",
    new Date("2026-05-20T11:00:00.000Z"),
  );
  const snapshotDaan = await zorgSnapshot(
    vacatureAssistent,
    daan.profile,
    "application",
    new Date("2026-07-01T09:15:00.000Z"),
  );
  const snapshotFemke = await zorgSnapshot(
    vacatureMondhygienist,
    femke.profile,
    "application",
    new Date("2026-07-14T13:30:00.000Z"),
  );
  const snapshotIris = await zorgSnapshot(
    vacatureMondhygienist,
    iris.profile,
    "invitation",
    new Date("2026-07-10T10:30:00.000Z"),
  );
  const snapshotThomas = await zorgSnapshot(
    vacatureMondhygienist,
    thomas.profile,
    "invitation",
    new Date("2026-06-15T15:00:00.000Z"),
  );

  // Sollicitaties: één hired (Emma), één interview (Daan), één ingediend (Femke).
  await prisma.application.upsert({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacaturePreventie.id,
        candidateUserId: emma.user.id,
      },
    },
    create: {
      vacancyId: vacaturePreventie.id,
      candidateUserId: emma.user.id,
      status: "hired",
      motivation:
        "Als preventieassistent werk ik graag met kinderen én ouderen; jullie brede patiëntenbestand spreekt me erg aan.",
      matchSnapshotId: snapshotEmma,
      createdAt: new Date("2026-05-20T11:00:00.000Z"),
      updatedAt: new Date("2026-06-20T14:00:00.000Z"),
    },
    update: {
      status: "hired",
      matchSnapshotId: snapshotEmma,
      updatedAt: new Date("2026-06-20T14:00:00.000Z"),
    },
  });
  await prisma.application.upsert({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacatureAssistent.id,
        candidateUserId: daan.user.id,
      },
    },
    create: {
      vacancyId: vacatureAssistent.id,
      candidateUserId: daan.user.id,
      status: "interview",
      motivation:
        "Ik ben net gestart als tandartsassistent en wil graag leren röntgenopnames te maken; jullie interne opleiding lijkt me ideaal.",
      matchSnapshotId: snapshotDaan,
      createdAt: new Date("2026-07-01T09:15:00.000Z"),
      updatedAt: new Date("2026-07-08T10:00:00.000Z"),
    },
    update: {
      status: "interview",
      matchSnapshotId: snapshotDaan,
      updatedAt: new Date("2026-07-08T10:00:00.000Z"),
    },
  });
  await prisma.application.upsert({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacatureMondhygienist.id,
        candidateUserId: femke.user.id,
      },
    },
    create: {
      vacancyId: vacatureMondhygienist.id,
      candidateUserId: femke.user.id,
      status: "submitted",
      motivation:
        "Jullie combinatie van parodontologie en begeleiding bij de TRIOS-scanner is precies wat ik zoek voor mijn volgende stap.",
      matchSnapshotId: snapshotFemke,
      createdAt: new Date("2026-07-14T13:30:00.000Z"),
      updatedAt: new Date("2026-07-14T13:30:00.000Z"),
    },
    update: { status: "submitted", matchSnapshotId: snapshotFemke },
  });

  // Uitnodigingen: één openstaand (Iris), één afgeslagen (Thomas).
  await prisma.invitation.upsert({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacatureMondhygienist.id,
        candidateUserId: iris.user.id,
      },
    },
    create: {
      vacancyId: vacatureMondhygienist.id,
      candidateUserId: iris.user.id,
      status: "sent",
      message:
        "Dag! Je profiel sluit mooi aan op onze vacature — vooral je leerwens rond de TRIOS-scanner. Zullen we kennismaken?",
      matchSnapshotId: snapshotIris,
      createdAt: new Date("2026-07-10T10:30:00.000Z"),
    },
    update: { status: "sent", matchSnapshotId: snapshotIris },
  });
  await prisma.invitation.upsert({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacatureMondhygienist.id,
        candidateUserId: thomas.user.id,
      },
    },
    create: {
      vacancyId: vacatureMondhygienist.id,
      candidateUserId: thomas.user.id,
      status: "declined",
      message: "Je ervaring met parodontologie en TRIOS past goed bij ons team.",
      matchSnapshotId: snapshotThomas,
      createdAt: new Date("2026-06-15T15:00:00.000Z"),
    },
    update: { status: "declined", matchSnapshotId: snapshotThomas },
  });

  // Gebruik voor de maandlimiet (idempotent via idempotencyKey).
  for (const gebruik of [
    {
      idempotencyKey: `invite:${lindeboom.id}:${vacatureMondhygienist.id}:${iris.user.id}:2026-07`,
      createdAt: new Date("2026-07-10T10:30:00.000Z"),
    },
    {
      idempotencyKey: `invite:${lindeboom.id}:${vacatureMondhygienist.id}:${thomas.user.id}:2026-06`,
      createdAt: new Date("2026-06-15T15:00:00.000Z"),
    },
  ]) {
    await prisma.usageEvent.upsert({
      where: { idempotencyKey: gebruik.idempotencyKey },
      create: {
        organizationId: lindeboom.id,
        key: "candidate_invite",
        quantity: 1,
        idempotencyKey: gebruik.idempotencyKey,
        createdAt: gebruik.createdAt,
      },
      update: {},
    });
  }

  // 8. Analytics-historie voor de KPI's — vaste datums over de afgelopen twee
  // maanden. Idempotent: alle seed-events dragen context.seed = "demo" en
  // worden eerst verwijderd.
  await prisma.analyticsEvent.deleteMany({
    where: { context: { path: ["seed"], equals: "demo" } },
  });

  const seedContext = (extra: Record<string, string | number | boolean | null> = {}) => ({
    seed: "demo",
    ...extra,
  });
  type EventRij = {
    name: string;
    createdAt: Date;
    organizationId?: string;
    locationId?: string;
    candidateId?: string;
    plan?: string;
    context: Record<string, string | number | boolean | null>;
  };

  const lindeboomEvent = { organizationId: lindeboom.id, locationId: lindeboomLocatie.id };
  const maasEvent = { organizationId: aanDeMaas.id, locationId: maasLocatie.id };

  const events: EventRij[] = [
    // Publicaties.
    { name: "vacancy_published", createdAt: new Date("2026-05-12T09:00:00.000Z"), ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacaturePreventie.id }) },
    { name: "vacancy_published", createdAt: new Date("2026-06-25T09:00:00.000Z"), ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "vacancy_published", createdAt: new Date("2026-07-05T08:30:00.000Z"), ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    { name: "vacancy_published", createdAt: new Date("2026-07-10T10:00:00.000Z"), ...maasEvent, plan: "trial", context: seedContext({ vacancyId: vacatureTandarts.id }) },
    // Profielactivaties.
    { name: "candidate_profile_activated", createdAt: new Date("2026-05-14T08:00:00.000Z"), candidateId: emma.profile.id, context: seedContext() },
    { name: "candidate_profile_activated", createdAt: new Date("2026-06-01T09:00:00.000Z"), candidateId: sanne.profile.id, context: seedContext() },
    { name: "candidate_profile_activated", createdAt: new Date("2026-06-05T10:00:00.000Z"), candidateId: femke.profile.id, context: seedContext() },
    { name: "candidate_profile_activated", createdAt: new Date("2026-06-10T11:00:00.000Z"), candidateId: lotte.profile.id, context: seedContext() },
    // Bekeken matches (≥ 10 voor de conversie-KPI).
    { name: "match_viewed", createdAt: new Date("2026-05-15T12:00:00.000Z"), candidateId: emma.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacaturePreventie.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-03T18:20:00.000Z"), candidateId: sanne.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-06T08:45:00.000Z"), candidateId: femke.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-14T20:10:00.000Z"), candidateId: lotte.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-18T07:55:00.000Z"), candidateId: daan.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-20T13:05:00.000Z"), candidateId: sanne.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-28T16:40:00.000Z"), candidateId: lotte.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-06-30T09:25:00.000Z"), candidateId: daan.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "match_viewed", createdAt: new Date("2026-07-06T19:00:00.000Z"), candidateId: sanne.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    { name: "match_viewed", createdAt: new Date("2026-07-11T12:30:00.000Z"), candidateId: yusuf.profile.id, ...maasEvent, context: seedContext({ vacancyId: vacatureTandarts.id }) },
    { name: "match_viewed", createdAt: new Date("2026-07-12T10:15:00.000Z"), candidateId: femke.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    { name: "match_viewed", createdAt: new Date("2026-07-12T21:45:00.000Z"), candidateId: thomas.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    // Sollicitaties.
    { name: "application_submitted", createdAt: new Date("2026-05-20T11:00:00.000Z"), candidateId: emma.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacaturePreventie.id }) },
    { name: "application_submitted", createdAt: new Date("2026-07-01T09:15:00.000Z"), candidateId: daan.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "application_submitted", createdAt: new Date("2026-07-14T13:30:00.000Z"), candidateId: femke.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    // Uitnodigingen.
    { name: "candidate_invited", createdAt: new Date("2026-06-15T15:00:00.000Z"), candidateId: thomas.profile.id, ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    { name: "candidate_invited", createdAt: new Date("2026-07-10T10:30:00.000Z"), candidateId: iris.profile.id, ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacatureMondhygienist.id }) },
    // Pipeline-mijlpalen.
    { name: "interview_scheduled", createdAt: new Date("2026-06-02T09:00:00.000Z"), candidateId: emma.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacaturePreventie.id }) },
    { name: "interview_scheduled", createdAt: new Date("2026-07-08T10:00:00.000Z"), candidateId: daan.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacatureAssistent.id }) },
    { name: "candidate_hired", createdAt: new Date("2026-06-20T14:00:00.000Z"), candidateId: emma.profile.id, ...lindeboomEvent, context: seedContext({ vacancyId: vacaturePreventie.id }) },
    { name: "vacancy_filled", createdAt: new Date("2026-06-20T14:00:00.000Z"), ...lindeboomEvent, plan: "growth", context: seedContext({ vacancyId: vacaturePreventie.id }) },
  ];

  await prisma.analyticsEvent.createMany({
    data: events.map((event) => ({
      name: event.name,
      organizationId: event.organizationId ?? null,
      locationId: event.locationId ?? null,
      candidateId: event.candidateId ?? null,
      plan: event.plan ?? null,
      context: event.context as Prisma.InputJsonValue,
      createdAt: event.createdAt,
    })),
  });

  console.log(`Pipeline-historie aangemaakt (${events.length} analytics-events).`);

  // 9. Overzicht van inloggegevens.
  console.log("");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("Seed afgerond. Inloggegevens (demo):");
  console.log("");
  console.log("  Platform-admin");
  console.log(`    admin@mondzorgwerkt.nl / ${WACHTWOORD_ADMIN}`);
  console.log(`    ${eigenaarEmail} ${eigenaarWachtwoordMelding}`);
  console.log("");
  console.log("  Praktijk 1 — Mondzorgpraktijk De Lindeboom (Utrecht, growth)");
  console.log(`    praktijk@delindeboom.nl / ${WACHTWOORD_PRAKTIJK}  (owner)`);
  console.log(`    recruiter@delindeboom.nl / ${WACHTWOORD_PRAKTIJK}  (recruiter)`);
  console.log("");
  console.log("  Praktijk 2 — Tandartsen aan de Maas (Rotterdam, trial)");
  console.log(`    praktijk@aandemaas.nl / ${WACHTWOORD_PRAKTIJK}  (owner)`);
  console.log("");
  console.log("  Kandidaten (allemaal met hetzelfde wachtwoord)");
  console.log(`    kandidaat@demo.nl / ${WACHTWOORD_KANDIDAAT}  (Sanne de Vries, mondhygiënist Utrecht)`);
  console.log("    femke.jansen@demo.nl, lotte@demo.nl, daan@demo.nl, yusuf@demo.nl,");
  console.log("    emma@demo.nl, thomas@demo.nl, nadia@demo.nl, ruben@demo.nl, iris@demo.nl");
  console.log("──────────────────────────────────────────────────────────────");
}

main()
  .catch((error) => {
    console.error("Seed mislukt:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
