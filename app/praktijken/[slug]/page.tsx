// /praktijken/[slug] — openbare praktijkpagina (Workstream B, fase 7).
// Alleen praktijken mét publicatie-consent zijn bereikbaar: de adapter
// geeft anders null en de pagina rendert notFound(). Het echte
// consentmechanisme (vastleggen/intrekken) is backend-eigendom; deze
// pagina vertrouwt op de consent-vlag uit het read-model.
// Fotografie: abstracte eigen vorm (PracticeVisual) volgens
// PHOTOGRAPHY_DIRECTION — geen stockfoto's.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui";
import { Breadcrumbs } from "@/public-site/Breadcrumbs";
import { JobCard } from "@/public-site/JobCard";
import { JsonLd } from "@/public-site/JsonLd";
import { PracticeVisual } from "@/public-site/PracticeVisual";
import { PublicShell } from "@/public-site/PublicShell";
import { TrackedLink } from "@/public-site/TrackedLink";
import { getPublicDataSource } from "@/public-site/data/adapter";
import type { PublicTag } from "@/public-site/data/types";
import { paginaMetadata, placeJsonLd } from "@/public-site/seo";

interface PaginaProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { slug } = await params;
  const praktijk = await getPublicDataSource().getPractice(slug);
  if (!praktijk) return { title: "Praktijk niet gevonden — mondzorgwerkt" };
  return paginaMetadata({
    titel: `${praktijk.name} — ${praktijk.locations[0]?.city ?? ""} | mondzorgwerkt`,
    beschrijving: praktijk.description.slice(0, 160),
    pad: `/praktijken/${praktijk.slug}`,
  });
}

function KenmerkSectie({
  id,
  titel,
  tags,
  children,
}: {
  id: string;
  titel: string;
  tags?: PublicTag[];
  children?: React.ReactNode;
}) {
  if (!children && (!tags || tags.length === 0)) return null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 border-t border-mw-border/70 pt-6 first:border-t-0 first:pt-0"
    >
      <h2 id={id} className="text-mw-kop-3 font-semibold text-ink">
        {titel}
      </h2>
      {tags && tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t.key}>
              <Badge tone="neutraal">{t.label}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </section>
  );
}

export default async function PraktijkPagina({ params }: PaginaProps) {
  const { slug } = await params;
  const bron = getPublicDataSource();
  const praktijk = await bron.getPractice(slug);
  if (!praktijk) notFound();

  const vacatureResultaat = await bron.getJobs({ organization: slug }, 1);
  const vacatures = vacatureResultaat.items;

  return (
    <PublicShell>
      {/* fase 9: Place-JSON-LD op praktijkpagina's (stad + postcode-4) */}
      <JsonLd data={placeJsonLd(praktijk)} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6 lg:py-14">
        {/* kruimelpad (zichtbaar + BreadcrumbList-JSON-LD) */}
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Praktijken" },
            { label: praktijk.name, href: `/praktijken/${praktijk.slug}` },
          ]}
        />

        {/* ------------------------------- kop ------------------------------- */}
        <header className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
          {/* fase 12: min-w-0 — lange namen mogen de gridkolom niet oprekken */}
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
                Praktijk
              </p>
              <h1 className="break-words text-mw-kop-1 font-semibold tracking-tight text-ink">
                {praktijk.name}
              </h1>
              <p className="text-[16px] text-mw-text-muted">
                {praktijk.locations
                  .map((l) => `${l.city} · ${l.region}`)
                  .join(" — ")}
              </p>
            </div>
            <p className="max-w-[65ch] text-[16px] leading-relaxed text-ink">
              {praktijk.description}
            </p>
            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <div className="flex flex-col gap-1">
                <dt className="text-mw-klein font-medium text-mw-text-muted">
                  Behandelkamers
                </dt>
                <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {praktijk.treatmentRooms}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-mw-klein font-medium text-mw-text-muted">
                  Open vacatures
                </dt>
                <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {vacatureResultaat.total}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-mw-klein font-medium text-mw-text-muted">
                  Begeleiding
                </dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">
                  {praktijk.mentorship ? "Vaste begeleider" : "Zelfstandig"}
                </dd>
              </div>
            </dl>
          </div>
          <PracticeVisual
            seed={praktijk.slug}
            className="h-48 w-full sm:h-64 lg:h-72"
          />
        </header>

        {/* ----------------------------- kenmerken ----------------------------- */}
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-x-16">
          <div className="flex flex-col gap-6">
            <KenmerkSectie
              id="apparatuur"
              titel="Apparatuur"
              tags={praktijk.equipment}
            />
            <KenmerkSectie
              id="software"
              titel="Software"
              tags={praktijk.software}
            />
            <KenmerkSectie
              id="specialisaties"
              titel="Specialisaties"
              tags={praktijk.specializations}
            />
            <KenmerkSectie
              id="populatie"
              titel="Patiëntenpopulatie"
              tags={praktijk.population}
            />
          </div>
          <div className="flex flex-col gap-6">
            <KenmerkSectie
              id="cultuur"
              titel="Cultuur"
              tags={praktijk.culture}
            />
            <KenmerkSectie id="begeleiding" titel="Begeleiding">
              <p className="max-w-[60ch] text-[15px] leading-relaxed text-ink">
                {praktijk.mentorship
                  ? "Nieuwe collega's krijgen een vaste begeleider en een gestructureerd inwerktraject."
                  : "Je werkt hier vanaf de start zelfstandig, met korte lijnen naar collega's voor overleg."}
              </p>
            </KenmerkSectie>
            <KenmerkSectie
              id="ontwikkeling"
              titel="Ontwikkeling"
              tags={praktijk.development}
            />
            <KenmerkSectie id="locaties" titel="Locaties">
              <ul className="flex flex-col gap-1.5">
                {praktijk.locations.map((l) => (
                  <li
                    key={`${l.city}-${l.postcode4}`}
                    className="text-[15px] leading-relaxed text-ink"
                  >
                    {l.city}, {l.region} — postcodegebied {l.postcode4}
                  </li>
                ))}
              </ul>
            </KenmerkSectie>
          </div>
        </div>

        {/* ------------------------- actieve vacatures ------------------------- */}
        <section aria-labelledby="vacatures-praktijk" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="vacatures-praktijk"
              className="text-mw-kop-2 font-semibold text-ink"
            >
              Open vacatures bij {praktijk.name}
            </h2>
            <Link
              href="/vacatures"
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
            <div className="glass flex flex-col items-start gap-3 rounded-kaart p-6">
              <p className="text-[15px] leading-relaxed text-mw-text-muted">
                Deze praktijk heeft op dit moment geen openstaande vacatures.
                Maak een profiel en word gevonden zodra hier iets vrijkomt.
              </p>
              <TrackedLink
                event="public_register_clicked"
                context={{ route_type: "praktijk" }}
                href="/registreren"
                className="flex min-h-11 items-center rounded-full border border-mw-border-strong bg-white px-5 text-sm font-semibold text-ink hover:border-blauw-400"
              >
                Maak een profiel
              </TrackedLink>
            </div>
          )}
        </section>
      </div>
    </PublicShell>
  );
}
