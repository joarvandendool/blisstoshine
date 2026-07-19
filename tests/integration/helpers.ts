// Testhelpers voor integratietests tegen de aparte testdatabase.
// tests/setup.ts wijst DATABASE_URL naar TEST_DATABASE_URL; deze helpers
// pushen het schema en bouwen realistische testdata op.

import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  WEEKDAYS,
  DAYPARTS,
  emptyAvailability,
  emptySchedule,
  type CandidateAvailability,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";

/** Ingelogde testgebruiker — gelezen door de next/headers-mock per testbestand. */
export const sessieHouder: { userId: string | null } = { userId: null };

export function alsGebruiker(userId: string | null): void {
  sessieHouder.userId = userId;
}

/**
 * Sessietoken in hetzelfde formaat als src/lib/auth.ts. Bewust gedupliceerd:
 * de next/headers-mock mag @/lib/auth niet importeren (dat importeert zelf
 * next/headers → circulaire dynamic import → deadlock in Vitest).
 */
export function createTestSessionToken(userId: string): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `${userId}.${Date.now() + 1000 * 60 * 60}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

let schemaKlaar = false;

/** Schema naar de testdatabase pushen (eenmalig) en alle tabellen legen. */
export async function prepareTestDb(): Promise<void> {
  if (!schemaKlaar) {
    // --accept-data-loss: de testdatabase is disposable; schemawijzigingen
    // (bv. nieuwe unique constraints) mogen oude testdata altijd overschrijven.
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      env: process.env,
      stdio: "ignore",
    });
    // Partiële unieke index (checkout-idempotency) staat als raw SQL in de
    // migratie en is dus niet zichtbaar voor `prisma db push`; hier expliciet
    // aanmaken zodat de testdatabase dezelfde constraint kent als productie.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_actief_per_org_uniek"
       ON "Subscription"("organizationId") WHERE status <> 'canceled'`,
    );
    schemaKlaar = true;
  }
  await truncateAll();
}

export async function truncateAll(): Promise<void> {
  const tabellen = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\_prisma%'`;
  if (tabellen.length === 0) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tabellen.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`,
  );
}

export async function maakGebruiker(email: string, name: string, isPlatformAdmin = false) {
  return prisma.user.create({
    data: { email, name, passwordHash: "test-hash", isPlatformAdmin },
  });
}

/** Beschikbaarheid met opgegeven voorkeurs- en beschikbare dagen (hele dagen). */
export function beschikbaarheid(
  preferred: Weekday[],
  available: Weekday[] = [],
): CandidateAvailability {
  const out = emptyAvailability();
  for (const d of preferred) for (const p of DAYPARTS) out[d][p] = "preferred";
  for (const d of available) for (const p of DAYPARTS) out[d][p] = "available";
  return out;
}

/** Vacaturerooster met verplichte en gewenste dagen (ochtend + middag). */
export function rooster(required: Weekday[], preferred: Weekday[] = []): VacancySchedule {
  const out = emptySchedule();
  for (const d of required) {
    out[d].ochtend = "required";
    out[d].middag = "required";
  }
  for (const d of preferred) {
    out[d].ochtend = "preferred";
    out[d].middag = "preferred";
  }
  return out;
}

export async function maakKandidaat(
  email: string,
  name: string,
  overrides: Partial<{
    role: string;
    visibility: "visible" | "anonymous" | "hidden";
    status: "draft" | "active" | "paused" | "archived";
    availability: CandidateAvailability;
    equipmentExperience: string[];
    techniquesWantsToLearn: string[];
    specializations: string[];
  }> = {},
) {
  const user = await maakGebruiker(email, name);
  const profiel = await prisma.candidateProfile.create({
    data: {
      userId: user.id,
      role: overrides.role ?? "mondhygienist",
      experienceLevel: "medior",
      postcode: "3511 AB",
      latitude: 52.0907,
      longitude: 5.1214,
      maxTravelMinutes: 45,
      hoursMin: 16,
      hoursMax: 32,
      contractTypes: ["loondienst"],
      availability: beschikbaarheid(["di", "do"], ["vr"]) as object,
      ...(overrides.availability
        ? { availability: overrides.availability as object }
        : {}),
      equipmentExperience: overrides.equipmentExperience ?? [],
      techniquesWantsToLearn: overrides.techniquesWantsToLearn ?? [],
      specializations: overrides.specializations ?? [],
      visibility: overrides.visibility ?? "visible",
      status: overrides.status ?? "active",
      completenessScore: 90,
    },
  });
  return { user, profiel };
}

export { WEEKDAYS };
