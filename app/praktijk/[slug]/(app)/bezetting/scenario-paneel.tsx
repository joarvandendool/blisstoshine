"use client";

// Scenario-paneel van de Praktijkbezetting: acht scenario-soorten als
// keuzekaarten, invoer per soort, resultaat naast de huidige week (voor/na)
// en expliciete bevestigen/verwerpen-knoppen. Scenario's zijn immutabel:
// het opgeslagen resultaat verandert niet meer na het draaien.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, Input, SectionHeading, Select, cx } from "@/components/ui";
import { DAYPARTS, ROLES, WEEKDAYS, label, type Daypart, type Weekday } from "@/domain/taxonomy";
import {
  bevestigScenarioAction,
  runScenarioAction,
  verwerpScenarioAction,
  type ScenarioActieResultaat,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Props en types                                                      */
/* ------------------------------------------------------------------ */

export interface ScenarioSamenvattingClient {
  volledig: number;
  gedeeltelijk: number;
  open: number;
  tekortVerwacht: number;
  totaalTekort: number;
}

export interface ScenarioOverzichtItem {
  id: string;
  name: string;
  kind: string;
  status: string; // simulatie | bevestigd | verworpen
  createdAt: string; // ISO
  before: ScenarioSamenvattingClient | null;
  after: ScenarioSamenvattingClient | null;
  afterGaps: number;
  kandidaten: number;
}

export interface ScenarioPaneelProps {
  slug: string;
  locatieId: string;
  locaties: Array<{ id: string; name: string }>;
  teamleden: Array<{ id: string; name: string }>;
  scenarios: ScenarioOverzichtItem[];
}

const KIND_KAARTEN: Array<{ kind: string; titel: string; omschrijving: string }> = [
  { kind: "uitval", titel: "Uitval", omschrijving: "Wat als een teamlid tijdelijk uitvalt (ziekte, verlof)?" },
  { kind: "vertrek", titel: "Vertrek", omschrijving: "Wat als een teamlid definitief vertrekt?" },
  { kind: "extra_kamer", titel: "Extra kamer", omschrijving: "Wat levert een extra behandelkamer op?" },
  { kind: "structurele_dag", titel: "Extra dag open", omschrijving: "Structureel een dag(deel) extra open." },
  { kind: "nieuwe_locatie", titel: "Nieuwe locatie", omschrijving: "Hoeveel bezetting vraagt een nieuwe locatie?" },
  { kind: "parttime_combinatie", titel: "Parttime-combinatie", omschrijving: "Twee parttimers die samen de gaten dekken." },
  { kind: "tijdelijk", titel: "Tijdelijke behandelaar", omschrijving: "Een tijdelijke kracht voor een periode." },
  { kind: "multi_locatie", titel: "Verdeling over locaties", omschrijving: "Een teamlid (deels) op een andere locatie inzetten." },
];

const KIND_LABELS: Record<string, string> = Object.fromEntries(
  KIND_KAARTEN.map((k) => [k.kind, k.titel]),
);

const STATUS_LABEL: Record<string, string> = {
  simulatie: "Simulatie",
  bevestigd: "Bevestigd",
  verworpen: "Verworpen",
};

/* ------------------------------------------------------------------ */
/* Hoofdcomponent                                                      */
/* ------------------------------------------------------------------ */

export function ScenarioPaneel({ slug, locatieId, locaties, teamleden, scenarios }: ScenarioPaneelProps) {
  const router = useRouter();
  const [gekozenKind, setGekozenKind] = useState<string | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [resultaat, setResultaat] = useState<Extract<ScenarioActieResultaat, { ok: true }> | null>(null);
  const [bevestiging, setBevestiging] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  // Invoer per soort (bewust één platte staat — alleen relevante velden gaan mee).
  const [teamMemberId, setTeamMemberId] = useState("");
  const [vanaf, setVanaf] = useState("");
  const [totEnMet, setTotEnMet] = useState("");
  const [rol, setRol] = useState<string>(ROLES[0]);
  const [dag, setDag] = useState<Weekday>("ma");
  const [dagdelen, setDagdelen] = useState<Daypart[]>(["ochtend", "middag"]);
  const [aantal, setAantal] = useState("1");
  const [doelLocatie, setDoelLocatie] = useState("");

  const draaiScenario = (): void => {
    if (!gekozenKind) return;
    setFout(null);
    setResultaat(null);
    setBevestiging(null);

    const invoer: Record<string, unknown> = { locationId: locatieId, kind: gekozenKind };
    if (["uitval", "vertrek", "multi_locatie"].includes(gekozenKind)) {
      invoer.teamMemberId = teamMemberId || undefined;
    }
    if (["uitval", "vertrek", "tijdelijk"].includes(gekozenKind)) {
      if (vanaf) invoer.from = vanaf;
      if (totEnMet) invoer.until = totEnMet;
    }
    if (gekozenKind === "extra_kamer") invoer.extraRooms = Number.parseInt(aantal, 10) || 1;
    if (["structurele_dag", "parttime_combinatie", "tijdelijk", "nieuwe_locatie"].includes(gekozenKind)) {
      invoer.role = rol;
    }
    if (gekozenKind === "structurele_dag") {
      invoer.day = dag;
      invoer.dayparts = dagdelen;
      invoer.extraTarget = Number.parseInt(aantal, 10) || 1;
    }
    if (gekozenKind === "nieuwe_locatie") {
      invoer.treatmentRooms = Number.parseInt(aantal, 10) || 1;
    }
    if (gekozenKind === "tijdelijk") {
      // Werkdagen van de tijdelijke behandelaar: gekozen dag + dagdelen.
      const rooster: Record<string, Record<string, boolean>> = {};
      for (const d of WEEKDAYS) {
        rooster[d] = { ochtend: false, middag: false, avond: false };
      }
      for (const dp of dagdelen) rooster[dag][dp] = true;
      invoer.schedule = rooster;
    }
    if (gekozenKind === "multi_locatie") invoer.targetLocationId = doelLocatie || undefined;

    startTransition(async () => {
      const res = await runScenarioAction(slug, invoer);
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      setResultaat(res);
      router.refresh();
    });
  };

  const bevestig = (scenarioId: string): void => {
    setFout(null);
    startTransition(async () => {
      const res = await bevestigScenarioAction(slug, { scenarioId });
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      if (res.type === "vacature") {
        setBevestiging(`Conceptvacature aangemaakt: “${res.titel}”.`);
      } else if (res.type === "uitnodigingen") {
        setBevestiging(
          `Uitnodigingenlijst klaar: ${res.kandidaten} ${res.kandidaten === 1 ? "kandidaat" : "kandidaten"} uit het scenario.`,
        );
      } else {
        setBevestiging("Capaciteitsrapport vastgelegd bij het scenario.");
      }
      setResultaat(null);
      router.refresh();
    });
  };

  const verwerp = (scenarioId: string): void => {
    setFout(null);
    startTransition(async () => {
      const res = await verwerpScenarioAction(slug, scenarioId);
      if (!res.ok) {
        setFout(res.fout);
        return;
      }
      setBevestiging("Scenario verworpen.");
      setResultaat(null);
      router.refresh();
    });
  };

  const wisselDagdeel = (dagdeel: Daypart): void => {
    setDagdelen((huidig) =>
      huidig.includes(dagdeel) ? huidig.filter((d) => d !== dagdeel) : [...huidig, dagdeel],
    );
  };

  const vraagtTeamlid = gekozenKind !== null && ["uitval", "vertrek", "multi_locatie"].includes(gekozenKind);
  const vraagtPeriode = gekozenKind !== null && ["uitval", "vertrek", "tijdelijk"].includes(gekozenKind);
  const vraagtRol =
    gekozenKind !== null &&
    ["structurele_dag", "parttime_combinatie", "tijdelijk", "nieuwe_locatie"].includes(gekozenKind);
  const vraagtDag = gekozenKind === "structurele_dag" || gekozenKind === "tijdelijk";
  const vraagtAantal =
    gekozenKind === "extra_kamer" || gekozenKind === "structurele_dag" || gekozenKind === "nieuwe_locatie";
  const aantalLabel =
    gekozenKind === "extra_kamer"
      ? "Extra kamers"
      : gekozenKind === "nieuwe_locatie"
        ? "Behandelkamers"
        : "Extra teamleden";

  return (
    <section aria-labelledby="scenario-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Scenario's"
        title="Wat als"
        accent="…?"
        description="Draai een scenario naast de huidige week. Het resultaat staat vast (simulatie) tot je het expliciet bevestigt of verwerpt."
      />
      <h2 id="scenario-titel" className="sr-only">
        Staffing-scenario's
      </h2>

      {/* keuzekaarten */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {KIND_KAARTEN.map((kaart) => {
          const actief = gekozenKind === kaart.kind;
          return (
            <button
              key={kaart.kind}
              type="button"
              aria-pressed={actief}
              onClick={() => {
                setGekozenKind(actief ? null : kaart.kind);
                setFout(null);
                setResultaat(null);
                setBevestiging(null);
              }}
              className={cx(
                "flex h-full flex-col gap-1 rounded-kaart border p-4 text-left",
                "transition-colors duration-150 motion-reduce:transition-none",
                actief
                  ? "border-blauw-600 bg-brand-light/60 ring-2 ring-blauw-600"
                  : "border-ink/10 bg-white/70 hover:bg-white",
              )}
            >
              <span className="text-sm font-semibold text-ink">{kaart.titel}</span>
              <span className="text-xs leading-relaxed text-ink/60">{kaart.omschrijving}</span>
            </button>
          );
        })}
      </div>

      {/* invoer per soort */}
      {gekozenKind ? (
        <Card className="flex flex-col gap-4">
          <h3 className="text-base font-semibold text-ink">
            {KIND_LABELS[gekozenKind]} — invoer
          </h3>
          <div className="flex flex-wrap items-end gap-4">
            {vraagtTeamlid ? (
              <Field label="Teamlid" htmlFor="scenario-teamlid" className="w-full sm:w-64">
                <Select
                  id="scenario-teamlid"
                  value={teamMemberId}
                  onChange={(e) => setTeamMemberId(e.target.value)}
                >
                  <option value="">Kies een teamlid…</option>
                  {teamleden.map((lid) => (
                    <option key={lid.id} value={lid.id}>
                      {lid.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {gekozenKind === "multi_locatie" ? (
              <Field label="Naar locatie" htmlFor="scenario-doel" className="w-full sm:w-64">
                <Select id="scenario-doel" value={doelLocatie} onChange={(e) => setDoelLocatie(e.target.value)}>
                  <option value="">Kies een locatie…</option>
                  {locaties
                    .filter((l) => l.id !== locatieId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            {vraagtPeriode ? (
              <>
                <Field
                  label={gekozenKind === "vertrek" ? "Vertrekt per" : "Van"}
                  htmlFor="scenario-van"
                  className="w-40"
                >
                  <Input id="scenario-van" type="date" value={vanaf} onChange={(e) => setVanaf(e.target.value)} />
                </Field>
                {gekozenKind !== "vertrek" ? (
                  <Field label="Tot en met" htmlFor="scenario-tot" className="w-40">
                    <Input id="scenario-tot" type="date" value={totEnMet} onChange={(e) => setTotEnMet(e.target.value)} />
                  </Field>
                ) : null}
              </>
            ) : null}
            {vraagtRol ? (
              <Field label="Functie" htmlFor="scenario-rol" className="w-full sm:w-56">
                <Select id="scenario-rol" value={rol} onChange={(e) => setRol(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {vraagtDag ? (
              <Field label="Dag" htmlFor="scenario-dag" className="w-36">
                <Select id="scenario-dag" value={dag} onChange={(e) => setDag(e.target.value as Weekday)}>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {label(d)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {vraagtAantal ? (
              <Field label={aantalLabel} htmlFor="scenario-aantal" className="w-32">
                <Input
                  id="scenario-aantal"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={gekozenKind === "nieuwe_locatie" ? 25 : 10}
                  value={aantal}
                  onChange={(e) => setAantal(e.target.value)}
                />
              </Field>
            ) : null}
          </div>

          {vraagtDag ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="w-full text-sm font-semibold text-ink">Dagdelen</legend>
              {DAYPARTS.map((dagdeel) => {
                const aan = dagdelen.includes(dagdeel);
                return (
                  <button
                    key={dagdeel}
                    type="button"
                    aria-pressed={aan}
                    onClick={() => wisselDagdeel(dagdeel)}
                    className={cx(
                      "rounded-full border px-4 py-1.5 text-sm font-medium",
                      aan
                        ? "border-blauw-600 bg-blauw-600 text-white"
                        : "border-ink/15 bg-white/70 text-ink hover:bg-white",
                    )}
                  >
                    {label(dagdeel)}
                  </button>
                );
              })}
            </fieldset>
          ) : null}

          {gekozenKind === "parttime_combinatie" ? (
            <p className="text-sm text-ink/60">
              Dit scenario zoekt twee kandidaten die sámen alle open dagdelen van de gekozen
              functie dekken. Zonder eigen selectie gebruikt het de actuele gaten van deze week.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={draaiScenario} disabled={bezig}>
              {bezig ? "Scenario draaien …" : "Draai scenario"}
            </Button>
            <Button variant="ghost" onClick={() => setGekozenKind(null)} disabled={bezig}>
              Annuleer
            </Button>
          </div>
          {fout ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {fout}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* resultaat voor/na van de zojuist gedraaide simulatie */}
      {resultaat ? (
        <Card strong className="flex flex-col gap-4 border border-blauw-200">
          <h3 className="text-base font-semibold text-ink">Resultaat (simulatie)</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <VoorNaKolom titel="Huidige week" samenvatting={resultaat.before} />
            <VoorNaKolom titel="Na het scenario" samenvatting={resultaat.after} />
          </div>
          <p className="text-sm text-ink/70">
            {resultaat.afterGaps === 0
              ? "Na dit scenario zijn er geen open dagdelen."
              : `Na dit scenario ${resultaat.afterGaps === 1 ? "blijft" : "blijven"} er ${resultaat.afterGaps} dagdeel${resultaat.afterGaps === 1 ? "" : "en"} met een tekort.`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => bevestig(resultaat.scenarioId)} disabled={bezig}>
              Bevestig scenario
            </Button>
            <Button variant="ghost" onClick={() => verwerp(resultaat.scenarioId)} disabled={bezig}>
              Verwerp
            </Button>
          </div>
        </Card>
      ) : null}

      {bevestiging ? (
        <Card role="status" className="border border-emerald-200 bg-emerald-50/80">
          <p className="text-sm font-medium text-emerald-900">{bevestiging}</p>
        </Card>
      ) : null}

      {/* eerdere scenario's */}
      {scenarios.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <h3 className="text-base font-semibold text-ink">Eerdere scenario's</h3>
          <ul className="flex flex-col divide-y divide-ink/10">
            {scenarios.map((scenario) => (
              <li key={scenario.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">{scenario.name}</span>
                  <span className="text-xs text-ink/60">
                    {KIND_LABELS[scenario.kind] ?? scenario.kind} ·{" "}
                    {new Date(scenario.createdAt).toLocaleDateString("nl-NL", {
                      day: "numeric",
                      month: "short",
                    })}
                    {scenario.after
                      ? ` · na: ${scenario.after.open} open, ${scenario.after.gedeeltelijk} gedeeltelijk`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={scenario.status === "bevestigd" ? "blauw" : scenario.status === "verworpen" ? "neutraal" : "roze"}>
                    {STATUS_LABEL[scenario.status] ?? scenario.status}
                  </Badge>
                  {scenario.status === "simulatie" ? (
                    <>
                      <Button size="sm" onClick={() => bevestig(scenario.id)} disabled={bezig}>
                        Bevestig
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => verwerp(scenario.id)} disabled={bezig}>
                        Verwerp
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink/50">
            Een scenario is onveranderlijk: het opgeslagen resultaat blijft staan, ook als het team
            daarna wijzigt. Bevestigen maakt afhankelijk van het soort een conceptvacature, een
            uitnodigingenlijst of een capaciteitsrapport.{" "}
            <Link href={`/praktijk/${slug}/vacatures/nieuw`} className="font-semibold text-blauw-700 underline-offset-4 hover:underline">
              Liever direct een vacature maken?
            </Link>
          </p>
        </Card>
      ) : null}
    </section>
  );
}

function VoorNaKolom({
  titel,
  samenvatting,
}: {
  titel: string;
  samenvatting: ScenarioSamenvattingClient;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-brand-light/40 p-4">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blauw-700">{titel}</span>
      <dl className="grid grid-cols-2 gap-x-4 text-sm text-ink/80">
        <dt>Volledig</dt>
        <dd className="tabular-nums font-semibold">{samenvatting.volledig}</dd>
        <dt>Gedeeltelijk</dt>
        <dd className="tabular-nums font-semibold">{samenvatting.gedeeltelijk}</dd>
        <dt>Open</dt>
        <dd className="tabular-nums font-semibold">{samenvatting.open}</dd>
        <dt>Tekort verwacht</dt>
        <dd className="tabular-nums font-semibold">{samenvatting.tekortVerwacht}</dd>
        <dt>Totaal tekort</dt>
        <dd className="tabular-nums font-semibold">{samenvatting.totaalTekort}</dd>
      </dl>
    </div>
  );
}
