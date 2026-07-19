// Praktijkdashboard: bezettingsstatus van gepubliceerde vacatures bovenaan
// (dagen gevraagd + aantal sterke matches via candidatesForVacancy), de
// plan-badge met resterende trial-dagen, en de vacaturelijst met per vacature
// een compacte pipeline-samenvatting (tellingen + recente kandidaten). Het
// echte pipelinebeheer — gesprekken, aanbiedingen, afwijzen met reden — leeft
// op /praktijk/[slug]/pipeline. Lege staat: één grote CTA.

import Link from "next/link";
import type { ApplicationStatus, VacancyStatus } from "@prisma/client";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  castSchedule,
  listVacancies,
  type VacancyWithLocation,
} from "@/server/vacancies";
import { candidatesForVacancy } from "@/server/matching";
import {
  listApplicationsForVacancies,
  type VacancyApplicationEntry,
} from "@/server/applications";
import { effectiveEntitlements, getActiveSubscription } from "@/lib/billing";
import { PLAN_CATALOG } from "@/domain/entitlements";
import { LABEL_THRESHOLDS, type MatchLabel } from "@/domain/matching";
import { DAYPARTS, WEEKDAYS, label } from "@/domain/taxonomy";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  ScoreBadge,
  SectionHeading,
  Stat,
  cx,
  type BadgeTone,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/* ------------------------------ hulpfuncties ------------------------------ */

const VACATURE_STATUS: Record<VacancyStatus, { tekst: string; toon: BadgeTone }> = {
  published: { tekst: "Gepubliceerd", toon: "blauw" },
  draft: { tekst: "Concept", toon: "neutraal" },
  paused: { tekst: "Gepauzeerd", toon: "wit" },
  filled: { tekst: "Vervuld", toon: "roze" },
  expired: { tekst: "Verlopen", toon: "neutraal" },
};

const SOLLICITATIE_STATUS: Record<
  ApplicationStatus,
  { tekst: string; toon: BadgeTone }
> = {
  submitted: { tekst: "Nieuw", toon: "blauw" },
  in_review: { tekst: "In behandeling", toon: "blauw" },
  interview: { tekst: "Gesprek", toon: "roze" },
  offered: { tekst: "Aanbod gedaan", toon: "roze" },
  hired: { tekst: "Aangenomen", toon: "blauw" },
  rejected: { tekst: "Afgewezen", toon: "neutraal" },
  withdrawn: { tekst: "Teruggetrokken", toon: "neutraal" },
};

/** Kort dagoverzicht van het vacaturerooster, bv. "Ma, Di, Vr". */
function gevraagdeDagen(vacature: VacancyWithLocation): string[] {
  const rooster = castSchedule(vacature.schedule);
  return WEEKDAYS.filter((dag) =>
    DAYPARTS.some((dagdeel) => rooster[dag][dagdeel] !== null),
  ).map((dag) => dag.charAt(0).toUpperCase() + dag.slice(1));
}

/** Aantal gevraagde dagdelen, gesplitst in nodig en gewenst. */
function dagdeelTelling(vacature: VacancyWithLocation): {
  nodig: number;
  gewenst: number;
} {
  const rooster = castSchedule(vacature.schedule);
  let nodig = 0;
  let gewenst = 0;
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      if (rooster[dag][dagdeel] === "required") nodig += 1;
      else if (rooster[dag][dagdeel] === "preferred") gewenst += 1;
    }
  }
  return { nodig, gewenst };
}

/** Resterende hele dagen tot een datum (minimaal 0). */
function dagenTot(datum: Date): number {
  return Math.max(0, Math.ceil((datum.getTime() - Date.now()) / 86_400_000));
}

/** Link opgemaakt als knop (Button is een <button>; navigatie hoort bij <a>). */
function LinkKnop({
  href,
  variant = "primary",
  children,
}: {
  href: string;
  variant?: "primary" | "secondary";
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold",
        "transition-colors duration-150 motion-reduce:transition-none",
        variant === "primary"
          ? "bg-blauw-600 text-white shadow-(--shadow-knop-blauw) hover:bg-blauw-700"
          : "glass text-ink hover:bg-white/90",
      )}
    >
      {children}
    </Link>
  );
}

/* --------------------------------- pagina --------------------------------- */

export default async function PraktijkDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, ctx } = await getOrgForUserBySlug(slug);

  const [vacatures, effectief, abonnement] = await Promise.all([
    listVacancies(ctx),
    effectiveEntitlements(org.id),
    getActiveSubscription(org.id),
  ]);

  const gepubliceerd = vacatures.filter((v) => v.status === "published");

  // Bezettingsstatus: sterke matches per gepubliceerde vacature (score ≥ 70).
  const bezetting = await Promise.all(
    gepubliceerd.map(async (vacature) => {
      const kandidaten = await candidatesForVacancy(ctx, vacature.id);
      const sterk = kandidaten.filter(
        (k) => k.result.eligible && k.result.score >= LABEL_THRESHOLDS.good,
      ).length;
      return { vacature, sterk };
    }),
  );

  // Compacte pipeline per vacature — gebatcht opgehaald (PERF: één
  // tenantcheck + één IN-query in plaats van twee queries per vacature).
  const sollicitatiesPerVacature: Map<string, VacancyApplicationEntry[]> =
    await listApplicationsForVacancies(
      ctx,
      vacatures.map((vacature) => vacature.id),
    );

  const planNaam = effectief.planCode
    ? PLAN_CATALOG[effectief.planCode].name
    : "Geen abonnement";
  const trialDagenOver =
    abonnement?.status === "trialing" && abonnement.trialEndsAt
      ? dagenTot(abonnement.trialEndsAt)
      : null;

  const basis = `/praktijk/${org.slug}`;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Dashboard van"
        accent={org.name}
        description="Alles over je vacatures, matches en sollicitaties op één plek."
        actions={
          vacatures.length > 0 ? (
            <>
              <LinkKnop href={`${basis}/pipeline`} variant="secondary">
                Pipeline
              </LinkKnop>
              <LinkKnop href={`${basis}/vacatures/nieuw`}>Nieuwe vacature</LinkKnop>
            </>
          ) : undefined
        }
      />

      {/* plan-badge + trial-dagen */}
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="blauw">Plan: {planNaam}</Badge>
          {trialDagenOver !== null ? (
            <span className="text-sm font-medium text-ink/80">
              Nog{" "}
              <strong className="font-semibold text-ink">
                {trialDagenOver} {trialDagenOver === 1 ? "dag" : "dagen"}
              </strong>{" "}
              proefperiode
            </span>
          ) : null}
          {effectief.status === "trial_expired" ? (
            <span className="text-sm font-medium text-roze-800">
              Je proefperiode is afgelopen — kies een plan om verder te gaan.
            </span>
          ) : null}
        </div>
        <Link
          href={`${basis}/abonnement`}
          className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
        >
          Abonnement beheren
        </Link>
      </Card>

      {/* bezettingsstatus bovenaan */}
      {bezetting.length > 0 ? (
        <section aria-labelledby="bezetting-titel" className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Bezetting"
            title="Hoe staan je"
            accent="vacatures ervoor?"
          />
          <h2 id="bezetting-titel" className="sr-only">
            Bezettingsstatus per gepubliceerde vacature
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {bezetting.map(({ vacature, sterk }) => {
              const dagen = gevraagdeDagen(vacature);
              const telling = dagdeelTelling(vacature);
              return (
                <Card key={vacature.id} strong className="flex flex-col gap-3">
                  <h3 className="text-base font-semibold leading-snug text-ink">
                    {vacature.title}
                  </h3>
                  <p className="text-sm text-ink/70">
                    {dagen.length > 0
                      ? `Gevraagd op ${dagen.join(", ")} — ${telling.nodig} ${
                          telling.nodig === 1 ? "dagdeel" : "dagdelen"
                        } nodig${
                          telling.gewenst > 0
                            ? `, ${telling.gewenst} gewenst`
                            : ""
                        }`
                      : "Nog geen dagdelen gevraagd in het rooster"}
                  </p>
                  <Stat
                    value={sterk}
                    label={`sterke ${sterk === 1 ? "match" : "matches"} — kandidaten met een matchscore van ${LABEL_THRESHOLDS.good}% of hoger`}
                  />
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* vacaturelijst + pipeline */}
      <section aria-labelledby="vacatures-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Vacatures"
          title="Jouw"
          accent="vacatures"
          description={
            vacatures.length > 0
              ? `${vacatures.length} ${
                  vacatures.length === 1 ? "vacature" : "vacatures"
                }, inclusief concepten en vervulde posities.`
              : undefined
          }
        />
        <h2 id="vacatures-titel" className="sr-only">
          Jouw vacatures
        </h2>

        {vacatures.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            }
            title="Nog geen vacatures"
            description="Plaats je eerste vacature en zie direct hoeveel kandidaten in de regio bij jullie werkweek passen — nog vóór je publiceert."
            action={
              <Link
                href={`${basis}/vacatures/nieuw`}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-8 py-3.5 text-base font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
              >
                Plaats je eerste vacature
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {vacatures.map((vacature) => (
              <li key={vacature.id}>
                <VacatureKaart
                  slug={org.slug}
                  vacature={vacature}
                  sollicitaties={sollicitatiesPerVacature.get(vacature.id) ?? []}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------- deelweergaven ---------------------------- */

function VacatureKaart({
  slug,
  vacature,
  sollicitaties,
}: {
  slug: string;
  vacature: VacancyWithLocation;
  sollicitaties: VacancyApplicationEntry[];
}) {
  const status = VACATURE_STATUS[vacature.status];
  const basis = `/praktijk/${slug}`;

  const nieuw = sollicitaties.filter(
    (s) => s.application.status === "submitted" || s.application.status === "in_review",
  ).length;
  const gesprek = sollicitaties.filter(
    (s) => s.application.status === "interview" || s.application.status === "offered",
  ).length;
  const aangenomen = sollicitaties.filter(
    (s) => s.application.status === "hired",
  ).length;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.toon}>{status.tekst}</Badge>
            <span className="text-sm text-ink/60">
              {label(vacature.role)} · {vacature.location.city}
            </span>
          </div>
          <h3 className="text-lg font-semibold leading-snug text-ink">
            {vacature.title}
          </h3>
          <p className="text-sm text-ink/70">
            {vacature.hoursMin === vacature.hoursMax
              ? `${vacature.hoursMin} uur p/w`
              : `${vacature.hoursMin}–${vacature.hoursMax} uur p/w`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <LinkKnop href={`${basis}/vacatures/${vacature.id}/studio`} variant="secondary">
            Match Studio
          </LinkKnop>
          <LinkKnop href={`${basis}/vacatures/${vacature.id}`}>Bekijk</LinkKnop>
        </div>
      </div>

      {sollicitaties.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-brand-light/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-ink/80">
              <span className="font-semibold text-ink">Sollicitaties</span>
              <span>{nieuw} nieuw</span>
              <span aria-hidden="true">·</span>
              <span>{gesprek} in gesprek</span>
              <span aria-hidden="true">·</span>
              <span>{aangenomen} aangenomen</span>
            </div>
            <Link
              href={`${basis}/pipeline`}
              className="-my-3 inline-flex min-h-11 items-center text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
            >
              Beheer in de pipeline →
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {sollicitaties.slice(0, 3).map((entry) => (
              <SollicitatieRij key={entry.application.id} entry={entry} />
            ))}
          </ul>
          {sollicitaties.length > 3 ? (
            <p className="text-sm text-ink/60">
              +{sollicitaties.length - 3} meer in de pipeline
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function SollicitatieRij({ entry }: { entry: VacancyApplicationEntry }) {
  const { application, candidateName, snapshot } = entry;
  const status = SOLLICITATIE_STATUS[application.status];

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="truncate text-sm font-semibold text-ink">
          {candidateName}
        </span>
        {snapshot ? (
          <ScoreBadge
            score={snapshot.score}
            label={snapshot.label as MatchLabel}
            className="px-2.5 py-0.5 text-xs"
          />
        ) : null}
        <Badge tone={status.toon}>{status.tekst}</Badge>
      </div>
    </li>
  );
}
