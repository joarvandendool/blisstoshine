// /arbeidsmarkt/[functie]/[regio] — arbeidsmarktkennispagina's (fase 8).
// Cijfers verschijnen hier uitsluitend indicatief op basis van platformdata
// (toekomstig market-insights read-model); niets wordt verzonnen.
// Beperkt tot de handgeschreven artikelen; onbekende combinaties geven 404.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  KennisArtikelPagina,
  kennisMetadata,
} from "@/public-site/kennis/KennisArtikelPagina";
import { vindArtikel } from "@/public-site/kennis/artikelen";

// Integratiefase: dit artikel toont échte vacatures/praktijken uit de
// PublicDataSource. Request-time renderen (i.p.v. SSG) zodat de databron
// van de runtime-omgeving geldt en de inhoud actueel blijft; onbekende
// slugs geven via vindArtikel gewoon 404.
export const dynamic = "force-dynamic";

interface PaginaProps {
  params: Promise<{ functie: string; regio: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { functie, regio } = await params;
  const artikel = vindArtikel("arbeidsmarkt", `${functie}/${regio}`);
  if (!artikel) return { title: "Pagina niet gevonden — mondzorgwerkt" };
  return kennisMetadata(artikel);
}

export default async function ArbeidsmarktPagina({ params }: PaginaProps) {
  const { functie, regio } = await params;
  const artikel = vindArtikel("arbeidsmarkt", `${functie}/${regio}`);
  if (!artikel) notFound();
  return <KennisArtikelPagina artikel={artikel} />;
}
