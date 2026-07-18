// Servicelaag rond de matching-engine: matchfeed voor kandidaten,
// kandidatenlijst en simulatie ("Match Studio") voor praktijken, en het
// vastleggen van MatchSnapshots op beslismomenten.
//
// Privacyregel: praktijken zien alleen kandidaten met status active en
// visibility != hidden. Bij visibility "anonymous" wordt de naam vervangen
// door een geanonimiseerde omschrijving ("Mondhygiënist uit Utrecht").

import type {
  CandidateProfile,
  PracticeLocation,
  Prisma,
  SnapshotContext,
  Vacancy,
} from "@prisma/client";
import {
  AuthzError,
  allowedLocationIds,
  assertLocationAllowed,
  roleCan,
  type OrgContext,
} from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { enforceEntitlement } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { label, type VacancySchedule } from "@/domain/taxonomy";
import { computeMatch, type MatchCandidate, type MatchResult, type MatchVacancy } from "@/domain/matching";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { geocodePostcode } from "@/server/geo";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { planCodeVoorAnalytics } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Gedeelde hulpfuncties
// ---------------------------------------------------------------------------

type ProfielMetNaam = CandidateProfile & { user: { name: string } };

/** Actieve, vindbare kandidaten (status active, visibility != hidden). */
async function vindbareKandidaten(): Promise<ProfielMetNaam[]> {
  return prisma.candidateProfile.findMany({
    where: { status: "active", visibility: { not: "hidden" } },
    include: { user: { select: { name: true } } },
  });
}

/**
 * Weergavenaam volgens de privacy-instelling van de kandidaat:
 * visible → echte naam; anonymous → geanonimiseerd, zonder naam — tenzij er
 * een actieve consent is die déze context dekt (metConsent).
 *
 * CONSENT-SCOPE: een consent die per vacature is gegeven, geldt uitsluitend
 * voor die vacature. Cross-locatieweergave toont bij andere vacatures dus
 * géén naam.
 */
function weergaveNaam(profiel: ProfielMetNaam, metConsent = false): string {
  if (profiel.visibility === "visible" || metConsent) return profiel.user.name;
  const stad = geocodePostcode(profiel.postcode)?.city;
  const rol = label(profiel.role);
  return stad ? `${rol} uit ${stad}` : `${rol} (anoniem profiel)`;
}

/**
 * Actieve consents van de organisatie → set van "candidateUserId" (orgbreed)
 * en "candidateUserId:vacancyId" (per vacature). dektConsent beantwoordt of
 * een kandidaat voor déze vacature zijn naam heeft vrijgegeven.
 */
async function consentSetVoorOrg(organizationId: string): Promise<ReadonlySet<string>> {
  const consents = await prisma.candidateConsent.findMany({
    where: { organizationId, scope: "contact_details", revokedAt: null },
    select: { candidateUserId: true, vacancyId: true },
  });
  return new Set(
    consents.map((c) =>
      c.vacancyId === null ? c.candidateUserId : `${c.candidateUserId}:${c.vacancyId}`,
    ),
  );
}

function dektConsent(
  consentSet: ReadonlySet<string>,
  candidateUserId: string,
  vacancyId: string,
): boolean {
  return consentSet.has(candidateUserId) || consentSet.has(`${candidateUserId}:${vacancyId}`);
}

/**
 * Vacature scoped ophalen (alleen binnen de eigen organisatie), incl. locatie.
 * Locatiegebonden memberships krijgen 403 op vacatures van andere locaties.
 */
async function eigenVacature(
  ctx: OrgContext,
  vacancyId: string,
): Promise<Vacancy & { location: PracticeLocation }> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    include: { location: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);
  assertLocationAllowed(ctx, vacature.locationId);
  return vacature;
}

/**
 * Matchresultaten van alle actieve, vindbare kandidaten tegen één
 * MatchVacancy — zonder opportunities (sneller; voor tellingen en Talent
 * Radar). Met `profielen` kan een reeds opgehaalde kandidatenlijst worden
 * hergebruikt zodat herhaalde aanroepen (simulatie, radar) niet telkens
 * opnieuw de database raken.
 */
export async function poolForMatchVacancy(
  matchVacancy: MatchVacancy,
  profielen?: CandidateProfile[],
): Promise<Array<{ profile: CandidateProfile; result: MatchResult }>> {
  const kandidaten = profielen ?? (await vindbareKandidaten());
  return kandidaten.map((profile) => ({
    profile,
    result: computeMatch(profileToMatchCandidate(profile), matchVacancy),
  }));
}

/** Overrides voor simulatie en Talent Radar — toegepast op een KOPIE. */
export interface SimulationOverrides {
  schedule?: VacancySchedule;
  hoursMin?: number;
  hoursMax?: number;
  mentorship?: boolean;
}

/** Past overrides toe op een diepe kopie; het origineel blijft onaangeroerd. */
export function applyVacancyOverrides(
  basis: MatchVacancy,
  overrides: SimulationOverrides,
): MatchVacancy {
  const kopie = structuredClone(basis);
  if (overrides.schedule !== undefined) kopie.schedule = overrides.schedule;
  if (overrides.hoursMin !== undefined) kopie.hoursMin = overrides.hoursMin;
  if (overrides.hoursMax !== undefined) kopie.hoursMax = overrides.hoursMax;
  if (overrides.mentorship !== undefined) kopie.mentorship = overrides.mentorship;
  return kopie;
}

// ---------------------------------------------------------------------------
// Kandidaatkant: matchfeed
// ---------------------------------------------------------------------------

export interface CandidateVacancyMatch {
  vacancy: Vacancy;
  location: PracticeLocation;
  organizationName: string;
  result: MatchResult;
}

/**
 * Matchfeed voor een kandidaat: alle gepubliceerde vacatures van actieve
 * organisaties, elk met volledig matchresultaat inclusief opportunities
 * ("Maak deze match mogelijk"). Gesorteerd: eligible eerst, daarna score
 * aflopend. Autorisatie: de aanroeper geeft het eigen profiel mee (via
 * getOwnProfile/requireCandidate).
 */
export async function matchesForCandidate(
  profile: CandidateProfile,
): Promise<CandidateVacancyMatch[]> {
  const vacatures = await prisma.vacancy.findMany({
    where: { status: "published", organization: { status: "active" } },
    include: { location: true, organization: { select: { name: true } } },
  });

  const kandidaat = profileToMatchCandidate(profile);
  const matches = vacatures.map(({ organization, location, ...vacancy }) => ({
    vacancy: vacancy as Vacancy,
    location,
    organizationName: organization.name,
    result: computeMatchWithOpportunities(kandidaat, vacancyToMatchVacancy(vacancy as Vacancy, location)),
  }));

  matches.sort(
    (a, b) =>
      Number(b.result.eligible) - Number(a.result.eligible) ||
      b.result.score - a.result.score,
  );
  return matches;
}

// ---------------------------------------------------------------------------
// Praktijkkant: kandidaten per vacature
// ---------------------------------------------------------------------------

export interface VacancyCandidateMatch {
  profile: CandidateProfile;
  /** Naam volgens privacy-instelling (anonymous → geanonimiseerd). */
  displayName: string;
  result: MatchResult;
}

/**
 * Alle actieve, vindbare kandidaten tegen één (eigen) vacature, met volledig
 * matchresultaat inclusief opportunities. Gesorteerd op score aflopend
 * (ineligible kandidaten hebben score 0 en staan dus onderaan).
 */
export async function candidatesForVacancy(
  ctx: OrgContext,
  vacancyId: string,
): Promise<VacancyCandidateMatch[]> {
  const vacature = await eigenVacature(ctx, vacancyId);
  const matchVacancy = vacancyToMatchVacancy(vacature, vacature.location);
  const [kandidaten, consentSet] = await Promise.all([
    vindbareKandidaten(),
    consentSetVoorOrg(ctx.organizationId),
  ]);

  const uitkomsten = kandidaten.map((profiel) => ({
    profile: profiel as CandidateProfile,
    displayName: weergaveNaam(
      profiel,
      dektConsent(consentSet, profiel.userId, vacature.id),
    ),
    result: computeMatchWithOpportunities(profileToMatchCandidate(profiel), matchVacancy),
  }));

  uitkomsten.sort((a, b) => b.result.score - a.result.score);
  return uitkomsten;
}

// ---------------------------------------------------------------------------
// Cross-locatiematching (entitlement cross_location_matching)
// ---------------------------------------------------------------------------

export interface OrgPoolEntry {
  vacancyId: string;
  vacancyTitle: string;
  locationId: string;
  profile: CandidateProfile;
  /** Consent-scope per vacature: naam alleen bij visible óf consent voor déze vacature. */
  displayName: string;
  result: MatchResult;
}

/**
 * Organisatiebrede kandidatenpool: alle actieve, vindbare kandidaten tegen
 * alle gepubliceerde vacatures van de organisatie. Zodra de vacatures meer
 * dan één locatie beslaan is dit cross-locatiematching en is de entitlement
 * cross_location_matching vereist (EntitlementError 402 anders).
 *
 * Locatiegebonden memberships zien alleen vacatures van hun eigen locaties.
 * De consent-scope blijft per vacature: een kandidaat die voor vacature X
 * toestemming gaf, blijft bij vacature Y (andere locatie) geanonimiseerd.
 */
export async function organizationCandidatePool(ctx: OrgContext): Promise<OrgPoolEntry[]> {
  if (!roleCan(ctx.role, "vacancy.manage")) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: vacancy.manage`, 403);
  }
  const allowed = allowedLocationIds(ctx);
  const vacatures = await prisma.vacancy.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: "published",
      ...(allowed ? { locationId: { in: allowed } } : {}),
    },
    include: { location: true },
  });

  const locaties = new Set(vacatures.map((v) => v.locationId));
  if (locaties.size > 1) {
    await enforceEntitlement(ctx.organizationId, "cross_location_matching");
  }

  const [kandidaten, consentSet] = await Promise.all([
    vindbareKandidaten(),
    consentSetVoorOrg(ctx.organizationId),
  ]);

  const entries: OrgPoolEntry[] = [];
  for (const vacature of vacatures) {
    const matchVacancy = vacancyToMatchVacancy(vacature as Vacancy, vacature.location);
    for (const profiel of kandidaten) {
      const result = computeMatch(profileToMatchCandidate(profiel), matchVacancy);
      if (!result.eligible) continue;
      entries.push({
        vacancyId: vacature.id,
        vacancyTitle: vacature.title,
        locationId: vacature.locationId,
        profile: profiel as CandidateProfile,
        displayName: weergaveNaam(
          profiel,
          dektConsent(consentSet, profiel.userId, vacature.id),
        ),
        result,
      });
    }
  }

  entries.sort((a, b) => b.result.score - a.result.score);
  return entries;
}

/**
 * Legt vast dat een kandidaat(profiel) met een andere locatie van de
 * organisatie wordt gedeeld — verplicht auditspoor bij cross-locatiegebruik.
 * Deelt zelf geen persoonsgegevens; consent-scope blijft leidend.
 */
export async function shareCandidateWithLocation(
  ctx: OrgContext,
  candidateProfileId: string,
  targetLocationId: string,
): Promise<void> {
  if (!roleCan(ctx.role, "candidate.invite")) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: candidate.invite`, 403);
  }
  assertLocationAllowed(ctx, targetLocationId);
  const locatie = await prisma.practiceLocation.findFirst({
    where: { id: targetLocationId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!locatie) throw new AuthzError("Locatie niet gevonden", 404);

  await audit("candidate.share_cross_location", "CandidateProfile", candidateProfileId, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { targetLocationId },
  });
}

// ---------------------------------------------------------------------------
// Simulatie (Match Studio)
// ---------------------------------------------------------------------------

export interface SimulationCandidate {
  profile: CandidateProfile;
  displayName: string;
  /** Resultaat met de huidige vacature-instellingen. */
  base: MatchResult;
  /** Resultaat met de overrides toegepast. */
  simulated: MatchResult;
  /** simulated.score − base.score */
  scoreDelta: number;
  /** true wanneer de kandidaat door de overrides eligible wordt. */
  becameEligible: boolean;
}

export interface SimulationResult {
  /** Gesorteerd op gesimuleerde score aflopend. */
  entries: SimulationCandidate[];
  baseEligibleCount: number;
  simulatedEligibleCount: number;
  /** Extra eligible kandidaten dankzij de overrides. */
  extraEligibleCount: number;
}

/**
 * Simuleert de kandidaatpool van een vacature met aangepaste instellingen
 * (rooster, uren, begeleiding) op een KOPIE — er wordt niets opgeslagen.
 * Retourneert per kandidaat de scoreverbetering t.o.v. de basis en het aantal
 * extra eligible kandidaten. De pagina (Match Studio) dwingt de entitlement
 * match_studio_full af; deze service rekent alleen.
 */
export async function simulateVacancyPool(
  ctx: OrgContext,
  vacancyId: string,
  overrides: SimulationOverrides,
): Promise<SimulationResult> {
  const vacature = await eigenVacature(ctx, vacancyId);
  const basisVacature = vacancyToMatchVacancy(vacature, vacature.location);
  const gesimuleerdeVacature = applyVacancyOverrides(basisVacature, overrides);

  const kandidaten = await vindbareKandidaten();
  const entries: SimulationCandidate[] = kandidaten.map((profiel) => {
    const matchKandidaat = profileToMatchCandidate(profiel);
    const base = computeMatch(matchKandidaat, basisVacature);
    const simulated = computeMatch(matchKandidaat, gesimuleerdeVacature);
    return {
      profile: profiel as CandidateProfile,
      displayName: weergaveNaam(profiel),
      base,
      simulated,
      scoreDelta: simulated.score - base.score,
      becameEligible: !base.eligible && simulated.eligible,
    };
  });

  entries.sort((a, b) => b.simulated.score - a.simulated.score);
  const baseEligibleCount = entries.filter((e) => e.base.eligible).length;
  const simulatedEligibleCount = entries.filter((e) => e.simulated.eligible).length;

  await track("match_simulation_run", {
    organizationId: ctx.organizationId,
    locationId: vacature.locationId,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: {
      vacancyId,
      extraEligible: simulatedEligibleCount - baseEligibleCount,
    },
  });

  return {
    entries,
    baseEligibleCount,
    simulatedEligibleCount,
    extraEligibleCount: simulatedEligibleCount - baseEligibleCount,
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** Waarde veilig als Json opslaan (datums worden ISO-strings). */
function alsJson(waarde: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(waarde)) as Prisma.InputJsonValue;
}

/**
 * Legt een MatchSnapshot vast op een beslismoment (uitnodiging, sollicitatie):
 * score, label, algoritmeversie, het volledige resultaat en de bepalende
 * profiel- en vacaturegegevens van dat moment. Geeft het snapshot-id terug.
 */
export async function saveMatchSnapshot(
  vacancyId: string,
  candidateUserId: string,
  result: MatchResult,
  context: SnapshotContext,
  profileData: MatchCandidate,
  vacancyData: MatchVacancy,
): Promise<string> {
  const snapshot = await prisma.matchSnapshot.create({
    data: {
      vacancyId,
      candidateUserId,
      context,
      score: result.score,
      label: result.label,
      algorithmVersion: result.algorithmVersion,
      result: alsJson(result),
      profileData: alsJson(profileData),
      vacancyData: alsJson(vacancyData),
    },
    select: { id: true },
  });
  return snapshot.id;
}
