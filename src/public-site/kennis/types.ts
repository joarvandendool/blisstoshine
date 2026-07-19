// Typen voor de publieke kennislaag (Workstream B, fase 8).
//
// Elke kennispagina is een HANDGESCHREVEN artikel (geen gegenereerde dunne
// pagina's) met een vaste, hoogwaardige structuur: direct antwoord bovenaan,
// heldere H2-secties, een methodologie-blok en verwijzingen naar functies,
// regio's en de andere kennispagina's. De routes (app/functies/[slug] enz.)
// beperken generateStaticParams tot de geschreven artikelen en geven 404
// voor onbekende slugs.

export type KennisCategorie =
  | "functies"
  | "specialisaties"
  | "technologie"
  | "salaris"
  | "arbeidsmarkt";

/** Eén H2-sectie: kop, lopende alinea's en optioneel een opsomming. */
export interface KennisSectie {
  kop: string;
  paragrafen: string[];
  lijst?: string[];
}

export interface KennisArtikel {
  /** Laatste padsegment(en); uniek binnen de categorie. */
  slug: string;
  /** Volledige route, bv. "/functies/mondhygienist". */
  pad: string;
  categorie: KennisCategorie;
  /** Nederlands label van de categorie voor breadcrumbs, bv. "Functies". */
  categorieLabel: string;
  /** H1 van de pagina. */
  titel: string;
  /** Korte linktekst voor footer/verder-lezen, bv. "Wat doet een mondhygiënist?". */
  kortLabel: string;
  /** Meta description (± 150 tekens). */
  beschrijving: string;
  /** Direct antwoord: 2–3 zinnen bovenaan die de kernvraag beantwoorden. */
  directAntwoord: string;
  secties: KennisSectie[];
  /** Periode waarop de inhoud gebaseerd is, bv. "juli 2026". */
  bronperiode: string;
  /** Altijd "Redactie Mondzorgwerkt". */
  auteur: string;
  /** Laatste inhoudelijke actualisatie (ISO 8601). */
  actualisatiedatum: string;
  /** Methodologie-blok: hoe kwam dit artikel tot stand, wat is indicatief. */
  methodologie: string[];
  /** Taxonomierol-sleutels voor de vacaturekoppeling en interne links. */
  gerelateerdeFuncties: string[];
  /** Regio's (plaats-/regionamen) voor de vacaturefilter, bv. ["Utrecht"]. */
  gerelateerdeRegios: string[];
}
