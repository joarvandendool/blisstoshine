// Metadata-layout voor ALLES onder /praktijk (fase 10, AI-discoverability):
// privéroutes (dashboard, wizard, studio, start) worden nooit geïndexeerd.
// Let op: de OPENBARE praktijkpagina's leven onder /praktijken (meervoud)
// en blijven gewoon indexeerbaar. Bewust uitsluitend een robots/metadata-
// export en een pass-through — niets functioneels; autorisatie leeft in
// app/praktijk/[slug]/(app)/layout.tsx.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PraktijkMetadataLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
