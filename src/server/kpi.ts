// Verzamelfuncties voor het interne KPI-dashboard: halen Prisma-rijen op en
// rekenen uitsluitend via de centrale KPI-definities in @/domain/kpi — hier
// staan geen eigen berekeningen.
//
// AUTORISATIE: marketplaceKpis() en saasKpis() zijn platformbreed (over alle
// tenants heen) en mogen daarom ALLEEN worden aangeroepen nadat de pagina of
// route handler requirePlatformAdmin() heeft gedaan. De afdwinging gebeurt
// bewust in de pagina, zodat deze module ook in scripts en tests bruikbaar is.

import { prisma } from "@/lib/db";
import {
  activeCandidates,
  activePractices,
  activeVacancies,
  applicationConversion,
  arpo,
  capacityPlannerPractices,
  checkoutConversion,
  churnedMrr,
  cohortRetention,
  contractionMrr,
  conversionByAcquisitionSource,
  conversionByPlan,
  coverageByRoleRegion,
  expansionMrr,
  firstInvitationShare,
  firstStrongMatchShare,
  interviewsScheduled,
  invitationAcceptance,
  invitationsSent,
  logoChurnMonthly,
  matchStudioPractices,
  matchesPerVacancy,
  monthlyActivePractices,
  mrr,
  newMrr,
  newPracticeAccounts,
  onboardingCompletionRate,
  payingOrganizations,
  placements,
  radarViewedShare,
  revenueConcentration,
  revenuePerPlan,
  simulationsPerPractice,
  subscriptionMrrCents,
  timeToActivationMedian,
  timeToFirstMatch,
  timeToFirstResponse,
  timeToInterview,
  timeToPaidMedian,
  timeToPlacement,
  trialOrganizations,
  trialStarts,
  trialToPaidRate,
  vacancyFillRate,
  weeklyActivePractices,
  type ActivationOrganizationRow,
  type CohortOrganizationRow,
  type CohortRetentionResult,
  type CoverageResult,
  type DurationMeasurement,
  type ItemPricesCents,
  type KpiValue,
  type MrrSnapshot,
  type PracticeMilestoneRow,
  type RevenuePerPlanResult,
  type SegmentConversionResult,
  type SubscriptionRow,
  type TrialConversionRow,
  type UsageEventRow,
} from "@/domain/kpi";
import { geocodePostcode } from "@/server/geo";
import { poolForMatchVacancy } from "@/server/matching";
import { vacancyToMatchVacancy } from "@/server/vacancies";

// ---------------------------------------------------------------------------
// Marketplace-KPI's
// ---------------------------------------------------------------------------

export interface MarketplaceKpis {
  activeCandidates: KpiValue;
  activePractices: KpiValue;
  activeVacancies: KpiValue;
  matchesPerVacancy: KpiValue;
  applicationConversion: KpiValue;
  invitationAcceptance: KpiValue;
  timeToFirstMatch: KpiValue;
  timeToFirstResponse: KpiValue;
  timeToInterview: KpiValue;
  timeToPlacement: KpiValue;
  vacancyFillRate: KpiValue;
  coverage: CoverageResult;
}

/** Regio van een kandidaat: stad uit de geocodeertabel, anders "onbekend". */
function regioVanPostcode(postcode: string): string {
  return geocodePostcode(postcode)?.city ?? "onbekend";
}

/**
 * Alle marketplace-KPI's. Doorlooptijden zijn benaderingen op basis van de
 * beschikbare gegevens: sollicitatie-doorlooptijden gebruiken createdAt →
 * updatedAt van de sollicitatie (updatedAt is de laatste statuswijziging),
 * time-to-first-match gebruikt de analytics-events per kandidaat.
 * ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function marketplaceKpis(): Promise<MarketplaceKpis> {
  const [kandidaten, organisaties, vacatures, events, uitnodigingen, sollicitaties] =
    await Promise.all([
      prisma.candidateProfile.findMany({
        select: { status: true, role: true, postcode: true },
      }),
      prisma.organization.findMany({ select: { status: true } }),
      prisma.vacancy.findMany({ include: { location: true } }),
      prisma.analyticsEvent.findMany({
        where: {
          name: {
            in: ["match_viewed", "application_submitted", "candidate_profile_activated"],
          },
        },
        select: { name: true, candidateId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.invitation.findMany({ select: { status: true } }),
      prisma.application.findMany({
        select: { status: true, createdAt: true, updatedAt: true },
      }),
    ]);

  // Eligible matches per gepubliceerde vacature — via de matchingservice, met
  // één gedeelde kandidatenlijst zodat we de database niet per vacature raken.
  const actieveProfielen = await prisma.candidateProfile.findMany({
    where: { status: "active", visibility: { not: "hidden" } },
  });
  const gepubliceerd = vacatures.filter((v) => v.status === "published");
  const matchRijen = await Promise.all(
    gepubliceerd.map(async (vacature) => {
      const pool = await poolForMatchVacancy(
        vacancyToMatchVacancy(vacature, vacature.location),
        actieveProfielen,
      );
      return { eligibleMatches: pool.filter((p) => p.result.eligible).length };
    }),
  );

  // Doorlooptijd profielactivatie → eerste bekeken match, per kandidaat.
  const activatiePerKandidaat = new Map<string, Date>();
  const eersteMatchPerKandidaat = new Map<string, Date>();
  for (const event of events) {
    if (!event.candidateId) continue;
    if (
      event.name === "candidate_profile_activated" &&
      !activatiePerKandidaat.has(event.candidateId)
    ) {
      activatiePerKandidaat.set(event.candidateId, event.createdAt);
    }
    if (event.name === "match_viewed" && !eersteMatchPerKandidaat.has(event.candidateId)) {
      eersteMatchPerKandidaat.set(event.candidateId, event.createdAt);
    }
  }
  const naarEersteMatch: DurationMeasurement[] = [];
  for (const [kandidaatId, activatie] of activatiePerKandidaat) {
    const eersteMatch = eersteMatchPerKandidaat.get(kandidaatId);
    if (eersteMatch && eersteMatch.getTime() >= activatie.getTime()) {
      naarEersteMatch.push({ startAt: activatie, endAt: eersteMatch });
    }
  }

  // Sollicitatie → eerste reactie (elke statuswijziging na indienen).
  const naarEersteReactie: DurationMeasurement[] = sollicitaties
    .filter((s) => s.status !== "submitted")
    .map((s) => ({ startAt: s.createdAt, endAt: s.updatedAt }));

  // Sollicitatie → kennismakingsgesprek (status interview of verder).
  const naarGesprek: DurationMeasurement[] = sollicitaties
    .filter((s) => s.status === "interview" || s.status === "offered" || s.status === "hired")
    .map((s) => ({ startAt: s.createdAt, endAt: s.updatedAt }));

  // Publicatie → vervulling.
  const naarVervulling: DurationMeasurement[] = vacatures
    .filter((v) => v.status === "filled" && v.publishedAt !== null)
    .map((v) => ({ startAt: v.publishedAt as Date, endAt: v.updatedAt }));

  // Dekking per functie en regio: actieve kandidaten en openstaande vacatures.
  const kandidaatRegios = kandidaten
    .filter((k) => k.status === "active")
    .map((k) => ({ role: k.role, region: regioVanPostcode(k.postcode) }));
  const vacatureRegios = gepubliceerd.map((v) => ({
    role: v.role,
    region: v.location.city,
  }));

  // Ooit gepubliceerde vacatures (concepten tellen niet mee in de fill rate).
  const ooitGepubliceerd = vacatures.filter((v) => v.status !== "draft");

  return {
    activeCandidates: activeCandidates(kandidaten),
    activePractices: activePractices(organisaties),
    activeVacancies: activeVacancies(vacatures),
    matchesPerVacancy: matchesPerVacancy(matchRijen),
    applicationConversion: applicationConversion(events),
    invitationAcceptance: invitationAcceptance(uitnodigingen),
    timeToFirstMatch: timeToFirstMatch(naarEersteMatch),
    timeToFirstResponse: timeToFirstResponse(naarEersteReactie),
    timeToInterview: timeToInterview(naarGesprek),
    timeToPlacement: timeToPlacement(naarVervulling),
    vacancyFillRate: vacancyFillRate(ooitGepubliceerd),
    coverage: coverageByRoleRegion(kandidaatRegios, vacatureRegios),
  };
}

// ---------------------------------------------------------------------------
// SaaS-KPI's
// ---------------------------------------------------------------------------

export interface SaasKpis {
  trialOrganizations: KpiValue;
  payingOrganizations: KpiValue;
  mrr: KpiValue;
  arpo: KpiValue;
  newMrr: KpiValue;
  expansionMrr: KpiValue;
  contractionMrr: KpiValue;
  churnedMrr: KpiValue;
  logoChurnMonthly: KpiValue;
  revenuePerPlan: RevenuePerPlanResult;
  cohortRetention: CohortRetentionResult;
  revenueConcentration: KpiValue;
}

/**
 * Maandprijzen van losse abonnementsitems in eurocenten. In deze release
 * worden er nog geen losse items verkocht; onbekende sleutels tellen als 0
 * (zie subscriptionMrrCents in het domein).
 */
const ITEM_PRIJZEN_CENTEN: ItemPricesCents = {};

/**
 * Alle SaaS-KPI's. De maand-op-maandbeweging (new/expansion/contraction/
 * churned MRR en logo-churn) is een benadering op basis van de huidige
 * abonnementstoestand: als "vorige maand" gelden abonnementen die vóór het
 * begin van deze kalendermaand zijn gestart en niet trialing zijn — er worden
 * (nog) geen historische MRR-snapshots per maand opgeslagen.
 * ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function saasKpis(): Promise<SaasKpis> {
  const abonnementen = await prisma.subscription.findMany({
    include: { planVersion: { include: { plan: true } }, items: true },
  });

  const rijen: SubscriptionRow[] = abonnementen.map((abonnement) => ({
    organizationId: abonnement.organizationId,
    planCode: abonnement.planVersion.plan.code,
    status: abonnement.status,
    planPriceMonthlyCents: abonnement.planVersion.priceMonthlyCents,
    items: abonnement.items.map((item) => ({ key: item.key, quantity: item.quantity })),
  }));

  // MRR-snapshots: huidige maand = nu actieve abonnementen; vorige maand =
  // vóór deze kalendermaand gestarte, niet-trialing abonnementen (benadering).
  const nu = new Date();
  const dezeMaandStart = new Date(nu.getFullYear(), nu.getMonth(), 1);

  const huidigeSnapshots: MrrSnapshot[] = [];
  const vorigeSnapshots: MrrSnapshot[] = [];
  for (let i = 0; i < abonnementen.length; i += 1) {
    const abonnement = abonnementen[i];
    const rij = rijen[i];
    const mrrCents = subscriptionMrrCents(rij, ITEM_PRIJZEN_CENTEN);
    if (rij.status === "active") {
      huidigeSnapshots.push({ orgId: rij.organizationId, mrrCents });
    }
    if (rij.status !== "trialing" && abonnement.createdAt < dezeMaandStart) {
      vorigeSnapshots.push({ orgId: rij.organizationId, mrrCents });
    }
  }

  // Cohorten: startmaand van het eerste abonnement per organisatie; een
  // organisatie geldt als actief zolang er een niet-geannuleerd abonnement is.
  const perOrganisatie = new Map<string, { eersteStart: Date; actief: boolean }>();
  for (const abonnement of abonnementen) {
    const bestaand = perOrganisatie.get(abonnement.organizationId);
    const actief = abonnement.status !== "canceled";
    if (!bestaand) {
      perOrganisatie.set(abonnement.organizationId, {
        eersteStart: abonnement.createdAt,
        actief,
      });
    } else {
      if (abonnement.createdAt < bestaand.eersteStart) {
        bestaand.eersteStart = abonnement.createdAt;
      }
      bestaand.actief = bestaand.actief || actief;
    }
  }
  const cohortRijen: CohortOrganizationRow[] = Array.from(
    perOrganisatie.entries(),
  ).map(([orgId, info]) => ({
    orgId,
    startMonth: `${info.eersteStart.getFullYear()}-${String(
      info.eersteStart.getMonth() + 1,
    ).padStart(2, "0")}`,
    active: info.actief,
  }));

  return {
    trialOrganizations: trialOrganizations(rijen),
    payingOrganizations: payingOrganizations(rijen),
    mrr: mrr(rijen, ITEM_PRIJZEN_CENTEN),
    arpo: arpo(rijen, ITEM_PRIJZEN_CENTEN),
    newMrr: newMrr(vorigeSnapshots, huidigeSnapshots),
    expansionMrr: expansionMrr(vorigeSnapshots, huidigeSnapshots),
    contractionMrr: contractionMrr(vorigeSnapshots, huidigeSnapshots),
    churnedMrr: churnedMrr(vorigeSnapshots, huidigeSnapshots),
    logoChurnMonthly: logoChurnMonthly(vorigeSnapshots, huidigeSnapshots),
    revenuePerPlan: revenuePerPlan(rijen, ITEM_PRIJZEN_CENTEN),
    cohortRetention: cohortRetention(cohortRijen),
    revenueConcentration: revenueConcentration(huidigeSnapshots),
  };
}

// ---------------------------------------------------------------------------
// Commerciële funnel-KPI's (activatie + conversie)
// ---------------------------------------------------------------------------

export interface CommercialKpis {
  // activatie
  newPracticeAccounts: KpiValue;
  onboardingCompletion: KpiValue;
  timeToActivation: KpiValue;
  radarViewedShare: KpiValue;
  firstStrongMatchShare: KpiValue;
  firstInvitationShare: KpiValue;
  // conversie
  trialStarts: KpiValue;
  trialToPaid: KpiValue;
  checkoutConversion: KpiValue;
  timeToPaid: KpiValue;
  conversionByPlan: SegmentConversionResult;
  conversionBySource: SegmentConversionResult;
}

/** Eventnamen die de commerciële funnel voeden. */
const COMMERCIELE_EVENTS = [
  "talent_radar_viewed",
  "candidate_invited",
  "checkout_started",
  "checkout_abandoned",
  "subscription_started",
  "subscription_upgraded",
  "subscription_downgraded",
] as const;

/**
 * Alle KPI's van de commerciële funnel. Benaderingen op basis van de
 * beschikbare gegevens:
 * - onboarding geldt als afgerond wanneer de praktijk geactiveerd is
 *   (activatedAt) of minstens één vacature heeft gepubliceerd;
 * - "eerste betaling" is de aanmaak van het eerste niet-trial-abonnement
 *   (LocalTestBillingProvider — geen echte betalingen);
 * - de sterke-matchmijlpaal wordt live doorgerekend via de matchingservice
 *   (goede of uitstekende match op een gepubliceerde vacature).
 * ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function commercialKpis(): Promise<CommercialKpis> {
  const nu = new Date();

  const [organisaties, abonnementen, events, gepubliceerdeVacatureOrgs] =
    await Promise.all([
      prisma.organization.findMany({
        select: {
          id: true,
          status: true,
          createdAt: true,
          activatedAt: true,
          acquisitionSource: true,
        },
      }),
      prisma.subscription.findMany({
        include: { planVersion: { include: { plan: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.analyticsEvent.findMany({
        where: { name: { in: [...COMMERCIELE_EVENTS] } },
        select: { name: true, organizationId: true, plan: true },
      }),
      prisma.vacancy.findMany({
        where: { status: { not: "draft" } },
        select: { organizationId: true },
      }),
    ]);

  // Per organisatie: eerste trial en eerste betaalde abonnement.
  const eersteTrialPerOrg = new Map<string, Date>();
  const eersteBetaaldPerOrg = new Map<string, { at: Date; plan: string }>();
  for (const abonnement of abonnementen) {
    const code = abonnement.planVersion.plan.code;
    if (code === "trial") {
      if (!eersteTrialPerOrg.has(abonnement.organizationId)) {
        eersteTrialPerOrg.set(abonnement.organizationId, abonnement.createdAt);
      }
    } else if (!eersteBetaaldPerOrg.has(abonnement.organizationId)) {
      eersteBetaaldPerOrg.set(abonnement.organizationId, {
        at: abonnement.createdAt,
        plan: code,
      });
    }
  }

  const orgsMetPublicatie = new Set(
    gepubliceerdeVacatureOrgs.map((v) => v.organizationId),
  );

  // Activatierijen over alle organisaties.
  const activatieRijen: ActivationOrganizationRow[] = organisaties.map((org) => ({
    orgId: org.id,
    createdAt: org.createdAt,
    activatedAt: org.activatedAt,
    onboardingCompleted: org.activatedAt !== null || orgsMetPublicatie.has(org.id),
  }));

  // Trialconversierijen: organisaties die een proefperiode zijn gestart.
  const trialRijen: TrialConversionRow[] = organisaties
    .filter((org) => eersteTrialPerOrg.has(org.id))
    .map((org) => {
      const betaald = eersteBetaaldPerOrg.get(org.id) ?? null;
      return {
        orgId: org.id,
        registeredAt: org.createdAt,
        convertedAt: betaald?.at ?? null,
        plan: betaald?.plan ?? null,
        acquisitionSource: org.acquisitionSource,
      };
    });

  // Mijlpalen per actieve praktijk: radar bekeken en eerste uitnodiging
  // (o.b.v. events), eerste sterke match (live doorgerekend).
  const actieveOrgs = organisaties.filter((org) => org.status === "active");
  const orgsMetRadar = new Set(
    events
      .filter((e) => e.name === "talent_radar_viewed" && e.organizationId !== null)
      .map((e) => e.organizationId as string),
  );
  const orgsMetUitnodiging = new Set(
    events
      .filter((e) => e.name === "candidate_invited" && e.organizationId !== null)
      .map((e) => e.organizationId as string),
  );

  const [gepubliceerd, actieveProfielen] = await Promise.all([
    prisma.vacancy.findMany({
      where: { status: "published" },
      include: { location: true },
    }),
    prisma.candidateProfile.findMany({
      where: { status: "active", visibility: { not: "hidden" } },
    }),
  ]);
  const orgsMetSterkeMatch = new Set<string>();
  await Promise.all(
    gepubliceerd.map(async (vacature) => {
      if (orgsMetSterkeMatch.has(vacature.organizationId)) return;
      const pool = await poolForMatchVacancy(
        vacancyToMatchVacancy(vacature, vacature.location),
        actieveProfielen,
      );
      const sterk = pool.some(
        (p) =>
          p.result.eligible &&
          (p.result.label === "excellent" || p.result.label === "good"),
      );
      if (sterk) orgsMetSterkeMatch.add(vacature.organizationId);
    }),
  );

  const mijlpaal = (gehaald: Set<string>): PracticeMilestoneRow[] =>
    actieveOrgs.map((org) => ({ orgId: org.id, achieved: gehaald.has(org.id) }));

  // Checkout-events voor conversie (totaal en per plan).
  const checkoutEvents = events.map((e) => ({ name: e.name, plan: e.plan }));

  return {
    newPracticeAccounts: newPracticeAccounts(activatieRijen, nu),
    onboardingCompletion: onboardingCompletionRate(activatieRijen),
    timeToActivation: timeToActivationMedian(activatieRijen),
    radarViewedShare: radarViewedShare(mijlpaal(orgsMetRadar)),
    firstStrongMatchShare: firstStrongMatchShare(mijlpaal(orgsMetSterkeMatch)),
    firstInvitationShare: firstInvitationShare(mijlpaal(orgsMetUitnodiging)),
    trialStarts: trialStarts(trialRijen),
    trialToPaid: trialToPaidRate(trialRijen),
    checkoutConversion: checkoutConversion(checkoutEvents),
    timeToPaid: timeToPaidMedian(trialRijen),
    conversionByPlan: conversionByPlan(checkoutEvents),
    conversionBySource: conversionByAcquisitionSource(trialRijen),
  };
}

// ---------------------------------------------------------------------------
// Productgebruik-KPI's (o.b.v. analytics-events)
// ---------------------------------------------------------------------------

export interface UsageKpis {
  weeklyActivePractices: KpiValue;
  monthlyActivePractices: KpiValue;
  matchStudioPractices: KpiValue;
  simulationsPerPractice: KpiValue;
  invitationsSent: KpiValue;
  interviewsScheduled: KpiValue;
  placements: KpiValue;
  capacityPlannerPractices: KpiValue;
}

/**
 * Alle productgebruik-KPI's, berekend over de analytics-events van de
 * afgelopen 30 dagen. ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function usageKpis(): Promise<UsageKpis> {
  const nu = new Date();
  const vanaf = new Date(nu.getTime() - 30 * 24 * 60 * 60 * 1000);

  const events: UsageEventRow[] = await prisma.analyticsEvent.findMany({
    where: { createdAt: { gte: vanaf } },
    select: { name: true, organizationId: true, createdAt: true },
  });

  return {
    weeklyActivePractices: weeklyActivePractices(events, nu),
    monthlyActivePractices: monthlyActivePractices(events, nu),
    matchStudioPractices: matchStudioPractices(events, nu),
    simulationsPerPractice: simulationsPerPractice(events, nu),
    invitationsSent: invitationsSent(events, nu),
    interviewsScheduled: interviewsScheduled(events, nu),
    placements: placements(events, nu),
    capacityPlannerPractices: capacityPlannerPractices(events, nu),
  };
}
