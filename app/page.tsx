// Publieke homepage (Workstream B, fase 5) — premium merkervaring volgens
// "Precision in flow" (docs/design/VISUAL_PRINCIPLES.md). Lost audit-P1 #4
// op: geen dode zoekbalk, geen hardcoded vacatures, geen onbewezen stats —
// alle inhoud komt uit de public-site-adapter en alle toegangen werken.
// Server component; client-eilanden: MatchShape (hero), WeekGrid (stap 1)
// en het mobiele menu in PublicShell.

import type { Metadata } from "next";
import Link from "next/link";
import { MatchShape } from "@/components/MatchShape";
import { WeekGrid } from "@/components/WeekGrid";
import { cx } from "@/components/ui";
import { emptyAvailability } from "@/domain/taxonomy";
import { JobCard } from "@/public-site/JobCard";
import { PublicShell } from "@/public-site/PublicShell";
import { getPublicDataSource } from "@/public-site/data/adapter";

export const metadata: Metadata = {
  title: "mondzorgwerkt — werk dat bij je week past",
  description:
    "Mondzorgwerkt matcht professionals en praktijken op dagen, vakinhoud, technologie en ambities. Stel je werkweek samen en ontdek waarom een praktijk past.",
};

/* ------------------------- demonstratiedata stap 1 ------------------------ */
/* Een kleine, echte WeekGrid-compositie (readonly) die laat zien hoe een
   kandidaat zijn week samenstelt — geen screenshot, het echte component. */

function demoWerkweek() {
  const week = emptyAvailability();
  week.di.ochtend = "preferred";
  week.di.middag = "preferred";
  week.do.ochtend = "preferred";
  week.do.middag = "available";
  week.ma.ochtend = "available";
  week.vr.ochtend = "available";
  return week;
}

/* ---------------------------- stap 2: balkjes ----------------------------- */

const MATCH_DIMENSIES = [
  { naam: "Werkdagen", procent: 96 },
  { naam: "Reisafstand", procent: 88 },
  { naam: "Vakinhoud", procent: 92 },
  { naam: "Technologie", procent: 74 },
  { naam: "Cultuur", procent: 85 },
] as const;

function DimensieBalk({ naam, procent }: { naam: string; procent: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-mw-klein font-medium text-ink/80">
        {naam}
      </span>
      <div
        role="img"
        aria-label={`${naam}: ${procent} procent`}
        className="h-2 flex-1 overflow-hidden rounded-full bg-brand-light/80"
      >
        <div
          className="h-full rounded-full bg-blauw-600"
          style={{ width: `${procent}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-mw-klein font-semibold tabular-nums text-ink">
        {procent}%
      </span>
    </div>
  );
}

/* --------------------------------- pagina --------------------------------- */

export default async function Home() {
  const bron = getPublicDataSource();
  const [vacatureResultaat, praktijken] = await Promise.all([
    bron.getJobs({}, 1),
    bron.getPractices(),
  ]);
  const uitgelicht = vacatureResultaat.items.slice(0, 3);

  return (
    <PublicShell>
      {/* ------------------------------ hero ------------------------------ */}
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:pb-24 lg:pt-24">
        <div className="flex max-w-xl flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.5rem]">
            Werk dat bij je{" "}
            <em className="accent-serif text-blauw-600">week</em> past.
          </h1>
          <p className="max-w-[46ch] text-lg leading-relaxed text-mw-text-muted">
            Mondzorgwerkt matcht professionals en praktijken op dagen,
            vakinhoud, technologie en ambities.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/registreren"
              className="inline-flex min-h-12 items-center rounded-full bg-blauw-600 px-7 text-base font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-(--motion-instant) hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Ontdek mijn matches
            </Link>
            <Link
              href="/registreren?type=praktijk"
              className="inline-flex min-h-12 items-center rounded-full border border-mw-border-strong bg-white px-7 text-base font-semibold text-ink transition-colors duration-(--motion-instant) hover:border-blauw-400 motion-reduce:transition-none"
            >
              Vind passende professionals
            </Link>
          </div>
        </div>

        {/* Het enige vloeibare heldenobject: de Match Shape. */}
        <div className="flex flex-col items-center gap-3 justify-self-center lg:justify-self-end">
          <MatchShape
            score={87}
            size="hero"
            dimensions={{
              availability: 0.96,
              location: 0.88,
              content: 0.92,
              technology: 0.74,
              culture: 0.85,
            }}
          />
          <p className="max-w-[30ch] text-center text-mw-klein text-mw-text-muted">
            Twee vormen, één overlap: hoe meer jouw week en de praktijk
            overlappen, hoe sterker de match.
          </p>
        </div>
      </section>

      {/* --------------------------- drie stappen --------------------------- */}
      <section
        aria-labelledby="zo-werkt-het"
        className="border-y border-mw-border/60 bg-white/60"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:py-20">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
              Zo werkt het
            </p>
            <h2 id="zo-werkt-het" className="text-mw-kop-2 font-semibold text-ink">
              Van werkweek naar uitgelegde match, in drie stappen
            </h2>
          </div>

          <ol className="grid gap-5 lg:grid-cols-3">
            <li className="glass flex flex-col gap-4 rounded-kaart p-6">
              <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-mw-text-muted">
                Stap 1
              </p>
              <h3 className="text-mw-kop-3 font-semibold text-ink">
                Stel je werkweek samen
              </h3>
              <p className="text-[15px] leading-relaxed text-mw-text-muted">
                Kies per dag en dagdeel wat je voorkeur heeft en wat kan.
                Jouw week is het startpunt — niet de vacaturetekst.
              </p>
              <div className="mt-auto rounded-2xl bg-white/70 p-3">
                <WeekGrid
                  mode="readonly"
                  variant="candidate"
                  value={demoWerkweek()}
                  compact
                />
              </div>
            </li>

            <li className="glass flex flex-col gap-4 rounded-kaart p-6">
              <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-mw-text-muted">
                Stap 2
              </p>
              <h3 className="text-mw-kop-3 font-semibold text-ink">
                Ontdek waarom het past
              </h3>
              <p className="text-[15px] leading-relaxed text-mw-text-muted">
                Elke match wordt uitgelegd per dimensie: werkdagen,
                reisafstand, vakinhoud, technologie en cultuur. Geen zwarte
                doos.
              </p>
              <div className="mt-auto flex flex-col gap-2.5 rounded-2xl bg-white/70 p-4">
                {MATCH_DIMENSIES.map((d) => (
                  <DimensieBalk key={d.naam} naam={d.naam} procent={d.procent} />
                ))}
              </div>
            </li>

            <li className="glass flex flex-col gap-4 rounded-kaart p-6">
              <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-mw-text-muted">
                Stap 3
              </p>
              <h3 className="text-mw-kop-3 font-semibold text-ink">
                Kom direct in contact
              </h3>
              <p className="text-[15px] leading-relaxed text-mw-text-muted">
                Praktijken nodigen je uit op basis van je week en profiel —
                of je solliciteert zelf. Zonder tussenlagen, in jouw tempo.
              </p>
              <div
                aria-hidden="true"
                className="mt-auto flex flex-col gap-2 rounded-2xl bg-white/70 p-4"
              >
                <p className="text-mw-micro font-semibold uppercase tracking-[0.12em] text-mw-text-muted">
                  Voorbeeld
                </p>
                <p className="text-[15px] font-medium leading-relaxed text-ink">
                  “We zoeken versterking op dinsdag en donderdag — jouw week
                  past opvallend goed bij ons team.”
                </p>
                <p className="text-mw-klein text-mw-text-muted">
                  Uitnodiging voor een kennismaking
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {/* -------------------------- actuele vacatures ------------------------ */}
      <section
        aria-labelledby="actuele-vacatures"
        className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 lg:py-20"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
              Vacatures
            </p>
            <h2
              id="actuele-vacatures"
              className="text-mw-kop-2 font-semibold text-ink"
            >
              Actueel op het platform
            </h2>
          </div>
          <Link
            href="/vacatures"
            className="flex min-h-11 items-center gap-1 rounded-md text-[15px] font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Bekijk alle vacatures
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {uitgelicht.map((job) => (
            <JobCard key={job.slug} job={job} />
          ))}
        </div>
      </section>

      {/* ----------------------------- praktijken ---------------------------- */}
      <section
        aria-labelledby="praktijken"
        className="border-t border-mw-border/60 bg-white/60"
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6 lg:py-20">
          <div className="flex max-w-2xl flex-col gap-3">
            <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
              Praktijken
            </p>
            <h2 id="praktijken" className="text-mw-kop-2 font-semibold text-ink">
              Praktijken die zich voorstellen
            </h2>
            <p className="text-[15px] leading-relaxed text-mw-text-muted">
              Praktijken kiezen zelf of ze zich publiek presenteren — met
              team, technologie en cultuur, niet alleen een vacaturetekst.
            </p>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {praktijken.map((praktijk) => (
              <li key={praktijk.slug}>
                <Link
                  href={`/praktijken/${praktijk.slug}`}
                  className={cx(
                    "glass flex h-full flex-col gap-2 rounded-kaart p-6",
                    "transition-shadow duration-(--motion-base) motion-reduce:transition-none hover:shadow-(--shadow-glass-strong)",
                  )}
                >
                  <span className="text-mw-kop-3 font-semibold text-ink">
                    {praktijk.name}
                  </span>
                  <span className="text-mw-klein text-mw-text-muted">
                    {praktijk.locations
                      .map((l) => `${l.city} · ${l.region}`)
                      .join(" — ")}
                  </span>
                  <span className="text-mw-klein text-mw-text-muted">
                    {praktijk.treatmentRooms} behandelkamers
                  </span>
                  <span className="mt-2 flex min-h-6 items-center gap-1 text-[15px] font-semibold text-blauw-700">
                    Bekijk praktijk
                    <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </PublicShell>
  );
}
