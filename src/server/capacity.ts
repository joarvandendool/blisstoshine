// Servicelaag voor de Praktijkbezetting: teamleden per locatie (geen
// platformgebruikers), het gewenste bezettingsminimum per weekdag+dagdeel en
// de berekende bezettingsweek — inclusief het aantal beschikbare kandidaten
// per gat (hergebruik van de matching-engine via poolForMatchVacancy).
//
// Regels:
// - Alles is tenant-gescoped: elke functie lost de locatie (of het teamlid)
//   op binnen ctx.organizationId — een vreemde locatie is onvindbaar (404,
//   AuthzError), nooit alleen verboden.
// - Schrijven en lezen van team en bezetting vereist capability
//   "location.manage" (zelfde recht als locatiebeheer).
// - PRIVACY: kandidaat-tellingen volgen de Talent Radar-regel — aantallen
//   onder TALENT_RADAR_MIN_GROUP worden als null teruggegeven.

import type { CandidateProfile, PracticeLocation, Prisma, TeamMember } from "@prisma/client";
import { AuthzError, roleCan, type OrgContext } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { audit } from "@/lib/audit";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  DAYPARTS,
  ROLES,
  WEEKDAYS,
  emptySchedule,
  label,
  type Daypart,
  type Weekday,
} from "@/domain/taxonomy";
import type { MatchVacancy } from "@/domain/matching";
import {
  createDraftVacancy,
  practiceSizeVanKamers,
  type VacancyWithLocation,
} from "@/server/vacancies";
import { poolForMatchVacancy } from "@/server/matching";
import { planCodeVoorAnalytics } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Contracten
// ---------------------------------------------------------------------------

/** Vaste werkdagen van een teamlid: true = werkt dat dagdeel. */
export type TeamSchedule = Record<Weekday, Record<Daypart, boolean>>;

/** Gewenst minimum aantal aanwezige teamleden per weekdag+dagdeel. */
export type StaffingTarget = Record<Weekday, Record<Daypart, number>>;

export interface TeamMemberInput {
  /** Zonder id: nieuw teamlid; met id: bestaand teamlid bijwerken. */
  id?: string;
  name: string;
  role: string;
  schedule: TeamSchedule;
  absentFrom?: Date | null;
  absentUntil?: Date | null;
  note?: string | null;
}

export type CapacityStatus = "volledig" | "gedeeltelijk" | "open" | "tekort_verwacht";

export interface CapacityCell {
  day: Weekday;
  daypart: Daypart;
  /** Aanwezige teamleden in de opgevraagde week (rooster minus afwezigheid). */
  present: number;
  /** Gewenst minimum uit staffingTarget (0 = geen bezetting nodig). */
  target: number;
  status: CapacityStatus;
  /**
   * Eerste datum binnen 4 weken waarop door geplande afwezigheid een tekort
   * ontstaat — alleen gevuld bij status "tekort_verwacht".
   */
  shortageExpectedOn: Date | null;
  /**
   * Aantal beschikbare (eligible) kandidaten voor dit dagdeel — alleen
   * berekend voor open/onderbezette dagdelen en tekorten; null wanneer niet
   * van toepassing óf onder de privacydrempel (zoals de Talent Radar).
   */
  availableCandidates: number | null;
}

export interface CapacityWeekResult {
  locationId: string;
  /** Maandag 00:00 van de berekende week. */
  weekStart: Date;
  /** Rol waarmee de kandidaat-tellingen zijn berekend (meest voorkomende teamrol). */
  candidateRole: string;
  cells: CapacityCell[];
  target: StaffingTarget;
  minGroupSize: number;
}

export interface GapToVacancyInput {
  role: string;
  gaps: Array<{ day: Weekday; daypart: Daypart }>;
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

const DAG_MS = 86_400_000;
/** Vooruitkijkvenster voor "tekort_verwacht": 4 weken. */
const VOORUITBLIK_WEKEN = 4;

export function emptyTeamSchedule(): TeamSchedule {
  const uit = {} as TeamSchedule;
  for (const dag of WEEKDAYS) {
    uit[dag] = { ochtend: false, middag: false, avond: false };
  }
  return uit;
}

export function emptyStaffingTarget(): StaffingTarget {
  const uit = {} as StaffingTarget;
  for (const dag of WEEKDAYS) {
    uit[dag] = { ochtend: 0, middag: 0, avond: 0 };
  }
  return uit;
}

/** Json-kolom → TeamSchedule, defensief (ontbrekend = werkt niet). */
export function castTeamSchedule(waarde: unknown): TeamSchedule {
  const basis = emptyTeamSchedule();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        if ((rij as Record<string, unknown>)[dagdeel] === true) {
          basis[dag][dagdeel] = true;
        }
      }
    }
  }
  return basis;
}

/** Json-kolom → StaffingTarget, defensief (ontbrekend of ongeldig = 0). */
export function castStaffingTarget(waarde: unknown): StaffingTarget {
  const basis = emptyStaffingTarget();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        const aantal = (rij as Record<string, unknown>)[dagdeel];
        if (typeof aantal === "number" && Number.isInteger(aantal) && aantal >= 0) {
          basis[dag][dagdeel] = Math.min(99, aantal);
        }
      }
    }
  }
  return basis;
}

function vereis(ctx: OrgContext, capability: string): void {
  if (!roleCan(ctx.role, capability)) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: ${capability}`, 403);
  }
}

/** Locatie ophalen binnen de eigen organisatie; een vreemde locatie is 404. */
async function eigenLocatie(ctx: OrgContext, locationId: string): Promise<PracticeLocation> {
  const locatie = await prisma.practiceLocation.findFirst({
    where: { id: locationId, organizationId: ctx.organizationId },
  });
  if (!locatie) throw new AuthzError("Locatie niet gevonden", 404);
  return locatie;
}

/** Teamlid ophalen binnen de eigen organisatie (via de locatie); anders 404. */
async function eigenTeamlid(ctx: OrgContext, id: string): Promise<TeamMember> {
  const teamlid = await prisma.teamMember.findFirst({
    where: { id, location: { organizationId: ctx.organizationId } },
  });
  if (!teamlid) throw new AuthzError("Teamlid niet gevonden", 404);
  return teamlid;
}

/** Maandag 00:00 (lokale tijd) van de week waarin de datum valt. */
export function maandagVan(datum: Date): Date {
  const d = new Date(datum);
  d.setHours(0, 0, 0, 0);
  const dagIndex = (d.getDay() + 6) % 7; // ma = 0 … zo = 6
  d.setDate(d.getDate() - dagIndex);
  return d;
}

/** Is het teamlid afwezig op (een deel van) de opgegeven kalenderdag? */
function afwezigOpDag(teamlid: TeamMember, dag: Date): boolean {
  if (!teamlid.absentFrom && !teamlid.absentUntil) return false;
  const dagStart = new Date(dag);
  dagStart.setHours(0, 0, 0, 0);
  const dagEinde = new Date(dagStart.getTime() + DAG_MS - 1);
  if (teamlid.absentFrom && teamlid.absentFrom.getTime() > dagEinde.getTime()) return false;
  if (teamlid.absentUntil && teamlid.absentUntil.getTime() < dagStart.getTime()) return false;
  return true;
}

/** Aanwezige teamleden op één dagdeel in de week die op weekStart begint. */
function telAanwezig(
  team: TeamMember[],
  roosters: Map<string, TeamSchedule>,
  weekStart: Date,
  dagIndex: number,
  dag: Weekday,
  dagdeel: Daypart,
): number {
  const kalenderdag = new Date(weekStart.getTime() + dagIndex * DAG_MS);
  let aantal = 0;
  for (const teamlid of team) {
    const rooster = roosters.get(teamlid.id);
    if (!rooster || !rooster[dag][dagdeel]) continue;
    if (afwezigOpDag(teamlid, kalenderdag)) continue;
    aantal += 1;
  }
  return aantal;
}

/** Teller onder de privacydrempel → null (zelfde regel als de Talent Radar). */
function maskeer(aantal: number): number | null {
  return aantal >= TALENT_RADAR_MIN_GROUP ? aantal : null;
}

/**
 * Minimale concept-MatchVacancy voor één rol+dagdeel op deze locatie: alleen
 * het betreffende dagdeel is verplicht, alle overige criteria zijn neutraal —
 * zo telt de matching-engine iedereen mee die de rol heeft en dat dagdeel kan.
 */
function minimaleDraftVacature(
  locatie: PracticeLocation,
  rol: string,
  dag: Weekday,
  dagdeel: Daypart,
): MatchVacancy {
  const rooster = emptySchedule();
  rooster[dag][dagdeel] = "required";
  return {
    id: `capaciteit:${locatie.id}:${dag}:${dagdeel}`,
    role: rol,
    experienceLevel: null,
    latitude: locatie.latitude,
    longitude: locatie.longitude,
    schedule: rooster,
    hoursMin: 0,
    hoursMax: 40,
    contractTypes: [],
    startBy: null,
    startByHard: false,
    criteria: {},
    culture: [],
    mentorship: false,
    development: [],
    practiceSize: practiceSizeVanKamers(locatie.treatmentRooms),
    patientPopulation: locatie.patientPopulation,
  };
}

/** Meest voorkomende rol in het team — de rol waarmee gaten geteld worden. */
function dominanteRol(team: TeamMember[]): string {
  const telling = new Map<string, number>();
  for (const teamlid of team) {
    telling.set(teamlid.role, (telling.get(teamlid.role) ?? 0) + 1);
  }
  let beste: string | null = null;
  let hoogste = 0;
  for (const [rol, aantal] of telling) {
    if (aantal > hoogste) {
      beste = rol;
      hoogste = aantal;
    }
  }
  return beste ?? "tandarts";
}

// ---------------------------------------------------------------------------
// Team-CRUD (capability location.manage, altijd tenant-gescoped)
// ---------------------------------------------------------------------------

/** Alle teamleden van een (eigen) locatie, alfabetisch. */
export async function listTeamMembers(
  ctx: OrgContext,
  locationId: string,
): Promise<TeamMember[]> {
  vereis(ctx, "location.manage");
  await eigenLocatie(ctx, locationId);
  return prisma.teamMember.findMany({
    where: { locationId },
    orderBy: { name: "asc" },
  });
}

/** Maakt of werkt een teamlid bij (id bepaalt welke van de twee). */
export async function upsertTeamMember(
  ctx: OrgContext,
  locationId: string,
  input: TeamMemberInput,
): Promise<TeamMember> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);

  const naam = input.name.trim();
  if (!naam) throw new AuthzError("Naam is verplicht", 400);
  if (!(ROLES as readonly string[]).includes(input.role)) {
    throw new AuthzError("Onbekende functie", 400);
  }
  if (
    input.absentFrom instanceof Date &&
    input.absentUntil instanceof Date &&
    input.absentUntil.getTime() < input.absentFrom.getTime()
  ) {
    throw new AuthzError("De einddatum van de afwezigheid ligt vóór de startdatum", 400);
  }

  const data = {
    name: naam,
    role: input.role,
    schedule: castTeamSchedule(input.schedule) as unknown as Prisma.InputJsonValue,
    absentFrom: input.absentFrom ?? null,
    absentUntil: input.absentUntil ?? null,
    note: input.note?.trim() || null,
  };

  let teamlid: TeamMember;
  if (input.id) {
    // Bestaand teamlid: eerst binnen de eigen organisatie oplossen (404 bij
    // een vreemd teamlid) en op dezelfde locatie houden.
    const bestaand = await eigenTeamlid(ctx, input.id);
    if (bestaand.locationId !== locatie.id) {
      throw new AuthzError("Teamlid hoort niet bij deze locatie", 400);
    }
    teamlid = await prisma.teamMember.update({ where: { id: bestaand.id }, data });
  } else {
    teamlid = await prisma.teamMember.create({
      data: { locationId: locatie.id, ...data },
    });
  }

  await audit(
    input.id ? "team_member.update" : "team_member.create",
    "TeamMember",
    teamlid.id,
    {
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      meta: { locationId: locatie.id, role: teamlid.role },
    },
  );

  return teamlid;
}

/** Verwijdert een teamlid — uitsluitend binnen de eigen organisatie. */
export async function deleteTeamMember(ctx: OrgContext, id: string): Promise<void> {
  vereis(ctx, "location.manage");
  const teamlid = await eigenTeamlid(ctx, id);
  await prisma.teamMember.delete({ where: { id: teamlid.id } });
  await audit("team_member.delete", "TeamMember", teamlid.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { locationId: teamlid.locationId },
  });
}

// ---------------------------------------------------------------------------
// Gewenst minimum
// ---------------------------------------------------------------------------

/** Slaat het gewenste minimum per weekdag+dagdeel op de locatie op. */
export async function saveStaffingTarget(
  ctx: OrgContext,
  locationId: string,
  target: StaffingTarget,
): Promise<PracticeLocation> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);
  const genormaliseerd = castStaffingTarget(target);
  const bijgewerkt = await prisma.practiceLocation.update({
    where: { id: locatie.id },
    data: { staffingTarget: genormaliseerd as unknown as Prisma.InputJsonValue },
  });
  await audit("location.staffing_target", "PracticeLocation", locatie.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
  return bijgewerkt;
}

// ---------------------------------------------------------------------------
// Bezettingsweek
// ---------------------------------------------------------------------------

/**
 * Berekent per weekdag+dagdeel de bezetting van een (eigen) locatie:
 * aanwezige teamleden (vaste werkdagen minus afwezigheid die de opgevraagde
 * week raakt), het gewenste minimum en de status:
 *
 * - "volledig":        aanwezig ≥ gewenst;
 * - "tekort_verwacht": nu volledig, maar binnen 4 weken ontstaat door een
 *                      geplande afwezigheid een gat (met de eerste datum);
 * - "gedeeltelijk":    er is bezetting, maar minder dan gewenst;
 * - "open":            gewenst > 0 en niemand aanwezig.
 *
 * Voor open/onderbezette dagdelen (en verwachte tekorten) telt de functie het
 * aantal beschikbare kandidaten via de matching-engine (minimale
 * concept-vacature voor de dominante teamrol + dit dagdeel). Privacy: alleen
 * aantallen, en onder TALENT_RADAR_MIN_GROUP → null.
 */
export async function capacityWeek(
  ctx: OrgContext,
  locationId: string,
  opts?: { weekStart?: Date },
): Promise<CapacityWeekResult> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);
  const team = await prisma.teamMember.findMany({ where: { locationId: locatie.id } });

  const weekStart = maandagVan(opts?.weekStart ?? new Date());
  const target = castStaffingTarget(locatie.staffingTarget);
  const roosters = new Map<string, TeamSchedule>(
    team.map((teamlid) => [teamlid.id, castTeamSchedule(teamlid.schedule)]),
  );
  const kandidaatRol = dominanteRol(team);

  // Kandidatenpool één keer ophalen en hergebruiken voor alle gaten.
  let kandidaten: CandidateProfile[] | null = null;

  const cells: CapacityCell[] = [];
  for (let dagIndex = 0; dagIndex < WEEKDAYS.length; dagIndex += 1) {
    const dag = WEEKDAYS[dagIndex];
    for (const dagdeel of DAYPARTS) {
      const gewenst = target[dag][dagdeel];
      const aanwezig = telAanwezig(team, roosters, weekStart, dagIndex, dag, dagdeel);

      let status: CapacityStatus;
      let shortageExpectedOn: Date | null = null;
      if (aanwezig >= gewenst) {
        status = "volledig";
        // Vooruitblik: ontstaat er binnen 4 weken een gat door afwezigheid?
        if (gewenst > 0) {
          for (let week = 1; week <= VOORUITBLIK_WEKEN; week += 1) {
            const toekomstStart = new Date(weekStart.getTime() + week * 7 * DAG_MS);
            const dan = telAanwezig(team, roosters, toekomstStart, dagIndex, dag, dagdeel);
            if (dan < gewenst) {
              status = "tekort_verwacht";
              shortageExpectedOn = new Date(toekomstStart.getTime() + dagIndex * DAG_MS);
              break;
            }
          }
        }
      } else if (aanwezig > 0) {
        status = "gedeeltelijk";
      } else {
        status = "open";
      }

      // Kandidaat-telling voor gaten en verwachte tekorten.
      let availableCandidates: number | null = null;
      if (status === "open" || status === "gedeeltelijk" || status === "tekort_verwacht") {
        if (kandidaten === null) {
          kandidaten = await prisma.candidateProfile.findMany({
            where: { status: "active", visibility: { not: "hidden" } },
          });
        }
        const pool = await poolForMatchVacancy(
          minimaleDraftVacature(locatie, kandidaatRol, dag, dagdeel),
          kandidaten,
        );
        availableCandidates = maskeer(pool.filter((entry) => entry.result.eligible).length);
      }

      cells.push({
        day: dag,
        daypart: dagdeel,
        present: aanwezig,
        target: gewenst,
        status,
        shortageExpectedOn,
        availableCandidates,
      });
    }
  }

  return {
    locationId: locatie.id,
    weekStart,
    candidateRole: kandidaatRol,
    cells,
    target,
    minGroupSize: TALENT_RADAR_MIN_GROUP,
  };
}

// ---------------------------------------------------------------------------
// Van bezettingsgat naar vacatureconcept
// ---------------------------------------------------------------------------

/** Nederlandse opsomming: "dinsdag en donderdag", "maandag, dinsdag en vrijdag". */
function dagenOpsomming(dagen: Weekday[]): string {
  const namen = dagen.map((dag) => label(dag).toLowerCase());
  if (namen.length === 1) return namen[0];
  return `${namen.slice(0, -1).join(", ")} en ${namen[namen.length - 1]}`;
}

/**
 * Genereert een conceptvacature (createDraftVacancy — capability
 * vacancy.manage) met het rooster "required" op de geselecteerde gaten en een
 * logische Nederlandse titel. Trackt capacity_gap_to_vacancy.
 */
export async function gapToVacancyDraft(
  ctx: OrgContext,
  locationId: string,
  input: GapToVacancyInput,
): Promise<VacancyWithLocation> {
  const locatie = await eigenLocatie(ctx, locationId);

  if (!(ROLES as readonly string[]).includes(input.role)) {
    throw new AuthzError("Onbekende functie", 400);
  }
  const gaten = input.gaps.filter(
    (gat) =>
      (WEEKDAYS as readonly string[]).includes(gat.day) &&
      (DAYPARTS as readonly string[]).includes(gat.daypart),
  );
  if (gaten.length === 0) {
    throw new AuthzError("Kies minstens één dagdeel voor de personeelsbehoefte", 400);
  }

  const rooster = emptySchedule();
  for (const gat of gaten) rooster[gat.day][gat.daypart] = "required";

  // Dagen in weekvolgorde en ontdubbeld voor de titel.
  const dagen = WEEKDAYS.filter((dag) => gaten.some((gat) => gat.day === dag));
  const titel = `${label(input.role)} gezocht voor ${dagenOpsomming(dagen)}`;

  // Urenindicatie: ± 4 uur per dagdeel, binnen de wizardgrenzen (1–40).
  const aantalDagdelen = new Set(gaten.map((gat) => `${gat.day}:${gat.daypart}`)).size;
  const hoursMin = Math.min(40, Math.max(4, aantalDagdelen * 4));
  const hoursMax = Math.min(40, hoursMin + 8);

  const vacature = await createDraftVacancy(ctx, {
    locationId: locatie.id,
    title: titel,
    role: input.role,
    description:
      `Conceptvacature aangemaakt vanuit de praktijkbezetting van ${locatie.name}: ` +
      `er is een ${label(input.role).toLowerCase()} nodig op ${dagenOpsomming(dagen)}. ` +
      "Vul de details aan voordat je publiceert.",
    schedule: rooster,
    hoursMin,
    hoursMax,
  });

  await track("capacity_gap_to_vacancy", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: {
      vacancyId: vacature.id,
      role: input.role,
      aantalDagdelen,
    },
  });

  return vacature;
}
