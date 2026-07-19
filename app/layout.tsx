import type { Metadata } from "next";
import { Archivo, Playfair_Display } from "next/font/google";
import "./globals.css";

// Tijdelijke stand-ins voor de huisstijl-fonts:
// Aktiv Grotesk → Archivo, Abril Display ExtraBold Italic → Playfair Display.
// Drop-in te vervangen zodra de licentiebestanden beschikbaar zijn.
const sans = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const serif = Playfair_Display({
  subsets: ["latin"],
  style: ["italic"],
  weight: ["700", "800"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
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
