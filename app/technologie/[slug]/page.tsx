// /technologie/[slug] — kennispagina's over mondzorgtechnologie (fase 8).
// Beperkt tot de handgeschreven artikelen; onbekende slugs geven 404.

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
  return artikelenInCategorie("technologie").map((a) => ({ slug: a.slug }));
}

interface PaginaProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { slug } = await params;
  const artikel = vindArtikel("technologie", slug);
  if (!artikel) return { title: "Pagina niet gevonden — mondzorgwerkt" };
  return kennisMetadata(artikel);
}

export default async function TechnologiePagina({ params }: PaginaProps) {
  const { slug } = await params;
  const artikel = vindArtikel("technologie", slug);
  if (!artikel) notFound();
  return <KennisArtikelPagina artikel={artikel} />;
}
