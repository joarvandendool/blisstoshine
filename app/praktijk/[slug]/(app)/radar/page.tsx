// Talent Radar — geaggregeerd arbeidsmarktinzicht per vacature (published én
// draft). Met de entitlement talent_radar toont elke kaart het volledige
// rapport (radarForVacancy): totaal potentieel, verdeling per werkdag als
// pure-CSS staafjes, sterke vs. gedeeltelijke matches, het meest beperkende
// criterium met concrete duiding + link naar de Match Studio, en de
// moeilijkheid als badge. Zonder entitlement blijft alleen de teaser
// (radarTeaser) over, met een rustige upgrade-sectie.
//
// PRIVACY: elke teller die de servicelaag als null teruggeeft (onder de
// minimumdrempel) wordt getoond als "Te weinig kandidaten om dit veilig te
// tonen" — er verschijnen nooit ruwe kleine aantallen.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { effectiveEntitlements } from "@/lib/billing";
import { TALENT_RADAR_MIN_GROUP } from "@/lib/config";
import { can } from "@/domain/entitlements";
import { LABEL_THRESHOLDS } from "@/domain/matching";
import { label } from "@/domain/taxonomy";
import { getOrgForUserBySlug } from "@/server/organizations";
import { listVacancies, type VacancyWithLocation } from "@/server/vacancies";
import {
  radarForVacancy,
  radarTeaser,
  type RadarDayCount,
  type RadarLimitingCriterion,
  type TalentRadarReport,
} from "@/server/radar";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  Stat,
  cx,
  type BadgeTone,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/* ------------------------------ constanten ------------------------------- */

const PRIVACY_TEKST = "Te weinig kandidaten om dit veilig te tonen";

const VACATURE_STATUS: Record<string, { tekst: string; toon: BadgeTone }> = {
  published: { tekst: "Gepubliceerd", toon: "blauw" },
  draft: { tekst: "Concept", toon: "neutraal" },
};

const MOEILIJKHEID: Record<
  TalentRadarReport["difficulty"],
  { toon: BadgeTone; uitleg: string }
> = {
  laag: { toon: "blauw", uitleg: "10 of meer sterke matches in de regio" },
  gemiddeld: { toon: "wit", uitleg: "3 tot 9 sterke matches in de regio" },
  hoog: { toon: "roze", uitleg: "minder dan 3 sterke matches in de regio" },
};

/* ----------------------------- hulpfuncties ------------------------------ */

/** Concrete duiding van het meest beperkende criterium, privacyveilig. */
function beperkingZin(beperking: RadarLimitingCriterion): string {
  const basis = `Het criterium “${beperking.label}” beperkt je pool het sterkst`;
  if (beperking.extraEligible === null) {
    return `${basis} — zonder deze eis groeit je pool, maar het precieze aantal is te klein om veilig te tonen.`;
  }
  const n = beperking.extraEligible;
  return `${basis} — ${n} extra ${n === 1 ? "kandidaat" : "kandidaten"} zonder deze eis.`;
}

/* ----------------------------- deelweergaven ----------------------------- */

/** Groot cijfer met privacyfallback: null → volledige privacyzin, nooit een klein getal. */
function MaskeerbaarStat({
  waarde,
  omschrijving,
}: {
  waarde: number | null;
  omschrijving: string;
}) {
  if (waarde === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold leading-snug text-ink">
          {PRIVACY_TEKST}
        </p>
        <p className="text-sm font-medium text-ink/70">{omschrijving}</p>
      </div>
    );
  }
  return <Stat value={waarde} label={omschrijving} />;
}

/** Verticale staafjes per gevraagde werkdag — pure CSS, geen chartbibliotheek. */
function DagStaafjes({ perDay }: { perDay: RadarDayCount[] }) {
  const max = Math.max(1, ...perDay.map((rij) => rij.count ?? 0));
  const heeftGemaskeerd = perDay.some((rij) => rij.count === null);

  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label="Beschikbare kandidaten per gevraagde werkdag"
        className="flex items-end justify-start gap-2 sm:gap-3"
      >
        {perDay.map(({ day, count }) => (
          <li key={day} className="flex w-12 flex-col items-center gap-1.5 sm:w-14">
            <span className="sr-only">
              {label(day)}:{" "}
              {count === null
                ? "te weinig kandidaten om dit veilig te tonen"
                : `${count} beschikbare ${count === 1 ? "kandidaat" : "kandidaten"}`}
            </span>
            <span
              aria-hidden="true"
              className="text-sm font-semibold tabular-nums text-ink"
            >
              {count ?? "—"}
            </span>
            <div aria-hidden="true" className="flex h-28 w-full items-end">
              {count === null ? (
                <div className="h-10 w-full rounded-t-lg border-2 border-dashed border-ink/25 bg-white/40" />
              ) : (
                <div
                  className="w-full rounded-t-lg bg-gradient-to-t from-blauw-600 to-blauw-400"
                  style={{ height: `${Math.max(8, (count / max) * 100)}%` }}
                />
              )}
            </div>
            <span
              aria-hidden="true"
              className="text-xs font-semibold capitalize text-ink/70"
            >
              {day}
            </span>
          </li>
        ))}
      </ul>
      {heeftGemaskeerd ? (
        <p className="text-xs font-medium text-ink/60">
          — = {PRIVACY_TEKST.toLowerCase()}
        </p>
      ) : null}
    </div>
  );
}

/** Volledige radarkaart voor één vacature (entitlement talent_radar). */
function RadarKaart({
  slug,
  vacature,
  rapport,
}: {
  slug: string;
  vacature: VacancyWithLocation;
  rapport: TalentRadarReport;
}) {
  const status = VACATURE_STATUS[vacature.status] ?? {
    tekst: vacature.status,
    toon: "neutraal" as BadgeTone,
  };
  const moeilijkheid = MOEILIJKHEID[rapport.difficulty];
  const studioHref = `/praktijk/${slug}/vacatures/${vacature.id}/studio`;

  return (
    <Card strong className="flex flex-col gap-6">
      {/* kop: titel, status en moeilijkheid */}
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
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={moeilijkheid.toon}>
            Moeilijkheid: {rapport.difficulty}
          </Badge>
          <span className="text-xs font-medium text-ink/60">
            {moeilijkheid.uitleg}
          </span>
        </div>
      </div>

      {/* cijfers links, verdeling rechts */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-5">
          <MaskeerbaarStat
            waarde={rapport.totalPotential}
            omschrijving="potentiële kandidaten — juiste rol, binnen reisafstand"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <MaskeerbaarStat
              waarde={rapport.strongMatches}
              omschrijving={`sterke matches — matchscore van ${LABEL_THRESHOLDS.good}% of hoger`}
            />
            <MaskeerbaarStat
              waarde={rapport.partialMatches}
              omschrijving={`gedeeltelijke matches — matchscore ${LABEL_THRESHOLDS.partial}–${LABEL_THRESHOLDS.good - 1}%`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-ink">
            Beschikbaar per gevraagde werkdag
          </h4>
          {rapport.perDay.length > 0 ? (
            <DagStaafjes perDay={rapport.perDay} />
          ) : (
            <p className="text-sm text-ink/70">
              In het rooster van deze vacature zijn nog geen werkdagen
              gevraagd — vul het rooster om de verdeling te zien.
            </p>
          )}
        </div>
      </div>

      {/* meest beperkende criterium */}
      <div className="flex flex-col gap-2 rounded-2xl bg-brand-light/50 p-4">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blauw-700">
          Meest beperkende criterium
        </span>
        {rapport.mostLimiting ? (
          <>
            <p className="text-[15px] leading-relaxed text-ink">
              {beperkingZin(rapport.mostLimiting)}
            </p>
            <Link
              href={studioHref}
              className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
            >
              Versoepel dit in de Match Studio →
            </Link>
          </>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink">
            Geen enkel criterium beperkt je pool op dit moment merkbaar —
            versoepelen levert geen extra kandidaten op.
          </p>
        )}
      </div>
    </Card>
  );
}

/** Teaser-kaart zonder entitlement: alleen het totale potentieel. */
function TeaserKaart({
  vacature,
  totalPotential,
}: {
  vacature: VacancyWithLocation;
  totalPotential: number | null;
}) {
  const status = VACATURE_STATUS[vacature.status] ?? {
    tekst: vacature.status,
    toon: "neutraal" as BadgeTone,
  };

  return (
    <Card className="flex flex-col gap-4">
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
      </div>
      <MaskeerbaarStat
        waarde={totalPotential}
        omschrijving="potentiële kandidaten — juiste rol, binnen reisafstand"
      />
      <p className="text-sm text-ink/70">
        Het volledige rapport — verdeling per werkdag, sterke matches en het
        meest beperkende criterium — hoort bij het Growth-plan.
      </p>
    </Card>
  );
}

/* --------------------------------- pagina -------------------------------- */

interface RadarRij {
  vacature: VacancyWithLocation;
  rapport: TalentRadarReport | null;
  teaserTotaal: number | null;
}

export default async function TalentRadarPagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // De (app)-layout controleert het membership al; hier opnieuw de poort met
  // de capability analytics.view (alle rollen), zodat de tenantisolatie ook
  // zonder layout gegarandeerd is.
  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "analytics.view");
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      notFound();
    }
    throw fout;
  }
  const { org, ctx } = toegang;

  const [alleVacatures, effectief] = await Promise.all([
    listVacancies(ctx),
    effectiveEntitlements(ctx.organizationId),
  ]);

  // Radar toont gepubliceerde vacatures en concepten; gepubliceerd eerst.
  const vacatures = alleVacatures
    .filter((v) => v.status === "published" || v.status === "draft")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "published" ? -1 : 1));

  const heeftRadar = can(effectief.entitlements, "talent_radar");

  const rijen: RadarRij[] = await Promise.all(
    vacatures.map(async (vacature): Promise<RadarRij> => {
      if (heeftRadar) {
        return {
          vacature,
          rapport: await radarForVacancy(ctx, { vacancyId: vacature.id }),
          teaserTotaal: null,
        };
      }
      const teaser = await radarTeaser(ctx, { vacancyId: vacature.id });
      return { vacature, rapport: null, teaserTotaal: teaser.totalPotential };
    }),
  );

  const basis = `/praktijk/${org.slug}`;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Talent"
        accent="Radar"
        description="Hoeveel kandidaten passen er bij elke vacature — en welke eis kost je de meeste matches? Alle cijfers zijn geaggregeerd en privacyveilig."
      />

      {vacatures.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="12" cy="12" r="3.5" fill="currentColor" />
            </svg>
          }
          title="Nog geen vacatures om te peilen"
          description="Maak een vacature aan — de Talent Radar laat dan direct zien hoeveel kandidaten in de regio bij de gevraagde werkweek passen."
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
        <ul className="flex flex-col gap-6">
          {rijen.map(({ vacature, rapport, teaserTotaal }) => (
            <li key={vacature.id}>
              {rapport ? (
                <RadarKaart slug={org.slug} vacature={vacature} rapport={rapport} />
              ) : (
                <TeaserKaart vacature={vacature} totalPotential={teaserTotaal} />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* rustige upgrade-sectie zonder entitlement */}
      {!heeftRadar && vacatures.length > 0 ? (
        <section aria-labelledby="radar-upgrade" className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Volledig rapport"
            title="Meer inzicht met het"
            accent="volledige rapport"
            description="Je ziet nu alleen het totale potentieel per vacature. Het volledige Talent Radar-rapport hoort bij het Growth-plan."
          />
          <h2 id="radar-upgrade" className="sr-only">
            Wat het volledige Talent Radar-rapport biedt
          </h2>
          <Card className="flex flex-col gap-5">
            <ul className="flex flex-col gap-2 text-[15px] leading-relaxed text-ink/80">
              <li className="flex gap-2">
                <span aria-hidden="true" className="font-semibold text-blauw-600">✓</span>
                De verdeling van beschikbare kandidaten over de gevraagde werkdagen
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="font-semibold text-blauw-600">✓</span>
                Sterke versus gedeeltelijke matches, met de gehanteerde scoregrenzen
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="font-semibold text-blauw-600">✓</span>
                Het meest beperkende criterium, met hoeveel kandidaten je zonder die eis extra bereikt
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="font-semibold text-blauw-600">✓</span>
                Een moeilijkheidsinschatting (laag, gemiddeld of hoog) per vacature
              </li>
            </ul>
            <div>
              <Link
                href={`${basis}/abonnement?benodigd=talent_radar`}
                className={cx(
                  "inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white",
                  "shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none",
                )}
              >
                Bekijk de abonnementen
              </Link>
            </div>
            <p className="text-sm text-ink/60">
              Geen verrassingen: je huidige gegevens en vacatures blijven exact
              zoals ze zijn, wat je ook kiest.
            </p>
          </Card>
        </section>
      ) : null}

      <p className="text-sm leading-relaxed text-ink/60">
        Privacy: de Talent Radar toont uitsluitend geaggregeerde aantallen.
        Groepen kleiner dan {TALENT_RADAR_MIN_GROUP} kandidaten worden nooit
        getoond, zodat individuele kandidaten niet herleidbaar zijn.
      </p>
    </div>
  );
}
