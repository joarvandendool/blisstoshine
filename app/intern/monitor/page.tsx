// Mondzorg Arbeidsmarkt Monitor (/intern/monitor) — platform-admin.
// Toont alle privacyveilige marktviews uit MarketInsightSnapshot: regionaal
// overzicht, functie-overzicht, schaarste per dag, invloed van flexibiliteit,
// uitkomsten (doorlooptijden, fill rate) en trends per maand.
//
// AUTORISATIE: naast de /intern-layout doet ook deze pagina
// requirePlatformAdmin() (defense-in-depth; market-monitor.ts vereist dat de
// pagina dit afdwingt).
//
// Presentatie: rustige tabellen en pure-CSS staafjes, geen chartbibliotheek.
// Elke onderdrukte cel toont "—" en elke te kleine meting letterlijk
// "onvoldoende data" — nooit kleine aantallen of schijnprecisie.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { label } from "@/domain/taxonomy";
import type {
  FlexibiliteitInvloed,
  MaandTrend,
  MarketDistribution,
  MarketValue,
} from "@/domain/market";
import {
  getMonitorView,
  refreshMarketMonitor,
  type FunctieOverzichtData,
  type RegionaalOverzichtData,
  type SchaarstePerDagData,
  type UitkomstenData,
} from "@/server/market-monitor";
import { Card, PageHeader, SectionHeading, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const ONVOLDOENDE = "onvoldoende data";
const EEN_DECIMAAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

function formatWaarde(waarde: MarketValue, opties?: { procent?: boolean }): string {
  if (waarde.insufficientData || waarde.value === null) return ONVOLDOENDE;
  if (opties?.procent) return `${EEN_DECIMAAL.format(waarde.value * 100)}%`;
  return EEN_DECIMAAL.format(waarde.value);
}

function formatCel(count: number | null): string {
  return count === null ? "—" : EEN_DECIMAAL.format(count);
}

/** Horizontale pure-CSS staafjes voor een verdeling; "—" voor onderdrukte cellen. */
function VerdelingStaafjes({ verdeling: data }: { verdeling: MarketDistribution }) {
  if (data.entries.length === 0 || data.insufficientData) {
    return <p className="text-sm text-ink/60">{ONVOLDOENDE}</p>;
  }
  const max = Math.max(1, ...data.entries.map((e) => e.count ?? 0));
  return (
    <ul className="flex flex-col gap-1.5">
      {data.entries.slice(0, 8).map((entry) => (
        <li key={entry.key} className="flex items-center gap-2 text-sm">
          <span className="w-40 shrink-0 truncate text-ink/80">
            {entry.key.includes(":") ? entry.key : label(entry.key)}
          </span>
          <span className="flex h-3 flex-1 items-center">
            {entry.count === null ? (
              <span className="h-3 w-6 rounded-full border border-dashed border-ink/25" />
            ) : (
              <span
                className="h-3 rounded-full bg-gradient-to-r from-blauw-600 to-blauw-400"
                style={{ width: `${Math.max(4, (entry.count / max) * 100)}%` }}
              />
            )}
          </span>
          <span className="w-10 shrink-0 text-right tabular-nums text-ink">
            {formatCel(entry.count)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WaardeRij({ naam, waarde, procent }: { naam: string; waarde: MarketValue; procent?: boolean }) {
  const onvoldoende = waarde.insufficientData || waarde.value === null;
  return (
    <tr className="border-b border-ink/5 last:border-0">
      <td className="py-2 pr-4 text-ink/80">
        {naam}
        <span className="block text-xs text-ink/50">{waarde.definition}</span>
      </td>
      <td className={cx("py-2 text-right tabular-nums", onvoldoende ? "text-ink/50" : "font-semibold text-ink")}>
        {formatWaarde(waarde, { procent })}
      </td>
      <td className="py-2 pl-4 text-right text-xs tabular-nums text-ink/50">
        n={waarde.sampleSize}
      </td>
    </tr>
  );
}

export default async function MonitorPagina() {
  try {
    await requirePlatformAdmin();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  const [regionaal, functies, schaarste, flexibiliteit, uitkomsten, trends] =
    await Promise.all([
      getMonitorView<RegionaalOverzichtData>("regionaal"),
      getMonitorView<FunctieOverzichtData>("functie"),
      getMonitorView<SchaarstePerDagData>("schaarste_per_dag"),
      getMonitorView<FlexibiliteitInvloed>("flexibiliteit"),
      getMonitorView<UitkomstenData>("uitkomsten"),
      getMonitorView<MaandTrend>("trend"),
    ]);
  const periode = regionaal[0]?.period ?? uitkomsten[0]?.period ?? "";

  async function verversAction() {
    "use server";
    await requirePlatformAdmin();
    await refreshMarketMonitor();
    revalidatePath("/intern/monitor");
  }

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Arbeidsmarkt"
        accent="Monitor"
        description={`Privacyveilige marktinzichten over kandidaten, vacatures en uitkomsten. Peilmaand ${periode}. Cellen kleiner dan ${TALENT_RADAR_MIN_GROUP} worden onderdrukt (—).`}
        actions={
          <form action={verversAction}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blauw-600 px-5 py-2.5 text-sm font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Ververs cijfers
            </button>
          </form>
        }
      />

      {/* Uitkomsten */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Uitkomsten" title="Doorlooptijden en" accent="fill rate" />
        {uitkomsten.map((rij) => (
          <Card key={rij.dimensionKey}>
            <table className="w-full text-sm">
              <tbody>
                <WaardeRij naam="Time-to-response (dagen)" waarde={rij.data.timeToResponse} />
                <WaardeRij naam="Time-to-interview (dagen)" waarde={rij.data.timeToInterview} />
                <WaardeRij naam="Time-to-hire (dagen)" waarde={rij.data.timeToHire} />
                <WaardeRij naam="Fill rate" waarde={rij.data.fillRate} procent />
              </tbody>
            </table>
          </Card>
        ))}
      </section>

      {/* Regionaal overzicht */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Regionaal" title="Kandidaten en vacatures per" accent="regio" />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                  <th className="py-2 pr-4">Regio</th>
                  <th className="py-2 pr-4 text-right">Kandidaten</th>
                  <th className="py-2 pr-4 text-right">Openstaande vacatures</th>
                  <th className="py-2">Kandidaten per functie</th>
                </tr>
              </thead>
              <tbody>
                {regionaal.map((rij) => (
                  <tr key={rij.dimensionKey} className="border-b border-ink/5 align-top last:border-0">
                    <td className="py-2 pr-4 font-medium text-ink">{rij.dimensionKey}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatWaarde(rij.data.kandidaten)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatWaarde(rij.data.vacaturesActief)}
                    </td>
                    <td className="py-2 text-ink/70">
                      {rij.data.kandidatenPerRol.entries.length === 0
                        ? "—"
                        : rij.data.kandidatenPerRol.entries
                            .map((e) => `${label(e.key)}: ${formatCel(e.count)}`)
                            .join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Functie-overzicht */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Functies" title="Marktbeeld per" accent="functie" />
        <div className="grid gap-6 lg:grid-cols-2">
          {functies.map((rij) => (
            <Card key={rij.dimensionKey} className="flex flex-col gap-4">
              <h3 className="text-lg font-semibold text-ink">{label(rij.dimensionKey)}</h3>
              <table className="w-full text-sm">
                <tbody>
                  <WaardeRij naam="Kandidaten" waarde={rij.data.kandidaten} />
                  <WaardeRij naam="Openstaande vacatures" waarde={rij.data.vacaturesActief} />
                  <WaardeRij naam="Mediane uren (kandidaatwens)" waarde={rij.data.urenMediaanKandidaat} />
                  <WaardeRij naam="Mediane uren (vacatureaanbod)" waarde={rij.data.urenMediaanVacature} />
                  <WaardeRij naam="Omzetpercentage gewenst (zzp)" waarde={rij.data.omzetPercentageGewenst} />
                  <WaardeRij naam="Omzetpercentage geboden (zzp)" waarde={rij.data.omzetPercentageGeboden} />
                  <WaardeRij naam="Mediane maximale reistijd (min)" waarde={rij.data.reistijdMediaan} />
                </tbody>
              </table>
              <p className="text-sm text-ink/70">
                Kandidaten per openstaande vacature:{" "}
                <span className="font-semibold text-ink">
                  {rij.data.kandidatenPerVacature === null
                    ? ONVOLDOENDE
                    : EEN_DECIMAAL.format(rij.data.kandidatenPerVacature)}
                </span>
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink">Contractvormen</h4>
                  <VerdelingStaafjes verdeling={rij.data.contractVerdeling} />
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink">Apparatuur en scanners</h4>
                  <VerdelingStaafjes verdeling={rij.data.apparatuur} />
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink">Software</h4>
                  <VerdelingStaafjes verdeling={rij.data.software} />
                </div>
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold text-ink">Specialisaties</h4>
                  <VerdelingStaafjes verdeling={rij.data.specialisaties} />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <h4 className="text-sm font-semibold text-ink">Ontwikkelinteresses</h4>
                  <VerdelingStaafjes verdeling={rij.data.ontwikkelInteresses} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Schaarste per dag */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Schaarste" title="Beschikbaarheid en vraag per" accent="werkdag" />
        {schaarste.map((rij) => (
          <Card key={rij.dimensionKey}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                    <th className="py-2 pr-4">Dag</th>
                    <th className="py-2 pr-4 text-right">Beschikbare kandidaten</th>
                    <th className="py-2 pr-4 text-right">Vacatures met vraag</th>
                    <th className="py-2 text-right">Waarvan verplicht</th>
                  </tr>
                </thead>
                <tbody>
                  {rij.data.perDag.map((dag) => (
                    <tr key={dag.dag} className="border-b border-ink/5 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink">{label(dag.dag)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCel(dag.kandidaten)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCel(dag.vacatures)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCel(dag.verplichteVacatures)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </section>

      {/* Flexibiliteit */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Flexibiliteit" title="Meer dagdelen, groter" accent="bereik" />
        {flexibiliteit.map((rij) => (
          <Card key={rij.dimensionKey} className="flex flex-col gap-3">
            <p className="text-sm text-ink/70">{rij.data.definition}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              {rij.data.banden.map((band) => (
                <div key={band.band} className="flex flex-col gap-1 rounded-2xl bg-brand-light/50 p-4">
                  <span className="text-xs font-semibold uppercase tracking-wide text-blauw-700">
                    {band.band}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums text-ink">
                    {band.insufficientData || band.medianBereik === null
                      ? ONVOLDOENDE
                      : EEN_DECIMAAL.format(band.medianBereik)}
                  </span>
                  <span className="text-xs text-ink/60">mediane vacatures binnen bereik · n={band.sampleSize}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </section>

      {/* Trends per maand */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Trend" title="Ontwikkeling door de" accent="tijd" />
        <div className="grid gap-6 lg:grid-cols-3">
          {trends.map((rij) => (
            <Card key={rij.dimensionKey} className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold capitalize text-ink">{rij.dimensionKey}</h3>
              <p className="text-xs text-ink/60">{rij.data.definition}</p>
              {rij.data.punten.length === 0 ? (
                <p className="text-sm text-ink/60">{ONVOLDOENDE}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {rij.data.punten.map((punt) => {
                    const max = Math.max(1, ...rij.data.punten.map((p) => p.count ?? 0));
                    return (
                      <li key={punt.maand} className="flex items-center gap-2 text-sm">
                        <span className="w-16 shrink-0 tabular-nums text-ink/70">{punt.maand}</span>
                        <span className="flex h-3 flex-1 items-center">
                          {punt.count === null ? (
                            <span className="h-3 w-6 rounded-full border border-dashed border-ink/25" />
                          ) : (
                            <span
                              className="h-3 rounded-full bg-gradient-to-r from-blauw-600 to-blauw-400"
                              style={{ width: `${Math.max(4, (punt.count / max) * 100)}%` }}
                            />
                          )}
                        </span>
                        <span className="w-10 shrink-0 text-right tabular-nums text-ink">
                          {formatCel(punt.count)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </section>

      <p className="text-sm leading-relaxed text-ink/60">
        Privacy: alle cijfers zijn geaggregeerd over geanonimiseerde feiten
        (taxonomiesleutels, regio&apos;s en datums — geen namen of vrije tekst).
        Groepen kleiner dan {TALENT_RADAR_MIN_GROUP} worden onderdrukt en
        combinaties van meer dan twee dimensies worden door het domein geweigerd.
      </p>
    </div>
  );
}
