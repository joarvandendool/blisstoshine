// Mondzorg Arbeidsmarkt Monitor — servicelaag (fase 6).
//
// Verzamelt GEANONIMISEERDE feiten (alleen taxonomiesleutels, regio's,
// aantallen en datums — geen namen, e-mailadressen of vrije tekst), laat het
// pure domein (src/domain/market) aggregeren met harde privacyregels
// (minimumgroepsgrootte, celonderdrukking, maximaal 2 dimensies) en cachet de
// read models in MarketInsightSnapshot (upsert per view + dimensionKey +
// period). Lezers halen de cache op; ontbreekt de periode, dan wordt eenmalig
// ververst.
//
// AUTORISATIE:
// - refreshMarketMonitor() en getMonitorView() zijn platformbreed en mogen
//   ALLEEN worden aangeroepen nadat de pagina requirePlatformAdmin() heeft
//   gedaan (zelfde afspraak als src/server/kpi.ts) — de afdwinging zit bewust
//   in de pagina zodat deze module ook in scripts en tests bruikbaar is.
// - praktijkMarktInzichten() is tenant-gebonden (OrgContext) en dwingt de
//   entitlement premium_market_insights af.
//
// ENTITLEMENT premium_market_insights: deze sleutel wordt door de parallelle
// billing-agent aan de entitlementcatalogus toegevoegd (add-on). Tot die
// landing gedraagt enforceEntitlement zich fail-closed: een onbekende sleutel
// is nergens enabled, dus praktijken zien de paywall — nooit per ongeluk data.

import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { OrgContext } from "@/lib/authz";
import { enforceEntitlement } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { prisma } from "@/lib/db";
import type { EntitlementKey } from "@/domain/entitlements";
import { DAYPARTS, WEEKDAYS, type Weekday } from "@/domain/taxonomy";
import { computeMatch } from "@/domain/matching";
import {
  fillRate,
  flexibiliteitInvloed,
  kruisVerdeling,
  maandTrend,
  maandVan,
  maskeerCel,
  mediaanWaarde,
  provincieVanStad,
  telWaarde,
  timeToHire,
  timeToInterview,
  timeToResponse,
  verdeling,
  type FlexibiliteitInvloed,
  type KandidaatFeit,
  type MaandTrend,
  type MarketDistribution,
  type MarketValue,
  type TrajectEventFeit,
  type VacatureFeit,
} from "@/domain/market";
import { geocodePostcode } from "@/server/geo";
import { castAvailability, profileToMatchCandidate } from "@/server/candidates";
import { castSchedule, vacancyToMatchVacancy } from "@/server/vacancies";

// De platformbrede minimumgroepsgrootte (5) geldt ook voor de marktmonitor.
const MIN_GROUP = TALENT_RADAR_MIN_GROUP;

/**
 * Entitlement-sleutel van de premium marktinzichten. De catalogusdefinitie
 * (add-on premium_market_insights) wordt door de billing-agent geleverd; de
 * cast overbrugt de periode tot die sleutel in ENTITLEMENT_KEYS staat en is
 * veilig omdat enforceEntitlement onbekende sleutels als "uit" behandelt.
 */
const PREMIUM_KEY: string = "premium_market_insights";
export const PREMIUM_MARKET_INSIGHTS = PREMIUM_KEY as EntitlementKey;

// ---------------------------------------------------------------------------
// Feiten verzamelen (anonimisering gebeurt HIER, vóór het domein)
// ---------------------------------------------------------------------------

/** Regio (provincie) van een postcode via de geocodeertabel. */
function regioVanPostcode(postcode: string): string {
  return provincieVanStad(geocodePostcode(postcode)?.city ?? null);
}

/** Pseudoniem trajectnummer: hash van vacature + kandidaat, niet omkeerbaar. */
function trajectPseudoniem(vacancyId: string, candidateUserId: string): string {
  return createHash("sha256").update(`${vacancyId}:${candidateUserId}`).digest("hex").slice(0, 16);
}

/** Actieve kandidaten als geanonimiseerde feiten (geen id, naam of tekst). */
export async function verzamelKandidaatFeiten(): Promise<KandidaatFeit[]> {
  const profielen = await prisma.candidateProfile.findMany({
    where: { status: "active", visibility: { not: "hidden" } },
  });
  return profielen.map((profiel) => {
    const beschikbaarheid = castAvailability(profiel.availability);
    const werkdagen: Weekday[] = [];
    let dagdelen = 0;
    for (const dag of WEEKDAYS) {
      let beschikbaarOpDag = false;
      for (const dagdeel of DAYPARTS) {
        if (beschikbaarheid[dag][dagdeel] !== "unavailable") {
          dagdelen += 1;
          beschikbaarOpDag = true;
        }
      }
      if (beschikbaarOpDag) werkdagen.push(dag);
    }
    return {
      role: profiel.role,
      regio: regioVanPostcode(profiel.postcode),
      maxTravelMinutes: profiel.maxTravelMinutes,
      werkdagen,
      beschikbareDagdelen: dagdelen,
      contractTypes: profiel.contractTypes,
      hoursMin: profiel.hoursMin,
      hoursMax: profiel.hoursMax,
      revenueShareMin: profiel.revenueShareMin,
      equipment: profiel.equipmentExperience,
      software: profiel.softwareSkills,
      specializations: profiel.specializations,
      ontwikkelInteresses: profiel.techniquesWantsToLearn,
    };
  });
}

/** Vacatures van actieve organisaties als geanonimiseerde feiten. */
export async function verzamelVacatureFeiten(): Promise<VacatureFeit[]> {
  const vacatures = await prisma.vacancy.findMany({
    where: { organization: { status: "active" } },
    include: { location: { select: { postcode: true } } },
  });
  return vacatures.map((vacature) => {
    const rooster = castSchedule(vacature.schedule);
    const gevraagdeDagen: Weekday[] = [];
    const verplichteDagen: Weekday[] = [];
    for (const dag of WEEKDAYS) {
      const eisen = DAYPARTS.map((dagdeel) => rooster[dag][dagdeel]);
      if (eisen.some((eis) => eis !== null)) gevraagdeDagen.push(dag);
      if (eisen.some((eis) => eis === "required")) verplichteDagen.push(dag);
    }
    const criteria = vacature.criteria as Record<string, { values?: string[] } | undefined> | null;
    const criteriumWaarden = (sleutel: string): string[] => {
      const values = criteria?.[sleutel]?.values;
      return Array.isArray(values) ? values.filter((w) => typeof w === "string") : [];
    };
    return {
      role: vacature.role,
      regio: regioVanPostcode(vacature.location.postcode),
      status: vacature.status,
      contractTypes: vacature.contractTypes,
      hoursMin: vacature.hoursMin,
      hoursMax: vacature.hoursMax,
      revenueShareMax: vacature.revenueShareMax,
      gevraagdeDagen,
      verplichteDagen,
      equipment: criteriumWaarden("equipment"),
      software: criteriumWaarden("software"),
      specializations: criteriumWaarden("specializations"),
      publicatieMaand: vacature.publishedAt ? maandVan(vacature.publishedAt) : null,
    };
  });
}

/** Pipeline-events als geanonimiseerde trajectfeiten (pseudoniem per traject). */
export async function verzamelTrajectFeiten(): Promise<TrajectEventFeit[]> {
  const [events, vacatures] = await Promise.all([
    prisma.pipelineStatusChange.findMany({
      select: { vacancyId: true, candidateUserId: true, toStatus: true, createdAt: true },
    }),
    prisma.vacancy.findMany({
      select: { id: true, role: true, location: { select: { postcode: true } } },
    }),
  ]);
  const perVacature = new Map(vacatures.map((v) => [v.id, v]));
  return events.flatMap((event) => {
    const vacature = perVacature.get(event.vacancyId);
    if (!vacature) return []; // wees-record zonder vacature: overslaan
    return [
      {
        trajectId: trajectPseudoniem(event.vacancyId, event.candidateUserId),
        role: vacature.role,
        regio: regioVanPostcode(vacature.location.postcode),
        toStatus: event.toStatus,
        createdAt: event.createdAt,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Read models per view
// ---------------------------------------------------------------------------

export interface RegionaalOverzichtData {
  kandidaten: MarketValue;
  vacaturesActief: MarketValue;
  kandidatenPerRol: MarketDistribution;
  vacaturesPerRol: MarketDistribution;
}

export interface FunctieOverzichtData {
  kandidaten: MarketValue;
  vacaturesActief: MarketValue;
  /** Kandidaten per actieve vacature — schaarste-indicator; null onder drempel. */
  kandidatenPerVacature: number | null;
  contractVerdeling: MarketDistribution;
  urenMediaanKandidaat: MarketValue;
  urenMediaanVacature: MarketValue;
  omzetPercentageGewenst: MarketValue;
  omzetPercentageGeboden: MarketValue;
  reistijdMediaan: MarketValue;
  apparatuur: MarketDistribution;
  software: MarketDistribution;
  specialisaties: MarketDistribution;
  ontwikkelInteresses: MarketDistribution;
}

export interface SchaarstePerDagData {
  perDag: Array<{
    dag: Weekday;
    kandidaten: number | null;
    vacatures: number | null;
    verplichteVacatures: number | null;
  }>;
  sampleSize: number;
}

export interface UitkomstenData {
  timeToResponse: MarketValue;
  timeToInterview: MarketValue;
  timeToHire: MarketValue;
  fillRate: MarketValue;
}

export interface MonitorSnapshotRij {
  view: string;
  dimensionKey: string;
  period: string;
  sampleSize: number;
  data: unknown;
}

function alsJson(waarde: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(waarde)) as Prisma.InputJsonValue;
}

const ACTIEVE_STATUSSEN = new Set(["published", "paused"]);

function regionaalOverzicht(
  kandidaten: KandidaatFeit[],
  vacatures: VacatureFeit[],
  period: string,
): MonitorSnapshotRij[] {
  const regios = Array.from(
    new Set([...kandidaten.map((k) => k.regio), ...vacatures.map((v) => v.regio)]),
  ).sort((a, b) => a.localeCompare(b));

  return regios.map((regio) => {
    const eigenKandidaten = kandidaten.filter((k) => k.regio === regio);
    const eigenVacatures = vacatures.filter(
      (v) => v.regio === regio && ACTIEVE_STATUSSEN.has(v.status),
    );
    const data: RegionaalOverzichtData = {
      kandidaten: telWaarde(eigenKandidaten.length, {
        period,
        definition: "Actieve, vindbare kandidaten in deze regio.",
        minGroupSize: MIN_GROUP,
      }),
      vacaturesActief: telWaarde(eigenVacatures.length, {
        period,
        definition: "Openstaande vacatures (gepubliceerd of gepauzeerd) in deze regio.",
        minGroupSize: MIN_GROUP,
      }),
      kandidatenPerRol: kruisVerdeling(
        eigenKandidaten.map((k) => ({ rol: k.role })),
        ["rol"],
        { period, definition: "Kandidaten per functie in deze regio.", minGroupSize: MIN_GROUP },
      ),
      vacaturesPerRol: kruisVerdeling(
        eigenVacatures.map((v) => ({ rol: v.role })),
        ["rol"],
        { period, definition: "Openstaande vacatures per functie in deze regio.", minGroupSize: MIN_GROUP },
      ),
    };
    return {
      view: "regionaal",
      dimensionKey: regio,
      period,
      sampleSize: eigenKandidaten.length + eigenVacatures.length,
      data,
    };
  });
}

function functieOverzicht(
  kandidaten: KandidaatFeit[],
  vacatures: VacatureFeit[],
  period: string,
): MonitorSnapshotRij[] {
  const rollen = Array.from(
    new Set([...kandidaten.map((k) => k.role), ...vacatures.map((v) => v.role)]),
  ).sort((a, b) => a.localeCompare(b));

  return rollen.map((rol) => {
    const eigenKandidaten = kandidaten.filter((k) => k.role === rol);
    const actieveVacatures = vacatures.filter(
      (v) => v.role === rol && ACTIEVE_STATUSSEN.has(v.status),
    );
    const opties = (definition: string) => ({ period, definition, minGroupSize: MIN_GROUP });

    // Schaarste alleen tonen wanneer beide kanten boven de drempel zitten.
    const kandidatenPerVacature =
      eigenKandidaten.length >= MIN_GROUP && actieveVacatures.length >= MIN_GROUP
        ? Math.round((eigenKandidaten.length / actieveVacatures.length) * 10) / 10
        : null;

    const data: FunctieOverzichtData = {
      kandidaten: telWaarde(eigenKandidaten.length, opties("Actieve, vindbare kandidaten met deze functie.")),
      vacaturesActief: telWaarde(actieveVacatures.length, opties("Openstaande vacatures voor deze functie.")),
      kandidatenPerVacature,
      contractVerdeling: verdeling(
        eigenKandidaten.map((k) => k.contractTypes),
        opties("Gewenste contractvormen van kandidaten met deze functie."),
      ),
      urenMediaanKandidaat: mediaanWaarde(
        eigenKandidaten.map((k) => (k.hoursMin + k.hoursMax) / 2),
        opties("Mediane gewenste uren per week (midden van de range) van kandidaten."),
      ),
      urenMediaanVacature: mediaanWaarde(
        actieveVacatures.map((v) => (v.hoursMin + v.hoursMax) / 2),
        opties("Mediane geboden uren per week (midden van de range) van vacatures."),
      ),
      omzetPercentageGewenst: mediaanWaarde(
        eigenKandidaten
          .map((k) => k.revenueShareMin)
          .filter((p): p is number => typeof p === "number"),
        opties("Mediaan gewenst omzetpercentage (zzp) van kandidaten."),
      ),
      omzetPercentageGeboden: mediaanWaarde(
        actieveVacatures
          .map((v) => v.revenueShareMax)
          .filter((p): p is number => typeof p === "number"),
        opties("Mediaan maximaal geboden omzetpercentage (zzp) van vacatures."),
      ),
      reistijdMediaan: mediaanWaarde(
        eigenKandidaten.map((k) => k.maxTravelMinutes),
        opties("Mediane maximale reistijd (minuten) van kandidaten."),
      ),
      apparatuur: verdeling(
        eigenKandidaten.map((k) => k.equipment),
        opties("Apparatuur- en scannerervaring van kandidaten (aantal kandidaten per merk)."),
      ),
      software: verdeling(
        eigenKandidaten.map((k) => k.software),
        opties("Softwarekennis van kandidaten (aantal kandidaten per pakket)."),
      ),
      specialisaties: verdeling(
        eigenKandidaten.map((k) => k.specializations),
        opties("Specialisaties van kandidaten."),
      ),
      ontwikkelInteresses: verdeling(
        eigenKandidaten.map((k) => k.ontwikkelInteresses),
        opties("Ontwikkelinteresses: technieken die kandidaten willen leren."),
      ),
    };
    return {
      view: "functie",
      dimensionKey: rol,
      period,
      sampleSize: eigenKandidaten.length + actieveVacatures.length,
      data,
    };
  });
}

function schaarstePerDag(
  kandidaten: KandidaatFeit[],
  vacatures: VacatureFeit[],
  period: string,
): MonitorSnapshotRij[] {
  const actief = vacatures.filter((v) => ACTIEVE_STATUSSEN.has(v.status));
  const data: SchaarstePerDagData = {
    perDag: WEEKDAYS.map((dag) => ({
      dag,
      kandidaten: maskeerCel(
        kandidaten.filter((k) => k.werkdagen.includes(dag)).length,
        MIN_GROUP,
      ),
      vacatures: maskeerCel(
        actief.filter((v) => v.gevraagdeDagen.includes(dag)).length,
        MIN_GROUP,
      ),
      verplichteVacatures: maskeerCel(
        actief.filter((v) => v.verplichteDagen.includes(dag)).length,
        MIN_GROUP,
      ),
    })),
    sampleSize: kandidaten.length + actief.length,
  };
  return [
    {
      view: "schaarste_per_dag",
      dimensionKey: "alle",
      period,
      sampleSize: data.sampleSize,
      data,
    },
  ];
}

/**
 * Invloed van flexibiliteit: per kandidaat het aantal gepubliceerde vacatures
 * waarvoor die eligible is ("bereik"), gegroepeerd naar flexibiliteitsband.
 * De koppeling kandidaat × vacature gebeurt in het geheugen en verlaat deze
 * functie uitsluitend als geaggregeerde banden.
 */
async function flexibiliteitView(period: string): Promise<MonitorSnapshotRij[]> {
  const [profielen, vacatures] = await Promise.all([
    prisma.candidateProfile.findMany({
      where: { status: "active", visibility: { not: "hidden" } },
    }),
    prisma.vacancy.findMany({
      where: { status: "published", organization: { status: "active" } },
      include: { location: true },
    }),
  ]);
  const matchVacatures = vacatures.map((v) => vacancyToMatchVacancy(v, v.location));
  const rijen = profielen.map((profiel) => {
    const beschikbaarheid = castAvailability(profiel.availability);
    let dagdelen = 0;
    for (const dag of WEEKDAYS) {
      for (const dagdeel of DAYPARTS) {
        if (beschikbaarheid[dag][dagdeel] !== "unavailable") dagdelen += 1;
      }
    }
    const kandidaat = profileToMatchCandidate(profiel);
    const bereik = matchVacatures.filter((v) => computeMatch(kandidaat, v).eligible).length;
    return { dagdelen, bereik };
  });
  const data: FlexibiliteitInvloed = flexibiliteitInvloed(rijen, {
    period,
    minGroupSize: MIN_GROUP,
    definition:
      "Mediane aantal vacatures binnen matchcriteria per flexibiliteitsband (beschikbare dagdelen van de kandidaat).",
  });
  return [
    { view: "flexibiliteit", dimensionKey: "alle", period, sampleSize: rijen.length, data },
  ];
}

function uitkomstenView(
  trajecten: TrajectEventFeit[],
  vacatures: VacatureFeit[],
  period: string,
): MonitorSnapshotRij[] {
  const opties = { period, minGroupSize: MIN_GROUP };
  const data: UitkomstenData = {
    timeToResponse: timeToResponse(trajecten, opties),
    timeToInterview: timeToInterview(trajecten, opties),
    timeToHire: timeToHire(trajecten, opties),
    fillRate: fillRate(vacatures.map((v) => v.status), opties),
  };
  return [
    {
      view: "uitkomsten",
      dimensionKey: "alle",
      period,
      sampleSize: new Set(trajecten.map((t) => t.trajectId)).size,
      data,
    },
  ];
}

function trendViews(
  vacatures: VacatureFeit[],
  trajecten: TrajectEventFeit[],
  period: string,
): MonitorSnapshotRij[] {
  const vacatureTrend: MaandTrend = maandTrend(
    vacatures.map((v) => v.publicatieMaand),
    { definition: "Gepubliceerde vacatures per maand.", minGroupSize: MIN_GROUP },
  );
  const plaatsingTrend: MaandTrend = maandTrend(
    trajecten.filter((t) => t.toStatus === "hired").map((t) => maandVan(t.createdAt)),
    { definition: "Plaatsingen per maand.", minGroupSize: MIN_GROUP },
  );
  const trajectTrend: MaandTrend = maandTrend(
    trajecten.filter((t) => t.toStatus === "invited" || t.toStatus === "applied")
      .map((t) => maandVan(t.createdAt)),
    { definition: "Gestarte trajecten (uitnodiging of sollicitatie) per maand.", minGroupSize: MIN_GROUP },
  );
  return [
    { view: "trend", dimensionKey: "vacatures", period, sampleSize: vacatureTrend.sampleSize, data: vacatureTrend },
    { view: "trend", dimensionKey: "plaatsingen", period, sampleSize: plaatsingTrend.sampleSize, data: plaatsingTrend },
    { view: "trend", dimensionKey: "trajecten", period, sampleSize: trajectTrend.sampleSize, data: trajectTrend },
  ];
}

// ---------------------------------------------------------------------------
// Cache (MarketInsightSnapshot) — upsert per view + dimensionKey + period
// ---------------------------------------------------------------------------

/**
 * Berekent alle monitor-views voor de opgegeven peildatum en slaat ze
 * idempotent op (upsert). Geeft het aantal geschreven snapshots terug.
 * ALLEEN aanroepen na requirePlatformAdmin() (of vanuit een interne job).
 */
export async function refreshMarketMonitor(nu: Date = new Date()): Promise<{
  period: string;
  snapshots: number;
}> {
  const period = maandVan(nu);
  const [kandidaten, vacatures, trajecten, flexibiliteit] = await Promise.all([
    verzamelKandidaatFeiten(),
    verzamelVacatureFeiten(),
    verzamelTrajectFeiten(),
    flexibiliteitView(maandVan(nu)),
  ]);

  const rijen: MonitorSnapshotRij[] = [
    ...regionaalOverzicht(kandidaten, vacatures, period),
    ...functieOverzicht(kandidaten, vacatures, period),
    ...schaarstePerDag(kandidaten, vacatures, period),
    ...flexibiliteit,
    ...uitkomstenView(trajecten, vacatures, period),
    ...trendViews(vacatures, trajecten, period),
  ];

  for (const rij of rijen) {
    await prisma.marketInsightSnapshot.upsert({
      where: {
        view_dimensionKey_period: {
          view: rij.view,
          dimensionKey: rij.dimensionKey,
          period: rij.period,
        },
      },
      create: {
        view: rij.view,
        dimensionKey: rij.dimensionKey,
        period: rij.period,
        data: alsJson(rij.data),
        sampleSize: rij.sampleSize,
      },
      update: { data: alsJson(rij.data), sampleSize: rij.sampleSize },
    });
  }

  return { period, snapshots: rijen.length };
}

export interface MonitorViewRij<T = unknown> {
  dimensionKey: string;
  period: string;
  sampleSize: number;
  data: T;
}

/**
 * Leest een monitor-view uit de cache voor een periode ("JJJJ-MM"). Is er
 * voor die periode nog niets berekend, dan wordt eenmalig ververst.
 * ALLEEN aanroepen na requirePlatformAdmin() — behalve via
 * praktijkMarktInzichten, dat zelf tenant-autorisatie en entitlement afdwingt.
 */
export async function getMonitorView<T = unknown>(
  view: string,
  period?: string,
  nu: Date = new Date(),
): Promise<MonitorViewRij<T>[]> {
  const gewenst = period ?? maandVan(nu);
  const lees = () =>
    prisma.marketInsightSnapshot.findMany({
      where: { view, period: gewenst },
      orderBy: { dimensionKey: "asc" },
    });

  let rijen = await lees();
  if (rijen.length === 0) {
    await refreshMarketMonitor(nu);
    rijen = await lees();
  }
  return rijen.map((rij) => ({
    dimensionKey: rij.dimensionKey,
    period: rij.period,
    sampleSize: rij.sampleSize,
    data: rij.data as T,
  }));
}

// ---------------------------------------------------------------------------
// Praktijkinzichten (tenant-gebonden, premium)
// ---------------------------------------------------------------------------

export interface LocatieBenchmark {
  locatieNaam: string;
  stad: string;
  regio: string;
  actieveVacatures: number;
  /** Mediane geboden uren van de eigen vacatures op deze locatie (eigen data). */
  eigenUrenMediaan: MarketValue;
  /** Regio-mediaan geboden uren — privacydrempel van kracht. */
  regioUrenMediaan: MarketValue;
}

export interface OrganisatieBenchmark {
  /** Eigen mediane reactietijd (dagen) — eigen data, geen drempel nodig. */
  eigenTimeToResponse: MarketValue;
  /** Regio-mediaan reactietijd — privacydrempel van kracht. */
  regioTimeToResponse: MarketValue;
  eigenFillRate: MarketValue;
  regioFillRate: MarketValue;
}

export interface PraktijkMarktInzichten {
  period: string;
  /** Eigen regio's (provincies van de eigen locaties). */
  regios: MonitorViewRij<RegionaalOverzichtData>[];
  /** Eigen functies (rollen van de eigen vacatures). */
  functies: MonitorViewRij<FunctieOverzichtData>[];
  organisatie: OrganisatieBenchmark;
  locaties: LocatieBenchmark[];
  minGroupSize: number;
}

/**
 * Marktinzichten voor één praktijk: regionaal overzicht en functie-overzicht
 * beperkt tot de eigen regio's en rollen, plus locatie- en organisatie-
 * benchmark (eigen cijfers versus regio-mediaan). Alleen eigen org-context:
 * de "eigen" cijfers komen uitsluitend uit de eigen organisatie, de
 * vergelijkingscijfers zijn dezelfde privacyveilige aggregaties als op het
 * interne dashboard.
 *
 * Vereist de entitlement premium_market_insights (geleverd door de
 * billing-agent); zonder die add-on volgt een EntitlementError (402) en toont
 * de pagina de paywall.
 */
export async function praktijkMarktInzichten(
  ctx: OrgContext,
  nu: Date = new Date(),
): Promise<PraktijkMarktInzichten> {
  await enforceEntitlement(ctx.organizationId, PREMIUM_MARKET_INSIGHTS);

  const period = maandVan(nu);
  const [locaties, eigenVacatures] = await Promise.all([
    prisma.practiceLocation.findMany({ where: { organizationId: ctx.organizationId } }),
    prisma.vacancy.findMany({
      where: { organizationId: ctx.organizationId },
      include: { location: { select: { postcode: true } } },
    }),
  ]);

  const eigenRegios = new Set(locaties.map((l) => regioVanPostcode(l.postcode)));
  const eigenRollen = new Set(eigenVacatures.map((v) => v.role));

  const [regionaal, functies] = await Promise.all([
    getMonitorView<RegionaalOverzichtData>("regionaal", period, nu),
    getMonitorView<FunctieOverzichtData>("functie", period, nu),
  ]);

  // Benchmarkgegevens: eigen trajecten (eigen org) vs. regio-trajecten.
  const alleTrajecten = await verzamelTrajectFeiten();
  const eigenVacatureIds = new Set(eigenVacatures.map((v) => v.id));
  const eigenTrajectIds = new Set(
    (
      await prisma.pipelineStatusChange.findMany({
        where: { vacancyId: { in: Array.from(eigenVacatureIds) } },
        select: { vacancyId: true, candidateUserId: true },
      })
    ).map((rij) => trajectPseudoniem(rij.vacancyId, rij.candidateUserId)),
  );
  const eigenTrajecten = alleTrajecten.filter((t) => eigenTrajectIds.has(t.trajectId));
  const regioTrajecten = alleTrajecten.filter((t) => eigenRegios.has(t.regio));

  const alleVacatureFeiten = await verzamelVacatureFeiten();
  const regioVacatures = alleVacatureFeiten.filter((v) => eigenRegios.has(v.regio));

  // Eigen cijfers mogen zonder drempel (de praktijk ziet de onderliggende
  // trajecten toch al in de eigen pipeline); regiocijfers houden MIN_GROUP.
  const organisatie: OrganisatieBenchmark = {
    eigenTimeToResponse: timeToResponse(eigenTrajecten, {
      period,
      minGroupSize: 1,
      definition: "Mediane dagen tot eerste reactie in je eigen pipeline.",
    }),
    regioTimeToResponse: timeToResponse(regioTrajecten, {
      period,
      minGroupSize: MIN_GROUP,
      definition: "Mediane dagen tot eerste reactie in jouw regio('s).",
    }),
    eigenFillRate: fillRate(
      eigenVacatures.map((v) => v.status),
      { period, minGroupSize: 1, definition: "Aandeel van je eigen vacatures dat vervuld is." },
    ),
    regioFillRate: fillRate(
      regioVacatures.map((v) => v.status),
      { period, minGroupSize: MIN_GROUP, definition: "Aandeel vervulde vacatures in jouw regio('s)." },
    ),
  };

  const locatieBenchmarks: LocatieBenchmark[] = locaties.map((locatie) => {
    const regio = regioVanPostcode(locatie.postcode);
    const vacaturesHier = eigenVacatures.filter(
      (v) => v.locationId === locatie.id && ACTIEVE_STATUSSEN.has(v.status),
    );
    const regioActief = alleVacatureFeiten.filter(
      (v) => v.regio === regio && ACTIEVE_STATUSSEN.has(v.status),
    );
    return {
      locatieNaam: locatie.name,
      stad: locatie.city,
      regio,
      actieveVacatures: vacaturesHier.length,
      eigenUrenMediaan: mediaanWaarde(
        vacaturesHier.map((v) => (v.hoursMin + v.hoursMax) / 2),
        {
          period,
          minGroupSize: 1,
          definition: "Mediane geboden uren per week van je eigen vacatures op deze locatie.",
        },
      ),
      regioUrenMediaan: mediaanWaarde(
        regioActief.map((v) => (v.hoursMin + v.hoursMax) / 2),
        {
          period,
          minGroupSize: MIN_GROUP,
          definition: "Mediane geboden uren per week van vacatures in deze regio.",
        },
      ),
    };
  });

  return {
    period,
    regios: regionaal.filter((rij) => eigenRegios.has(rij.dimensionKey)),
    functies: functies.filter(
      (rij) => eigenRollen.size === 0 || eigenRollen.has(rij.dimensionKey),
    ),
    organisatie,
    locaties: locatieBenchmarks,
    minGroupSize: MIN_GROUP,
  };
}
