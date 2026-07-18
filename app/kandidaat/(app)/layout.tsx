// Kandidaat-app-layout: elke pagina in deze groep vereist een ingelogde
// kandidaat mét actief profiel. Zonder (actief) profiel gaat de kandidaat
// eerst door de onboarding; zonder sessie naar het inlogscherm.

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthzError, requireCandidate } from "@/lib/authz";
import { AppShell, type AppShellNavItem } from "@/components/AppShell";

const KANDIDAAT_NAV: AppShellNavItem[] = [
  { href: "/kandidaat", label: "Matches" },
  { href: "/kandidaat/uitnodigingen", label: "Uitnodigingen" },
  { href: "/kandidaat/profiel", label: "Profiel" },
];

export default async function KandidaatAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  let kandidaat: Awaited<ReturnType<typeof requireCandidate>>;
  try {
    kandidaat = await requireCandidate();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  // Geen actief profiel → eerst de onboarding afronden.
  if (!kandidaat.profile || kandidaat.profile.status !== "active") {
    redirect("/kandidaat/onboarding");
  }

  return (
    <AppShell
      nav={KANDIDAAT_NAV}
      userName={kandidaat.user.name}
      areaLabel="Kandidaat"
    >
      {children}
    </AppShell>
  );
}
