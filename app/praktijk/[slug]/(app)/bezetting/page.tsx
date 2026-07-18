// Praktijkbezetting — serverkant. Autorisatie via dé toegangspoort
// (getOrgForUserBySlug) met capability location.manage: rollen zonder dat
// recht gaan terug naar het dashboard. Per (gekozen) locatie wordt de
// bezettingsweek berekend (capacityWeek) en het team geladen
// (listTeamMembers); alle interactie leeft in bezetting-client.tsx.
//
// Analytics: capacity_planner_viewed wordt hier server-side getrackt bij elk
// paginabezoek.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { track } from "@/lib/analytics";
import {
  getOrgForUserBySlug,
  listLocations,
  planCodeVoorAnalytics,
} from "@/server/organizations";
import { capacityWeek, castTeamSchedule, listTeamMembers } from "@/server/capacity";
import { listVacancies } from "@/server/vacancies";
import { PageHeader } from "@/components/ui";
import {
  BezettingClient,
  type BezettingLocatie,
  type BezettingTeamlid,
  type BezettingVacature,
} from "./bezetting-client";

export const metadata: Metadata = {
  title: "Praktijkbezetting — mondzorgwerkt",
  description:
    "Zie per weekdag en dagdeel of je praktijk volledig bezet is, waar gaten vallen en hoeveel kandidaten die kunnen opvullen.",
};

export const dynamic = "force-dynamic";

export default async function BezettingPagina({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ locatie?: string }>;
}) {
  const { slug } = await params;
  const { locatie: locatieParam } = await searchParams;

  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "location.manage");
  } catch (fout) {
    // De layout ving sessie- en membershipfouten al af; hier resteert de rol
    // zonder location.manage — terug naar het dashboard.
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      redirect(`/praktijk/${slug}`);
    }
    throw fout;
  }
  const { org, ctx } = toegang;

  const alleLocaties = await listLocations(ctx);
  const locaties: BezettingLocatie[] = alleLocaties.map((l) => ({
    id: l.id,
    name: l.name,
    city: l.city,
  }));
  const geselecteerd =
    locaties.find((l) => l.id === locatieParam) ?? locaties[0] ?? null;
  if (!geselecteerd) redirect(`/praktijk/${slug}`);

  const [week, team, alleVacatures] = await Promise.all([
    capacityWeek(ctx, geselecteerd.id),
    listTeamMembers(ctx, geselecteerd.id),
    listVacancies(ctx),
  ]);

  // Concept- en gepubliceerde vacatures van deze locatie — voor de link
  // "Bekijk passende kandidaten" naar de Match Studio.
  const vacatures: BezettingVacature[] = alleVacatures
    .filter(
      (v) =>
        v.locationId === geselecteerd.id &&
        (v.status === "published" || v.status === "draft"),
    )
    .map((v) => ({ id: v.id, title: v.title, role: v.role, status: v.status }));

  const teamleden: BezettingTeamlid[] = team.map((teamlid) => ({
    id: teamlid.id,
    name: teamlid.name,
    role: teamlid.role,
    schedule: castTeamSchedule(teamlid.schedule),
    absentFrom: teamlid.absentFrom?.toISOString() ?? null,
    absentUntil: teamlid.absentUntil?.toISOString() ?? null,
    note: teamlid.note,
  }));

  await track("capacity_planner_viewed", {
    organizationId: ctx.organizationId,
    locationId: geselecteerd.id,
    userId: ctx.user.id,
    plan: await planCodeVoorAnalytics(ctx.organizationId),
    context: {
      teamleden: teamleden.length,
      openDagdelen: week.cells.filter((c) => c.status === "open").length,
    },
  });

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Praktijk"
        accent="bezetting"
        description={`Per weekdag en dagdeel: wie er is, wat je minimaal wilt en waar een gat valt — met direct zicht op kandidaten die het kunnen opvullen bij ${org.name}.`}
      />

      <BezettingClient
        // Bij locatiewissel of dataverandering remount de client met verse staat.
        key={geselecteerd.id}
        slug={org.slug}
        locaties={locaties}
        locatie={geselecteerd}
        weekStart={week.weekStart.toISOString()}
        candidateRole={week.candidateRole}
        cells={week.cells.map((cel) => ({
          ...cel,
          shortageExpectedOn: cel.shortageExpectedOn?.toISOString() ?? null,
        }))}
        target={week.target}
        minGroupSize={week.minGroupSize}
        teamleden={teamleden}
        vacatures={vacatures}
      />
    </div>
  );
}
