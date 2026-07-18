import { Archivo, Playfair_Display } from "next/font/google";
import "./globals.css";

// Stand-ins voor de huisstijl-fonts (Aktiv Grotesk Ex → Archivo, Abril Display → Playfair Display)
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

export const metadata = {
  title: "mondzorgwerkt — vacatures in de mondzorg",
  description:
    "Hét platform voor werken in de mondzorg. Vind vacatures voor tandartsen, mondhygiënisten en assistenten, of vind als praktijk jouw nieuwe collega.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="nl" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
