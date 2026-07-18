// Server-side autorisatie en tenantisolatie.
//
// Regels:
// - Elke query naar organisatiegebonden data loopt via een AuthContext dat hier
//   is opgebouwd uit een geverifieerd membership — nooit uit client-input.
// - Gebruikers van organisatie A kunnen nooit data van organisatie B lezen:
//   services filteren altijd op ctx.organizationId.
// - Rollen bepalen schrijfrechten (zie ROLE_CAPABILITIES).

import type { MemberRole } from "@prisma/client";
import { prisma } from "./db";
import { getSessionUser, type SessionUser } from "./auth";

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export interface OrgContext {
  user: SessionUser;
  organizationId: string;
  role: MemberRole;
  /**
   * Locatiegebonden rechten uit het membership: null (of afwezig) = toegang
   * tot alle locaties van de organisatie; anders uitsluitend de genoemde
   * locatie-id's. Services filteren hierop via allowedLocationIds().
   */
  locationIds?: string[] | null;
}

/** Capabilities per rol — één plek, geen verspreide rolchecks. */
const ROLE_CAPABILITIES: Record<MemberRole, ReadonlySet<string>> = {
  owner: new Set([
    "org.manage",
    "billing.manage",
    "members.manage",
    "location.manage",
    "vacancy.manage",
    "vacancy.publish",
    "candidate.invite",
    "pipeline.manage",
    "analytics.view",
  ]),
  admin: new Set([
    "org.manage",
    "members.manage",
    "location.manage",
    "vacancy.manage",
    "vacancy.publish",
    "candidate.invite",
    "pipeline.manage",
    "analytics.view",
  ]),
  recruiter: new Set([
    "vacancy.manage",
    "vacancy.publish",
    "candidate.invite",
    "pipeline.manage",
    "analytics.view",
  ]),
  hiring_manager: new Set(["vacancy.manage", "pipeline.manage", "analytics.view"]),
  viewer: new Set(["analytics.view"]),
  // Facturatiebeheer: billing en rapportages, maar géén kandidaatdetails,
  // vacaturebeheer of uitnodigingen (least privilege).
  billing_manager: new Set(["billing.manage", "analytics.view"]),
};

export function roleCan(role: MemberRole, capability: string): boolean {
  return ROLE_CAPABILITIES[role]?.has(capability) ?? false;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthzError("Niet ingelogd", 401);
  return user;
}

/**
 * Verifieert dat de ingelogde gebruiker een actief membership heeft bij de
 * organisatie en (optioneel) een capability bezit. Alle organisatie-services
 * accepteren uitsluitend dit context-object.
 *
 * Met `locationId` wordt bovendien de locatiegebondenheid van het membership
 * gecontroleerd: een membership met niet-lege locationIds geeft alleen toegang
 * tot die locaties (AuthzError 403 anders).
 */
export async function requireMembership(
  organizationId: string,
  capability?: string,
  locationId?: string,
): Promise<OrgContext> {
  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  if (!membership || membership.status !== "active") {
    throw new AuthzError("Geen toegang tot deze organisatie", 403);
  }
  if (capability && !roleCan(membership.role, capability)) {
    throw new AuthzError(`Rol ${membership.role} mag dit niet: ${capability}`, 403);
  }
  const locationIds = membership.locationIds.length > 0 ? membership.locationIds : null;
  if (locationId && locationIds && !locationIds.includes(locationId)) {
    throw new AuthzError("Geen toegang tot deze locatie", 403);
  }
  return { user, organizationId, role: membership.role, locationIds };
}

/**
 * Locatiegebonden rechten van een context: null = alle locaties van de
 * organisatie; anders de toegestane locatie-id's. Alle locatie-gebonden
 * services filteren hun queries hierop.
 */
export function allowedLocationIds(ctx: OrgContext): string[] | null {
  return ctx.locationIds ?? null;
}

/** Throwt AuthzError (403) wanneer de context geen toegang tot de locatie heeft. */
export function assertLocationAllowed(ctx: OrgContext, locationId: string): void {
  const allowed = allowedLocationIds(ctx);
  if (allowed && !allowed.includes(locationId)) {
    throw new AuthzError("Geen toegang tot deze locatie", 403);
  }
}

/** Eerste actieve organisatie van de gebruiker (voor redirects na login). */
export async function firstOrganizationOf(userId: string) {
  return prisma.membership.findFirst({
    where: { userId, status: "active", organization: { status: "active" } },
    include: { organization: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new AuthzError("Alleen platformbeheer", 403);
  return user;
}

/** Kandidaatcontext: de ingelogde gebruiker met eigen profiel. */
export async function requireCandidate() {
  const user = await requireUser();
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId: user.id },
  });
  return { user, profile };
}
