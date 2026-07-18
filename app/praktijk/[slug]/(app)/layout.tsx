// Praktijk-app-layout: elke pagina in deze groep vereist een ingelogde
// gebruiker met actief membership bij de organisatie achter de slug
// (getOrgForUserBySlug — dé toegangspoort met tenantisolatie). Zonder sessie
// naar /inloggen; zonder membership naar de praktijk-start (die stuurt leden
// van een andere organisatie door naar hun eigen dashboard).

import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthzError } from "@/lib/authz";
import { getOrgForUserBySlug } from "@/server/organizations";
import { AppShell, type AppShellNavItem } from "@/components/AppShell";

export default async function PraktijkAppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug);
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      if (fout.status === 404) notFound();
      redirect("/praktijk/nieuw");
    }
    throw fout;
  }
  const { org, ctx } = toegang;

  const basis = `/praktijk/${org.slug}`;
  const nav: AppShellNavItem[] = [
    { href: basis, label: "Dashboard" },
    { href: `${basis}/pipeline`, label: "Pipeline" },
    { href: `${basis}/bezetting`, label: "Bezetting" },
    { href: `${basis}/vacatures/nieuw`, label: "Vacature" },
    { href: `${basis}/radar`, label: "Radar" },
    { href: `${basis}/team`, label: "Team", alleenDesktop: true },
    { href: `${basis}/inzichten`, label: "Inzichten", alleenDesktop: true },
    { href: `${basis}/integraties`, label: "Integraties", alleenDesktop: true },
    // Zes tabs op mobiel: "Abonnement" past daar niet onafgekapt — kort label.
    { href: `${basis}/abonnement`, label: "Abonnement", kort: "Plan" },
  ];

  return (
    <AppShell
      nav={nav}
      userName={ctx.user.name}
      areaLabel={org.name}
    >
      {children}
    </AppShell>
  );
}
