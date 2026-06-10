import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";

const quicksand = Quicksand({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-quicksand",
});

export const metadata: Metadata = {
  title: "Bliss to Shine — Donatie-teller",
  description: "Samen voor €10.000 op de Bliss to Shine Day",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" className={quicksand.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
