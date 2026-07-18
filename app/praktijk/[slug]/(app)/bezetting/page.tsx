// Praktijkbezetting — serverkant. Autorisatie via dé toegangspoort
// (getOrgForUserBySlug) met capability location.manage: rollen zonder dat
// recht gaan terug naar het dashboard. Per (gekozen) locatie wordt de
// bezettingsweek berekend (capacityWeek — incl. dekking per functie,
// behandelkamercapaciteit en parttimer-combinaties), het team geladen
// (listTeamMembers, incl. TeamAbsence) en de recente scenario's opgehaald;
// alle interactie leeft in bezetting-client.tsx.
//
// Analytics: weekly_capacity_planner_viewed (en het bestaande
// capacity_planner_viewed) worden hier server-side getrackt per paginabezoek.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { track } from "@/lib/analytics";
import {
  getOrgForUserBySlug,
  listLocations,
  planCodeVoorAnalytics,
} from "@/server/organizations";
import {
  capacityWeek,
  castTeamSchedule,
  listScenarios,
  listTeamMembers,
} from "@/server/capacity";
import { listVacancies } from "@/server/vacancies";
import { PageHeader } from "@/components/ui";
import {
  BezettingClient,
  type BezettingLocatie,
  type BezettingTeamlid,
  type BezettingVacature,
} from "./bezetting-client";
import type { ScenarioOverzichtItem, ScenarioSamenvattingClient } from "./scenario-paneel";

export const metadata: Metadata = {
  title: "Praktijkbezetting — mondzorgwerkt",
  description:
    "Zie per weekdag en dagdeel of je praktijk volledig bezet is, waar gaten vallen en hoeveel kandidaten die kunnen opvullen.",
};

export const dynamic = "force-dynamic";

/** Defensieve extractie van een scenario-samenvatting uit de result-Json. */
function alsSamenvatting(waarde: unknown): ScenarioSamenvattingClient | null {
  if (!waarde || typeof waarde !== "object") return null;
  const v = waarde as Record<string, unknown>;
  const getal = (x: unknown): number => (typeof x === "number" ? x : 0);
  return {
    volledig: getal(v.volledig),
    gedeeltelijk: getal(v.gedeeltelijk),
    open: getal(v.open),
    tekortVerwacht: getal(v.tekortVerwacht),
    totaalTekort: getal(v.totaalTekort),
  };
}

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

  // listLocations filtert al op de locatietoewijzing van het membership.
  const alleLocaties = await listLocations(ctx);
  const locaties: BezettingLocatie[] = alleLocaties.map((l) => ({
    id: l.id,
    name: l.name,
    city: l.city,
  }));
  const geselecteerd =
    locaties.find((l) => l.id === locatieParam) ?? locaties[0] ?? null;
  if (!geselecteerd) redirect(`/praktijk/${slug}`);

  const [week, team, alleVacatures, scenarioRijen] = await Promise.all([
    capacityWeek(ctx, geselecteerd.id),
    listTeamMembers(ctx, geselecteerd.id),
    listVacancies(ctx),
    listScenarios(ctx, geselecteerd.id),
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
    contractHours: teamlid.contractHours,
    employmentType: teamlid.employmentType,
    startDate: teamlid.startDate?.toISOString() ?? null,
    endDate: teamlid.endDate?.toISOString() ?? null,
    absences: teamlid.absences.map((afwezigheid) => ({
      id: afwezigheid.id,
      kind: afwezigheid.kind,
      from: afwezigheid.from.toISOString(),
      until: afwezigheid.until?.toISOString() ?? null,
      note: afwezigheid.note,
    })),
    note: teamlid.note,
  }));

  const scenarios: ScenarioOverzichtItem[] = scenarioRijen.map((scenario) => {
    const result = (scenario.result ?? {}) as Record<string, unknown>;
    const afterGaps = Array.isArray(result.afterGaps) ? result.afterGaps.length : 0;
    const kandidaten = Array.isArray(result.candidateProfileIds)
      ? result.candidateProfileIds.length
      : 0;
    return {
      id: scenario.id,
      name: scenario.name,
      kind: scenario.kind,
      status: scenario.status,
      createdAt: scenario.createdAt.toISOString(),
      before: alsSamenvatting(result.before),
      after: alsSamenvatting(result.after),
      afterGaps,
      kandidaten,
    };
  });

  const plan = await planCodeVoorAnalytics(ctx.organizationId);
  const openDagdelen = week.cells.filter((c) => c.status === "open").length;
  await track("capacity_planner_viewed", {
    organizationId: ctx.organizationId,
    locationId: geselecteerd.id,
    userId: ctx.user.id,
    plan,
    context: { teamleden: teamleden.length, openDagdelen },
  });
  await track("weekly_capacity_planner_viewed", {
    organizationId: ctx.organizationId,
    locationId: geselecteerd.id,
    userId: ctx.user.id,
    plan,
    context: {
      teamleden: teamleden.length,
      openDagdelen,
      weekStart: week.weekStart.toISOString().slice(0, 10),
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
        roleCells={week.roleCells.map((cel) => ({
          ...cel,
          shortageExpectedOn: cel.shortageExpectedOn?.toISOString() ?? null,
        }))}
        target={week.target}
        treatmentRooms={week.treatmentRooms}
        overCapacity={week.overCapacity}
        partTimeCombos={week.partTimeCombos}
        minGroupSize={week.minGroupSize}
        teamleden={teamleden}
        vacatures={vacatures}
        scenarios={scenarios}
      />
    </div>
  );
}
