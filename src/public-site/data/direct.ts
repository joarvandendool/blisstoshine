// DirectDataSource — de standaard databron van de openbare site: échte
// databasegegevens, in-process via de site-datalaag in
// src/server/public/site-queries.ts. Bewust géén self-HTTP naar
// /api/public/v1/* (dat breekt op Vercel-previews achter Deployment
// Protection en kost een onnodige netwerkronde); zie adapter.ts voor de
// afweging en de selectie via PUBLIC_DATA_SOURCE.
//
// Dit bestand importeert zelf géén Prisma: alle databasetoegang leeft in
// src/server/public/**. De privacy- en publicatieregels (alleen
// gepubliceerde vacatures in lijsten, gesloten vacatures wél per slug,
// praktijken alleen mét consent, locaties nooit exacter dan stad + PC4,
// nooit kandidaatdata) worden dáár afgedwongen.

import {
  siteJob,
  siteJobSearch,
  sitePractice,
  sitePractices,
} from "@/server/public/site-queries";
import { taxonomieView } from "./taxonomie";
import type {
  PublicDataSource,
  PublicJobFilters,
  PublicJobSearchResult,
  PublicJobView,
  PublicPracticeView,
  PublicTaxonomyView,
} from "./types";

export class DirectDataSource implements PublicDataSource {
  async getJobs(
    filters: PublicJobFilters,
    page: number,
  ): Promise<PublicJobSearchResult> {
    return siteJobSearch(filters, page);
  }

  async getJob(idOrSlug: string): Promise<PublicJobView | null> {
    return siteJob(idOrSlug);
  }

  async getPractice(slug: string): Promise<PublicPracticeView | null> {
    const praktijk = await sitePractice(slug);
    // Dubbele zekerheid: de datalaag levert alleen praktijken mét consent,
    // maar de adapter dwingt dezelfde regel af (net als bij fixtures/http).
    if (!praktijk || !praktijk.practiceConsent) return null;
    return praktijk;
  }

  async getPractices(): Promise<PublicPracticeView[]> {
    return (await sitePractices()).filter((p) => p.practiceConsent);
  }

  async getTaxonomies(): Promise<PublicTaxonomyView> {
    return taxonomieView();
  }
}
