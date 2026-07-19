// Sitemap-index van de openbare site (fase 9): statische routes, de
// kennisbank, gepubliceerde vacatures (lastModified = updatedAt) en
// praktijken mét consent — alles uit de public-site-adapter, nooit uit
// Prisma. Privé-routes (/kandidaat, /praktijk, /intern, …) horen hier
// bewust NIET in (auth + noindex, zie docs/design/CRAWLER_POLICY.md).

import type { MetadataRoute } from "next";
import { getPublicDataSource } from "@/public-site/data/adapter";
import { KENNIS_ARTIKELEN } from "@/public-site/kennis/artikelen";
import { absoluteUrl } from "@/public-site/seo";
import type { PublicJobView } from "@/public-site/data/types";

/** Alle gepubliceerde vacatures via de gepagineerde adapter-API. */
async function alleVacatures(): Promise<PublicJobView[]> {
  const bron = getPublicDataSource();
  const uit: PublicJobView[] = [];
  let pagina = 1;
  let totalPages = 1;
  do {
    const resultaat = await bron.getJobs({}, pagina);
    uit.push(...resultaat.items);
    totalPages = resultaat.totalPages;
    pagina += 1;
  } while (pagina <= totalPages);
  return uit;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [vacatures, praktijken] = await Promise.all([
    alleVacatures(),
    getPublicDataSource().getPractices(),
  ]);

  const statisch: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/vacatures"),
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  const kennis: MetadataRoute.Sitemap = KENNIS_ARTIKELEN.map((artikel) => ({
    url: absoluteUrl(artikel.pad),
    lastModified: new Date(artikel.actualisatiedatum),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const vacatureUrls: MetadataRoute.Sitemap = vacatures.map((job) => ({
    url: absoluteUrl(`/vacatures/${job.slug}`),
    lastModified: new Date(job.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const praktijkUrls: MetadataRoute.Sitemap = praktijken.map((praktijk) => ({
    url: absoluteUrl(`/praktijken/${praktijk.slug}`),
    lastModified: new Date(praktijk.updatedAt),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...statisch, ...kennis, ...vacatureUrls, ...praktijkUrls];
}
