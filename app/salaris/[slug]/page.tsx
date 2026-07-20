// /salaris/[slug] — salariskennispagina's (fase 8). Bandbreedtes zijn
// altijd een indicatie met methodologie-disclaimer (zie artikelen.ts).
// Beperkt tot de handgeschreven artikelen; onbekende slugs geven 404.

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
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { slug } = await params;
  const artikel = vindArtikel("salaris", slug);
  if (!artikel) return { title: "Pagina niet gevonden — mondzorgwerkt" };
  return kennisMetadata(artikel);
}

export default async function SalarisPagina({ params }: PaginaProps) {
  const { slug } = await params;
  const artikel = vindArtikel("salaris", slug);
  if (!artikel) notFound();
  return <KennisArtikelPagina artikel={artikel} />;
}
