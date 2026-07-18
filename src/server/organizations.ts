// Servicelaag voor praktijkorganisaties: aanmaken, toegangspoort per slug en
// locatiebeheer. Elke functie begint bij een geverifieerde identiteit
// (requireUser/requireMembership) en scopet alle data op de organisatie uit
// het membership — nooit op client-input.

import type { Organization, PracticeLocation } from "@prisma/client";
import {
  AuthzError,
  requireMembership,
  requireUser,
  roleCan,
  type OrgContext,
} from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import {
  effectiveEntitlements,
  enforceLimit,
  ensureOrgSubscription,
} from "@/lib/billing";
import { prisma } from "@/lib/db";
import { geocodePostcode } from "@/server/geo";

// Terugvalcoördinaten (geografisch midden van Nederland) wanneer een postcode
// niet in de geocodeertabel staat — de locatie blijft dan bruikbaar.
const MIDDEN_NEDERLAND = { latitude: 52.1326, longitude: 5.2913 } as const;

export interface LocationInput {
  /** Weergavenaam van de locatie; standaard de organisatienaam. */
  name?: string;
  street?: string;
  houseNumber?: string;
  postcode: string;
  /** Terugval-stadsnaam wanneer de postcode niet herkend wordt. */
  city?: string;
  phone?: string;
  treatmentRooms?: number;
  traits?: string[];
  equipment?: string[];
  software?: string[];
  specializations?: string[];
  patientPopulation?: string[];
}

export interface CreateOrganizationInput {
  name: string;
  kvkNumber?: string;
  billingEmail?: string;
  acquisitionSource?: string;
  location: LocationInput;
}

/** Plancode van de organisatie voor analytics-events ("waar passend"). */
export async function planCodeVoorAnalytics(
  orgId: string,
): Promise<string | undefined> {
  const effectief = await effectiveEntitlements(orgId);
  return effectief.planCode ?? undefined;
}

/** Naam → url-veilige slug: kleine letters, geen diakrieten, koppeltekens. */
function slugify(naam: string): string {
  const basis = naam
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return basis || "praktijk";
}

/** Unieke slug: bij botsing wordt -2, -3, … achtergevoegd. */
async function uniekeSlug(naam: string): Promise<string> {
  const basis = slugify(naam);
  let kandidaat = basis;
  for (let volgnummer = 2; ; volgnummer += 1) {
    const bestaand = await prisma.organization.findUnique({
      where: { slug: kandidaat },
      select: { id: true },
    });
    if (!bestaand) return kandidaat;
    kandidaat = `${basis}-${volgnummer}`;
  }
}

/** Locatiedata voor Prisma, met coördinaten via de geocodeertabel. */
function locatieData(orgNaam: string, input: LocationInput) {
  const geo = geocodePostcode(input.postcode);
  return {
    name: input.name?.trim() || orgNaam,
    street: input.street ?? null,
    houseNumber: input.houseNumber ?? null,
    postcode: input.postcode.trim(),
    city: geo?.city ?? input.city?.trim() ?? "Onbekend",
    latitude: geo?.latitude ?? MIDDEN_NEDERLAND.latitude,
    longitude: geo?.longitude ?? MIDDEN_NEDERLAND.longitude,
    phone: input.phone ?? null,
    treatmentRooms: input.treatmentRooms ?? 1,
    traits: input.traits ?? [],
    equipment: input.equipment ?? [],
    software: input.software ?? [],
    specializations: input.specializations ?? [],
    patientPopulation: input.patientPopulation ?? [],
  };
}

/**
 * Maakt een nieuwe praktijkorganisatie met eerste locatie en owner-membership
 * voor de ingelogde gebruiker, en start direct het trial-abonnement
 * (ensureOrgSubscription). Dit is de start van de praktijkfunnel.
 */
export async function createOrganizationWithLocation(
  input: CreateOrganizationInput,
): Promise<{ organization: Organization; location: PracticeLocation }> {
  const user = await requireUser();
  const naam = input.name.trim();
  if (!naam) throw new AuthzError("Praktijknaam is verplicht", 400);

  const slug = await uniekeSlug(naam);

  const { organization, location } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: naam,
        slug,
        kvkNumber: input.kvkNumber ?? null,
        billingEmail: input.billingEmail ?? user.email,
        acquisitionSource: input.acquisitionSource ?? null,
      },
    });
    const location = await tx.practiceLocation.create({
      data: { organizationId: organization.id, ...locatieData(naam, input.location) },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: "owner" },
    });
    return { organization, location };
  });

  // Trial-abonnement zodat entitlements direct werken.
  await ensureOrgSubscription(organization.id);

  await track("organization_created", {
    organizationId: organization.id,
    userId: user.id,
    plan: "trial",
    acquisitionSource: input.acquisitionSource,
    context: { slug },
  });
  await track("location_created", {
    organizationId: organization.id,
    locationId: location.id,
    userId: user.id,
    context: { city: location.city },
  });
  await audit("organization.create", "Organization", organization.id, {
    organizationId: organization.id,
    userId: user.id,
    meta: { slug },
  });
  await audit("location.create", "PracticeLocation", location.id, {
    organizationId: organization.id,
    userId: user.id,
  });

  return { organization, location };
}

/**
 * DE standaard toegangspoort voor alle praktijkpagina's: zoekt de organisatie
 * op slug en verifieert daarna het membership (en optioneel een capability)
 * van de ingelogde gebruiker. Alle vervolgqueries lopen via de teruggegeven
 * ctx en zijn daarmee tenant-geïsoleerd.
 */
export async function getOrgForUserBySlug(
  slug: string,
  capability?: string,
): Promise<{ org: Organization; ctx: OrgContext }> {
  const org = await prisma.organization.findUnique({ where: { slug } });
  if (!org || org.status !== "active") {
    throw new AuthzError("Praktijk niet gevonden", 404);
  }
  const ctx = await requireMembership(org.id, capability);
  return { org, ctx };
}

/** Alle locaties van de organisatie uit het geverifieerde membership. */
export async function listLocations(ctx: OrgContext): Promise<PracticeLocation[]> {
  return prisma.practiceLocation.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Voegt een locatie toe. Vereist capability location.manage en ruimte onder
 * de max_locations-limiet van het abonnement.
 */
export async function addLocation(
  ctx: OrgContext,
  input: LocationInput,
): Promise<PracticeLocation> {
  if (!roleCan(ctx.role, "location.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag geen locaties beheren`, 403);
  }

  const huidigAantal = await prisma.practiceLocation.count({
    where: { organizationId: ctx.organizationId },
  });
  await enforceLimit(ctx.organizationId, "max_locations", huidigAantal);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true },
  });
  const location = await prisma.practiceLocation.create({
    data: { organizationId: ctx.organizationId, ...locatieData(org.name, input) },
  });

  await track("location_created", {
    organizationId: ctx.organizationId,
    locationId: location.id,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { city: location.city },
  });
  await audit("location.create", "PracticeLocation", location.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });

  return location;
}
