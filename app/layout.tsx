import type { Metadata } from "next";
import { Archivo, Playfair_Display } from "next/font/google";
import { siteUrl } from "@/public-site/seo";
import "./globals.css";

// Tijdelijke stand-ins voor de huisstijl-fonts:
// Aktiv Grotesk → Archivo, Abril Display ExtraBold Italic → Playfair Display.
// Drop-in te vervangen zodra de licentiebestanden beschikbaar zijn.
// fase 13: display swap expliciet (geen onzichtbare tekst tijdens laden)
// en alleen gewichten die daadwerkelijk gebruikt worden — serif-italic
// bestaat in het product uitsluitend op gewicht 700 (accent-serif/font-bold).
const sans = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

const serif = Playfair_Display({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["700"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  // Fase 9: absolute basis voor canonical/OG-URL's, env-gestuurd zodat
  // previews en productie elk hun eigen domein canonicaliseren.
  metadataBase: new URL(siteUrl()),
  title: "mondzorgwerkt — werk dat past, in de mondzorg",
  description:
    "Hét match- en capaciteitsplatform voor de mondzorg. Stel je ideale werkweek samen en ontdek praktijken die echt bij je passen.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="nl" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
