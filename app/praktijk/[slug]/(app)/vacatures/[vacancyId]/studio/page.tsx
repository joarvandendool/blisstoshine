// Match Studio — serverkant. Haalt via dé toegangspoort (getOrgForUserBySlug,
// capability vacancy.manage) de vacature, de volledige kandidatenpool
// (candidatesForVacancy, incl. opportunities) en de effectieve entitlements
// op. De entitlement match_studio_full bepaalt de modus:
// "volledig" (simuleren + opportunities) of "beperkt" (pool en scores
// zichtbaar, gereedschap vergrendeld met eerlijke upgrade-uitleg).
//
// Privacy/entitlements: in de beperkte modus worden de opportunity-voorstellen
// server-side uit de props gestript — vergrendelde inhoud gaat nooit mee naar
// de client. Alle interactie leeft in studio.tsx (client).

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { effectiveEntitlements } from "@/lib/billing";
import { can } from "@/domain/entitlements";
import { getOrgForUserBySlug } from "@/server/organizations";
import { castSchedule, getVacancy } from "@/server/vacancies";
import { candidatesForVacancy } from "@/server/matching";
import { listInvitationsForVacancy } from "@/server/invitations";
import { castAvailability } from "@/server/candidates";
import { Badge, PageHeader } from "@/components/ui";
import {
  StudioClient,
  type StudioKandidaat,
  type StudioMode,
  type StudioVacature,
} from "./studio";

export const dynamic = "force-dynamic";

export default async function MatchStudioPagina({
  params,
}: {
  params: Promise<{ slug: string; vacancyId: string }>;
}) {
  const { slug, vacancyId } = await params;

  // De (app)-layout controleert het membership al, maar de studio vereist
  // bovendien de capability vacancy.manage — daarom hier opnieuw de poort.
  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "vacancy.manage");
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      notFound();
    }
    throw fout;
  }
  const { ctx } = toegang;

  // Vacature altijd binnen de eigen organisatie (anders 404 — tenantisolatie).
  let vacature: Awaited<ReturnType<typeof getVacancy>>;
  try {
    vacature = await getVacancy(ctx, vacancyId);
  } catch (fout) {
    if (fout instanceof AuthzError) notFound();
    throw fout;
  }

  const [pool, uitnodigingen, effectief] = await Promise.all([
    candidatesForVacancy(ctx, vacancyId),
    listInvitationsForVacancy(ctx, vacancyId),
    effectiveEntitlements(ctx.organizationId),
  ]);

  const mode: StudioMode = can(effectief.entitlements, "match_studio_full")
    ? "volledig"
    : "beperkt";

  // Alleen de velden die de studio nodig heeft gaan naar de client — geen
  // postcodes of andere profielgegevens. In de beperkte modus gaan ook de
  // opportunity-voorstellen niet mee (vergrendelde functie).
  const kandidaten: StudioKandidaat[] = pool.map(
    ({ profile, displayName, result }) => ({
      candidateUserId: profile.userId,
      profileId: profile.id,
      displayName,
      isAnoniem: profile.visibility !== "visible",
      role: profile.role,
      experienceLevel: profile.experienceLevel,
      availability: castAvailability(profile.availability),
      result: mode === "volledig" ? result : { ...result, opportunities: [] },
    }),
  );

  const studioVacature: StudioVacature = {
    id: vacature.id,
    title: vacature.title,
    role: vacature.role,
    stad: vacature.location.city,
    schedule: castSchedule(vacature.schedule),
    hoursMin: vacature.hoursMin,
    hoursMax: vacature.hoursMax,
    mentorship: vacature.mentorship,
  };

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Kruimelpad">
        <Link
          href={`/praktijk/${slug}`}
          className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
        >
          ← Terug naar het dashboard
        </Link>
      </nav>

      <PageHeader
        title="Match"
        accent="Studio"
        description={`${vacature.title} · ${vacature.location.city} — verken hoe kleine aanpassingen aan de werkweek de kandidatenpool veranderen, en nodig de sterkste matches direct uit.`}
        actions={
          mode === "beperkt" ? (
            <Badge tone="wit">Beperkte weergave — simulatie hoort bij Growth</Badge>
          ) : undefined
        }
      />

      <StudioClient
        // Na het opslaan van een simulatie verandert updatedAt; de nieuwe key
        // remount de client met een schone (niet-gesimuleerde) staat.
        key={`${vacature.id}-${vacature.updatedAt.getTime()}`}
        slug={slug}
        mode={mode}
        planCode={effectief.planCode}
        vacature={studioVacature}
        kandidaten={kandidaten}
        uitgenodigd={uitnodigingen.map((entry) => entry.invitation.candidateUserId)}
      />
    </div>
  );
}
