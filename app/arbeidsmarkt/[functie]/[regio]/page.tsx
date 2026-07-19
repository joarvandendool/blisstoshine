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
import {
  artikelenInCategorie,
  vindArtikel,
} from "@/public-site/kennis/artikelen";

export const dynamicParams = false;

export function generateStaticParams() {
  // Slug van arbeidsmarkt-artikelen is "functie/regio".
  return artikelenInCategorie("arbeidsmarkt").map((a) => {
    const [functie, regio] = a.slug.split("/");
    return { functie, regio };
  });
}

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
