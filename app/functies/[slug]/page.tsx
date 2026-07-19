// /functies/[slug] — kennispagina's over functies in de mondzorg (fase 8).
// generateStaticParams is beperkt tot de handgeschreven artikelen;
// onbekende slugs geven 404 (geen dunne auto-pagina's).

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
  return artikelenInCategorie("functies").map((a) => ({ slug: a.slug }));
}

interface PaginaProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PaginaProps): Promise<Metadata> {
  const { slug } = await params;
  const artikel = vindArtikel("functies", slug);
  if (!artikel) return { title: "Pagina niet gevonden — mondzorgwerkt" };
  return kennisMetadata(artikel);
}

export default async function FunctiePagina({ params }: PaginaProps) {
  const { slug } = await params;
  const artikel = vindArtikel("functies", slug);
  if (!artikel) notFound();
  return <KennisArtikelPagina artikel={artikel} />;
}
