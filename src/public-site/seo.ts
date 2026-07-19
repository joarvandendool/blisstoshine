// SEO-hulpen voor de openbare site (Workstream B, fase 9).
//
// Eén bron van waarheid voor de site-URL (NEXT_PUBLIC_SITE_URL, default
// https://mondzorgwerkt.nl), canonieke URL's, Open Graph/Twitter-metadata
// en de JSON-LD-bouwers (JobPosting, Organization, Place, BreadcrumbList).
//
// Regels (zie docs/design/CRAWLER_POLICY.md):
// - JobPosting-markup UITSLUITEND op /vacatures/[slug] en alleen bij
//   status "published"; de markup spiegelt exact de zichtbare inhoud.
// - Gesloten vacatures blijven indexeerbaar maar krijgen GEEN JobPosting.
// - Locaties nooit exacter dan stad + postcode-4 (privacyregel van het
//   publieke read-model).

import type { Metadata } from "next";
import type {
  PublicJobView,
  PublicPracticeView,
} from "./data/types";

/* -------------------------------- site-URL ------------------------------- */

/** Basis-URL van de site; env-gestuurd zodat previews correct canonicaliseren. */
export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://mondzorgwerkt.nl";
}

export function absoluteUrl(pad: string): string {
  return `${siteUrl()}${pad}`;
}

/* ----------------------------- paginametadata ---------------------------- */

/**
 * Standaardmetadata voor een openbare pagina: titel, beschrijving,
 * canonical (relatief — metadataBase in app/layout.tsx maakt hem absoluut),
 * Open Graph en Twitter. De social-afbeelding is de gegenereerde
 * MatchShape-compositie op /opengraph-image (app/opengraph-image.tsx) —
 * expliciet meegegeven zodat routes met een eigen openGraph-object hem
 * niet kwijtraken door de ondiepe metadata-merge van Next.
 */
export function paginaMetadata({
  titel,
  beschrijving,
  pad,
  noindex = false,
}: {
  titel: string;
  beschrijving: string;
  pad: string;
  noindex?: boolean;
}): Metadata {
  return {
    title: titel,
    description: beschrijving,
    alternates: { canonical: pad },
    robots: noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: titel,
      description: beschrijving,
      url: pad,
      siteName: "mondzorgwerkt",
      locale: "nl_NL",
      type: "website",
      images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: titel,
      description: beschrijving,
      images: ["/opengraph-image"],
    },
  };
}

/* --------------------------------- JSON-LD -------------------------------- */

/** Google-enumwaarde voor employmentType, afgeleid van de zichtbare contractvormen. */
function employmentTypeEnum(job: PublicJobView): string[] {
  const uit: string[] = [];
  for (const t of job.employmentTypes) {
    switch (t.key) {
      case "loondienst":
        uit.push(job.hoursMax >= 36 ? "FULL_TIME" : "PART_TIME");
        break;
      case "zzp":
        uit.push("CONTRACTOR");
        break;
      case "detachering":
        uit.push("TEMPORARY");
        break;
      case "stage":
        uit.push("INTERN");
        break;
      default:
        uit.push("OTHER");
    }
  }
  return [...new Set(uit)];
}

/**
 * JobPosting-JSON-LD voor een GEPUBLICEERDE vacature. Elk veld komt exact
 * overeen met wat de detailpagina zichtbaar toont: titel, beschrijving,
 * datums, contractvorm, salaris of omzetpercentage, praktijk en locatie
 * (stad + regio + postcode-4 — nooit een volledig adres).
 * De aanroeper is verantwoordelijk voor de published-check.
 */
export function jobPostingJsonLd(
  job: PublicJobView,
  praktijkZichtbaar: boolean,
): Record<string, unknown> {
  const json: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    datePosted: job.datePosted,
    employmentType: employmentTypeEnum(job),
    directApply: job.directApply,
    url: absoluteUrl(`/vacatures/${job.slug}`),
    identifier: {
      "@type": "PropertyValue",
      name: "mondzorgwerkt",
      value: job.slug,
    },
    hiringOrganization: {
      "@type": "Organization",
      name: job.organization.name,
      ...(praktijkZichtbaar
        ? { url: absoluteUrl(`/praktijken/${job.organization.slug}`) }
        : {}),
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.location.city,
        addressRegion: job.location.region,
        postalCode: job.location.postcode4,
        addressCountry: "NL",
      },
    },
  };
  if (job.validThrough) json.validThrough = job.validThrough;
  if (job.salary) {
    // Zichtbaar als "€ x – € y p/m" → maandbedragen in euro's.
    json.baseSalary = {
      "@type": "MonetaryAmount",
      currency: "EUR",
      value: {
        "@type": "QuantitativeValue",
        minValue: Math.round(job.salary.minCents / 100),
        maxValue: Math.round(job.salary.maxCents / 100),
        unitText: "MONTH",
      },
    };
  } else if (job.revenueShare) {
    // Zichtbaar als "tot n% van de omzet" (zzp) — geen vast salaris.
    json.incentiveCompensation = `Tot ${job.revenueShare.maxPercent}% van de omzet`;
  }
  return json;
}

/** Organization-JSON-LD voor de homepage. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "mondzorgwerkt",
    url: siteUrl(),
    description:
      "Match- en capaciteitsplatform voor de mondzorg: professionals en praktijken vinden elkaar op werkdagen, vakinhoud, technologie en ambities.",
    logo: absoluteUrl("/opengraph-image"),
  };
}

/** Place-JSON-LD voor een openbare praktijkpagina (stad + postcode-4). */
export function placeJsonLd(
  praktijk: PublicPracticeView,
): Record<string, unknown> {
  const adressen = praktijk.locations.map((l) => ({
    "@type": "PostalAddress",
    addressLocality: l.city,
    addressRegion: l.region,
    postalCode: l.postcode4,
    addressCountry: "NL",
  }));
  return {
    "@context": "https://schema.org",
    "@type": "Place",
    name: praktijk.name,
    description: praktijk.description,
    url: absoluteUrl(`/praktijken/${praktijk.slug}`),
    address: adressen.length === 1 ? adressen[0] : adressen,
  };
}

/** BreadcrumbList-JSON-LD; items zonder href zijn de huidige pagina. */
export function breadcrumbJsonLd(
  items: { label: string; href?: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  };
}
