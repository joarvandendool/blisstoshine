// Metadata-layout voor ALLES onder /kandidaat (fase 10, AI-discoverability):
// privéroutes worden nooit geïndexeerd. Bewust uitsluitend een
// robots/metadata-export en een pass-through — niets functioneels; de
// autorisatie leeft in app/kandidaat/(app)/layout.tsx en de onboarding.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function KandidaatMetadataLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
