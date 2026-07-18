// Matchdetail voor de kandidaat: MatchShape-hero met score en samenvatting,
// zeven benoemde categoriescores, sterke punten en aandachtspunten, de
// werkweek-vergelijking (kandidaat × vacature), opportunities ("Wat deze
// match nog sterker maakt"), praktijkinfo en de primaire actie: solliciteren.
//
// match_viewed wordt bij het laden getrackt (fire-and-forget) — track()
// faalt nooit hard en mag het renderen niet vertragen.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { PracticeLocation, Vacancy } from "@prisma/client";
import { requireCandidate } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { DAYPARTS, WEEKDAYS, label } from "@/domain/taxonomy";
import type { CategoryScores, MatchReason } from "@/domain/matching";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { castAvailability, profileToMatchCandidate } from "@/server/candidates";
import { castSchedule, vacancyToMatchVacancy } from "@/server/vacancies";
import { FEEDBACK_REASON_LABELS } from "@/server/pipeline";
import { MatchShape, type MatchShapeDimensions } from "@/components/MatchShape";
import { WeekGrid } from "@/components/WeekGrid";
import {
  Badge,
  Button,
  Card,
  Field,
  ProgressBar,
  ScoreBadge,
  SectionHeading,
  Select,
  Textarea,
  cx,
} from "@/components/ui";
import { SolliciteerForm } from "./solliciteer-form";
import { trekTerugAction } from "./actions";

export const dynamic = "force-dynamic";

/* ------------------------------ hulpfuncties ------------------------------ */

type VacatureMetContext = Vacancy & {
  location: PracticeLocation;
  organization: { name: string };
};

/** Gepubliceerde vacature van een actieve organisatie — zichtbaar voor kandidaten. */
async function vindGepubliceerdeVacature(
  vacancyId: string,
): Promise<VacatureMetContext | null> {
  return prisma.vacancy.findFirst({
    where: {
      id: vacancyId,
      status: "published",
      organization: { status: "active" },
    },
    include: { location: true, organization: { select: { name: true } } },
  });
}

/** Categoriescores (0–100) → de vijf visuele dimensies (0–1) van MatchShape. */
function shapeDimensies(scores: CategoryScores): MatchShapeDimensions {
  return {
    availability: scores.availability / 100,
    location: scores.travel / 100,
    content: scores.specializations / 100,
    technology: scores.equipmentAndSoftware / 100,
    culture: scores.workplacePreferences / 100,
  };
}

/** Korte uren/dagen-samenvatting, bv. "24–32 uur p/w · Di, Wo, Vr". */
function urenDagenSamenvatting(vacature: Vacancy): string {
  const uren =
    vacature.hoursMin === vacature.hoursMax
      ? `${vacature.hoursMin} uur p/w`
      : `${vacature.hoursMin}–${vacature.hoursMax} uur p/w`;
  const rooster = castSchedule(vacature.schedule);
  const dagen = WEEKDAYS.filter((dag) =>
    DAYPARTS.some((dagdeel) => rooster[dag][dagdeel] !== null),
  );
  if (dagen.length === 0) return uren;
  return `${uren} · ${dagen
    .map((dag) => dag.charAt(0).toUpperCase() + dag.slice(1))
    .join(", ")}`;
}

/** De zeven matchcategorieën met Nederlandse namen, in vaste volgorde. */
const CATEGORIEEN: ReadonlyArray<{ sleutel: keyof CategoryScores; naam: string }> = [
  { sleutel: "availability", naam: "Beschikbaarheid" },
  { sleutel: "roleAndExperience", naam: "Rol en ervaring" },
  { sleutel: "travel", naam: "Reisafstand" },
  { sleutel: "employment", naam: "Contract en uren" },
  { sleutel: "equipmentAndSoftware", naam: "Apparatuur en software" },
  { sleutel: "specializations", naam: "Specialisaties en behandelingen" },
  { sleutel: "workplacePreferences", naam: "Werkplekvoorkeuren" },
];

const SOLLICITATIE_STATUS: Record<string, string> = {
  submitted: "Verstuurd — wacht op reactie van de praktijk",
  in_review: "In behandeling bij de praktijk",
  interview: "Uitgenodigd voor een kennismakingsgesprek",
  offered: "Je hebt een aanbod ontvangen",
  hired: "Aangenomen — gefeliciteerd!",
  rejected: "Afgewezen door de praktijk",
  withdrawn: "Door jou teruggetrokken",
};

/* -------------------------------- iconen ---------------------------------- */

function SterkPuntIcoon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-3.5 w-3.5 shrink-0">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AandachtIcoon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-3.5 w-3.5 shrink-0">
      <path d="M8 3v6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="12.25" r="1.25" fill="currentColor" />
    </svg>
  );
}

function RedenLijst({
  redenen,
  toon,
}: {
  redenen: MatchReason[];
  toon: "sterk" | "aandacht" | "blokkade";
}) {
  const stijl =
    toon === "sterk"
      ? { chip: "bg-emerald-100 text-emerald-900", icoon: <SterkPuntIcoon /> }
      : toon === "aandacht"
        ? { chip: "bg-amber-100 text-amber-900", icoon: <AandachtIcoon /> }
        : { chip: "bg-red-100 text-red-900", icoon: <AandachtIcoon /> };

  return (
    <ul className="flex flex-col gap-2.5">
      {redenen.map((reden) => (
        <li key={reden.code} className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className={cx(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              stijl.chip,
            )}
          >
            {stijl.icoon}
          </span>
          <span className="text-[15px] leading-relaxed text-ink/85">
            {reden.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- pagina --------------------------------- */

export default async function MatchDetailPagina({
  params,
}: {
  params: Promise<{ vacancyId: string }>;
}) {
  const { user, profile } = await requireCandidate();
  if (!profile) redirect("/kandidaat/onboarding");

  const { vacancyId } = await params;
  const vacature = await vindGepubliceerdeVacature(vacancyId);
  if (!vacature) notFound();

  const { location: locatie, organization } = vacature;
  const result = computeMatchWithOpportunities(
    profileToMatchCandidate(profile),
    vacancyToMatchVacancy(vacature, locatie),
  );

  const sollicitatie = await prisma.application.findUnique({
    where: {
      vacancyId_candidateUserId: {
        vacancyId: vacature.id,
        candidateUserId: user.id,
      },
    },
    select: { id: true, status: true, createdAt: true },
  });

  // Fire-and-forget: track() faalt nooit hard en houdt het renderen niet op.
  void track("match_viewed", {
    userId: user.id,
    candidateId: profile.id,
    organizationId: vacature.organizationId,
    locationId: vacature.locationId,
    context: { vacancyId: vacature.id, score: result.score },
  });

  const verbeterkansen = result.opportunities.filter(
    (kans) => kans.projectedScore > result.score,
  );

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Kruimelpad">
        <Link
          href="/kandidaat"
          className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
        >
          ← Terug naar je matches
        </Link>
      </nav>

      {/* hero: vorm + score + samenvatting */}
      <Card strong className="flex flex-col items-center gap-4 text-center">
        <MatchShape
          score={result.score}
          dimensions={shapeDimensies(result.categoryScores)}
          size="hero"
        />
        <ScoreBadge score={result.score} label={result.label} />
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {vacature.title}
          </h1>
          <p className="text-sm font-medium text-ink/70">
            {organization.name} · {locatie.city} · {urenDagenSamenvatting(vacature)}
          </p>
          <p className="text-[16px] leading-relaxed text-ink/80">{result.summary}</p>
        </div>
      </Card>

      {!result.eligible && result.hardMismatchReasons.length > 0 ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">
            Waarom deze match nu niet mogelijk is
          </h2>
          <RedenLijst redenen={result.hardMismatchReasons} toon="blokkade" />
        </Card>
      ) : null}

      {/* categoriescores */}
      <section aria-labelledby="categorie-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Opbouw van de score"
          title="Zo is dit percentage"
          accent="opgebouwd"
        />
        <h2 id="categorie-titel" className="sr-only">
          Score per categorie
        </h2>
        <Card className="flex flex-col gap-4">
          {CATEGORIEEN.map(({ sleutel, naam }) => (
            <div key={sleutel} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{naam}</span>
                <span className="text-sm font-semibold tabular-nums text-ink/70">
                  {Math.round(result.categoryScores[sleutel])}%
                </span>
              </div>
              <ProgressBar value={result.categoryScores[sleutel]} label={naam} />
            </div>
          ))}
        </Card>
      </section>

      {/* sterke punten en aandachtspunten */}
      <section aria-label="Sterke punten en aandachtspunten" className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Sterke punten</h2>
          {result.strengths.length > 0 ? (
            <RedenLijst redenen={result.strengths} toon="sterk" />
          ) : (
            <p className="text-[15px] text-ink/70">
              Geen uitgesproken sterke punten — bekijk hieronder wat deze match
              sterker maakt.
            </p>
          )}
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-ink">Aandachtspunten</h2>
          {result.attentionPoints.length > 0 ? (
            <RedenLijst redenen={result.attentionPoints} toon="aandacht" />
          ) : (
            <p className="text-[15px] text-ink/70">
              Geen aandachtspunten gevonden voor deze match.
            </p>
          )}
        </Card>
      </section>

      {/* werkweek-vergelijking */}
      <section aria-labelledby="werkweek-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Werkweek"
          title="Jouw beschikbaarheid naast het"
          accent="rooster"
          description="Per dagdeel zie je waar jouw werkweek en de gevraagde dagen van de vacature elkaar raken."
        />
        <h2 id="werkweek-titel" className="sr-only">
          Werkweek-vergelijking
        </h2>
        <Card>
          <WeekGrid
            mode="overlay"
            candidateAvailability={castAvailability(profile.availability)}
            vacancySchedule={castSchedule(vacature.schedule)}
          />
        </Card>
      </section>

      {/* opportunities */}
      {verbeterkansen.length > 0 ? (
        <section aria-labelledby="kansen-titel" className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Maak deze match mogelijk"
            title="Wat deze match nog sterker"
            accent="maakt"
          />
          <h2 id="kansen-titel" className="sr-only">
            Wat deze match nog sterker maakt
          </h2>
          <div className="flex flex-col gap-4">
            {verbeterkansen.map((kans) => (
              <Card key={kans.code} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-ink">{kans.title}</h3>
                  <Badge tone="roze">
                    stijgt naar {Math.round(kans.projectedScore)}%
                  </Badge>
                </div>
                <p className="text-[15px] leading-relaxed text-ink/80">
                  {kans.explanation}
                </p>
                <p className="text-sm font-medium text-ink/70">
                  Hiermee stijgt de match van {Math.round(result.score)}% naar{" "}
                  {Math.round(kans.projectedScore)}%.
                  {kans.requiresPracticeApproval ? " In overleg met de praktijk." : ""}
                </p>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {/* praktijkinfo */}
      <section aria-labelledby="praktijk-titel" className="flex flex-col gap-4">
        <SectionHeading eyebrow="De praktijk" title="Over" accent={organization.name} />
        <h2 id="praktijk-titel" className="sr-only">
          Over de praktijk
        </h2>
        <Card className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink/60">
              Locatie
            </h3>
            <p className="text-[15px] leading-relaxed text-ink">
              {locatie.name}
              <br />
              {locatie.street && locatie.houseNumber
                ? `${locatie.street} ${locatie.houseNumber}, `
                : null}
              {locatie.postcode} {locatie.city}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink/60">
              Apparatuur
            </h3>
            {locatie.equipment.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {locatie.equipment.map((sleutel) => (
                  <li key={sleutel}>
                    <Badge tone="wit">{label(sleutel)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink/70">Niet opgegeven</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink/60">
              Cultuur
            </h3>
            {vacature.culture.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {vacature.culture.map((sleutel) => (
                  <li key={sleutel}>
                    <Badge tone="blauw">{label(sleutel)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink/70">Niet opgegeven</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-ink/60">
              Begeleiding en ontwikkeling
            </h3>
            <p className="text-[15px] leading-relaxed text-ink">
              {vacature.mentorship
                ? "Begeleiding door een ervaren collega is beschikbaar."
                : "Geen vaste begeleiding opgegeven."}
            </p>
            {vacature.development.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {vacature.development.map((sleutel) => (
                  <li key={sleutel}>
                    <Badge tone="roze">{label(sleutel)}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Card>
      </section>

      {/* primaire actie: solliciteren */}
      <section aria-labelledby="solliciteren-titel" className="flex flex-col gap-4">
        <h2 id="solliciteren-titel" className="sr-only">
          Solliciteren
        </h2>
        {sollicitatie ? (
          <Card strong className="flex flex-col gap-3">
            <h3 className="text-lg font-semibold text-ink">Je sollicitatie</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="blauw">
                {SOLLICITATIE_STATUS[sollicitatie.status] ?? sollicitatie.status}
              </Badge>
              <span className="text-sm text-ink/60">
                Verstuurd op{" "}
                {sollicitatie.createdAt.toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
            {["submitted", "in_review", "interview", "offered"].includes(
              sollicitatie.status,
            ) ? (
              <details className="rounded-2xl bg-white/60 px-4 py-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink/70">
                  Sollicitatie intrekken
                </summary>
                <form
                  action={trekTerugAction.bind(null, vacature.id, sollicitatie.id)}
                  className="mt-3 flex flex-col gap-3"
                >
                  <Field
                    label="Reden"
                    htmlFor="intrekken-reden"
                    hint="Optioneel — je reden helpt ons betere matches voor je te vinden."
                  >
                    <Select
                      id="intrekken-reden"
                      name="reasonCode"
                      defaultValue=""
                      className="sm:max-w-72"
                    >
                      <option value="">Liever geen reden opgeven</option>
                      {Object.entries(FEEDBACK_REASON_LABELS).map(
                        ([code, tekst]) => (
                          <option key={code} value={code}>
                            {tekst}
                          </option>
                        ),
                      )}
                    </Select>
                  </Field>
                  <Field label="Toelichting" htmlFor="intrekken-note">
                    <Textarea
                      id="intrekken-note"
                      name="note"
                      rows={3}
                      maxLength={500}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    className="self-start"
                  >
                    Sollicitatie intrekken
                  </Button>
                </form>
              </details>
            ) : null}
          </Card>
        ) : result.eligible ? (
          <Card strong className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-ink">
                Solliciteer bij {organization.name}
              </h3>
              <p className="text-[15px] leading-relaxed text-ink/70">
                De praktijk ziet je matchpercentage met de volledige uitleg en —
                als je solliciteert — je naam en motivatie.
              </p>
            </div>
            <SolliciteerForm
              vacancyId={vacature.id}
              praktijkNaam={organization.name}
            />
          </Card>
        ) : (
          <Card className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold text-ink">
              Solliciteren is nu niet mogelijk
            </h3>
            <p className="text-[15px] leading-relaxed text-ink/70">
              Deze match heeft een blokkerend verschil (zie hierboven). Pas je
              profiel of beschikbaarheid aan, of bekijk de kansen onder “Wat
              deze match nog sterker maakt”.
            </p>
          </Card>
        )}
      </section>
    </div>
  );
}
