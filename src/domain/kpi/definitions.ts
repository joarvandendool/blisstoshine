// Centrale KPI-definities — de ENIGE bron van waarheid voor het interne
// dashboard. Pure, deterministische functies over eenvoudige, getypeerde
// invoerrijen; geen database- of framework-imports.
//
// Conventies:
// - Bedragen in eurocenten (integer), verhoudingen als fracties (0–1),
//   doorlooptijden in dagen.
// - Elke KPI levert een KpiValue met een korte Nederlandse definitietekst.
//   Bij insufficientData toont de UI letterlijk "onvoldoende data".

// ---------- kernwaardetype ----------

export interface KpiValue {
  /** De berekende waarde; null wanneer er onvoldoende data is. */
  value: number | null;
  /** true → de UI toont "onvoldoende data" in plaats van de waarde. */
  insufficientData: boolean;
  /** Korte Nederlandse definitietekst (tooltip/legenda in het dashboard). */
  definition: string;
}

function kpi(value: number, definition: string): KpiValue {
  return { value, insufficientData: false, definition };
}

function onvoldoendeData(definition: string): KpiValue {
  return { value: null, insufficientData: true, definition };
}

// ---------- gedeelde hulpfuncties ----------

const MS_PER_DAG = 24 * 60 * 60 * 1000;

/** Mediaan van een niet-lege reeks getallen; bij een even aantal het gemiddelde van de twee middelste. */
function mediaan(values: number[]): number {
  const gesorteerd = [...values].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 1
    ? gesorteerd[midden]
    : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
}

// =====================================================================
// Marketplace-KPI's
// =====================================================================

export interface CandidateRow {
  /** CandidateStatus uit opslag: draft | active | paused | archived */
  status: string;
}

export interface OrganizationRow {
  /** OrgStatus uit opslag: active | suspended | archived */
  status: string;
}

export interface VacancyRow {
  /** VacancyStatus uit opslag: draft | published | paused | filled | expired */
  status: string;
}

const DEF_ACTIVE_CANDIDATES = "Aantal kandidaten met een actief profiel.";

export function activeCandidates(candidates: CandidateRow[]): KpiValue {
  const aantal = candidates.filter((c) => c.status === "active").length;
  return kpi(aantal, DEF_ACTIVE_CANDIDATES);
}

const DEF_ACTIVE_PRACTICES = "Aantal actieve praktijkorganisaties.";

export function activePractices(organizations: OrganizationRow[]): KpiValue {
  const aantal = organizations.filter((o) => o.status === "active").length;
  return kpi(aantal, DEF_ACTIVE_PRACTICES);
}

const DEF_ACTIVE_VACANCIES = "Aantal gepubliceerde (openstaande) vacatures.";

export function activeVacancies(vacancies: VacancyRow[]): KpiValue {
  const aantal = vacancies.filter((v) => v.status === "published").length;
  return kpi(aantal, DEF_ACTIVE_VACANCIES);
}

export interface VacancyMatchRow {
  /** Aantal eligible (niet uitgesloten) kandidaten voor deze vacature. */
  eligibleMatches: number;
}

const DEF_MATCHES_PER_VACANCY =
  "Gemiddeld aantal eligible matches per vacature.";

/** Gemiddeld aantal eligible matches over de aangeleverde vacatures. */
export function matchesPerVacancy(rows: VacancyMatchRow[]): KpiValue {
  if (rows.length === 0) return onvoldoendeData(DEF_MATCHES_PER_VACANCY);
  const totaal = rows.reduce((som, rij) => som + rij.eligibleMatches, 0);
  return kpi(totaal / rows.length, DEF_MATCHES_PER_VACANCY);
}

export interface AnalyticsEventRow {
  /** Stabiele eventnaam uit src/domain/analytics. */
  name: string;
}

const DEF_APPLICATION_CONVERSION =
  "Conversie van bekeken match naar sollicitatie (application_submitted / match_viewed); minimaal 10 weergaven.";

/**
 * Sollicitatieconversie: application_submitted gedeeld door match_viewed.
 * Onder de 10 weergaven is de verhouding te ruisgevoelig → onvoldoende data.
 */
export function applicationConversion(
  events: AnalyticsEventRow[],
  minimumViews = 10,
): KpiValue {
  const weergaven = events.filter((e) => e.name === "match_viewed").length;
  const sollicitaties = events.filter(
    (e) => e.name === "application_submitted",
  ).length;
  if (weergaven < minimumViews) {
    return onvoldoendeData(DEF_APPLICATION_CONVERSION);
  }
  return kpi(sollicitaties / weergaven, DEF_APPLICATION_CONVERSION);
}

export interface InvitationRow {
  /** InvitationStatus uit opslag: sent | accepted | declined | expired */
  status: string;
}

const DEF_INVITATION_ACCEPTANCE =
  "Aandeel geaccepteerde kandidaat-uitnodigingen; minimaal 5 uitnodigingen.";

export function invitationAcceptance(
  invitations: InvitationRow[],
  minimumInvitations = 5,
): KpiValue {
  if (invitations.length < minimumInvitations) {
    return onvoldoendeData(DEF_INVITATION_ACCEPTANCE);
  }
  const geaccepteerd = invitations.filter(
    (i) => i.status === "accepted",
  ).length;
  return kpi(geaccepteerd / invitations.length, DEF_INVITATION_ACCEPTANCE);
}

// ---------- doorlooptijden (mediaan in dagen) ----------

/**
 * Eén doorlooptijdmeting: het begin- en eindmoment van de gemeten stap,
 * afgeleid uit events (bv. candidate_profile_activated → eerste match_viewed).
 */
export interface DurationMeasurement {
  startAt: Date;
  endAt: Date;
}

function mediaanInDagen(
  measurements: DurationMeasurement[],
  definition: string,
  minimumMeasurements: number,
): KpiValue {
  if (measurements.length < minimumMeasurements) {
    return onvoldoendeData(definition);
  }
  const dagen = measurements.map(
    (m) => (m.endAt.getTime() - m.startAt.getTime()) / MS_PER_DAG,
  );
  return kpi(mediaan(dagen), definition);
}

const DEF_TIME_TO_FIRST_MATCH =
  "Mediane tijd in dagen van profielactivatie tot de eerste match; minimaal 3 metingen.";

export function timeToFirstMatch(
  measurements: DurationMeasurement[],
  minimumMeasurements = 3,
): KpiValue {
  return mediaanInDagen(measurements, DEF_TIME_TO_FIRST_MATCH, minimumMeasurements);
}

const DEF_TIME_TO_FIRST_RESPONSE =
  "Mediane tijd in dagen van sollicitatie of uitnodiging tot de eerste reactie; minimaal 3 metingen.";

export function timeToFirstResponse(
  measurements: DurationMeasurement[],
  minimumMeasurements = 3,
): KpiValue {
  return mediaanInDagen(measurements, DEF_TIME_TO_FIRST_RESPONSE, minimumMeasurements);
}

const DEF_TIME_TO_INTERVIEW =
  "Mediane tijd in dagen van sollicitatie tot ingepland kennismakingsgesprek; minimaal 3 metingen.";

export function timeToInterview(
  measurements: DurationMeasurement[],
  minimumMeasurements = 3,
): KpiValue {
  return mediaanInDagen(measurements, DEF_TIME_TO_INTERVIEW, minimumMeasurements);
}

const DEF_TIME_TO_PLACEMENT =
  "Mediane tijd in dagen van vacaturepublicatie tot vervulling; minimaal 3 metingen.";

export function timeToPlacement(
  measurements: DurationMeasurement[],
  minimumMeasurements = 3,
): KpiValue {
  return mediaanInDagen(measurements, DEF_TIME_TO_PLACEMENT, minimumMeasurements);
}

const DEF_VACANCY_FILL_RATE =
  "Aandeel vacatures dat vervuld is; minimaal 5 vacatures.";

/** Vervullingsgraad over de aangeleverde (ooit gepubliceerde) vacatures. */
export function vacancyFillRate(
  vacancies: VacancyRow[],
  minimumVacancies = 5,
): KpiValue {
  if (vacancies.length < minimumVacancies) {
    return onvoldoendeData(DEF_VACANCY_FILL_RATE);
  }
  const vervuld = vacancies.filter((v) => v.status === "filled").length;
  return kpi(vervuld / vacancies.length, DEF_VACANCY_FILL_RATE);
}

// ---------- dekking per functie en regio ----------

export interface RoleRegionRow {
  /** Taxonomie-rol, bv. tandarts of mondhygienist. */
  role: string;
  /** Regiosleutel, bv. provincie of postcodegebied. */
  region: string;
}

export interface CoverageEntry {
  role: string;
  region: string;
  candidateCount: number;
  vacancyCount: number;
  /** Vraag/aanbod: vacatures per actieve kandidaat; null zonder kandidaten. */
  demandSupplyRatio: number | null;
}

export interface CoverageResult {
  entries: CoverageEntry[];
  definition: string;
}

const DEF_COVERAGE =
  "Vraag/aanbod-verhouding (vacatures per kandidaat) per functie en regio; groepen kleiner dan de minimumgroepsgrootte worden weggelaten.";

/**
 * Dekking per functie+regio. Groepen met minder dan `minimumGroupSize`
 * personen/vacatures samen worden weggelaten (te klein voor betekenisvolle —
 * en privacyveilige — cijfers). Deterministisch gesorteerd op functie, regio.
 */
export function coverageByRoleRegion(
  candidates: RoleRegionRow[],
  vacancies: RoleRegionRow[],
  minimumGroupSize = 5,
): CoverageResult {
  const groepen = new Map<
    string,
    { role: string; region: string; candidateCount: number; vacancyCount: number }
  >();

  const groepVan = (rij: RoleRegionRow) => {
    const sleutel = `${rij.role} ${rij.region}`;
    let groep = groepen.get(sleutel);
    if (!groep) {
      groep = {
        role: rij.role,
        region: rij.region,
        candidateCount: 0,
        vacancyCount: 0,
      };
      groepen.set(sleutel, groep);
    }
    return groep;
  };

  for (const kandidaat of candidates) groepVan(kandidaat).candidateCount += 1;
  for (const vacature of vacancies) groepVan(vacature).vacancyCount += 1;

  const entries: CoverageEntry[] = Array.from(groepen.values())
    .filter((g) => g.candidateCount + g.vacancyCount >= minimumGroupSize)
    .map((g) => ({
      role: g.role,
      region: g.region,
      candidateCount: g.candidateCount,
      vacancyCount: g.vacancyCount,
      demandSupplyRatio:
        g.candidateCount === 0 ? null : g.vacancyCount / g.candidateCount,
    }))
    .sort(
      (a, b) =>
        a.role.localeCompare(b.role) || a.region.localeCompare(b.region),
    );

  return { entries, definition: DEF_COVERAGE };
}

// =====================================================================
// SaaS-KPI's
// =====================================================================

/** Opslagstatussen, gelijk aan de SubscriptionStatus-enum in de database. */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionItemRow {
  /** bv. extra_location | recruiter_seat | invite_pack */
  key: string;
  quantity: number;
}

export interface SubscriptionRow {
  organizationId: string;
  planCode: string;
  status: SubscriptionStatus;
  /** Maandprijs van de vastgepinde planversie, in eurocenten. */
  planPriceMonthlyCents: number;
  items: SubscriptionItemRow[];
}

/** Maandprijs per itemsleutel in eurocenten — als parameter, niet hardcoded. */
export type ItemPricesCents = Record<string, number>;

const DEF_TRIAL_ORGANIZATIONS =
  "Aantal organisaties in een lopende proefperiode.";

export function trialOrganizations(subscriptions: SubscriptionRow[]): KpiValue {
  const orgs = new Set(
    subscriptions
      .filter((s) => s.status === "trialing")
      .map((s) => s.organizationId),
  );
  return kpi(orgs.size, DEF_TRIAL_ORGANIZATIONS);
}

const DEF_PAYING_ORGANIZATIONS =
  "Aantal organisaties met een actief betaald abonnement.";

export function payingOrganizations(subscriptions: SubscriptionRow[]): KpiValue {
  const orgs = new Set(
    subscriptions
      .filter((s) => s.status === "active")
      .map((s) => s.organizationId),
  );
  return kpi(orgs.size, DEF_PAYING_ORGANIZATIONS);
}

/**
 * Maandomzet van één abonnement in eurocenten: maandprijs van de planversie
 * plus alle items × hun maandprijs. Onbekende itemsleutels tellen als 0.
 */
export function subscriptionMrrCents(
  subscription: SubscriptionRow,
  itemPricesCents: ItemPricesCents,
): number {
  const itemsTotaal = subscription.items.reduce(
    (som, item) => som + item.quantity * (itemPricesCents[item.key] ?? 0),
    0,
  );
  return subscription.planPriceMonthlyCents + itemsTotaal;
}

const DEF_MRR =
  "Maandelijks terugkerende omzet (MRR) in eurocenten: som over actieve abonnementen van de maandprijs van de planversie plus abonnementsitems × itemprijs.";

/** MRR over alle abonnementen met status active (trials en canceled tellen niet mee). */
export function mrr(
  subscriptions: SubscriptionRow[],
  itemPricesCents: ItemPricesCents,
): KpiValue {
  const totaal = subscriptions
    .filter((s) => s.status === "active")
    .reduce((som, s) => som + subscriptionMrrCents(s, itemPricesCents), 0);
  return kpi(totaal, DEF_MRR);
}

// ---------- MRR-beweging (maand-op-maand) ----------

/** MRR-momentopname van één organisatie in een bepaalde maand. */
export interface MrrSnapshot {
  orgId: string;
  mrrCents: number;
}

/** Som per organisatie; dubbele orgId's (meerdere abonnementen) worden opgeteld. */
function mrrPerOrg(snapshots: MrrSnapshot[]): Map<string, number> {
  const perOrg = new Map<string, number>();
  for (const s of snapshots) {
    perOrg.set(s.orgId, (perOrg.get(s.orgId) ?? 0) + s.mrrCents);
  }
  return perOrg;
}

interface MrrMovement {
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnedCents: number;
}

/**
 * Maand-op-maandvergelijking. Een organisatie telt als betalend bij
 * mrrCents > 0; afwezig of 0 geldt als niet-betalend.
 * - nieuw:      nu betalend, vorige maand niet → volledige huidige MRR
 * - expansion:  beide maanden betalend, gestegen → het verschil
 * - contraction: beide maanden betalend, gedaald → het verschil (positief)
 * - churned:    vorige maand betalend, nu niet → volledige vorige MRR
 */
function mrrMovement(
  previous: MrrSnapshot[],
  current: MrrSnapshot[],
): MrrMovement {
  const vorige = mrrPerOrg(previous);
  const huidige = mrrPerOrg(current);
  const beweging: MrrMovement = {
    newCents: 0,
    expansionCents: 0,
    contractionCents: 0,
    churnedCents: 0,
  };

  for (const [orgId, nu] of huidige) {
    const eerder = vorige.get(orgId) ?? 0;
    if (nu <= 0) continue;
    if (eerder <= 0) {
      beweging.newCents += nu;
    } else if (nu > eerder) {
      beweging.expansionCents += nu - eerder;
    } else if (nu < eerder) {
      beweging.contractionCents += eerder - nu;
    }
  }

  for (const [orgId, eerder] of vorige) {
    if (eerder <= 0) continue;
    const nu = huidige.get(orgId) ?? 0;
    if (nu <= 0) beweging.churnedCents += eerder;
  }

  return beweging;
}

const DEF_NEW_MRR =
  "Nieuwe MRR in eurocenten: omzet van organisaties die deze maand betalend werden.";

export function newMrr(previous: MrrSnapshot[], current: MrrSnapshot[]): KpiValue {
  return kpi(mrrMovement(previous, current).newCents, DEF_NEW_MRR);
}

const DEF_EXPANSION_MRR =
  "Expansion-MRR in eurocenten: extra omzet van bestaande betalende organisaties (upgrades en extra items).";

export function expansionMrr(
  previous: MrrSnapshot[],
  current: MrrSnapshot[],
): KpiValue {
  return kpi(mrrMovement(previous, current).expansionCents, DEF_EXPANSION_MRR);
}

const DEF_CONTRACTION_MRR =
  "Contraction-MRR in eurocenten: verloren omzet van organisaties die downgradeden maar klant bleven.";

export function contractionMrr(
  previous: MrrSnapshot[],
  current: MrrSnapshot[],
): KpiValue {
  return kpi(
    mrrMovement(previous, current).contractionCents,
    DEF_CONTRACTION_MRR,
  );
}

const DEF_CHURNED_MRR =
  "Churned MRR in eurocenten: omzet van organisaties die vorige maand betaalden en nu geen betalend abonnement meer hebben.";

export function churnedMrr(
  previous: MrrSnapshot[],
  current: MrrSnapshot[],
): KpiValue {
  return kpi(mrrMovement(previous, current).churnedCents, DEF_CHURNED_MRR);
}

// ---------- gemiddelden en verdeling ----------

const DEF_ARPO =
  "Gemiddelde maandomzet per betalende organisatie (ARPO) in eurocenten, afgerond op hele centen.";

/** Average revenue per organization: MRR gedeeld door het aantal betalende organisaties. */
export function arpo(
  subscriptions: SubscriptionRow[],
  itemPricesCents: ItemPricesCents,
): KpiValue {
  const betalend = new Set(
    subscriptions
      .filter((s) => s.status === "active")
      .map((s) => s.organizationId),
  );
  if (betalend.size === 0) return onvoldoendeData(DEF_ARPO);
  const totaal = subscriptions
    .filter((s) => s.status === "active")
    .reduce((som, s) => som + subscriptionMrrCents(s, itemPricesCents), 0);
  return kpi(Math.round(totaal / betalend.size), DEF_ARPO);
}

export interface RevenuePerPlanEntry {
  planCode: string;
  mrrCents: number;
}

export interface RevenuePerPlanResult {
  entries: RevenuePerPlanEntry[];
  definition: string;
}

const DEF_REVENUE_PER_PLAN =
  "MRR-verdeling per plan in eurocenten, over actieve abonnementen (inclusief items).";

/** MRR per plancode; deterministisch gesorteerd op plancode. */
export function revenuePerPlan(
  subscriptions: SubscriptionRow[],
  itemPricesCents: ItemPricesCents,
): RevenuePerPlanResult {
  const perPlan = new Map<string, number>();
  for (const s of subscriptions) {
    if (s.status !== "active") continue;
    perPlan.set(
      s.planCode,
      (perPlan.get(s.planCode) ?? 0) + subscriptionMrrCents(s, itemPricesCents),
    );
  }
  const entries = Array.from(perPlan.entries())
    .map(([planCode, mrrCents]) => ({ planCode, mrrCents }))
    .sort((a, b) => a.planCode.localeCompare(b.planCode));
  return { entries, definition: DEF_REVENUE_PER_PLAN };
}

const DEF_LOGO_CHURN =
  "Maandelijkse logo-churn: aandeel betalende organisaties van vorige maand dat nu geen betalend abonnement meer heeft; minimaal 5 betalende organisaties.";

/** Logo-churn op basis van dezelfde maandsnapshots als de MRR-beweging. */
export function logoChurnMonthly(
  previous: MrrSnapshot[],
  current: MrrSnapshot[],
  minimumPayingOrgs = 5,
): KpiValue {
  const vorige = mrrPerOrg(previous);
  const huidige = mrrPerOrg(current);
  const betalendVorige = Array.from(vorige.entries()).filter(
    ([, cents]) => cents > 0,
  );
  if (betalendVorige.length < minimumPayingOrgs) {
    return onvoldoendeData(DEF_LOGO_CHURN);
  }
  const vertrokken = betalendVorige.filter(
    ([orgId]) => (huidige.get(orgId) ?? 0) <= 0,
  ).length;
  return kpi(vertrokken / betalendVorige.length, DEF_LOGO_CHURN);
}

// ---------- cohortretentie ----------

export interface CohortOrganizationRow {
  orgId: string;
  /** Startmaand van het abonnement, bv. "2026-01". */
  startMonth: string;
  /** Heeft de organisatie op peildatum nog een actief abonnement? */
  active: boolean;
}

export interface CohortRetentionEntry {
  startMonth: string;
  organizationCount: number;
  activeCount: number;
  /** Aandeel nog actief (0–1); null bij een te klein cohort. */
  retention: number | null;
  insufficientData: boolean;
}

export interface CohortRetentionResult {
  cohorts: CohortRetentionEntry[];
  definition: string;
}

const DEF_COHORT_RETENTION =
  "Vereenvoudigde cohortretentie: per startmaand het aandeel organisaties dat nog actief is; cohorten met minder dan 3 organisaties tonen onvoldoende data.";

/** Retentie per startmaand-cohort; deterministisch gesorteerd op startmaand. */
export function cohortRetention(
  organizations: CohortOrganizationRow[],
  minimumCohortSize = 3,
): CohortRetentionResult {
  const cohorten = new Map<string, { totaal: number; actief: number }>();
  for (const org of organizations) {
    const cohort = cohorten.get(org.startMonth) ?? { totaal: 0, actief: 0 };
    cohort.totaal += 1;
    if (org.active) cohort.actief += 1;
    cohorten.set(org.startMonth, cohort);
  }

  const entries: CohortRetentionEntry[] = Array.from(cohorten.entries())
    .map(([startMonth, { totaal, actief }]) => {
      const teKlein = totaal < minimumCohortSize;
      return {
        startMonth,
        organizationCount: totaal,
        activeCount: actief,
        retention: teKlein ? null : actief / totaal,
        insufficientData: teKlein,
      };
    })
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth));

  return { cohorts: entries, definition: DEF_COHORT_RETENTION };
}

// ---------- omzetconcentratie ----------

const DEF_REVENUE_CONCENTRATION =
  "Omzetconcentratie: aandeel van de grootste klant in de totale MRR.";

/** Aandeel (0–1) van de grootste klant in de totale MRR; zonder omzet onvoldoende data. */
export function revenueConcentration(snapshots: MrrSnapshot[]): KpiValue {
  const perOrg = mrrPerOrg(snapshots);
  let totaal = 0;
  let grootste = 0;
  for (const cents of perOrg.values()) {
    if (cents <= 0) continue;
    totaal += cents;
    if (cents > grootste) grootste = cents;
  }
  if (totaal <= 0) return onvoldoendeData(DEF_REVENUE_CONCENTRATION);
  return kpi(grootste / totaal, DEF_REVENUE_CONCENTRATION);
}
