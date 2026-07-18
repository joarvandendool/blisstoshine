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
import { AuthzError, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
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
 * visible → echte naam; anonymous → geanonimiseerd, zonder naam.
 */
function weergaveNaam(profiel: ProfielMetNaam): string {
  if (profiel.visibility === "visible") return profiel.user.name;
  const stad = geocodePostcode(profiel.postcode)?.city;
  const rol = label(profiel.role);
  return stad ? `${rol} uit ${stad}` : `${rol} (anoniem profiel)`;
}

/** Vacature scoped ophalen (alleen binnen de eigen organisatie), incl. locatie. */
async function eigenVacature(
  ctx: OrgContext,
  vacancyId: string,
): Promise<Vacancy & { location: PracticeLocation }> {
  const vacature = await prisma.vacancy.findFirst({
    where: { id: vacancyId, organizationId: ctx.organizationId },
    include: { location: true },
  });
  if (!vacature) throw new AuthzError("Vacature niet gevonden", 404);
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
  const kandidaten = await vindbareKandidaten();

  const uitkomsten = kandidaten.map((profiel) => ({
    profile: profiel as CandidateProfile,
    displayName: weergaveNaam(profiel),
    result: computeMatchWithOpportunities(profileToMatchCandidate(profiel), matchVacancy),
  }));

  uitkomsten.sort((a, b) => b.result.score - a.result.score);
  return uitkomsten;
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
