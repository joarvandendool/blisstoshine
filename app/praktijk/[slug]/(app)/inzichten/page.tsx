// Marktinzichten voor praktijken (/praktijk/[slug]/inzichten) — fase 6.
// Regionaal overzicht, functie-overzicht en benchmark voor de eigen regio('s)
// en rollen. Vereist de add-on premium_market_insights (de catalogussleutel
// wordt door de billing-agent geleverd); zonder entitlement toont de pagina
// een PaywallNotice met een geblurde preview (die zelf paywall_viewed meldt).
//
// PRIVACY: alle marktcijfers zijn dezelfde privacyveilige aggregaties als op
// /intern/monitor (minimumgroepsgrootte, celonderdrukking); alleen de "eigen"
// benchmarkcijfers komen zonder drempel uit de eigen organisatie.

import { notFound, redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { label } from "@/domain/taxonomy";
import type { MarketValue } from "@/domain/market";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  PREMIUM_MARKET_INSIGHTS,
  praktijkMarktInzichten,
  type PraktijkMarktInzichten,
} from "@/server/market-monitor";
import PaywallNotice from "@/components/PaywallNotice";
import { Card, PageHeader, SectionHeading, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const ONVOLDOENDE = "onvoldoende data";
const EEN_DECIMAAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

function formatWaarde(waarde: MarketValue, opties?: { procent?: boolean }): string {
  if (waarde.insufficientData || waarde.value === null) return ONVOLDOENDE;
  if (opties?.procent) return `${EEN_DECIMAAL.format(waarde.value * 100)}%`;
  return EEN_DECIMAAL.format(waarde.value);
}

function BenchmarkRij({
  naam,
  eigen,
  regio,
  procent,
}: {
  naam: string;
  eigen: MarketValue;
  regio: MarketValue;
  procent?: boolean;
}) {
  return (
    <tr className="border-b border-ink/5 last:border-0">
      <td className="py-2 pr-4 text-ink/80">{naam}</td>
      <td className="py-2 pr-4 text-right font-semibold tabular-nums text-ink">
        {formatWaarde(eigen, { procent })}
      </td>
      <td className="py-2 text-right tabular-nums text-ink/70">
        {formatWaarde(regio, { procent })}
      </td>
    </tr>
  );
}

/** Statische, niet-bedienbare preview achter de paywall-blur. */
function PreviewInhoud() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-ink">Jouw regio in beeld</h3>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-ink/5">
              <td className="py-2 text-ink/80">Kandidaten in jouw regio</td>
              <td className="py-2 text-right font-semibold">24</td>
            </tr>
            <tr className="border-b border-ink/5">
              <td className="py-2 text-ink/80">Openstaande vacatures</td>
              <td className="py-2 text-right font-semibold">11</td>
            </tr>
            <tr>
              <td className="py-2 text-ink/80">Mediane reactietijd in de regio</td>
              <td className="py-2 text-right font-semibold">3 dagen</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-ink">Benchmark: jouw praktijk vs. regio</h3>
        <p className="text-sm text-ink/70">
          Vergelijk je reactietijd, fill rate en geboden uren met de regio-mediaan.
        </p>
      </Card>
    </div>
  );
}

function InzichtenWeergave({ inzichten }: { inzichten: PraktijkMarktInzichten }) {
  return (
    <div className="flex flex-col gap-10">
      {/* Organisatiebenchmark */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Benchmark"
          title="Jouw praktijk vs. de"
          accent="regio-mediaan"
          description="Eigen cijfers komen uit je eigen pipeline; regiocijfers zijn privacyveilige aggregaties."
        />
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                  <th className="py-2 pr-4">Meting</th>
                  <th className="py-2 pr-4 text-right">Jouw praktijk</th>
                  <th className="py-2 text-right">Regio-mediaan</th>
                </tr>
              </thead>
              <tbody>
                <BenchmarkRij
                  naam="Reactietijd (dagen tot eerste reactie)"
                  eigen={inzichten.organisatie.eigenTimeToResponse}
                  regio={inzichten.organisatie.regioTimeToResponse}
                />
                <BenchmarkRij
                  naam="Fill rate (aandeel vervulde vacatures)"
                  eigen={inzichten.organisatie.eigenFillRate}
                  regio={inzichten.organisatie.regioFillRate}
                  procent
                />
              </tbody>
            </table>
          </div>
        </Card>
        {inzichten.locaties.length > 0 ? (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                    <th className="py-2 pr-4">Locatie</th>
                    <th className="py-2 pr-4">Regio</th>
                    <th className="py-2 pr-4 text-right">Actieve vacatures</th>
                    <th className="py-2 pr-4 text-right">Uren (eigen mediaan)</th>
                    <th className="py-2 text-right">Uren (regio-mediaan)</th>
                  </tr>
                </thead>
                <tbody>
                  {inzichten.locaties.map((locatie) => (
                    <tr key={`${locatie.locatieNaam}-${locatie.stad}`} className="border-b border-ink/5 last:border-0">
                      <td className="py-2 pr-4 font-medium text-ink">
                        {locatie.locatieNaam}
                        <span className="block text-xs text-ink/50">{locatie.stad}</span>
                      </td>
                      <td className="py-2 pr-4 text-ink/70">{locatie.regio}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{locatie.actieveVacatures}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatWaarde(locatie.eigenUrenMediaan)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatWaarde(locatie.regioUrenMediaan)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </section>

      {/* Regionaal */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Regionaal" title="De arbeidsmarkt in jouw" accent="regio" />
        {inzichten.regios.length === 0 ? (
          <Card>
            <p className="text-sm text-ink/70">
              Nog geen regionale cijfers voor jouw regio — {ONVOLDOENDE}.
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {inzichten.regios.map((rij) => (
              <Card key={rij.dimensionKey} className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold text-ink">{rij.dimensionKey}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-ink/5">
                      <td className="py-2 text-ink/80">Actieve kandidaten</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.kandidaten)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 text-ink/80">Openstaande vacatures</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.vacaturesActief)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {rij.data.kandidatenPerRol.entries.length > 0 ? (
                  <p className="text-sm text-ink/70">
                    Kandidaten per functie:{" "}
                    {rij.data.kandidatenPerRol.entries
                      .map((e) => `${label(e.key)}: ${e.count === null ? "—" : e.count}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Functies */}
      <section className="flex flex-col gap-4">
        <SectionHeading eyebrow="Functies" title="Marktbeeld voor jouw" accent="functies" />
        {inzichten.functies.length === 0 ? (
          <Card>
            <p className="text-sm text-ink/70">
              Plaats een vacature om het marktbeeld voor die functie te zien.
            </p>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {inzichten.functies.map((rij) => (
              <Card key={rij.dimensionKey} className="flex flex-col gap-3">
                <h3 className="text-lg font-semibold text-ink">{label(rij.dimensionKey)}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-ink/5">
                      <td className="py-2 text-ink/80">Kandidaten</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.kandidaten)}
                      </td>
                    </tr>
                    <tr className="border-b border-ink/5">
                      <td className="py-2 text-ink/80">Openstaande vacatures</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.vacaturesActief)}
                      </td>
                    </tr>
                    <tr className="border-b border-ink/5">
                      <td className="py-2 text-ink/80">Mediane gewenste uren (kandidaten)</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.urenMediaanKandidaat)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 text-ink/80">Mediane maximale reistijd (min)</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatWaarde(rij.data.reistijdMediaan)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className={cx("text-sm", "text-ink/70")}>
                  Kandidaten per openstaande vacature:{" "}
                  <span className="font-semibold text-ink">
                    {rij.data.kandidatenPerVacature === null
                      ? ONVOLDOENDE
                      : EEN_DECIMAAL.format(rij.data.kandidatenPerVacature)}
                  </span>
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="text-sm leading-relaxed text-ink/60">
        Privacy: alle marktcijfers zijn geaggregeerd; groepen kleiner dan{" "}
        {inzichten.minGroupSize} worden nooit getoond, zodat individuele
        kandidaten niet herleidbaar zijn. Peilmaand {inzichten.period}.
      </p>
    </div>
  );
}

export default async function InzichtenPagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Zelfde poort als elders: membership + capability, ook zonder layout veilig.
  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "analytics.view");
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      notFound();
    }
    throw fout;
  }
  const { org, ctx } = toegang;

  let inzichten: PraktijkMarktInzichten | null = null;
  try {
    inzichten = await praktijkMarktInzichten(ctx);
  } catch (fout) {
    if (!(fout instanceof EntitlementError)) throw fout;
    // Geen entitlement → paywall met preview; PaywallNotice meldt zelf
    // paywall_viewed (het enige meetpunt van deze pagina).
    inzichten = null;
  }

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Markt"
        accent="inzichten"
        description={`Hoe staat de arbeidsmarkt ervoor in jouw regio en voor jouw functies — en hoe doet ${org.name} het ten opzichte van de regio? Alle cijfers zijn geaggregeerd en privacyveilig (minimumgroep ${TALENT_RADAR_MIN_GROUP}).`}
      />

      {inzichten ? (
        <InzichtenWeergave inzichten={inzichten} />
      ) : (
        <PaywallNotice
          slug={org.slug}
          benodigd={PREMIUM_MARKET_INSIGHTS}
          organizationId={ctx.organizationId}
          titel="Marktinzichten zitten niet in je huidige plan"
          uitkomst="Zie hoeveel kandidaten er in jouw regio beschikbaar zijn, welke dagen schaars zijn en hoe jouw reactietijd en fill rate zich verhouden tot de regio-mediaan."
        >
          <PreviewInhoud />
        </PaywallNotice>
      )}
    </div>
  );
}
