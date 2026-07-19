// Metadata-layout voor /design-system (fase 10, AI-discoverability):
// interne referentiepagina — nooit indexeren. Alleen een robots/metadata-
// export en een pass-through; niets functioneels.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DesignSystemMetadataLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
