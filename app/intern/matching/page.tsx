// Schaduwmatching-dashboard (/intern/matching) — platform-admin (fase 7).
// Vergelijkt de actieve matching-engine (v1) met de schaduwversie (v2):
// verschiltabel per categorie, geanonimiseerde top-stijgers/-dalers,
// evaluatiemetrics op echte snapshots + pipeline-uitkomsten en
// hard-mismatch-regressies (horen leeg te zijn).
//
// SCHADUWMODUS: niets op deze pagina beïnvloedt zichtbare matches. Rollback is
// niets doen; promotie van v2 kan uitsluitend via een expliciete wijziging van
// de actieve engine (src/domain/matching/engine.ts) — hier bestaat bewust geen
// promotieknop.
//
// AUTORISATIE: naast de /intern-layout doet ook deze pagina (en de server
// action) requirePlatformAdmin() — shadow-matching.ts is tenant-loos en
// vereist die afdwinging door de aanroeper.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import { ALGORITHM_VERSION } from "@/domain/matching";
import { ALGORITHM_VERSION_V2 } from "@/domain/matching/v2";
import type { EvalValue } from "@/domain/matching-eval";
import { compareShadow, runShadowBatch } from "@/server/shadow-matching";
import { Badge, Card, PageHeader, SectionHeading, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const ONVOLDOENDE = "onvoldoende data";
const EEN_DECIMAAL = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 });

const CATEGORIE_LABELS: Record<string, string> = {
  availability: "Beschikbaarheid",
  roleAndExperience: "Functie en ervaring",
  travel: "Reistijd",
  employment: "Dienstverband",
  equipmentAndSoftware: "Apparatuur en software",
  specializations: "Specialisaties",
  workplacePreferences: "Werkplekvoorkeuren",
};

function formatEval(waarde: EvalValue, opties?: { procent?: boolean; dagen?: boolean }): string {
  if (waarde.insufficientData || waarde.value === null) return ONVOLDOENDE;
  if (opties?.procent) return `${EEN_DECIMAAL.format(waarde.value * 100)}%`;
  if (opties?.dagen) return `${EEN_DECIMAAL.format(waarde.value)} dagen`;
  return EEN_DECIMAAL.format(waarde.value);
}

function EvalRij({
  naam,
  waarde,
  procent,
  dagen,
}: {
  naam: string;
  waarde: EvalValue;
  procent?: boolean;
  dagen?: boolean;
}) {
  const onvoldoende = waarde.insufficientData || waarde.value === null;
  return (
    <tr className="border-b border-ink/5 last:border-0">
      <td className="py-2 pr-4 text-ink/80">
        {naam}
        <span className="block text-xs text-ink/50">{waarde.definition}</span>
      </td>
      <td className={cx("py-2 text-right tabular-nums", onvoldoende ? "text-ink/50" : "font-semibold text-ink")}>
        {formatEval(waarde, { procent, dagen })}
      </td>
      <td className="py-2 pl-4 text-right text-xs tabular-nums text-ink/50">n={waarde.sampleSize}</td>
    </tr>
  );
}

export default async function MatchingSchaduwPagina() {
  try {
    await requirePlatformAdmin();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  const vergelijking = await compareShadow();
  const evaluatie = vergelijking.evaluatieActief;
  const regressieAantal =
    vergelijking.regressies.eligibleInBaseOnly.length +
    vergelijking.regressies.eligibleInShadowOnly.length;

  async function draaiSchaduwbatchAction() {
    "use server";
    await requirePlatformAdmin();
    await runShadowBatch(25);
    revalidatePath("/intern/matching");
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Duidelijke banner: schaduwmodus */}
      <div
        role="status"
        className="flex items-center gap-3 rounded-2xl border border-blauw-600/30 bg-brand-light/60 px-5 py-3 text-[15px] font-medium text-blauw-700"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-blauw-600" />
        Schaduwmodus — beïnvloedt geen zichtbare matches. Rollback is niets
        promoten; promotie kan alleen via een expliciete wijziging van de
        actieve engine.
      </div>

      <PageHeader
        title="Matching"
        accent="schaduwvergelijking"
        description="De schaduwengine draait naast de actieve versie over dezelfde kandidatenpool; alle verschillen hieronder zijn vrijblijvend en geanonimiseerd."
        actions={
          <form action={draaiSchaduwbatchAction}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blauw-600 px-5 py-2.5 text-sm font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Draai schaduwbatch
            </button>
          </form>
        }
      />

      {/* Versies en omvang */}
      <div className="grid gap-6 sm:grid-cols-3">
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">Actieve versie</span>
          <span className="text-2xl font-semibold text-ink">{ALGORITHM_VERSION}</span>
          <Badge tone="blauw" className="self-start">actief</Badge>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">Schaduwversie</span>
          <span className="text-2xl font-semibold text-ink">{ALGORITHM_VERSION_V2}</span>
          <Badge tone="neutraal" className="self-start">schaduw</Badge>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">Vergeleken</span>
          <span className="text-2xl font-semibold tabular-nums text-ink">{vergelijking.paren}</span>
          <span className="text-sm text-ink/60">
            kandidaat-vacatureparen over {vergelijking.vacatures} vacatures
            {vergelijking.gemiddeldScoreDelta !== null
              ? ` · gemiddeld scoreverschil ${vergelijking.gemiddeldScoreDelta > 0 ? "+" : ""}${EEN_DECIMAAL.format(vergelijking.gemiddeldScoreDelta)}`
              : ""}
          </span>
        </Card>
      </div>

      {vergelijking.paren === 0 ? (
        <Card>
          <p className="text-[15px] text-ink/70">
            Er zijn nog geen schaduwscores. Draai een schaduwbatch om v1 en v2
            over de gepubliceerde vacatures te vergelijken.
          </p>
        </Card>
      ) : (
        <>
          {/* Verschiltabel per categorie */}
          <section className="flex flex-col gap-4">
            <SectionHeading eyebrow="Verschillen" title="Gemiddeld scoreverschil per" accent="categorie" />
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                      <th className="py-2 pr-4">Categorie</th>
                      <th className="py-2 pr-4 text-right">Gemiddeld Δ (v2 − v1)</th>
                      <th className="py-2">Verklaring</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vergelijking.perCategorie.map((rij) => (
                      <tr key={rij.categorie} className="border-b border-ink/5 last:border-0">
                        <td className="py-2 pr-4 font-medium text-ink">
                          {CATEGORIE_LABELS[rij.categorie] ?? rij.categorie}
                        </td>
                        <td
                          className={cx(
                            "py-2 pr-4 text-right tabular-nums",
                            rij.gemiddeldDelta > 0
                              ? "text-blauw-700"
                              : rij.gemiddeldDelta < 0
                                ? "text-roze-500"
                                : "text-ink/60",
                          )}
                        >
                          {rij.gemiddeldDelta > 0 ? "+" : ""}
                          {EEN_DECIMAAL.format(rij.gemiddeldDelta)}
                        </td>
                        <td className="py-2 text-ink/70">
                          {rij.verklaring ?? "Regels ongewijzigd in v2."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>

          {/* Top-stijgers en -dalers, geanonimiseerd */}
          <section className="flex flex-col gap-4">
            <SectionHeading
              eyebrow="Uitschieters"
              title="Grootste stijgers en"
              accent="dalers"
              description="Alleen pseudoniemen — geen kandidaatnamen of herleidbare gegevens."
            />
            <div className="grid gap-6 lg:grid-cols-2">
              {(
                [
                  { titel: "Stijgers", lijst: vergelijking.topStijgers },
                  { titel: "Dalers", lijst: vergelijking.topDalers },
                ] as const
              ).map(({ titel, lijst }) => (
                <Card key={titel} className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-ink">{titel}</h3>
                  {lijst.length === 0 ? (
                    <p className="text-sm text-ink/60">Geen {titel.toLowerCase()}.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {lijst.map((mover) => (
                          <tr key={mover.pseudoniem} className="border-b border-ink/5 last:border-0">
                            <td className="py-2 pr-4 font-mono text-xs text-ink/70">{mover.pseudoniem}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-ink/70">
                              {mover.baseScore} → {mover.shadowScore}
                            </td>
                            <td
                              className={cx(
                                "py-2 text-right font-semibold tabular-nums",
                                mover.delta > 0 ? "text-blauw-700" : "text-roze-500",
                              )}
                            >
                              {mover.delta > 0 ? "+" : ""}
                              {mover.delta}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              ))}
            </div>
          </section>

          {/* Hard-mismatch-regressies */}
          <section className="flex flex-col gap-4">
            <SectionHeading eyebrow="Contract" title="Hard-mismatch-" accent="regressies" />
            <Card className="flex flex-col gap-2">
              {regressieAantal === 0 ? (
                <p className="text-[15px] text-ink/80">
                  <span aria-hidden="true" className="mr-1 font-semibold text-blauw-600">✓</span>
                  Geen regressies: alle {vergelijking.regressies.totalPairs}{" "}
                  vergeleken paren hebben identieke eligibility in v1 en v2 —
                  precies wat het contract van de schaduwversie vereist.
                </p>
              ) : (
                <>
                  <p className="text-[15px] font-semibold text-roze-500">
                    {regressieAantal} regressie{regressieAantal === 1 ? "" : "s"} gevonden — v2 mag niet
                    gepromoveerd worden zolang dit niet nul is.
                  </p>
                  <p className="text-sm text-ink/70">
                    Eligible in v1 maar niet in v2:{" "}
                    {vergelijking.regressies.eligibleInBaseOnly.length} · eligible in v2 maar niet in v1:{" "}
                    {vergelijking.regressies.eligibleInShadowOnly.length}
                  </p>
                </>
              )}
            </Card>
          </section>
        </>
      )}

      {/* Evaluatie van de actieve versie */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Evaluatie"
          title="Actieve versie op echte"
          accent="uitkomsten"
          description={`Gemeten over ${evaluatie.snapshotCount} MatchSnapshots (versie ${evaluatie.version}) en het pipeline-journaal.`}
        />
        <Card>
          <table className="w-full text-sm">
            <tbody>
              <EvalRij naam="Precision@Top5" waarde={evaluatie.precisionAtTop5} procent />
              <EvalRij naam="Acceptatie uitnodigingen (top 5)" waarde={evaluatie.invitationAcceptanceTop5} procent />
              <EvalRij naam="Gespreksratio" waarde={evaluatie.interviewRate} procent />
              <EvalRij naam="Plaatsingsratio" waarde={evaluatie.placementRate} procent />
              <EvalRij naam="Time-to-interview (mediaan)" waarde={evaluatie.timeToInterviewMedianDays} dagen />
              <EvalRij naam="Time-to-hire (mediaan)" waarde={evaluatie.timeToHireMedianDays} dagen />
              <EvalRij naam="Uitlegbare matches" waarde={evaluatie.explainableShare} procent />
            </tbody>
          </table>
        </Card>
        {evaluatie.perRole.length > 0 || evaluatie.perRegio.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {(
              [
                { titel: "Per functie", segmenten: evaluatie.perRole },
                { titel: "Per regio", segmenten: evaluatie.perRegio },
              ] as const
            ).map(({ titel, segmenten }) => (
              <Card key={titel} className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-ink">{titel}</h3>
                {segmenten.length === 0 ? (
                  <p className="text-sm text-ink/60">{ONVOLDOENDE}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/60">
                        <th className="py-2 pr-4">Segment</th>
                        <th className="py-2 pr-4 text-right">Precision@Top5</th>
                        <th className="py-2 text-right">Gespreksratio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segmenten.map((segment) => (
                        <tr key={segment.segment} className="border-b border-ink/5 last:border-0">
                          <td className="py-2 pr-4 text-ink/80">{segment.segment}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {formatEval(segment.precisionAtTop5, { procent: true })}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {formatEval(segment.interviewRate, { procent: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            ))}
          </div>
        ) : null}
      </section>

      <p className="text-sm leading-relaxed text-ink/60">
        Privacy: de scoring gebruikt uitsluitend werkgerelateerde gegevens
        (geen beschermde of gevoelige persoonsgegevens) en dit dashboard toont
        uitsluitend pseudoniemen en geaggregeerde metrics met
        minimumsteekproef.
      </p>
    </div>
  );
}
