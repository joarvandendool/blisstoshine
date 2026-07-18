// Nieuwe vacature: laadt de locaties van de (geverifieerde) organisatie en
// rendert de wizard. Autorisatie via getOrgForUserBySlug met capability
// vacancy.manage — rollen zonder die capability gaan terug naar het dashboard.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { getOrgForUserBySlug, listLocations } from "@/server/organizations";
import { VacatureWizard, type WizardLocatie } from "./vacature-wizard";

export const metadata: Metadata = {
  title: "Nieuwe vacature — mondzorgwerkt",
  description:
    "Stel in vijf stappen een vacature samen en zie vóór publicatie hoeveel kandidaten in de regio passen.",
};

export const dynamic = "force-dynamic";

export default async function NieuweVacaturePagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "vacancy.manage");
  } catch (fout) {
    // De layout ving sessie- en membershipfouten al af; hier resteert de rol
    // zonder vacancy.manage — terug naar het dashboard.
    if (fout instanceof AuthzError) redirect(`/praktijk/${slug}`);
    throw fout;
  }

  const locaties = await listLocations(toegang.ctx);
  const wizardLocaties: WizardLocatie[] = locaties.map((locatie) => ({
    id: locatie.id,
    name: locatie.name,
    city: locatie.city,
  }));

  return <VacatureWizard slug={slug} locaties={wizardLocaties} />;
}
