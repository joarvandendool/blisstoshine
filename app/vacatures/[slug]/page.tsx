// /vacatures/[slug] — openbare vacature-detailpagina als premium mini-site
// (Workstream B, fase 6). Boven de vouw: functie/praktijk/locatie, de
// werkweek als visueel blok (WeekGrid readonly), vergoeding, abstracte
// praktijkbeeld-placeholder en de CTA's. Daarna verzorgde secties.
// Gesloten vacatures tonen een duidelijke vervuld-staat zonder
// sollicitatiemogelijkheid, met drie vergelijkbare actuele vacatures.
// GEEN persoonlijke matchscore publiek — die bestaat pas na registratie.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WeekGrid } from "@/components/WeekGrid";
import { Badge, cx } from "@/components/ui";
import { Breadcrumbs } from "@/public-site/Breadcrumbs";
import { JobCard } from "@/public-site/JobCard";
import { JsonLd } from "@/public-site/JsonLd";
import { PracticeVisual } from "@/public-site/PracticeVisual";
import { PublicShell } from "@/public-site/PublicShell";
import { TrackedLink } from "@/public-site/TrackedLink";
import { getPublicDataSource } from "@/public-site/data/adapter";
import type { PublicJobView, PublicTag } from "@/public-site/data/types";
import {
  datum,
  naarVacancySchedule,
  registrerenMetNext,
  urenRange,
  vergoeding,
} from "@/public-site/format";
import { jobPostingJsonLd, paginaMetadata } from "@/public-site/seo";

// PERF: on-demand ISR. Zonder deze exports rendert Next elke aanvraag
// opnieuw op de server; de onderliggende publieke data mag per contract al
// 300 s oud zijn (zie HttpDataSource, revalidate 300), dus een even lange
// paginacache verandert niets aan de versheidsgarantie maar haalt de
// render (en bij de http-bron ook het API/DB-pad) van het kritieke pad.
// generateStaticParams is bewust leeg: er wordt niets tijdens de build
// gerenderd (de databron draait dan nog niet); elke slug wordt bij de
// eerste aanvraag gerenderd en daarna 300 s uit de cache bediend.
export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface PaginaProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getPublicDataSource().getJob(slug);
  if (!job) return { title: "Vacature niet gevonden — mondzorgwerkt" };
  // Ook een gesloten vacature blijft indexeerbaar (met zichtbare status,
  // zonder JobPosting-markup en zonder sollicitatiemogelijkheid).
  return paginaMetadata({
    titel: `${job.title} — ${job.organization.name} | mondzorgwerkt`,
    beschrijving: `${job.role.label} in ${job.location.city} (${urenRange(job)}). ${job.description.slice(0, 140)}`,
    pad: `/vacatures/${job.slug}`,
  });
}

/* ------------------------------- bouwstenen ------------------------------- */

function Sectie({
  id,
  titel,
  children,
}: {
  id: string;
  titel: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-mw-kop-3 font-semibold text-ink">
        {titel}
      </h2>
      {children}
    </section>
  );
}

function TagGroep({ titel, tags }: { titel: string; tags: PublicTag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-mw-klein font-semibold text-mw-text-muted">
        {titel}
      </h3>
      <ul className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <li key={t.key}>
            <Badge tone="neutraal">{t.label}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VinkLijst({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
            className="mt-1 h-4 w-4 shrink-0 text-blauw-600"
          >
            <path
              d="M3 8.5 6.5 12 13 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[15px] leading-relaxed text-ink">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CtaKnoppen({ job }: { job: PublicJobView }) {
  const pad = `/vacatures/${job.slug}`;
  // fase 11: slug-loze eventcontext (alleen taxonomierol + regio).
  const context = { rol: job.role.key, regio: job.location.region };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TrackedLink
        event="public_register_clicked"
        context={context}
        href={registrerenMetNext(pad)}
        className="inline-flex min-h-12 items-center rounded-full bg-blauw-600 px-7 text-base font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-(--motion-instant) hover:bg-blauw-700 motion-reduce:transition-none"
      >
        Bekijk mijn match
      </TrackedLink>
      {job.directApply ? (
        <TrackedLink
          event="public_apply_clicked"
          context={context}
          href={registrerenMetNext(pad)}
          className="inline-flex min-h-12 items-center rounded-full border border-mw-border-strong bg-white px-7 text-base font-semibold text-ink transition-colors duration-(--motion-instant) hover:border-blauw-400 motion-reduce:transition-none"
        >
          Solliciteer direct
        </TrackedLink>
      ) : null}
    </div>
  );
}

/* --------------------------------- pagina --------------------------------- */

export default async function VacatureDetail({ params }: PaginaProps) {
  const { slug } = await params;
  const bron = getPublicDataSource();
  const job = await bron.getJob(slug);
  if (!job) notFound();

  const gesloten = job.status === "closed";
  const [praktijk, vergelijkbaarResultaat] = await Promise.all([
    bron.getPractice(job.organization.slug),
    gesloten ? bron.getJobs({ role: job.role.key }, 1) : Promise.resolve(null),
  ]);

  // Gesloten vacature: drie vergelijkbare actuele vacatures (zelfde functie,
  // aangevuld met de nieuwste andere vacatures als dat er minder dan 3 zijn).
  let vergelijkbaar: PublicJobView[] = [];
  if (gesloten && vergelijkbaarResultaat) {
    vergelijkbaar = vergelijkbaarResultaat.items.filter(
      (v) => v.slug !== job.slug,
    );
    if (vergelijkbaar.length < 3) {
      const aanvulling = await bron.getJobs({}, 1);
      for (const v of aanvulling.items) {
        if (v.slug !== job.slug && !vergelijkbaar.some((x) => x.slug === v.slug)) {
          vergelijkbaar.push(v);
        }
      }
    }
    vergelijkbaar = vergelijkbaar.slice(0, 3);
  }

  const beloning = vergoeding(job);
  const verplicht = job.requirements.filter((r) => r.level === "required");
  const bespreekbaar = job.requirements.filter((r) => r.level === "preferred");

  return (
    <PublicShell
      jobAnalyticsContext={{ rol: job.role.key, regio: job.location.region }}
    >
      {/* fase 9: JobPosting-JSON-LD UITSLUITEND bij status published,
          exact overeenkomend met de zichtbare inhoud. Gesloten vacatures
          blijven indexeerbaar maar krijgen géén JobPosting-markup. */}
      {!gesloten ? (
        <JsonLd data={jobPostingJsonLd(job, praktijk !== null)} />
      ) : null}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6 lg:py-14">
        {/* kruimelpad (zichtbaar + BreadcrumbList-JSON-LD) */}
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Vacatures", href: "/vacatures" },
            { label: job.title, href: `/vacatures/${job.slug}` },
          ]}
        />

        {gesloten ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-kaart border border-mw-border-strong bg-mw-surface-2 p-6"
          >
            <p className="text-mw-kop-3 font-semibold text-ink">
              Deze vacature is vervuld
            </p>
            <p className="text-[15px] leading-relaxed text-mw-text-muted">
              Solliciteren is niet meer mogelijk. Hieronder staan drie
              vergelijkbare vacatures die nu wél openstaan — of maak een
              profiel en laat passende praktijken jou vinden.
            </p>
          </div>
        ) : null}

        {/* --------------------------- boven de vouw --------------------------- */}
        <header className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          {/* fase 12: min-w-0 — lange woorden mogen de gridkolom niet oprekken */}
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
                {job.role.label}
              </p>
              <h1 className="break-words text-mw-kop-1 font-semibold tracking-tight text-ink">
                {job.title}
              </h1>
              <p className="text-[16px] font-medium text-ink">
                {praktijk ? (
                  <Link
                    href={`/praktijken/${praktijk.slug}`}
                    className="rounded-md text-blauw-700 underline-offset-4 hover:underline"
                  >
                    {job.organization.name}
                  </Link>
                ) : (
                  job.organization.name
                )}
                <span className="text-mw-text-muted">
                  {" "}
                  · {job.location.city}, {job.location.region}
                </span>
              </p>
            </div>

            {/* kerncijfers: uren + vergoeding, typografisch voorop */}
            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <div className="flex flex-col gap-1">
                <dt className="text-mw-klein font-medium text-mw-text-muted">
                  Uren per week
                </dt>
                <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {job.hoursMin}–{job.hoursMax}
                </dd>
              </div>
              {beloning ? (
                <div className="flex flex-col gap-1">
                  <dt className="text-mw-klein font-medium text-mw-text-muted">
                    {job.revenueShare ? "Vergoeding (zzp)" : "Salaris"}
                  </dt>
                  <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                    {beloning}
                  </dd>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <dt className="text-mw-klein font-medium text-mw-text-muted">
                  Contractvorm
                </dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">
                  {job.employmentTypes.map((t) => t.label).join(" / ")}
                </dd>
              </div>
            </dl>

            <p className="max-w-[65ch] text-[16px] leading-relaxed text-ink">
              {job.description}
            </p>

            {!gesloten ? <CtaKnoppen job={job} /> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <PracticeVisual
              seed={job.organization.slug}
              className="h-40 w-full sm:h-48"
            />
            <div className="glass flex flex-col gap-3 rounded-kaart p-5">
              <h2 className="text-mw-klein font-semibold text-ink">
                De werkweek van deze vacature
              </h2>
              <WeekGrid
                mode="readonly"
                variant="vacancy"
                value={naarVacancySchedule(job.availability)}
              />
            </div>
          </div>
        </header>

        {/* ------------------------------ secties ------------------------------ */}
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <div className="flex min-w-0 max-w-[65ch] flex-col gap-10">
            <Sectie id="werkzaamheden" titel="Werkzaamheden">
              <VinkLijst items={job.responsibilities} />
            </Sectie>

            <Sectie id="vereisten" titel="Vereisten">
              <div className="flex flex-col gap-5">
                {verplicht.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-mw-klein font-semibold text-mw-text-muted">
                      Verplicht
                    </h3>
                    <VinkLijst items={verplicht.map((r) => r.label)} />
                  </div>
                ) : null}
                {bespreekbaar.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    <h3 className="text-mw-klein font-semibold text-mw-text-muted">
                      Bespreekbaar — geen harde eis
                    </h3>
                    <ul className="flex flex-col gap-2.5">
                      {bespreekbaar.map((r) => (
                        <li key={r.label} className="flex items-start gap-2.5">
                          <svg
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                            focusable="false"
                            className="mt-1 h-4 w-4 shrink-0 text-mw-text-muted"
                          >
                            <circle
                              cx="8"
                              cy="8"
                              r="5.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeDasharray="2.4 2.4"
                            />
                          </svg>
                          <span className="text-[15px] leading-relaxed text-ink">
                            {r.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Sectie>

            {job.equipment.length + job.software.length + job.specializations.length >
            0 ? (
              <Sectie id="techniek" titel="Apparatuur, software en specialisaties">
                <div className="flex flex-col gap-4">
                  <TagGroep titel="Apparatuur" tags={job.equipment} />
                  <TagGroep titel="Software" tags={job.software} />
                  <TagGroep titel="Specialisaties" tags={job.specializations} />
                </div>
              </Sectie>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-10">
            <Sectie id="team-cultuur" titel="Team en cultuur">
              <div className="glass flex flex-col gap-4 rounded-kaart p-5">
                <TagGroep titel="Zo werkt dit team" tags={job.culture} />
                {praktijk ? (
                  <p className="text-[15px] leading-relaxed text-mw-text-muted">
                    {praktijk.description}
                  </p>
                ) : null}
              </div>
            </Sectie>

            <Sectie id="ontwikkeling" titel="Begeleiding en ontwikkeling">
              <div className="glass flex flex-col gap-4 rounded-kaart p-5">
                <p className="text-[15px] leading-relaxed text-ink">
                  {job.mentorship
                    ? "Je krijgt een vaste begeleider en een ingewerkt inwerktraject."
                    : "Je werkt vanaf de start zelfstandig, met korte lijnen naar collega's."}
                </p>
                <TagGroep titel="Ontwikkelmogelijkheden" tags={job.development} />
              </div>
            </Sectie>

            <Sectie id="bereikbaarheid" titel="Bereikbaarheid">
              <p className="text-[15px] leading-relaxed text-ink">
                {job.location.city} ({job.location.region}), postcodegebied{" "}
                {job.location.postcode4}. Maak een profiel om je reistijd per
                werkdag mee te laten wegen in je match.
              </p>
            </Sectie>
          </div>
        </div>

        {/* --------------------------- sollicitatieblok --------------------------- */}
        {!gesloten ? (
          <section
            aria-labelledby="solliciteren"
            className="rounded-kaart-xl bg-blauw-600 p-8 text-white sm:p-10"
          >
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex max-w-xl flex-col gap-2">
                <h2 id="solliciteren" className="text-mw-kop-2 font-semibold">
                  Past dit bij jouw week?
                </h2>
                <p className="text-[15px] leading-relaxed text-blauw-100">
                  Maak een gratis profiel en zie meteen hoe deze vacature
                  scoort op jouw werkdagen, vakinhoud en reistijd — of
                  solliciteer direct bij {job.organization.name}.
                </p>
                <p className="text-mw-klein text-blauw-200">
                  Geplaatst op {datum(job.datePosted)}
                  {job.validThrough
                    ? ` · reageren kan tot ${datum(job.validThrough)}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <TrackedLink
                  event="public_register_clicked"
                  context={{ rol: job.role.key, regio: job.location.region }}
                  href={registrerenMetNext(`/vacatures/${job.slug}`)}
                  className="inline-flex min-h-12 items-center rounded-full bg-white px-7 text-base font-semibold text-blauw-700 transition-colors duration-(--motion-instant) hover:bg-brand-light motion-reduce:transition-none"
                >
                  Bekijk mijn match
                </TrackedLink>
                {job.directApply ? (
                  <TrackedLink
                    event="public_apply_clicked"
                    context={{ rol: job.role.key, regio: job.location.region }}
                    href={registrerenMetNext(`/vacatures/${job.slug}`)}
                    className="inline-flex min-h-12 items-center rounded-full border border-white/40 px-7 text-base font-semibold text-white transition-colors duration-(--motion-instant) hover:bg-white/10 motion-reduce:transition-none"
                  >
                    Solliciteer direct
                  </TrackedLink>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section
            aria-labelledby="vergelijkbaar"
            className="flex flex-col gap-6"
          >
            <h2 id="vergelijkbaar" className="text-mw-kop-2 font-semibold text-ink">
              Vergelijkbare vacatures die nu openstaan
            </h2>
            {vergelijkbaar.length > 0 ? (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {vergelijkbaar.map((v) => (
                  <JobCard key={v.slug} job={v} />
                ))}
              </div>
            ) : (
              <p className={cx("text-[15px] text-mw-text-muted")}>
                Op dit moment staan er geen vergelijkbare vacatures open.{" "}
                <Link
                  href="/vacatures"
                  className="font-semibold text-blauw-700 underline-offset-4 hover:underline"
                >
                  Bekijk alle vacatures
                </Link>
                .
              </p>
            )}
          </section>
        )}
      </div>
    </PublicShell>
  );
}
