// Matchfeed van de kandidaat: begroeting + profielvolledigheid, openstaande
// uitnodigingen van praktijken prominent bovenaan, daarna de matchkaarten
// (alleen eligible matches, gesorteerd door de servicelaag). match_viewed
// wordt pas op de detailpagina getrackt — niet hier in de feed.

import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthzError, requireCandidate } from "@/lib/authz";
import {
  matchesForCandidate,
  type CandidateVacancyMatch,
} from "@/server/matching";
import {
  listInvitationsForCandidate,
  respondToInvitation,
  type CandidateInvitationEntry,
} from "@/server/invitations";
import { castSchedule } from "@/server/vacancies";
import { DAYPARTS, WEEKDAYS, label } from "@/domain/taxonomy";
import type { CategoryScores, MatchLabel } from "@/domain/matching";
import { MatchShape, type MatchShapeDimensions } from "@/components/MatchShape";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  ScoreBadge,
  SectionHeading,
} from "@/components/ui";

export const dynamic = "force-dynamic";

/* ------------------------------ hulpfuncties ------------------------------ */

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
function urenDagenSamenvatting(match: CandidateVacancyMatch): string {
  const { vacancy } = match;
  const uren =
    vacancy.hoursMin === vacancy.hoursMax
      ? `${vacancy.hoursMin} uur p/w`
      : `${vacancy.hoursMin}–${vacancy.hoursMax} uur p/w`;

  const rooster = castSchedule(vacancy.schedule);
  const dagen = WEEKDAYS.filter((dag) =>
    DAYPARTS.some((dagdeel) => rooster[dag][dagdeel] !== null),
  );
  if (dagen.length === 0) return uren;
  const dagLabels = dagen
    .map((dag) => dag.charAt(0).toUpperCase() + dag.slice(1))
    .join(", ");
  return `${uren} · ${dagLabels}`;
}

/* ------------------------------ server action ----------------------------- */

async function beantwoordUitnodiging(
  invitationId: string,
  geaccepteerd: boolean,
): Promise<void> {
  "use server";
  await requireCandidate();
  try {
    await respondToInvitation(invitationId, geaccepteerd);
  } catch (fout) {
    // Al beantwoord of niet (meer) gevonden: de feed toont na revalidatie
    // gewoon de actuele status — geen harde fout richting de kandidaat.
    if (!(fout instanceof AuthzError)) throw fout;
  }
  revalidatePath("/kandidaat");
}

/* --------------------------------- pagina --------------------------------- */

export default async function MatchfeedPagina() {
  const { user, profile } = await requireCandidate();
  if (!profile) redirect("/kandidaat/onboarding");

  const [matches, uitnodigingen] = await Promise.all([
    matchesForCandidate(profile),
    listInvitationsForCandidate(),
  ]);

  const zichtbareMatches = matches.filter((match) => match.result.eligible);
  const voornaam = user.name.split(" ")[0] ?? user.name;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Hallo"
        accent={voornaam}
        description="Dit zijn de praktijken die nu bij jouw werkweek en wensen passen."
      />

      {profile.completenessScore < 100 ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">
              Je profiel is nog niet compleet
            </h2>
            <Link
              href="/kandidaat/profiel"
              className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
            >
              Profiel aanvullen
            </Link>
          </div>
          <ProgressBar
            value={profile.completenessScore}
            label="Profielvolledigheid"
            showValue
          />
          <p className="text-sm text-ink/70">
            Hoe completer je profiel, hoe scherper je matches en hoe beter
            praktijken zien wat jij zoekt.
          </p>
        </Card>
      ) : null}

      {uitnodigingen.length > 0 ? (
        <section
          id="uitnodigingen"
          aria-labelledby="uitnodigingen-titel"
          className="flex scroll-mt-24 flex-col gap-4"
        >
          <SectionHeading
            eyebrow="Voor jou"
            title="Uitnodigingen van"
            accent="praktijken"
            description="Deze praktijken zagen jouw profiel en nodigen je persoonlijk uit."
          />
          <h2 id="uitnodigingen-titel" className="sr-only">
            Uitnodigingen van praktijken
          </h2>
          <div className="flex flex-col gap-4">
            {uitnodigingen.map((entry) => (
              <UitnodigingsKaart key={entry.invitation.id} entry={entry} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="matches-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Matchfeed"
          title="Jouw"
          accent="matches"
          description={
            zichtbareMatches.length > 0
              ? `${zichtbareMatches.length} ${
                  zichtbareMatches.length === 1 ? "vacature past" : "vacatures passen"
                } bij jouw profiel — de sterkste match staat bovenaan.`
              : undefined
          }
        />
        <h2 id="matches-titel" className="sr-only">
          Jouw matches
        </h2>

        {zichtbareMatches.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
                <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M15 15l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
            title="Nog geen matches gevonden"
            description="Er is op dit moment geen gepubliceerde vacature die bij je profiel past. Tip: verruim je beschikbaarheid met een extra dag of dagdeel — dat opent vaak direct nieuwe matches."
            action={
              <Link
                href="/kandidaat/profiel"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
              >
                Beschikbaarheid aanpassen
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {zichtbareMatches.map((match) => (
              <li key={match.vacancy.id}>
                <MatchKaart match={match} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------- deelweergaven ---------------------------- */

const UITNODIGING_STATUS: Record<string, { tekst: string; toon: "blauw" | "roze" | "neutraal" }> = {
  accepted: { tekst: "Geaccepteerd", toon: "blauw" },
  declined: { tekst: "Afgeslagen", toon: "neutraal" },
  expired: { tekst: "Verlopen", toon: "neutraal" },
};

function UitnodigingsKaart({ entry }: { entry: CandidateInvitationEntry }) {
  const { invitation, vacancy, location, organizationName, snapshot } = entry;
  const beantwoord = invitation.status !== "sent";
  const statusWeergave = UITNODIGING_STATUS[invitation.status];

  return (
    <Card strong className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Badge tone="roze">Persoonlijke uitnodiging</Badge>
          <h3 className="mt-1 text-lg font-semibold text-ink">{vacancy.title}</h3>
          <p className="text-sm text-ink/70">
            {organizationName} · {location.city}
          </p>
        </div>
        {snapshot ? (
          <ScoreBadge score={snapshot.score} label={snapshot.label as MatchLabel} />
        ) : null}
      </div>

      {invitation.message ? (
        <blockquote className="rounded-2xl bg-brand-light/50 px-4 py-3 text-[15px] leading-relaxed text-ink/85">
          “{invitation.message}”
        </blockquote>
      ) : null}

      {beantwoord ? (
        <div className="flex flex-wrap items-center gap-3">
          {statusWeergave ? (
            <Badge tone={statusWeergave.toon}>{statusWeergave.tekst}</Badge>
          ) : null}
          <Link
            href={`/kandidaat/matches/${vacancy.id}`}
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Bekijk de match
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <form action={beantwoordUitnodiging.bind(null, invitation.id, true)}>
            <Button type="submit" size="sm">
              Accepteren
            </Button>
          </form>
          <form action={beantwoordUitnodiging.bind(null, invitation.id, false)}>
            <Button type="submit" variant="secondary" size="sm">
              Afslaan
            </Button>
          </form>
          <Link
            href={`/kandidaat/matches/${vacancy.id}`}
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Eerst de match bekijken
          </Link>
        </div>
      )}
    </Card>
  );
}

function MatchKaart({ match }: { match: CandidateVacancyMatch }) {
  const { vacancy, location, organizationName, result } = match;
  const sterksteMatchpunt = result.strengths[0]?.message;

  return (
    <Card className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <MatchShape
        score={result.score}
        dimensions={shapeDimensies(result.categoryScores)}
        size="compact"
        className="shrink-0"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ScoreBadge score={result.score} label={result.label} />
        </div>
        <h3 className="text-lg font-semibold leading-snug text-ink">
          {vacancy.title}
        </h3>
        <p className="text-sm text-ink/70">
          {organizationName} · {location.city} · {label(vacancy.role)}
        </p>
        {sterksteMatchpunt ? (
          <p className="text-[15px] leading-relaxed text-ink/85">
            {sterksteMatchpunt}
          </p>
        ) : null}
        <p className="text-sm font-medium text-ink/60">
          {urenDagenSamenvatting(match)}
        </p>
      </div>

      <div className="shrink-0">
        <Link
          href={`/kandidaat/matches/${vacancy.id}`}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
        >
          Bekijk match
        </Link>
      </div>
    </Card>
  );
}
