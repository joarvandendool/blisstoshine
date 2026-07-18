// Intern KPI-dashboard (/intern): marketplace- en SaaS-cijfers voor
// bedrijfssturing. Rekent uitsluitend via de servicelaag (src/server/kpi.ts),
// die op zijn beurt de centrale KPI-definities in @/domain/kpi gebruikt.
//
// AUTORISATIE: naast de layout doet ook deze pagina requirePlatformAdmin()
// (defense-in-depth; kpi.ts vereist expliciet dat de pagina dit afdwingt).
//
// Presentatie: rustig en data-eerst. Elke metric heeft een klein i-element met
// de definitietekst uit de KPI-module; metrics met insufficientData tonen
// letterlijk "onvoldoende data" (gedempt) in plaats van een misleidend getal.

import { redirect } from "next/navigation";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import { commercialKpis, marketplaceKpis, saasKpis, usageKpis } from "@/server/kpi";
import { feedbackInsights, feedbackReasonLabel } from "@/server/feedback-insights";
import type { KpiValue, SegmentConversionResult } from "@/domain/kpi";
import { label as taxonomieLabel } from "@/domain/taxonomy";
import { PLAN_CATALOG, PLAN_CODES, type PlanCode } from "@/domain/entitlements";
import { Card, PageHeader, SectionHeading, cx } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Formattering (nl-NL) — bedragen komen binnen in eurocenten,         */
/* verhoudingen als fracties (0–1), doorlooptijden in dagen.           */
/* ------------------------------------------------------------------ */

const HEEL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 });
const EEN_DECIMAAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });
const TWEE_DECIMALEN = new Intl.NumberFormat("nl-NL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const EURO = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

const formatAantal = (waarde: number) => HEEL.format(waarde);
const formatGetal = (waarde: number) => EEN_DECIMAAL.format(waarde);
const formatProcentGetal = (fractie: number) => EEN_DECIMAAL.format(fractie * 100);
const formatEuroCenten = (centen: number) => EURO.format(centen / 100);

const MAANDEN = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
] as const;

/** "2026-01" → "januari 2026"; onbekend formaat blijft ongewijzigd. */
function formatStartmaand(startMonth: string): string {
  const [jaar, maand] = startMonth.split("-");
  const naam = MAANDEN[Number(maand) - 1];
  return naam ? `${naam} ${jaar}` : startMonth;
}

/** Plannaam uit de plancatalogus; onbekende codes vallen terug op de code. */
function planNaam(code: string): string {
  return (PLAN_CODES as readonly string[]).includes(code)
    ? PLAN_CATALOG[code as PlanCode].name
    : code;
}

/* ------------------------------------------------------------------ */
/* Bouwstenen                                                          */
/* ------------------------------------------------------------------ */

/** Klein i-element met de definitietekst uit de KPI-module. */
function InfoDefinitie({ definitie }: { definitie: string }) {
  return (
    <span
      title={definitie}
      className="inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full border border-ink/15 bg-white/70 font-serif text-[11px] font-bold italic text-ink/60"
    >
      <span aria-hidden="true">i</span>
      <span className="sr-only">Definitie: {definitie}</span>
    </span>
  );
}

/** Gedempte, letterlijke melding wanneer een metric onvoldoende data heeft. */
function OnvoldoendeData({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cx(
        "font-medium italic text-ink/60",
        compact ? "text-sm" : "text-lg",
      )}
    >
      onvoldoende data
    </span>
  );
}

interface KpiTegelProps {
  label: string;
  kpi: KpiValue;
  formatteer: (waarde: number) => string;
  /** Serif-accent direct achter het getal, bv. "%". */
  suffix?: string;
  /** Kleinere eenheid achter het getal, bv. "dagen". */
  eenheid?: string;
}

/** Stat-tegel: één metric met label, waarde en definitie-info. */
function KpiTegel({ label, kpi, formatteer, suffix, eenheid }: KpiTegelProps) {
  return (
    <Card className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-ink/70">{label}</span>
        <InfoDefinitie definitie={kpi.definition} />
      </div>
      {kpi.insufficientData || kpi.value === null ? (
        <OnvoldoendeData />
      ) : (
        <p className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          <span className="tabular-nums">{formatteer(kpi.value)}</span>
          {suffix ? (
            <em className="font-serif font-bold italic text-blauw-600">
              {suffix}
            </em>
          ) : null}
          {eenheid ? (
            <span className="ml-1.5 text-base font-medium text-ink/60">
              {eenheid}
            </span>
          ) : null}
        </p>
      )}
    </Card>
  );
}

/** Kop binnen een kaart, met definitie-info van tabelmetrics. */
function KaartKop({ titel, definitie }: { titel: string; definitie: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-lg font-semibold text-ink">{titel}</h3>
      <InfoDefinitie definitie={definitie} />
    </div>
  );
}

const TH_KLASSE =
  "py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60";
const TD_KLASSE = "py-2.5 pr-3 align-top";

/** Conversietabel per segment (plan of acquisitiebron). */
function ConversieTabel({
  titel,
  resultaat,
  segmentKop,
  formatSegment = (segment: string) => segment,
}: {
  titel: string;
  resultaat: SegmentConversionResult;
  segmentKop: string;
  formatSegment?: (segment: string) => string;
}) {
  return (
    <Card>
      <KaartKop titel={titel} definitie={resultaat.definition} />
      {resultaat.entries.length === 0 ? (
        <p className="mt-4">
          <OnvoldoendeData />
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[20rem] text-left text-sm text-ink">
            <thead>
              <tr className="border-b border-ink/10">
                <th scope="col" className={TH_KLASSE}>
                  {segmentKop}
                </th>
                <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                  Totaal
                </th>
                <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                  Geconverteerd
                </th>
                <th scope="col" className={cx(TH_KLASSE, "pr-0 text-right")}>
                  Conversie
                </th>
              </tr>
            </thead>
            <tbody>
              {resultaat.entries.map((rij) => (
                <tr
                  key={rij.segment}
                  className="border-b border-ink/5 last:border-b-0"
                >
                  <td className={cx(TD_KLASSE, "font-medium")}>
                    {formatSegment(rij.segment)}
                  </td>
                  <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                    {formatAantal(rij.total)}
                  </td>
                  <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                    {formatAantal(rij.converted)}
                  </td>
                  <td className={cx(TD_KLASSE, "pr-0 text-right tabular-nums")}>
                    {rij.insufficientData || rij.rate === null ? (
                      <OnvoldoendeData compact />
                    ) : (
                      `${formatProcentGetal(rij.rate)}%`
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */

export default async function InternKpiPagina() {
  // Defense-in-depth: kpi.ts is platformbreed en vereist dat de pagina zelf
  // requirePlatformAdmin() doet — de layout alleen is niet voldoende.
  try {
    await requirePlatformAdmin();
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      return null; // de layout toont de 403-melding
    }
    throw fout;
  }

  const [marketplace, saas, commercieel, gebruik, feedback] = await Promise.all([
    marketplaceKpis(),
    saasKpis(),
    commercialKpis(),
    usageKpis(),
    feedbackInsights(),
  ]);

  // MRR-beweging als kleine motion-loze staafjes; breedte relatief aan de
  // grootste beweging. Richting staat óók in het teken, nooit alleen in kleur.
  const mrrBeweging = [
    { label: "Nieuwe MRR", kpi: saas.newMrr, richting: "in" },
    { label: "Expansion-MRR", kpi: saas.expansionMrr, richting: "in" },
    { label: "Contraction-MRR", kpi: saas.contractionMrr, richting: "uit" },
    { label: "Churned MRR", kpi: saas.churnedMrr, richting: "uit" },
  ] as const;
  const grootsteBeweging = Math.max(
    0,
    ...mrrBeweging.map((b) =>
      b.kpi.insufficientData || b.kpi.value === null ? 0 : b.kpi.value,
    ),
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-roze-800">
          Interne cijfers — niet delen buiten het team
        </p>
        <PageHeader
          title="Bedrijfssturing"
          accent="in cijfers"
          description="Marketplace- en SaaS-KPI's, live berekend volgens de centrale KPI-definities. Het i-symbool bij elke metric toont de exacte definitie."
        />
      </div>

      {/* ============================ MARKETPLACE ===================== */}
      <section className="flex flex-col gap-6">
        <SectionHeading
          eyebrow="Marketplace"
          title="Vraag en"
          accent="aanbod"
          description="Hoe gezond is de match-markt: kandidaten, vacatures en de snelheid waarmee ze elkaar vinden."
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <KpiTegel
            label="Actieve kandidaten"
            kpi={marketplace.activeCandidates}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Actieve praktijken"
            kpi={marketplace.activePractices}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Actieve vacatures"
            kpi={marketplace.activeVacancies}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Matches per vacature"
            kpi={marketplace.matchesPerVacancy}
            formatteer={formatGetal}
          />
          <KpiTegel
            label="Sollicitatieconversie"
            kpi={marketplace.applicationConversion}
            formatteer={formatProcentGetal}
            suffix="%"
          />
          <KpiTegel
            label="Uitnodiging-acceptatie"
            kpi={marketplace.invitationAcceptance}
            formatteer={formatProcentGetal}
            suffix="%"
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-ink">
            Doorlooptijden{" "}
            <span className="text-sm font-normal text-ink/60">
              — mediaan in dagen
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTegel
              label="Tot eerste match"
              kpi={marketplace.timeToFirstMatch}
              formatteer={formatGetal}
              eenheid="dagen"
            />
            <KpiTegel
              label="Tot eerste reactie"
              kpi={marketplace.timeToFirstResponse}
              formatteer={formatGetal}
              eenheid="dagen"
            />
            <KpiTegel
              label="Tot gesprek"
              kpi={marketplace.timeToInterview}
              formatteer={formatGetal}
              eenheid="dagen"
            />
            <KpiTegel
              label="Tot plaatsing"
              kpi={marketplace.timeToPlacement}
              formatteer={formatGetal}
              eenheid="dagen"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <KpiTegel
            label="Ingevulde vacatures"
            kpi={marketplace.vacancyFillRate}
            formatteer={formatProcentGetal}
            suffix="%"
          />

          <Card className="md:col-span-2">
            <KaartKop
              titel="Dekking per functie en regio"
              definitie={marketplace.coverage.definition}
            />
            {marketplace.coverage.entries.length === 0 ? (
              <p className="mt-4">
                <OnvoldoendeData />
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-sm text-ink">
                  <thead>
                    <tr className="border-b border-ink/10">
                      <th scope="col" className={TH_KLASSE}>
                        Functie
                      </th>
                      <th scope="col" className={TH_KLASSE}>
                        Regio
                      </th>
                      <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                        Kandidaten
                      </th>
                      <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                        Vacatures
                      </th>
                      <th
                        scope="col"
                        className={cx(TH_KLASSE, "pr-0 text-right")}
                      >
                        Vraag/aanbod
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketplace.coverage.entries.map((rij) => (
                      <tr
                        key={`${rij.role}-${rij.region}`}
                        className="border-b border-ink/5 last:border-b-0"
                      >
                        <td className={cx(TD_KLASSE, "font-medium")}>
                          {taxonomieLabel(rij.role)}
                        </td>
                        <td className={cx(TD_KLASSE, "text-ink/80")}>
                          {rij.region}
                        </td>
                        <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                          {formatAantal(rij.candidateCount)}
                        </td>
                        <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                          {formatAantal(rij.vacancyCount)}
                        </td>
                        <td
                          className={cx(
                            TD_KLASSE,
                            "pr-0 text-right tabular-nums",
                          )}
                        >
                          {rij.demandSupplyRatio === null ? (
                            <span
                              className="text-ink/60"
                              title="Geen actieve kandidaten in deze groep"
                            >
                              —
                            </span>
                          ) : (
                            TWEE_DECIMALEN.format(rij.demandSupplyRatio)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* ============================ SAAS ============================ */}
      <section className="flex flex-col gap-6">
        <SectionHeading
          eyebrow="SaaS"
          title="Omzet en"
          accent="retentie"
          description="De commerciële motor: abonnementen, terugkerende omzet en hoe goed we klanten vasthouden."
        />

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <KpiTegel
            label="Organisaties in proefperiode"
            kpi={saas.trialOrganizations}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Betalende organisaties"
            kpi={saas.payingOrganizations}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="MRR"
            kpi={saas.mrr}
            formatteer={formatEuroCenten}
          />
          <KpiTegel
            label="Gemiddelde omzet per organisatie"
            kpi={saas.arpo}
            formatteer={formatEuroCenten}
          />
          <KpiTegel
            label="Maandelijkse logo-churn"
            kpi={saas.logoChurnMonthly}
            formatteer={formatProcentGetal}
            suffix="%"
          />
          <KpiTegel
            label="Omzetconcentratie grootste klant"
            kpi={saas.revenueConcentration}
            formatteer={formatProcentGetal}
            suffix="%"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* MRR-beweging: motion-loze staafjes, richting in het teken. */}
          <Card>
            <KaartKop
              titel="MRR-beweging deze maand"
              definitie="Maand-op-maandvergelijking van de MRR per organisatie; zie de definitie per onderdeel."
            />
            <ul className="mt-4 flex flex-col gap-4">
              {mrrBeweging.map((beweging) => {
                const waarde =
                  beweging.kpi.insufficientData || beweging.kpi.value === null
                    ? null
                    : beweging.kpi.value;
                const breedte =
                  waarde === null || grootsteBeweging === 0
                    ? 0
                    : (waarde / grootsteBeweging) * 100;
                const teken =
                  waarde === null || waarde === 0
                    ? ""
                    : beweging.richting === "in"
                      ? "+ "
                      : "− ";
                return (
                  <li key={beweging.label} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink/70">
                        {beweging.label}
                        <InfoDefinitie definitie={beweging.kpi.definition} />
                      </span>
                      {waarde === null ? (
                        <OnvoldoendeData compact />
                      ) : (
                        <span className="text-sm font-semibold tabular-nums text-ink">
                          {teken}
                          {formatEuroCenten(waarde)}
                        </span>
                      )}
                    </div>
                    <div
                      aria-hidden="true"
                      className="h-2 overflow-hidden rounded-full bg-brand-light/50"
                    >
                      <div
                        className={cx(
                          "h-full rounded-full",
                          beweging.richting === "in"
                            ? "bg-blauw-600"
                            : "bg-roze-500",
                        )}
                        style={{ width: `${breedte}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Omzet per plan */}
          <Card>
            <KaartKop
              titel="Omzet per plan"
              definitie={saas.revenuePerPlan.definition}
            />
            {saas.revenuePerPlan.entries.length === 0 ? (
              <p className="mt-4">
                <OnvoldoendeData />
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[16rem] text-left text-sm text-ink">
                  <thead>
                    <tr className="border-b border-ink/10">
                      <th scope="col" className={TH_KLASSE}>
                        Plan
                      </th>
                      <th
                        scope="col"
                        className={cx(TH_KLASSE, "pr-0 text-right")}
                      >
                        MRR
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {saas.revenuePerPlan.entries.map((rij) => (
                      <tr
                        key={rij.planCode}
                        className="border-b border-ink/5 last:border-b-0"
                      >
                        <td className={cx(TD_KLASSE, "font-medium")}>
                          {planNaam(rij.planCode)}
                        </td>
                        <td
                          className={cx(
                            TD_KLASSE,
                            "pr-0 text-right tabular-nums",
                          )}
                        >
                          {formatEuroCenten(rij.mrrCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Cohortretentie */}
        <Card>
          <KaartKop
            titel="Cohortretentie per startmaand"
            definitie={saas.cohortRetention.definition}
          />
          {saas.cohortRetention.cohorts.length === 0 ? (
            <p className="mt-4">
              <OnvoldoendeData />
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left text-sm text-ink">
                <thead>
                  <tr className="border-b border-ink/10">
                    <th scope="col" className={TH_KLASSE}>
                      Startmaand
                    </th>
                    <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                      Organisaties
                    </th>
                    <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                      Nog actief
                    </th>
                    <th scope="col" className={cx(TH_KLASSE, "pr-0 text-right")}>
                      Retentie
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {saas.cohortRetention.cohorts.map((cohort) => (
                    <tr
                      key={cohort.startMonth}
                      className="border-b border-ink/5 last:border-b-0"
                    >
                      <td className={cx(TD_KLASSE, "font-medium")}>
                        {formatStartmaand(cohort.startMonth)}
                      </td>
                      <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                        {formatAantal(cohort.organizationCount)}
                      </td>
                      <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                        {formatAantal(cohort.activeCount)}
                      </td>
                      <td
                        className={cx(TD_KLASSE, "pr-0 text-right tabular-nums")}
                      >
                        {cohort.insufficientData || cohort.retention === null ? (
                          <OnvoldoendeData compact />
                        ) : (
                          `${formatProcentGetal(cohort.retention)}%`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ====================== COMMERCIËLE FUNNEL ==================== */}
      <section className="flex flex-col gap-6">
        <SectionHeading
          eyebrow="Commerciële funnel"
          title="Van account naar"
          accent="abonnement"
          description="Activatie en conversie: hoe snel nieuwe praktijken waarde zien en hoe vaak dat tot een betaald plan leidt."
        />

        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-ink">Activatie</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <KpiTegel
              label="Nieuwe praktijkaccounts (30 d)"
              kpi={commercieel.newPracticeAccounts}
              formatteer={formatAantal}
            />
            <KpiTegel
              label="Onboarding afgerond"
              kpi={commercieel.onboardingCompletion}
              formatteer={formatProcentGetal}
              suffix="%"
            />
            <KpiTegel
              label="Time-to-activation (mediaan)"
              kpi={commercieel.timeToActivation}
              formatteer={formatGetal}
              eenheid="dagen"
            />
            <KpiTegel
              label="Talent Radar bekeken"
              kpi={commercieel.radarViewedShare}
              formatteer={formatProcentGetal}
              suffix="%"
            />
            <KpiTegel
              label="Eerste sterke match"
              kpi={commercieel.firstStrongMatchShare}
              formatteer={formatProcentGetal}
              suffix="%"
            />
            <KpiTegel
              label="Eerste uitnodiging"
              kpi={commercieel.firstInvitationShare}
              formatteer={formatProcentGetal}
              suffix="%"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-lg font-semibold text-ink">Conversie</h3>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTegel
              label="Trialstarts"
              kpi={commercieel.trialStarts}
              formatteer={formatAantal}
            />
            <KpiTegel
              label="Trial → betaald"
              kpi={commercieel.trialToPaid}
              formatteer={formatProcentGetal}
              suffix="%"
            />
            <KpiTegel
              label="Checkoutconversie"
              kpi={commercieel.checkoutConversion}
              formatteer={formatProcentGetal}
              suffix="%"
            />
            <KpiTegel
              label="Registratie → betaling (mediaan)"
              kpi={commercieel.timeToPaid}
              formatteer={formatGetal}
              eenheid="dagen"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ConversieTabel
            titel="Conversie per plan"
            resultaat={commercieel.conversionByPlan}
            segmentKop="Plan"
            formatSegment={planNaam}
          />
          <ConversieTabel
            titel="Conversie per acquisitiebron"
            resultaat={commercieel.conversionBySource}
            segmentKop="Bron"
          />
        </div>
      </section>

      {/* ========================= PRODUCTGEBRUIK ===================== */}
      <section className="flex flex-col gap-6">
        <SectionHeading
          eyebrow="Productgebruik"
          title="Wat praktijken echt"
          accent="doen"
          description="Actieve praktijken en kernacties in de afgelopen 30 dagen, op basis van analytics-events."
        />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTegel
            label="Wekelijks actieve praktijken (WAP)"
            kpi={gebruik.weeklyActivePractices}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Maandelijks actieve praktijken (MAP)"
            kpi={gebruik.monthlyActivePractices}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Praktijken in de Match Studio"
            kpi={gebruik.matchStudioPractices}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Simulaties per praktijk"
            kpi={gebruik.simulationsPerPractice}
            formatteer={formatGetal}
          />
          <KpiTegel
            label="Kandidaat-uitnodigingen"
            kpi={gebruik.invitationsSent}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Ingeplande gesprekken"
            kpi={gebruik.interviewsScheduled}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Plaatsingen"
            kpi={gebruik.placements}
            formatteer={formatAantal}
          />
          <KpiTegel
            label="Praktijken in de bezettingsplanner"
            kpi={gebruik.capacityPlannerPractices}
            formatteer={formatAantal}
          />
        </div>
      </section>

      {/* ======================== FEEDBACKREDENEN ===================== */}
      <section className="flex flex-col gap-6">
        <SectionHeading
          eyebrow="Feedbackredenen"
          title="Waarom matches"
          accent="afketsen"
          description={`Redenen waarom praktijken en kandidaten een match afwijzen. Groepen kleiner dan ${feedback.minimumGroupSize} worden weggelaten voor betrouwbare en privacyveilige cijfers.`}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <KaartKop titel="Per reden" definitie={feedback.definition} />
            {feedback.byReason.length === 0 ? (
              <p className="mt-4">
                <OnvoldoendeData />
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[20rem] text-left text-sm text-ink">
                  <thead>
                    <tr className="border-b border-ink/10">
                      <th scope="col" className={TH_KLASSE}>
                        Reden
                      </th>
                      <th scope="col" className={cx(TH_KLASSE, "text-right")}>
                        Aantal
                      </th>
                      <th scope="col" className={cx(TH_KLASSE, "pr-0 text-right")}>
                        Aandeel
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedback.byReason.map((rij) => (
                      <tr
                        key={rij.reasonCode}
                        className="border-b border-ink/5 last:border-b-0"
                      >
                        <td className={cx(TD_KLASSE, "font-medium")}>
                          {feedbackReasonLabel(rij.reasonCode)}
                        </td>
                        <td className={cx(TD_KLASSE, "text-right tabular-nums")}>
                          {formatAantal(rij.count)}
                        </td>
                        <td className={cx(TD_KLASSE, "pr-0 text-right tabular-nums")}>
                          {formatProcentGetal(rij.share)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <KaartKop
              titel="Per regio en reden"
              definitie={feedback.definition}
            />
            {feedback.byRegion.length === 0 ? (
              <p className="mt-4">
                <OnvoldoendeData />
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[20rem] text-left text-sm text-ink">
                  <thead>
                    <tr className="border-b border-ink/10">
                      <th scope="col" className={TH_KLASSE}>
                        Regio
                      </th>
                      <th scope="col" className={TH_KLASSE}>
                        Reden
                      </th>
                      <th scope="col" className={cx(TH_KLASSE, "pr-0 text-right")}>
                        Aantal
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {feedback.byRegion.map((rij) => (
                      <tr
                        key={`${rij.region}-${rij.reasonCode}`}
                        className="border-b border-ink/5 last:border-b-0"
                      >
                        <td className={cx(TD_KLASSE, "font-medium")}>
                          {rij.region}
                        </td>
                        <td className={cx(TD_KLASSE, "text-ink/80")}>
                          {feedbackReasonLabel(rij.reasonCode)}
                        </td>
                        <td className={cx(TD_KLASSE, "pr-0 text-right tabular-nums")}>
                          {formatAantal(rij.count)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
