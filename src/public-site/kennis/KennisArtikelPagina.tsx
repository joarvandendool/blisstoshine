// Gedeelde template voor alle kennispagina's (Workstream B, fase 8).
// Server component: direct antwoord bovenaan, H2-secties, methodologie-blok,
// relevante vacatures uit de adapter (gefilterd op functie/regio),
// praktijklinks, interne links naar de andere kennisartikelen en
// breadcrumbs (zichtbaar + BreadcrumbList-JSON-LD via Breadcrumbs).

import Link from "next/link";
import type { Metadata } from "next";
import { label } from "@/domain/taxonomy";
import { Breadcrumbs } from "../Breadcrumbs";
import { JobCard } from "../JobCard";
import { JsonLd } from "../JsonLd";
import { PublicShell } from "../PublicShell";
import { getPublicDataSource } from "../data/adapter";
import type { PublicJobView, PublicPracticeView } from "../data/types";
import { datum } from "../format";
import { absoluteUrl, paginaMetadata } from "../seo";
import { andereArtikelen } from "./artikelen";
import type { KennisArtikel } from "./types";

/** Metadata (title/description/canonical/OG) voor een kennisartikel. */
export function kennisMetadata(artikel: KennisArtikel): Metadata {
  return paginaMetadata({
    titel: `${artikel.titel} | mondzorgwerkt`,
    beschrijving: artikel.beschrijving,
    pad: artikel.pad,
  });
}

/** Article-JSON-LD: auteur, datums en bronperiode machineleesbaar. */
function artikelJsonLd(artikel: KennisArtikel): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: artikel.titel,
    description: artikel.beschrijving,
    inLanguage: "nl-NL",
    author: { "@type": "Organization", name: artikel.auteur },
    publisher: { "@type": "Organization", name: "mondzorgwerkt" },
    dateModified: artikel.actualisatiedatum,
    mainEntityOfPage: absoluteUrl(artikel.pad),
  };
}

/** Relevante vacatures: per gerelateerde functie/regio uit de adapter. */
async function relevanteVacatures(
  artikel: KennisArtikel,
): Promise<PublicJobView[]> {
  const bron = getPublicDataSource();
  const regio = artikel.gerelateerdeRegios[0];
  const perFunctie = await Promise.all(
    artikel.gerelateerdeFuncties.map((rol) =>
      bron.getJobs({ role: rol, city: regio }, 1),
    ),
  );
  const gezien = new Set<string>();
  const uit: PublicJobView[] = [];
  for (const resultaat of perFunctie) {
    for (const job of resultaat.items) {
      if (!gezien.has(job.slug)) {
        gezien.add(job.slug);
        uit.push(job);
      }
    }
  }
  return uit.slice(0, 3);
}

/** Praktijken voor het praktijklinks-blok, regiogefilterd waar mogelijk. */
async function relevantePraktijken(
  artikel: KennisArtikel,
): Promise<PublicPracticeView[]> {
  const alle = await getPublicDataSource().getPractices();
  const regio = artikel.gerelateerdeRegios[0]?.toLowerCase();
  const inRegio = regio
    ? alle.filter((p) =>
        p.locations.some(
          (l) =>
            l.city.toLowerCase().includes(regio) ||
            l.region.toLowerCase().includes(regio),
        ),
      )
    : alle;
  return (inRegio.length > 0 ? inRegio : alle).slice(0, 3);
}

export async function KennisArtikelPagina({
  artikel,
}: {
  artikel: KennisArtikel;
}) {
  const [vacatures, praktijken] = await Promise.all([
    relevanteVacatures(artikel),
    relevantePraktijken(artikel),
  ]);
  const verderLezen = andereArtikelen(artikel);
  const hoofdFunctie = artikel.gerelateerdeFuncties[0];

  return (
    <PublicShell>
      <JsonLd data={artikelJsonLd(artikel)} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6 lg:py-14">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: artikel.categorieLabel },
            { label: artikel.titel, href: artikel.pad },
          ]}
        />

        {/* ------------------------------- kop ------------------------------- */}
        <header className="flex max-w-[70ch] flex-col gap-4">
          <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
            {artikel.categorieLabel}
          </p>
          <h1 className="text-mw-kop-1 font-semibold tracking-tight text-ink">
            {artikel.titel}
          </h1>
          <p className="text-mw-klein text-mw-text-muted">
            Door {artikel.auteur} · bijgewerkt op{" "}
            <time dateTime={artikel.actualisatiedatum}>
              {datum(artikel.actualisatiedatum)}
            </time>{" "}
            · bronperiode {artikel.bronperiode}
          </p>
        </header>

        {/* -------------------------- direct antwoord -------------------------- */}
        <section
          aria-labelledby="direct-antwoord"
          className="glass-strong max-w-[75ch] rounded-kaart border-l-4 border-blauw-600 p-6 sm:p-7"
        >
          <h2
            id="direct-antwoord"
            className="mb-2 text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700"
          >
            Het antwoord in het kort
          </h2>
          <p className="text-[17px] font-medium leading-relaxed text-ink">
            {artikel.directAntwoord}
          </p>
        </section>

        {/* ------------------------------ secties ------------------------------ */}
        <div className="flex max-w-[70ch] flex-col gap-10">
          {artikel.secties.map((sectie) => (
            <section key={sectie.kop} className="flex flex-col gap-4">
              <h2 className="text-mw-kop-2 font-semibold tracking-tight text-ink">
                {sectie.kop}
              </h2>
              {sectie.paragrafen.map((p, i) => (
                <p
                  key={i}
                  className="text-[16px] leading-relaxed text-ink"
                >
                  {p}
                </p>
              ))}
              {sectie.lijst ? (
                <ul className="flex flex-col gap-2.5">
                  {sectie.lijst.map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <svg
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        focusable="false"
                        className="mt-1.5 h-3.5 w-3.5 shrink-0 text-blauw-600"
                      >
                        <circle cx="8" cy="8" r="3" fill="currentColor" />
                      </svg>
                      <span className="text-[16px] leading-relaxed text-ink">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          {/* --------------------------- methodologie --------------------------- */}
          <section
            aria-labelledby="methodologie"
            className="glass flex flex-col gap-3 rounded-kaart p-6"
          >
            <h2
              id="methodologie"
              className="text-mw-kop-3 font-semibold text-ink"
            >
              Verantwoording en methode
            </h2>
            {artikel.methodologie.map((p, i) => (
              <p
                key={i}
                className="text-[15px] leading-relaxed text-mw-text-muted"
              >
                {p}
              </p>
            ))}
            <p className="text-mw-klein text-mw-text-muted">
              Auteur: {artikel.auteur} · bronperiode {artikel.bronperiode} ·
              laatst bijgewerkt op{" "}
              <time dateTime={artikel.actualisatiedatum}>
                {datum(artikel.actualisatiedatum)}
              </time>
              .
            </p>
          </section>
        </div>

        {/* -------------------------- relevante vacatures -------------------------- */}
        <section aria-labelledby="kennis-vacatures" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="kennis-vacatures"
              className="text-mw-kop-2 font-semibold text-ink"
            >
              Actuele vacatures{hoofdFunctie ? ` voor ${label(hoofdFunctie).toLowerCase()}en` : ""}
              {artikel.gerelateerdeRegios[0]
                ? ` in ${artikel.gerelateerdeRegios[0]}`
                : ""}
            </h2>
            <Link
              href={
                hoofdFunctie
                  ? `/vacatures?functie=${hoofdFunctie}${
                      artikel.gerelateerdeRegios[0]
                        ? `&plaats=${encodeURIComponent(artikel.gerelateerdeRegios[0])}`
                        : ""
                    }`
                  : "/vacatures"
              }
              className="flex min-h-11 items-center gap-1 rounded-md text-[15px] font-semibold text-blauw-700 underline-offset-4 hover:underline"
            >
              Alle vacatures
              <span aria-hidden="true">→</span>
            </Link>
          </div>
          {vacatures.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {vacatures.map((job) => (
                <JobCard key={job.slug} job={job} />
              ))}
            </div>
          ) : (
            <p className="text-[15px] leading-relaxed text-mw-text-muted">
              Op dit moment staan er geen passende vacatures open.{" "}
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

        {/* ------------------------------ praktijken ------------------------------ */}
        {praktijken.length > 0 ? (
          <section aria-labelledby="kennis-praktijken" className="flex flex-col gap-4">
            <h2
              id="kennis-praktijken"
              className="text-mw-kop-3 font-semibold text-ink"
            >
              Praktijken die zich voorstellen
            </h2>
            <ul className="flex flex-wrap gap-2">
              {praktijken.map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/praktijken/${p.slug}`}
                    className="flex min-h-11 items-center rounded-full border border-mw-border-strong bg-white px-4 text-sm font-medium text-ink hover:border-blauw-400"
                  >
                    {p.name} — {p.locations[0]?.city}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ------------------------------ verder lezen ------------------------------ */}
        <section
          aria-labelledby="verder-lezen"
          className="flex flex-col gap-4 border-t border-mw-border/70 pt-8"
        >
          <h2 id="verder-lezen" className="text-mw-kop-3 font-semibold text-ink">
            Verder lezen in de kennisbank
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {verderLezen.map((a) => (
              <li key={a.pad}>
                <Link
                  href={a.pad}
                  className="flex min-h-11 items-center gap-2 rounded-md text-[15px] font-semibold text-blauw-700 underline-offset-4 hover:underline"
                >
                  <span
                    aria-hidden="true"
                    className="text-mw-text-muted"
                  >
                    {a.categorieLabel} ·
                  </span>
                  {a.kortLabel}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PublicShell>
  );
}
