// Servicelaag voor praktijkorganisaties: aanmaken, toegangspoort per slug en
// locatiebeheer. Elke functie begint bij een geverifieerde identiteit
// (requireUser/requireMembership) en scopet alle data op de organisatie uit
// het membership — nooit op client-input.

import type {
  MemberRole,
  Membership,
  MembershipStatus,
  Organization,
  PracticeLocation,
  Vacancy,
} from "@prisma/client";
import {
  AuthzError,
  allowedLocationIds,
  assertLocationAllowed,
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

/** Alle toewijsbare rollen (incl. billing_manager) — runtime-spiegel van MemberRole. */
export const MEMBER_ROLES = [
  "owner",
  "admin",
  "recruiter",
  "hiring_manager",
  "viewer",
  "billing_manager",
] as const satisfies readonly MemberRole[];

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

/**
 * Alle locaties van de organisatie uit het geverifieerde membership.
 * Locatiegebonden memberships (Membership.locationIds) zien alleen de eigen
 * locaties.
 */
export async function listLocations(ctx: OrgContext): Promise<PracticeLocation[]> {
  const allowed = allowedLocationIds(ctx);
  return prisma.practiceLocation.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(allowed ? { id: { in: allowed } } : {}),
    },
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

/**
 * Werkt een bestaande locatie bij (capability location.manage). Alleen
 * meegegeven velden veranderen; een nieuwe postcode wordt opnieuw gegeocodeerd.
 */
export async function updateLocation(
  ctx: OrgContext,
  locationId: string,
  input: Partial<LocationInput>,
): Promise<PracticeLocation> {
  if (!roleCan(ctx.role, "location.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag geen locaties beheren`, 403);
  }
  assertLocationAllowed(ctx, locationId);
  const bestaand = await prisma.practiceLocation.findFirst({
    where: { id: locationId, organizationId: ctx.organizationId },
  });
  if (!bestaand) throw new AuthzError("Locatie niet gevonden", 404);

  const geo = input.postcode !== undefined ? geocodePostcode(input.postcode) : null;
  const location = await prisma.practiceLocation.update({
    where: { id: bestaand.id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() || bestaand.name } : {}),
      ...(input.street !== undefined ? { street: input.street || null } : {}),
      ...(input.houseNumber !== undefined ? { houseNumber: input.houseNumber || null } : {}),
      ...(input.postcode !== undefined
        ? {
            postcode: input.postcode.trim(),
            city: geo?.city ?? input.city?.trim() ?? bestaand.city,
            latitude: geo?.latitude ?? bestaand.latitude,
            longitude: geo?.longitude ?? bestaand.longitude,
          }
        : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.treatmentRooms !== undefined ? { treatmentRooms: input.treatmentRooms } : {}),
      ...(input.traits !== undefined ? { traits: input.traits } : {}),
      ...(input.equipment !== undefined ? { equipment: input.equipment } : {}),
      ...(input.software !== undefined ? { software: input.software } : {}),
      ...(input.specializations !== undefined ? { specializations: input.specializations } : {}),
      ...(input.patientPopulation !== undefined
        ? { patientPopulation: input.patientPopulation }
        : {}),
    },
  });

  await audit("location.update", "PracticeLocation", location.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });

  return location;
}

/**
 * Verplaatst een vacature naar een andere (eigen) locatie. Capability
 * vacancy.manage; beide locaties moeten binnen de organisatie én binnen de
 * locatietoewijzing van de gebruiker vallen. Schrijft een auditregel.
 */
export async function moveVacancy(
  ctx: OrgContext,
  vacancyId: string,
  targetLocationId: string,
): Promise<Vacancy> {
  if (!roleCan(ctx.role, "vacancy.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: vacancy.manage`, 403);
  }
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);
  assertLocationAllowed(ctx, vacature.locationId);
  assertLocationAllowed(ctx, targetLocationId);

  // Hercontrole: de doellocatie moet binnen de eigen organisatie liggen.
  const doel = await prisma.practiceLocation.findFirst({
    where: { id: targetLocationId, organizationId: ctx.organizationId },
  });
  if (!doel) throw new AuthzError("Locatie niet gevonden", 404);

  const verplaatst = await prisma.vacancy.update({
    where: { id: vacature.id },
    data: { locationId: doel.id },
  });

  await audit("vacancy.move", "Vacancy", vacature.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { van: vacature.locationId, naar: doel.id },
  });

  return verplaatst;
}

// ---------------------------------------------------------------------------
// Ledenbeheer (capability members.manage)
// ---------------------------------------------------------------------------

export interface MemberEntry {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MembershipStatus;
  /** Leeg = toegang tot alle locaties. */
  locationIds: string[];
  createdAt: Date;
}

function vereisLedenbeheer(ctx: OrgContext): void {
  if (!roleCan(ctx.role, "members.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: members.manage`, 403);
  }
}

function naarMemberEntry(
  membership: Membership & { user: { name: string; email: string } },
): MemberEntry {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    status: membership.status,
    locationIds: membership.locationIds,
    createdAt: membership.createdAt,
  };
}

/** Alle (niet-ingetrokken) leden van de organisatie. */
export async function listMembers(ctx: OrgContext): Promise<MemberEntry[]> {
  vereisLedenbeheer(ctx);
  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId, status: { not: "revoked" } },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map(naarMemberEntry);
}

/** Valideert dat alle locatie-id's binnen de organisatie liggen. */
async function valideerLocatieIds(ctx: OrgContext, locationIds: string[]): Promise<string[]> {
  const uniek = [...new Set(locationIds)];
  if (uniek.length === 0) return [];
  const aantal = await prisma.practiceLocation.count({
    where: { id: { in: uniek }, organizationId: ctx.organizationId },
  });
  if (aantal !== uniek.length) {
    throw new AuthzError("Eén of meer locaties horen niet bij deze organisatie", 400);
  }
  return uniek;
}

function valideerRol(role: string): MemberRole {
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    throw new AuthzError("Onbekende rol", 400);
  }
  return role as MemberRole;
}

/**
 * Nodigt een bestaande platformgebruiker (op e-mailadres) uit als lid van de
 * organisatie, met rol en optionele locatietoewijzing. Telt tegen de
 * max_members-limiet van het abonnement. billing_manager is toewijsbaar.
 */
export async function inviteMember(
  ctx: OrgContext,
  email: string,
  role: string,
  locationIds: string[] = [],
): Promise<MemberEntry> {
  vereisLedenbeheer(ctx);
  const rol = valideerRol(role);
  const locaties = await valideerLocatieIds(ctx, locationIds);

  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    throw new AuthzError(
      "Geen gebruiker met dit e-mailadres — vraag je collega eerst een account aan te maken",
      404,
    );
  }

  const bestaand = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: ctx.organizationId } },
  });
  if (bestaand && bestaand.status !== "revoked") {
    throw new AuthzError("Deze gebruiker is al lid van de organisatie", 400);
  }

  const actieveLeden = await prisma.membership.count({
    where: { organizationId: ctx.organizationId, status: "active" },
  });
  await enforceLimit(ctx.organizationId, "max_members", actieveLeden);

  const membership = bestaand
    ? await prisma.membership.update({
        where: { id: bestaand.id },
        data: { status: "active", role: rol, locationIds: locaties },
        include: { user: { select: { name: true, email: true } } },
      })
    : await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: ctx.organizationId,
          role: rol,
          status: "active",
          locationIds: locaties,
        },
        include: { user: { select: { name: true, email: true } } },
      });

  await audit("member.invite", "Membership", membership.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { role: rol, locaties: locaties.length },
  });

  return naarMemberEntry(membership);
}

/** Membership binnen de eigen organisatie ophalen; anders 404. */
async function eigenMembership(ctx: OrgContext, membershipId: string) {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: ctx.organizationId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!membership) throw new AuthzError("Lid niet gevonden", 404);
  return membership;
}

/** Is dit het laatste actieve owner-membership van de organisatie? */
async function isLaatsteOwner(ctx: OrgContext, membership: Membership): Promise<boolean> {
  if (membership.role !== "owner") return false;
  const owners = await prisma.membership.count({
    where: { organizationId: ctx.organizationId, role: "owner", status: "active" },
  });
  return owners <= 1;
}

/** Wijzigt rol en/of locatietoewijzing van een lid. */
export async function updateMember(
  ctx: OrgContext,
  membershipId: string,
  input: { role?: string; locationIds?: string[] },
): Promise<MemberEntry> {
  vereisLedenbeheer(ctx);
  const membership = await eigenMembership(ctx, membershipId);

  const nieuweRol = input.role !== undefined ? valideerRol(input.role) : undefined;
  if (
    nieuweRol !== undefined &&
    nieuweRol !== "owner" &&
    (await isLaatsteOwner(ctx, membership))
  ) {
    throw new AuthzError("De laatste eigenaar kan zijn rol niet verliezen", 400);
  }
  const locaties =
    input.locationIds !== undefined
      ? await valideerLocatieIds(ctx, input.locationIds)
      : undefined;

  const bijgewerkt = await prisma.membership.update({
    where: { id: membership.id },
    data: {
      ...(nieuweRol !== undefined ? { role: nieuweRol } : {}),
      ...(locaties !== undefined ? { locationIds: locaties } : {}),
    },
    include: { user: { select: { name: true, email: true } } },
  });

  await audit("member.update", "Membership", membership.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: {
      ...(nieuweRol !== undefined ? { role: nieuweRol } : {}),
      ...(locaties !== undefined ? { locaties: locaties.length } : {}),
    },
  });

  return naarMemberEntry(bijgewerkt);
}

/** Deactiveert (trekt in) een lid. De laatste eigenaar kan niet weg. */
export async function deactivateMember(ctx: OrgContext, membershipId: string): Promise<void> {
  vereisLedenbeheer(ctx);
  const membership = await eigenMembership(ctx, membershipId);
  if (await isLaatsteOwner(ctx, membership)) {
    throw new AuthzError("De laatste eigenaar kan niet worden gedeactiveerd", 400);
  }
  await prisma.membership.update({
    where: { id: membership.id },
    data: { status: "revoked" },
  });
  await audit("member.deactivate", "Membership", membership.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
}
