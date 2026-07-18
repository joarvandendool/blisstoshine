// Servicelaag voor de Praktijkbezetting: teamleden per locatie (geen
// platformgebruikers), getypeerde afwezigheden (TeamAbsence), het gewenste
// bezettingsminimum per weekdag+dagdeel — desgewenst per functie — en de
// berekende bezettingsweek: huidige en gewenste dekking, absoluut en relatief
// tekort, toekomstig tekort (8 weken vooruit, incl. start-/einddatum en
// afwezigheden), behandelkamercapaciteit, passende kandidaten en mogelijke
// parttimer-combinaties. Daarnaast: immutabele staffing-scenario's
// (runScenario/confirmScenario/rejectScenario).
//
// Regels:
// - Alles is tenant-gescoped: elke functie lost de locatie (of het teamlid)
//   op binnen ctx.organizationId — een vreemde locatie is onvindbaar (404,
//   AuthzError), nooit alleen verboden. Locatiegebonden memberships
//   (Membership.locationIds) worden bovendien via assertLocationAllowed
//   afgedwongen (403).
// - Schrijven en lezen van team en bezetting vereist capability
//   "location.manage" (zelfde recht als locatiebeheer).
// - PRIVACY: kandidaat-tellingen volgen de Talent Radar-regel — aantallen
//   onder TALENT_RADAR_MIN_GROUP worden als null teruggegeven.
// - De oude kolommen TeamMember.absentFrom/absentUntil blijven bestaan maar
//   worden niet meer gelezen of geschreven (leesloze migratie): TeamAbsence
//   is de enige bron voor afwezigheid.

import type {
  CandidateProfile,
  PracticeLocation,
  Prisma,
  StaffingScenario,
  TeamAbsence,
  TeamMember,
} from "@prisma/client";
import {
  AuthzError,
  assertLocationAllowed,
  roleCan,
  type OrgContext,
} from "@/lib/authz";
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

/** Gewenst minimum per functie: { tandarts: { ma: { ochtend: 2 } } }. */
export type RoleStaffingTargets = Record<string, StaffingTarget>;

export const ABSENCE_KINDS = ["verlof", "ziekte", "zwangerschapsverlof", "anders"] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export const EMPLOYMENT_TYPES = ["loondienst", "zzp", "detachering"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export type TeamMemberMetAbsences = TeamMember & { absences: TeamAbsence[] };

export interface TeamMemberInput {
  /** Zonder id: nieuw teamlid; met id: bestaand teamlid bijwerken. */
  id?: string;
  name: string;
  role: string;
  schedule: TeamSchedule;
  /** Contracturen per week (een dagdeel telt als ±4 uur). */
  contractHours?: number | null;
  employmentType?: string | null;
  /** Toekomstige startdatum: telt pas mee vanaf deze datum. */
  startDate?: Date | null;
  /** Verwachte einddatum (uitstroom): telt daarna niet meer mee. */
  endDate?: Date | null;
  note?: string | null;
}

export interface AbsenceInput {
  kind: AbsenceKind;
  from: Date;
  /** null = einddatum nog onbekend (bv. langdurige ziekte). */
  until?: Date | null;
  note?: string | null;
}

export type CapacityStatus = "volledig" | "gedeeltelijk" | "open" | "tekort_verwacht";

export interface CapacityCell {
  day: Weekday;
  daypart: Daypart;
  /** Effectieve dekking deze week (rooster − afwezigheid, gemaximeerd op kamers). */
  present: number;
  /** Gewenste dekking uit staffingTarget (0 = geen bezetting nodig). */
  target: number;
  /** Absoluut tekort: max(0, target − present). */
  shortage: number;
  /** Relatief tekort: shortage/target (0 wanneer target 0). */
  shortageRatio: number;
  status: CapacityStatus;
  /**
   * Eerste datum binnen 8 weken waarop door start-/einddatum of geplande
   * afwezigheid een tekort ontstaat — alleen gevuld bij "tekort_verwacht".
   */
  shortageExpectedOn: Date | null;
  /**
   * Aantal beschikbare (eligible) kandidaten voor dit dagdeel — alleen
   * berekend voor open/onderbezette dagdelen en tekorten; null wanneer niet
   * van toepassing óf onder de privacydrempel (zoals de Talent Radar).
   */
  availableCandidates: number | null;
}

/** Dekking per functie (alleen wanneer een per-functie target is ingesteld). */
export interface RoleCapacityCell extends CapacityCell {
  role: string;
}

export interface OverCapacityCell {
  day: Weekday;
  daypart: Daypart;
  /** Ingeroosterde teamleden (vóór aftopping op behandelkamers). */
  scheduled: number;
  rooms: number;
}

export interface PartTimeCombo {
  role: string;
  gaps: Array<{ day: Weekday; daypart: Daypart }>;
  /**
   * Aantal parttimer-combinaties (twee kandidaten die samen alle gevraagde
   * dagdelen dekken, terwijl geen van beiden dat alleen kan). Onder de
   * privacydrempel → null.
   */
  comboCount: number | null;
}

export interface CapacityWeekResult {
  locationId: string;
  /** Maandag 00:00 van de berekende week. */
  weekStart: Date;
  /** Rol waarmee de totaal-kandidaattellingen zijn berekend (dominante teamrol). */
  candidateRole: string;
  /** Totale dekking over alle functies heen. */
  cells: CapacityCell[];
  /** Dekking per functie — leeg wanneer alleen het oude totaaltarget is ingesteld. */
  roleCells: RoleCapacityCell[];
  target: StaffingTarget;
  /** Per-functie targets (nieuwe Json-vorm) of null bij de oude vorm. */
  roleTargets: RoleStaffingTargets | null;
  treatmentRooms: number;
  /** Dagdelen waarop meer teamleden zijn ingeroosterd dan er kamers zijn. */
  overCapacity: OverCapacityCell[];
  /** Parttimer-combinaties per functie met gaten. */
  partTimeCombos: PartTimeCombo[];
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
/** Vooruitkijkvenster voor "tekort_verwacht": 8 weken. */
const VOORUITBLIK_WEKEN = 8;
/** Een dagdeel telt als ±4 uur voor de contracturen-aftopping. */
const UREN_PER_DAGDEEL = 4;

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

/**
 * Json-kolom → per-functie targets (nieuwe vorm { rol: { ma: { ochtend: 2 } } })
 * of null bij de oude vorm ({ ma: { ochtend: 2 } }) of onbruikbare invoer.
 */
export function castRoleStaffingTargets(waarde: unknown): RoleStaffingTargets | null {
  if (!waarde || typeof waarde !== "object" || Array.isArray(waarde)) return null;
  const sleutels = Object.keys(waarde as Record<string, unknown>);
  if (sleutels.length === 0) return null;
  // Oude vorm: weekdagen op het hoogste niveau.
  if (sleutels.some((sleutel) => (WEEKDAYS as readonly string[]).includes(sleutel))) {
    return null;
  }
  const uit: RoleStaffingTargets = {};
  for (const [rol, sub] of Object.entries(waarde as Record<string, unknown>)) {
    if (!(ROLES as readonly string[]).includes(rol)) continue;
    uit[rol] = castStaffingTarget(sub);
  }
  return Object.keys(uit).length > 0 ? uit : null;
}

/** Som van per-functie targets → totaaltarget. */
export function totalStaffingTarget(perRol: RoleStaffingTargets): StaffingTarget {
  const totaal = emptyStaffingTarget();
  for (const target of Object.values(perRol)) {
    for (const dag of WEEKDAYS) {
      for (const dagdeel of DAYPARTS) {
        totaal[dag][dagdeel] = Math.min(99, totaal[dag][dagdeel] + target[dag][dagdeel]);
      }
    }
  }
  return totaal;
}

function vereis(ctx: OrgContext, capability: string): void {
  if (!roleCan(ctx.role, capability)) {
    throw new AuthzError(`Rol ${ctx.role} mag dit niet: ${capability}`, 403);
  }
}

/**
 * Locatie ophalen binnen de eigen organisatie; een vreemde locatie is 404.
 * Locatiegebonden memberships krijgen 403 op locaties buiten hun toewijzing.
 */
async function eigenLocatie(ctx: OrgContext, locationId: string): Promise<PracticeLocation> {
  assertLocationAllowed(ctx, locationId);
  const locatie = await prisma.practiceLocation.findFirst({
    where: { id: locationId, organizationId: ctx.organizationId },
  });
  if (!locatie) throw new AuthzError("Locatie niet gevonden", 404);
  return locatie;
}

/** Teamlid ophalen binnen de eigen organisatie (via de locatie); anders 404. */
async function eigenTeamlid(ctx: OrgContext, id: string): Promise<TeamMemberMetAbsences> {
  const teamlid = await prisma.teamMember.findFirst({
    where: { id, location: { organizationId: ctx.organizationId } },
    include: { absences: { orderBy: { from: "asc" } } },
  });
  if (!teamlid) throw new AuthzError("Teamlid niet gevonden", 404);
  assertLocationAllowed(ctx, teamlid.locationId);
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

/** Waarde veilig als Json opslaan (datums worden ISO-strings). */
function alsJson(waarde: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(waarde)) as Prisma.InputJsonValue;
}

/** Teller onder de privacydrempel → null (zelfde regel als de Talent Radar). */
function maskeer(aantal: number): number | null {
  return aantal >= TALENT_RADAR_MIN_GROUP ? aantal : null;
}

// ---------------------------------------------------------------------------
// Voorbereide teamleden (rooster + contracturen + afwezigheden)
// ---------------------------------------------------------------------------

interface AbsencePeriode {
  from: Date;
  until: Date | null;
}

/** Interne, voorbereide vorm van een teamlid voor de weekberekening. */
interface VoorbereidLid {
  id: string;
  role: string;
  startDate: Date | null;
  endDate: Date | null;
  absences: AbsencePeriode[];
  /**
   * Dagdelen waarop dit lid meetelt: het rooster, afgetopt op de contracturen
   * (±4 uur per dagdeel, in weekvolgorde ma-ochtend → zo-avond).
   */
  effectieveDagdelen: ReadonlySet<string>;
}

function dagdeelSleutel(dag: Weekday, dagdeel: Daypart): string {
  return `${dag}:${dagdeel}`;
}

/**
 * Rooster + contracturen → effectieve dagdelen. Zonder contracturen telt het
 * hele rooster; met contracturen tellen alleen de eerste ⌊uren/4⌋ dagdelen
 * (minimaal 1 bij een positief aantal uren) in weekvolgorde.
 */
function effectieveDagdelen(rooster: TeamSchedule, contractHours: number | null): Set<string> {
  const alle: string[] = [];
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      if (rooster[dag][dagdeel]) alle.push(dagdeelSleutel(dag, dagdeel));
    }
  }
  if (contractHours === null || contractHours === undefined) return new Set(alle);
  const maximum =
    contractHours <= 0
      ? 0
      : Math.max(1, Math.floor(contractHours / UREN_PER_DAGDEEL));
  return new Set(alle.slice(0, maximum));
}

function bereidLidVoor(
  teamlid: TeamMemberMetAbsences,
  extraAbsences: AbsencePeriode[] = [],
  overrides?: { endDate?: Date | null },
): VoorbereidLid {
  return {
    id: teamlid.id,
    role: teamlid.role,
    startDate: teamlid.startDate,
    endDate: overrides && "endDate" in overrides ? (overrides.endDate ?? null) : teamlid.endDate,
    absences: [
      // Alleen TeamAbsence — de oude absentFrom/absentUntil worden bewust
      // niet meer gelezen (leesloze migratie).
      ...teamlid.absences.map((a) => ({ from: a.from, until: a.until })),
      ...extraAbsences,
    ],
    effectieveDagdelen: effectieveDagdelen(
      castTeamSchedule(teamlid.schedule),
      teamlid.contractHours ?? null,
    ),
  };
}

/** Is het lid aanwezig op dit dagdeel van deze kalenderdag? */
function isAanwezig(lid: VoorbereidLid, kalenderdag: Date, dag: Weekday, dagdeel: Daypart): boolean {
  if (!lid.effectieveDagdelen.has(dagdeelSleutel(dag, dagdeel))) return false;
  const dagStart = new Date(kalenderdag);
  dagStart.setHours(0, 0, 0, 0);
  const dagEinde = new Date(dagStart.getTime() + DAG_MS - 1);
  if (lid.startDate && lid.startDate.getTime() > dagEinde.getTime()) return false;
  if (lid.endDate && lid.endDate.getTime() < dagStart.getTime()) return false;
  for (const afwezigheid of lid.absences) {
    const raaktStart = afwezigheid.from.getTime() <= dagEinde.getTime();
    const raaktEinde =
      afwezigheid.until === null || afwezigheid.until.getTime() >= dagStart.getTime();
    if (raaktStart && raaktEinde) return false;
  }
  return true;
}

function telAanwezig(
  leden: VoorbereidLid[],
  weekStart: Date,
  dagIndex: number,
  dag: Weekday,
  dagdeel: Daypart,
  rol?: string,
): number {
  const kalenderdag = new Date(weekStart.getTime() + dagIndex * DAG_MS);
  let aantal = 0;
  for (const lid of leden) {
    if (rol !== undefined && lid.role !== rol) continue;
    if (isAanwezig(lid, kalenderdag, dag, dagdeel)) aantal += 1;
  }
  return aantal;
}

// ---------------------------------------------------------------------------
// Kern-weekberekening (puur, zonder database of events)
// ---------------------------------------------------------------------------

interface WeekBerekeningOpties {
  leden: VoorbereidLid[];
  totalTarget: StaffingTarget;
  roleTargets: RoleStaffingTargets | null;
  weekStart: Date;
  treatmentRooms: number;
}

interface WeekBerekening {
  cells: Omit<CapacityCell, "availableCandidates">[];
  roleCells: Array<Omit<RoleCapacityCell, "availableCandidates">>;
  overCapacity: OverCapacityCell[];
}

function celBerekening(
  leden: VoorbereidLid[],
  weekStart: Date,
  dagIndex: number,
  dag: Weekday,
  dagdeel: Daypart,
  gewenst: number,
  kamers: number,
  rol?: string,
): Omit<CapacityCell, "availableCandidates"> {
  const ingeroosterd = telAanwezig(leden, weekStart, dagIndex, dag, dagdeel, rol);
  // Behandelkamercapaciteit: dekking kan het aantal kamers niet overstijgen.
  const aanwezig = Math.min(ingeroosterd, kamers);
  const tekort = Math.max(0, gewenst - aanwezig);

  let status: CapacityStatus;
  let shortageExpectedOn: Date | null = null;
  if (aanwezig >= gewenst) {
    status = "volledig";
    // Vooruitblik: ontstaat er binnen 8 weken een gat door start-/einddatum
    // of geplande afwezigheid?
    if (gewenst > 0) {
      for (let week = 1; week <= VOORUITBLIK_WEKEN; week += 1) {
        const toekomstStart = new Date(weekStart.getTime() + week * 7 * DAG_MS);
        const dan = Math.min(
          telAanwezig(leden, toekomstStart, dagIndex, dag, dagdeel, rol),
          kamers,
        );
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

  return {
    day: dag,
    daypart: dagdeel,
    present: aanwezig,
    target: gewenst,
    shortage: tekort,
    shortageRatio: gewenst > 0 ? tekort / gewenst : 0,
    status,
    shortageExpectedOn,
  };
}

function berekenWeek(opts: WeekBerekeningOpties): WeekBerekening {
  const { leden, totalTarget, roleTargets, weekStart, treatmentRooms } = opts;
  const cells: WeekBerekening["cells"] = [];
  const roleCells: WeekBerekening["roleCells"] = [];
  const overCapacity: OverCapacityCell[] = [];

  for (let dagIndex = 0; dagIndex < WEEKDAYS.length; dagIndex += 1) {
    const dag = WEEKDAYS[dagIndex];
    for (const dagdeel of DAYPARTS) {
      const ingeroosterd = telAanwezig(leden, weekStart, dagIndex, dag, dagdeel);
      if (ingeroosterd > treatmentRooms) {
        overCapacity.push({ day: dag, daypart: dagdeel, scheduled: ingeroosterd, rooms: treatmentRooms });
      }
      cells.push(
        celBerekening(
          leden,
          weekStart,
          dagIndex,
          dag,
          dagdeel,
          totalTarget[dag][dagdeel],
          treatmentRooms,
        ),
      );
      if (roleTargets) {
        for (const rol of Object.keys(roleTargets)) {
          roleCells.push({
            role: rol,
            ...celBerekening(
              leden,
              weekStart,
              dagIndex,
              dag,
              dagdeel,
              roleTargets[rol][dag][dagdeel],
              treatmentRooms,
              rol,
            ),
          });
        }
      }
    }
  }

  return { cells, roleCells, overCapacity };
}

/**
 * Minimale concept-MatchVacancy voor één rol op deze locatie met de opgegeven
 * dagdelen als "required" — de matching-engine telt dan iedereen mee die de
 * rol heeft en die dagdelen kan werken.
 */
function minimaleDraftVacature(
  locatie: Pick<PracticeLocation, "id" | "latitude" | "longitude" | "treatmentRooms" | "patientPopulation">,
  rol: string,
  dagdelen: Array<{ day: Weekday; daypart: Daypart }>,
): MatchVacancy {
  const rooster = emptySchedule();
  for (const cel of dagdelen) rooster[cel.day][cel.daypart] = "required";
  return {
    id: `capaciteit:${locatie.id}:${rol}:${dagdelen.map((c) => `${c.day}-${c.daypart}`).join("+")}`,
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
function dominanteRol(team: Array<{ role: string }>): string {
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

/** Alle teamleden van een (eigen) locatie, alfabetisch, incl. afwezigheden. */
export async function listTeamMembers(
  ctx: OrgContext,
  locationId: string,
): Promise<TeamMemberMetAbsences[]> {
  vereis(ctx, "location.manage");
  await eigenLocatie(ctx, locationId);
  return prisma.teamMember.findMany({
    where: { locationId },
    include: { absences: { orderBy: { from: "asc" } } },
    orderBy: { name: "asc" },
  });
}

/** Maakt of werkt een teamlid bij (id bepaalt welke van de twee). */
export async function upsertTeamMember(
  ctx: OrgContext,
  locationId: string,
  input: TeamMemberInput,
): Promise<TeamMemberMetAbsences> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);

  const naam = input.name.trim();
  if (!naam) throw new AuthzError("Naam is verplicht", 400);
  if (!(ROLES as readonly string[]).includes(input.role)) {
    throw new AuthzError("Onbekende functie", 400);
  }
  if (
    input.contractHours !== null &&
    input.contractHours !== undefined &&
    (!Number.isInteger(input.contractHours) ||
      input.contractHours < 0 ||
      input.contractHours > 60)
  ) {
    throw new AuthzError("Contracturen moeten tussen 0 en 60 liggen", 400);
  }
  if (
    input.employmentType !== null &&
    input.employmentType !== undefined &&
    !(EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)
  ) {
    throw new AuthzError("Onbekend dienstverband", 400);
  }
  if (
    input.startDate instanceof Date &&
    input.endDate instanceof Date &&
    input.endDate.getTime() < input.startDate.getTime()
  ) {
    throw new AuthzError("De einddatum ligt vóór de startdatum", 400);
  }

  const data = {
    name: naam,
    role: input.role,
    schedule: castTeamSchedule(input.schedule) as unknown as Prisma.InputJsonValue,
    contractHours: input.contractHours ?? null,
    employmentType: input.employmentType ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    note: input.note?.trim() || null,
  };

  let teamlid: TeamMemberMetAbsences;
  if (input.id) {
    // Bestaand teamlid: eerst binnen de eigen organisatie oplossen (404 bij
    // een vreemd teamlid) en op dezelfde locatie houden.
    const bestaand = await eigenTeamlid(ctx, input.id);
    if (bestaand.locationId !== locatie.id) {
      throw new AuthzError("Teamlid hoort niet bij deze locatie", 400);
    }
    teamlid = await prisma.teamMember.update({
      where: { id: bestaand.id },
      data,
      include: { absences: { orderBy: { from: "asc" } } },
    });
  } else {
    teamlid = await prisma.teamMember.create({
      data: { locationId: locatie.id, ...data },
      include: { absences: { orderBy: { from: "asc" } } },
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
  await track("capacity_plan_updated", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    context: { onderdeel: "teamlid", actie: input.id ? "bijgewerkt" : "toegevoegd" },
  });

  return teamlid;
}

/** Verwijdert een teamlid (incl. afwezigheden) — binnen de eigen organisatie. */
export async function deleteTeamMember(ctx: OrgContext, id: string): Promise<void> {
  vereis(ctx, "location.manage");
  const teamlid = await eigenTeamlid(ctx, id);
  await prisma.teamAbsence.deleteMany({ where: { teamMemberId: teamlid.id } });
  await prisma.teamMember.delete({ where: { id: teamlid.id } });
  await audit("team_member.delete", "TeamMember", teamlid.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { locationId: teamlid.locationId },
  });
  await track("capacity_plan_updated", {
    organizationId: ctx.organizationId,
    locationId: teamlid.locationId,
    userId: ctx.user.id,
    context: { onderdeel: "teamlid", actie: "verwijderd" },
  });
}

// ---------------------------------------------------------------------------
// Afwezigheden (TeamAbsence-CRUD) — vervangt absentFrom/absentUntil
// ---------------------------------------------------------------------------

/** Voegt een afwezigheidsperiode toe aan een teamlid. */
export async function addAbsence(
  ctx: OrgContext,
  teamMemberId: string,
  input: AbsenceInput,
): Promise<TeamAbsence> {
  vereis(ctx, "location.manage");
  const teamlid = await eigenTeamlid(ctx, teamMemberId);
  if (!(ABSENCE_KINDS as readonly string[]).includes(input.kind)) {
    throw new AuthzError("Onbekend afwezigheidstype", 400);
  }
  if (input.until instanceof Date && input.until.getTime() < input.from.getTime()) {
    throw new AuthzError("De einddatum van de afwezigheid ligt vóór de startdatum", 400);
  }

  const afwezigheid = await prisma.teamAbsence.create({
    data: {
      teamMemberId: teamlid.id,
      kind: input.kind,
      from: input.from,
      until: input.until ?? null,
      note: input.note?.trim() || null,
    },
  });

  await audit("team_absence.create", "TeamAbsence", afwezigheid.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { teamMemberId: teamlid.id, kind: input.kind },
  });
  await track("capacity_plan_updated", {
    organizationId: ctx.organizationId,
    locationId: teamlid.locationId,
    userId: ctx.user.id,
    context: { onderdeel: "afwezigheid", actie: "toegevoegd", soort: input.kind },
  });

  return afwezigheid;
}

/** Verwijdert een afwezigheidsperiode — binnen de eigen organisatie. */
export async function deleteAbsence(ctx: OrgContext, absenceId: string): Promise<void> {
  vereis(ctx, "location.manage");
  const afwezigheid = await prisma.teamAbsence.findFirst({
    where: { id: absenceId, teamMember: { location: { organizationId: ctx.organizationId } } },
    include: { teamMember: { select: { locationId: true } } },
  });
  if (!afwezigheid) throw new AuthzError("Afwezigheid niet gevonden", 404);
  assertLocationAllowed(ctx, afwezigheid.teamMember.locationId);

  await prisma.teamAbsence.delete({ where: { id: afwezigheid.id } });
  await audit("team_absence.delete", "TeamAbsence", afwezigheid.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
  await track("capacity_plan_updated", {
    organizationId: ctx.organizationId,
    locationId: afwezigheid.teamMember.locationId,
    userId: ctx.user.id,
    context: { onderdeel: "afwezigheid", actie: "verwijderd" },
  });
}

// ---------------------------------------------------------------------------
// Gewenst minimum
// ---------------------------------------------------------------------------

/**
 * Slaat het gewenste minimum op: per weekdag+dagdeel (oude vorm) of per
 * functie ({ rol: { ma: { ochtend: 2 } } }, nieuwe vorm). De vorm wordt aan
 * de sleutels herkend.
 */
export async function saveStaffingTarget(
  ctx: OrgContext,
  locationId: string,
  target: StaffingTarget | RoleStaffingTargets,
): Promise<PracticeLocation> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);

  const perRol = castRoleStaffingTargets(target);
  const genormaliseerd = perRol ?? castStaffingTarget(target);
  const bijgewerkt = await prisma.practiceLocation.update({
    where: { id: locatie.id },
    data: { staffingTarget: genormaliseerd as unknown as Prisma.InputJsonValue },
  });
  await audit("location.staffing_target", "PracticeLocation", locatie.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
  await track("capacity_plan_updated", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    context: { onderdeel: "minimum", perFunctie: perRol !== null },
  });
  return bijgewerkt;
}

// ---------------------------------------------------------------------------
// Bezettingsweek
// ---------------------------------------------------------------------------

/** Cellen met tekort (open/gedeeltelijk) → gatenlijst voor scenario's/events. */
function gatenVan(
  cells: Array<Pick<CapacityCell, "day" | "daypart" | "shortage"> & { role?: string }>,
): Array<{ day: Weekday; daypart: Daypart; shortage: number; role?: string }> {
  return cells
    .filter((cel) => cel.shortage > 0)
    .map((cel) => ({
      day: cel.day,
      daypart: cel.daypart,
      shortage: cel.shortage,
      ...(cel.role ? { role: cel.role } : {}),
    }));
}

/** Eligible profiel-id's voor één rol+dagdelen op een locatie. */
async function eligibleProfielIds(
  locatie: PracticeLocation,
  rol: string,
  dagdelen: Array<{ day: Weekday; daypart: Daypart }>,
  kandidaten: CandidateProfile[],
): Promise<string[]> {
  const pool = await poolForMatchVacancy(minimaleDraftVacature(locatie, rol, dagdelen), kandidaten);
  return pool.filter((entry) => entry.result.eligible).map((entry) => entry.profile.id);
}

/**
 * Parttimer-combinaties voor een set gaten van één rol: paren kandidaten die
 * samen alle gevraagde dagdelen dekken terwijl geen van beiden dat alleen kan.
 */
async function berekenPartTimeCombos(
  locatie: PracticeLocation,
  rol: string,
  gaten: Array<{ day: Weekday; daypart: Daypart }>,
  kandidaten: CandidateProfile[],
): Promise<{ comboCount: number; paren: Array<[string, string]> }> {
  // Per gat: wie kan dit dagdeel dekken?
  const perGat: Array<Set<string>> = [];
  for (const gat of gaten) {
    perGat.push(new Set(await eligibleProfielIds(locatie, rol, [gat], kandidaten)));
  }
  const alleIds = new Set<string>();
  for (const set of perGat) for (const id of set) alleIds.add(id);

  // Dekking per kandidaat als bitmask over de gaten.
  const dekking = new Map<string, number>();
  const volledig = (1 << gaten.length) - 1;
  for (const id of alleIds) {
    let mask = 0;
    perGat.forEach((set, index) => {
      if (set.has(id)) mask |= 1 << index;
    });
    dekking.set(id, mask);
  }

  const ids = [...dekking.keys()];
  const paren: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    const maskA = dekking.get(ids[i])!;
    if (maskA === volledig) continue; // dekt alles alleen — geen parttime-combinatie
    for (let j = i + 1; j < ids.length; j += 1) {
      const maskB = dekking.get(ids[j])!;
      if (maskB === volledig) continue;
      if ((maskA | maskB) === volledig) paren.push([ids[i], ids[j]]);
    }
  }
  return { comboCount: paren.length, paren };
}

/**
 * Berekent per weekdag+dagdeel de bezetting van een (eigen) locatie — totaal
 * én per functie wanneer een per-functie target is ingesteld:
 *
 * - "volledig":        dekking ≥ gewenst;
 * - "tekort_verwacht": nu volledig, maar binnen 8 weken ontstaat door
 *                      start-/einddatum of geplande afwezigheid een gat;
 * - "gedeeltelijk":    er is dekking, maar minder dan gewenst;
 * - "open":            gewenst > 0 en niemand aanwezig.
 *
 * De dekking is afgetopt op de behandelkamers van de locatie. Voor gaten telt
 * de functie het aantal beschikbare kandidaten via de matching-engine en
 * zoekt zij parttimer-combinaties (twee kandidaten die samen de gevraagde
 * dagdelen dekken). Privacy: alleen aantallen, onder TALENT_RADAR_MIN_GROUP
 * → null.
 *
 * Events: staffing_gap_detected bij gaten; staffing_gap_resolved wanneer een
 * gat uit de laatst opgeslagen scenario-planstand nu gedekt blijkt.
 */
export async function capacityWeek(
  ctx: OrgContext,
  locationId: string,
  opts?: { weekStart?: Date },
): Promise<CapacityWeekResult> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);
  const team = await prisma.teamMember.findMany({
    where: { locationId: locatie.id },
    include: { absences: { orderBy: { from: "asc" } } },
  });

  const weekStart = maandagVan(opts?.weekStart ?? new Date());
  const roleTargets = castRoleStaffingTargets(locatie.staffingTarget);
  const totalTarget = roleTargets
    ? totalStaffingTarget(roleTargets)
    : castStaffingTarget(locatie.staffingTarget);
  const leden = team.map((teamlid) => bereidLidVoor(teamlid));
  const kandidaatRol = dominanteRol(team);

  const berekening = berekenWeek({
    leden,
    totalTarget,
    roleTargets,
    weekStart,
    treatmentRooms: locatie.treatmentRooms,
  });

  // Kandidatenpool één keer ophalen en hergebruiken voor alle gaten.
  let kandidaten: CandidateProfile[] | null = null;
  const laadKandidaten = async (): Promise<CandidateProfile[]> => {
    if (kandidaten === null) {
      kandidaten = await prisma.candidateProfile.findMany({
        where: { status: "active", visibility: { not: "hidden" } },
      });
    }
    return kandidaten;
  };

  const heeftAandacht = (status: CapacityStatus): boolean =>
    status === "open" || status === "gedeeltelijk" || status === "tekort_verwacht";

  const cells: CapacityCell[] = [];
  for (const cel of berekening.cells) {
    let availableCandidates: number | null = null;
    if (heeftAandacht(cel.status)) {
      const pool = await eligibleProfielIds(
        locatie,
        kandidaatRol,
        [{ day: cel.day, daypart: cel.daypart }],
        await laadKandidaten(),
      );
      availableCandidates = maskeer(pool.length);
    }
    cells.push({ ...cel, availableCandidates });
  }

  const roleCells: RoleCapacityCell[] = [];
  for (const cel of berekening.roleCells) {
    let availableCandidates: number | null = null;
    if (heeftAandacht(cel.status)) {
      const pool = await eligibleProfielIds(
        locatie,
        cel.role,
        [{ day: cel.day, daypart: cel.daypart }],
        await laadKandidaten(),
      );
      availableCandidates = maskeer(pool.length);
    }
    roleCells.push({ ...cel, availableCandidates });
  }

  // Parttimer-combinaties per functie met 2..6 gaten (begrensd om de
  // berekening licht te houden).
  const partTimeCombos: PartTimeCombo[] = [];
  const comboBronnen: Array<{ role: string; cellen: Array<{ day: Weekday; daypart: Daypart; shortage: number }> }> =
    roleTargets
      ? Object.keys(roleTargets).map((rol) => ({
          role: rol,
          cellen: gatenVan(roleCells.filter((cel) => cel.role === rol)),
        }))
      : [{ role: kandidaatRol, cellen: gatenVan(cells) }];
  for (const bron of comboBronnen) {
    if (bron.cellen.length < 2 || bron.cellen.length > 6) continue;
    const gaten = bron.cellen.map(({ day, daypart }) => ({ day, daypart }));
    const combos = await berekenPartTimeCombos(locatie, bron.role, gaten, await laadKandidaten());
    partTimeCombos.push({ role: bron.role, gaps: gaten, comboCount: maskeer(combos.comboCount) });
  }

  // Analytics: gaten gedetecteerd + gaten die t.o.v. de laatst opgeslagen
  // scenario-planstand gedekt blijken (staffing_gap_resolved).
  const gaten = gatenVan(cells);
  if (gaten.length > 0) {
    await track("staffing_gap_detected", {
      organizationId: ctx.organizationId,
      locationId: locatie.id,
      userId: ctx.user.id,
      context: {
        gaten: gaten.length,
        totaalTekort: gaten.reduce((som, gat) => som + gat.shortage, 0),
      },
    });
  }
  await meldOpgelosteGaten(ctx, locatie.id, cells);

  return {
    locationId: locatie.id,
    weekStart,
    candidateRole: kandidaatRol,
    cells,
    roleCells,
    target: totalTarget,
    roleTargets,
    treatmentRooms: locatie.treatmentRooms,
    overCapacity: berekening.overCapacity,
    partTimeCombos,
    minGroupSize: TALENT_RADAR_MIN_GROUP,
  };
}

/**
 * Vergelijkt de actuele week met de gatenlijst uit het laatst opgeslagen
 * scenario (result.baseGaps) en vuurt staffing_gap_resolved voor gaten die nu
 * gedekt zijn. Pragmatisch: de scenario-planstand is de referentie.
 */
async function meldOpgelosteGaten(
  ctx: OrgContext,
  locationId: string,
  cells: CapacityCell[],
): Promise<void> {
  const laatste = await prisma.staffingScenario.findFirst({
    where: { organizationId: ctx.organizationId, locationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, result: true },
  });
  if (!laatste) return;
  const result = laatste.result as { baseGaps?: Array<{ day?: string; daypart?: string }> } | null;
  const baseGaps = Array.isArray(result?.baseGaps) ? result.baseGaps : [];
  if (baseGaps.length === 0) return;

  const dekkend = new Set(
    cells.filter((cel) => cel.shortage === 0).map((cel) => dagdeelSleutel(cel.day, cel.daypart)),
  );
  const opgelost = baseGaps.filter(
    (gat) =>
      typeof gat.day === "string" &&
      typeof gat.daypart === "string" &&
      dekkend.has(`${gat.day}:${gat.daypart}`),
  );
  if (opgelost.length === 0) return;

  await track("staffing_gap_resolved", {
    organizationId: ctx.organizationId,
    locationId,
    userId: ctx.user.id,
    context: { opgelost: opgelost.length, scenarioId: laatste.id },
  });
}

// ---------------------------------------------------------------------------
// Staffing-scenario's (immutable tot bevestiging)
// ---------------------------------------------------------------------------

export const SCENARIO_KINDS = [
  "uitval",
  "extra_kamer",
  "nieuwe_locatie",
  "vertrek",
  "structurele_dag",
  "parttime_combinatie",
  "tijdelijk",
  "multi_locatie",
] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  uitval: "Uitval van een teamlid",
  extra_kamer: "Extra behandelkamer",
  nieuwe_locatie: "Nieuwe locatie openen",
  vertrek: "Vertrek van een teamlid",
  structurele_dag: "Structureel een dag extra open",
  parttime_combinatie: "Parttime-combinatie zoeken",
  tijdelijk: "Tijdelijke behandelaar",
  multi_locatie: "Verdeling over locaties",
};

export interface ScenarioInput {
  kind: ScenarioKind;
  name?: string;
  /** uitval, vertrek, multi_locatie */
  teamMemberId?: string;
  /** uitval, tijdelijk: periode */
  from?: Date | null;
  until?: Date | null;
  /** extra_kamer */
  extraRooms?: number;
  /** nieuwe_locatie, structurele_dag, parttime_combinatie, tijdelijk */
  role?: string;
  /** structurele_dag */
  day?: Weekday;
  dayparts?: Daypart[];
  extraTarget?: number;
  /** parttime_combinatie (leeg = actuele gaten) */
  gaps?: Array<{ day: Weekday; daypart: Daypart }>;
  /** tijdelijk: werkdagen van de tijdelijke behandelaar */
  schedule?: TeamSchedule;
  /** nieuwe_locatie */
  target?: StaffingTarget;
  treatmentRooms?: number;
  /** multi_locatie: locatie die het teamlid erbij krijgt */
  targetLocationId?: string;
}

export interface ScenarioSamenvatting {
  volledig: number;
  gedeeltelijk: number;
  open: number;
  tekortVerwacht: number;
  totaalTekort: number;
}

export interface ScenarioUitkomst {
  scenario: StaffingScenario;
  before: ScenarioSamenvatting;
  after: ScenarioSamenvatting;
  baseGaps: Array<{ day: Weekday; daypart: Daypart; shortage: number }>;
  afterGaps: Array<{ day: Weekday; daypart: Daypart; shortage: number }>;
}

function samenvatting(cells: Array<Pick<CapacityCell, "status" | "shortage">>): ScenarioSamenvatting {
  return {
    volledig: cells.filter((c) => c.status === "volledig").length,
    gedeeltelijk: cells.filter((c) => c.status === "gedeeltelijk").length,
    open: cells.filter((c) => c.status === "open").length,
    tekortVerwacht: cells.filter((c) => c.status === "tekort_verwacht").length,
    totaalTekort: cells.reduce((som, c) => som + c.shortage, 0),
  };
}

/**
 * Draait één van de acht scenario-soorten voor een (eigen) locatie en slaat
 * het resultaat immutabel op als StaffingScenario (status "simulatie"):
 * input én result staan vast tot een bevoegde gebruiker bevestigt of
 * verwerpt — latere teamwijzigingen veranderen het opgeslagen resultaat niet.
 */
export async function runScenario(
  ctx: OrgContext,
  locationId: string,
  input: ScenarioInput,
): Promise<ScenarioUitkomst> {
  vereis(ctx, "location.manage");
  const locatie = await eigenLocatie(ctx, locationId);
  if (!(SCENARIO_KINDS as readonly string[]).includes(input.kind)) {
    throw new AuthzError("Onbekend scenariotype", 400);
  }

  const team = await prisma.teamMember.findMany({
    where: { locationId: locatie.id },
    include: { absences: { orderBy: { from: "asc" } } },
  });
  const weekStart = maandagVan(new Date());
  const roleTargets = castRoleStaffingTargets(locatie.staffingTarget);
  const totalTarget = roleTargets
    ? totalStaffingTarget(roleTargets)
    : castStaffingTarget(locatie.staffingTarget);
  const rol =
    input.role && (ROLES as readonly string[]).includes(input.role)
      ? input.role
      : dominanteRol(team);

  const basisOpties: WeekBerekeningOpties = {
    leden: team.map((teamlid) => bereidLidVoor(teamlid)),
    totalTarget,
    roleTargets,
    weekStart,
    treatmentRooms: locatie.treatmentRooms,
  };
  const voor = berekenWeek(basisOpties);

  // Kandidaten alleen laden wanneer het scenario ze nodig heeft.
  let kandidaten: CandidateProfile[] | null = null;
  const laadKandidaten = async (): Promise<CandidateProfile[]> => {
    if (kandidaten === null) {
      kandidaten = await prisma.candidateProfile.findMany({
        where: { status: "active", visibility: { not: "hidden" } },
      });
    }
    return kandidaten;
  };

  const extra: Record<string, unknown> = {};
  let na: WeekBerekening;

  switch (input.kind) {
    case "uitval": {
      const lid = team.find((teamlid) => teamlid.id === input.teamMemberId);
      if (!lid) throw new AuthzError("Kies het teamlid dat uitvalt", 400);
      const from = input.from ?? weekStart;
      const until = input.until ?? new Date(from.getTime() + 28 * DAG_MS);
      na = berekenWeek({
        ...basisOpties,
        leden: team.map((teamlid) =>
          teamlid.id === lid.id
            ? bereidLidVoor(teamlid, [{ from, until }])
            : bereidLidVoor(teamlid),
        ),
      });
      break;
    }
    case "vertrek": {
      const lid = team.find((teamlid) => teamlid.id === input.teamMemberId);
      if (!lid) throw new AuthzError("Kies het teamlid dat vertrekt", 400);
      const vertrekOp = input.from ?? new Date();
      na = berekenWeek({
        ...basisOpties,
        leden: team.map((teamlid) =>
          teamlid.id === lid.id
            ? bereidLidVoor(teamlid, [], { endDate: vertrekOp })
            : bereidLidVoor(teamlid),
        ),
      });
      break;
    }
    case "extra_kamer": {
      const extraKamers = Math.max(1, Math.min(10, input.extraRooms ?? 1));
      na = berekenWeek({ ...basisOpties, treatmentRooms: locatie.treatmentRooms + extraKamers });
      extra.extraRooms = extraKamers;
      break;
    }
    case "nieuwe_locatie": {
      const nieuweTarget = castStaffingTarget(input.target ?? totalTarget);
      na = berekenWeek({
        leden: [],
        totalTarget: nieuweTarget,
        roleTargets: null,
        weekStart,
        treatmentRooms: Math.max(1, Math.min(25, input.treatmentRooms ?? 1)),
      });
      const gaten = gatenVan(na.cells);
      if (gaten.length > 0) {
        extra.candidateProfileIds = (
          await eligibleProfielIds(
            locatie,
            rol,
            gaten.map(({ day, daypart }) => ({ day, daypart })),
            await laadKandidaten(),
          )
        ).slice(0, 25);
      }
      break;
    }
    case "structurele_dag": {
      const dag = input.day;
      if (!dag || !(WEEKDAYS as readonly string[]).includes(dag)) {
        throw new AuthzError("Kies de dag die structureel extra open gaat", 400);
      }
      const dagdelen =
        input.dayparts && input.dayparts.length > 0 ? input.dayparts : (["ochtend", "middag"] as Daypart[]);
      const plus = Math.max(1, Math.min(10, input.extraTarget ?? 1));
      const nieuweTarget = structuredClone(totalTarget) as StaffingTarget;
      for (const dagdeel of dagdelen) {
        if (!(DAYPARTS as readonly string[]).includes(dagdeel)) continue;
        nieuweTarget[dag][dagdeel] = Math.min(99, nieuweTarget[dag][dagdeel] + plus);
      }
      na = berekenWeek({ ...basisOpties, totalTarget: nieuweTarget, roleTargets: null });
      const gaten = gatenVan(na.cells);
      if (gaten.length > 0) {
        extra.candidateProfileIds = (
          await eligibleProfielIds(
            locatie,
            rol,
            gaten.map(({ day, daypart }) => ({ day, daypart })),
            await laadKandidaten(),
          )
        ).slice(0, 25);
      }
      break;
    }
    case "parttime_combinatie": {
      const gaten =
        input.gaps && input.gaps.length > 0
          ? input.gaps.filter(
              (gat) =>
                (WEEKDAYS as readonly string[]).includes(gat.day) &&
                (DAYPARTS as readonly string[]).includes(gat.daypart),
            )
          : gatenVan(voor.cells).map(({ day, daypart }) => ({ day, daypart }));
      if (gaten.length < 2) {
        throw new AuthzError("Een parttime-combinatie vraagt minstens twee dagdelen", 400);
      }
      const volledigeDekking = await eligibleProfielIds(locatie, rol, gaten, await laadKandidaten());
      const combos = await berekenPartTimeCombos(locatie, rol, gaten, await laadKandidaten());
      extra.gaps = gaten;
      extra.fullCoverageCount = volledigeDekking.length;
      extra.comboCount = combos.comboCount;
      extra.comboPairs = combos.paren.slice(0, 25);
      extra.candidateProfileIds = [
        ...new Set(combos.paren.slice(0, 25).flat()),
      ];
      na = voor; // de weekstand zelf verandert niet door dit zoekscenario
      break;
    }
    case "tijdelijk": {
      const rooster = input.schedule ? castTeamSchedule(input.schedule) : null;
      if (!rooster || !WEEKDAYS.some((dag) => DAYPARTS.some((dagdeel) => rooster[dag][dagdeel]))) {
        throw new AuthzError("Kies de dagdelen voor de tijdelijke behandelaar", 400);
      }
      const from = input.from ?? weekStart;
      const until = input.until ?? new Date(from.getTime() + 84 * DAG_MS);
      const tijdelijkLid: VoorbereidLid = {
        id: "scenario:tijdelijk",
        role: rol,
        startDate: from,
        endDate: until,
        absences: [],
        effectieveDagdelen: effectieveDagdelen(rooster, null),
      };
      na = berekenWeek({ ...basisOpties, leden: [...basisOpties.leden, tijdelijkLid] });
      const dagdelen = WEEKDAYS.flatMap((dag) =>
        DAYPARTS.filter((dagdeel) => rooster[dag][dagdeel]).map((dagdeel) => ({
          day: dag,
          daypart: dagdeel,
        })),
      );
      extra.candidateProfileIds = (
        await eligibleProfielIds(locatie, rol, dagdelen, await laadKandidaten())
      ).slice(0, 25);
      break;
    }
    case "multi_locatie": {
      const lid = team.find((teamlid) => teamlid.id === input.teamMemberId);
      if (!lid) throw new AuthzError("Kies het teamlid dat (deels) naar een andere locatie gaat", 400);
      if (!input.targetLocationId) {
        throw new AuthzError("Kies de locatie die het teamlid erbij krijgt", 400);
      }
      const doelLocatie = await eigenLocatie(ctx, input.targetLocationId);
      // Bronlocatie zonder het lid.
      na = berekenWeek({
        ...basisOpties,
        leden: team
          .filter((teamlid) => teamlid.id !== lid.id)
          .map((teamlid) => bereidLidVoor(teamlid)),
      });
      // Doellocatie met het lid erbij.
      const doelTeam = await prisma.teamMember.findMany({
        where: { locationId: doelLocatie.id },
        include: { absences: { orderBy: { from: "asc" } } },
      });
      const doelRoleTargets = castRoleStaffingTargets(doelLocatie.staffingTarget);
      const doelTarget = doelRoleTargets
        ? totalStaffingTarget(doelRoleTargets)
        : castStaffingTarget(doelLocatie.staffingTarget);
      const doelVoor = berekenWeek({
        leden: doelTeam.map((teamlid) => bereidLidVoor(teamlid)),
        totalTarget: doelTarget,
        roleTargets: doelRoleTargets,
        weekStart,
        treatmentRooms: doelLocatie.treatmentRooms,
      });
      const doelNa = berekenWeek({
        leden: [...doelTeam.map((teamlid) => bereidLidVoor(teamlid)), bereidLidVoor(lid)],
        totalTarget: doelTarget,
        roleTargets: doelRoleTargets,
        weekStart,
        treatmentRooms: doelLocatie.treatmentRooms,
      });
      extra.targetLocation = {
        locationId: doelLocatie.id,
        before: samenvatting(doelVoor.cells),
        after: samenvatting(doelNa.cells),
        afterGaps: gatenVan(doelNa.cells),
      };
      break;
    }
    default:
      throw new AuthzError("Onbekend scenariotype", 400);
  }

  const baseGaps = gatenVan(voor.cells);
  // Voor scenario's tellen ook verwachte tekorten (bv. na een vertrek in de
  // komende weken) als gat — anders valt er na een toekomstig vertrek niets
  // om te zetten in een vacatureconcept.
  const afterGaps = na.cells
    .filter((c) => c.shortage > 0 || c.status === "tekort_verwacht")
    .map((c) => ({ day: c.day, daypart: c.daypart, shortage: Math.max(1, c.shortage) }));
  const result = {
    before: samenvatting(voor.cells),
    after: samenvatting(na.cells),
    baseGaps,
    afterGaps,
    role: rol,
    weekStart: weekStart.toISOString(),
    ...extra,
  };

  const naam =
    input.name?.trim() ||
    `${SCENARIO_LABELS[input.kind]} — ${locatie.name}`;
  const scenario = await prisma.staffingScenario.create({
    data: {
      organizationId: ctx.organizationId,
      locationId: locatie.id,
      name: naam,
      kind: input.kind,
      input: alsJson(input),
      result: alsJson(result),
      status: "simulatie",
      createdByUserId: ctx.user.id,
    },
  });

  await track("staffing_scenario_run", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: { scenarioId: scenario.id, kind: input.kind },
  });
  await audit("staffing_scenario.run", "StaffingScenario", scenario.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { kind: input.kind, locationId: locatie.id },
  });

  return {
    scenario,
    before: result.before,
    after: result.after,
    baseGaps,
    afterGaps,
  };
}

/** Recente scenario's van een (eigen) locatie, nieuwste eerst. */
export async function listScenarios(
  ctx: OrgContext,
  locationId: string,
  limit = 10,
): Promise<StaffingScenario[]> {
  vereis(ctx, "location.manage");
  await eigenLocatie(ctx, locationId);
  return prisma.staffingScenario.findMany({
    where: { organizationId: ctx.organizationId, locationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Scenario ophalen binnen de eigen organisatie; anders 404. */
async function eigenScenario(ctx: OrgContext, id: string): Promise<StaffingScenario> {
  const scenario = await prisma.staffingScenario.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!scenario) throw new AuthzError("Scenario niet gevonden", 404);
  assertLocationAllowed(ctx, scenario.locationId);
  return scenario;
}

export type ScenarioOutcomeKind = "vacature" | "uitnodigingen" | "rapport";

export type ScenarioBevestiging =
  | { type: "vacature"; vacancy: VacancyWithLocation }
  | { type: "uitnodigingen"; candidateProfileIds: string[] }
  | { type: "rapport"; result: unknown };

const STANDAARD_UITKOMST: Record<ScenarioKind, ScenarioOutcomeKind> = {
  uitval: "vacature",
  vertrek: "vacature",
  structurele_dag: "vacature",
  nieuwe_locatie: "vacature",
  parttime_combinatie: "uitnodigingen",
  tijdelijk: "uitnodigingen",
  extra_kamer: "rapport",
  multi_locatie: "rapport",
};

/**
 * Bevestigt een scenario (alleen vanuit status "simulatie" — het opgeslagen
 * resultaat verandert nooit). Afhankelijk van de uitkomst:
 * - "vacature":      conceptvacature via de bestaande gapToVacancyDraft-logica;
 * - "uitnodigingen": lijst kandidaat-profiel-id's uit het scenario-resultaat;
 * - "rapport":       het opgeslagen capaciteitsrapport (result-Json).
 */
export async function confirmScenario(
  ctx: OrgContext,
  scenarioId: string,
  outcome?: ScenarioOutcomeKind,
): Promise<ScenarioBevestiging> {
  vereis(ctx, "location.manage");
  const scenario = await eigenScenario(ctx, scenarioId);
  if (scenario.status !== "simulatie") {
    throw new AuthzError("Dit scenario is al bevestigd of verworpen", 400);
  }

  const kind = scenario.kind as ScenarioKind;
  const gekozen = outcome ?? STANDAARD_UITKOMST[kind] ?? "rapport";
  const result = scenario.result as {
    role?: string;
    baseGaps?: Array<{ day: Weekday; daypart: Daypart }>;
    afterGaps?: Array<{ day: Weekday; daypart: Daypart }>;
    candidateProfileIds?: string[];
  };

  await prisma.staffingScenario.update({
    where: { id: scenario.id },
    data: { status: "bevestigd", confirmedAt: new Date() },
  });
  await audit("staffing_scenario.confirm", "StaffingScenario", scenario.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    meta: { kind, outcome: gekozen },
  });

  if (gekozen === "vacature") {
    const gaten = (result.afterGaps?.length ? result.afterGaps : result.baseGaps) ?? [];
    if (gaten.length > 0) {
      const vacature = await gapToVacancyDraft(ctx, scenario.locationId, {
        role: result.role && (ROLES as readonly string[]).includes(result.role)
          ? result.role
          : "tandarts",
        gaps: gaten.map(({ day, daypart }) => ({ day, daypart })),
      });
      return { type: "vacature", vacancy: vacature };
    }
    // Geen gaten meer → rapport als terugval.
    return { type: "rapport", result: scenario.result };
  }

  if (gekozen === "uitnodigingen") {
    const ids = Array.isArray(result.candidateProfileIds) ? result.candidateProfileIds : [];
    await track("candidate_invited_from_gap", {
      organizationId: ctx.organizationId,
      locationId: scenario.locationId,
      userId: ctx.user.id,
      context: { scenarioId: scenario.id, kandidaten: ids.length },
    });
    return { type: "uitnodigingen", candidateProfileIds: ids };
  }

  return { type: "rapport", result: scenario.result };
}

/** Verwerpt een scenario (alleen vanuit status "simulatie"). */
export async function rejectScenario(ctx: OrgContext, scenarioId: string): Promise<void> {
  vereis(ctx, "location.manage");
  const scenario = await eigenScenario(ctx, scenarioId);
  if (scenario.status !== "simulatie") {
    throw new AuthzError("Dit scenario is al bevestigd of verworpen", 400);
  }
  await prisma.staffingScenario.update({
    where: { id: scenario.id },
    data: { status: "verworpen" },
  });
  await audit("staffing_scenario.reject", "StaffingScenario", scenario.id, {
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
  });
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
 * logische Nederlandse titel. Trackt staffing_gap_created,
 * vacancy_created_from_gap en het bestaande capacity_gap_to_vacancy.
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

  await track("staffing_gap_created", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    context: { role: input.role, aantalDagdelen },
  });

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

  const plan = await planCodeVoorAnalytics(ctx.organizationId);
  await track("capacity_gap_to_vacancy", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    plan,
    context: {
      vacancyId: vacature.id,
      role: input.role,
      aantalDagdelen,
    },
  });
  await track("vacancy_created_from_gap", {
    organizationId: ctx.organizationId,
    locationId: locatie.id,
    userId: ctx.user.id,
    plan,
    context: { vacancyId: vacature.id, role: input.role, aantalDagdelen },
  });

  return vacature;
}
