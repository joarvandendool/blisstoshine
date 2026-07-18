// Team & locaties — serverkant. Autorisatie via dé toegangspoort
// (getOrgForUserBySlug) met capability members.manage: rollen zonder dat
// recht gaan terug naar het dashboard.
//
// Op deze pagina: ledenlijst met rol + locatietoewijzing, uitnodigen van een
// bestaande gebruiker, locatiebeheer (toevoegen/bewerken met
// entitlement-melding) en een compacte locatievergelijking (actieve
// vacatures, dekkingspercentage en open gaten per locatie — hergebruik van
// capacityWeek).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { effectiveEntitlements } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  getOrgForUserBySlug,
  listLocations,
  listMembers,
} from "@/server/organizations";
import { capacityWeek } from "@/server/capacity";
import { PageHeader } from "@/components/ui";
import {
  TeamClient,
  type TeamLid,
  type TeamLocatie,
  type LocatieVergelijkRij,
} from "./team-client";

export const metadata: Metadata = {
  title: "Team & locaties — mondzorgwerkt",
  description:
    "Beheer teamleden, rollen en locatietoewijzing, en vergelijk de bezetting en vacatures van je locaties.",
};

export const dynamic = "force-dynamic";

export default async function TeamPagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "members.manage");
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      redirect(`/praktijk/${slug}`);
    }
    throw fout;
  }
  const { org, ctx } = toegang;

  const [leden, locatieRijen, entitlements] = await Promise.all([
    listMembers(ctx),
    listLocations(ctx),
    effectiveEntitlements(ctx.organizationId),
  ]);

  const locaties: TeamLocatie[] = locatieRijen.map((l) => ({
    id: l.id,
    name: l.name,
    city: l.city,
    postcode: l.postcode,
    street: l.street,
    houseNumber: l.houseNumber,
    phone: l.phone,
    treatmentRooms: l.treatmentRooms,
  }));

  const ledenClient: TeamLid[] = leden.map((lid) => ({
    membershipId: lid.membershipId,
    name: lid.name,
    email: lid.email,
    role: lid.role,
    status: lid.status,
    locationIds: lid.locationIds,
    isSelf: lid.userId === ctx.user.id,
  }));

  // Locatievergelijking: actieve vacatures + dekking per locatie.
  const vergelijking: LocatieVergelijkRij[] = [];
  for (const locatie of locatieRijen) {
    const [actieveVacatures, week] = await Promise.all([
      prisma.vacancy.count({
        where: {
          organizationId: ctx.organizationId,
          locationId: locatie.id,
          status: "published",
        },
      }),
      capacityWeek(ctx, locatie.id),
    ]);
    const relevant = week.cells.filter((cel) => cel.target > 0);
    const gedekt = relevant.filter((cel) => cel.shortage === 0).length;
    vergelijking.push({
      locationId: locatie.id,
      name: locatie.name,
      city: locatie.city,
      activeVacancies: actieveVacatures,
      coveragePct: relevant.length > 0 ? Math.round((gedekt / relevant.length) * 100) : null,
      openGaps: relevant.filter((cel) => cel.shortage > 0).length,
    });
  }

  const maxLocations = entitlements.entitlements.max_locations;
  const locatieLimiet = maxLocations?.enabled ? maxLocations.limitInt : 0;
  const crossLocation = entitlements.entitlements.cross_location_matching?.enabled === true;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Team &"
        accent="locaties"
        description={`Beheer wie toegang heeft tot ${org.name}, met welke rol en op welke locaties — en vergelijk de bezetting van je locaties.`}
      />

      <TeamClient
        slug={org.slug}
        leden={ledenClient}
        locaties={locaties}
        vergelijking={vergelijking}
        locatieLimiet={locatieLimiet}
        crossLocationMatching={crossLocation}
        planCode={entitlements.planCode}
      />
    </div>
  );
}
