// Pipeline-overzicht van de praktijk: per vacature alle kandidaten uit
// uitnodigingen, sollicitaties en gesprekken samengevoegd, met status-badges,
// laatste activiteit, de match (score + maximaal drie redenen +
// aandachtspunten), een uitklapbare statushistorie en acties per fase:
// gesprek voorstellen (drie datumtijd-velden), aanbod doen, aannemen en
// afwijzen (verplichte redencode + optionele toelichting).
//
// Privacy: de naam is alleen zichtbaar bij visibility "visible", na expliciete
// consent van de kandidaat of bij een sollicitatie; anders een geanonimiseerd
// label met de hint dat de naam pas na toestemming zichtbaar wordt.

import Link from "next/link";
import { getOrgForUserBySlug } from "@/server/organizations";
import { listVacancies, type VacancyWithLocation } from "@/server/vacancies";
import {
  listPipelineForVacancy,
  FEEDBACK_REASON_LABELS,
  PIPELINE_STATUS_LABELS,
  type PipelineCandidateEntry,
  type PipelineStatus,
} from "@/server/pipeline";
import { label } from "@/domain/taxonomy";
import type { MatchLabel } from "@/domain/matching";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  ScoreBadge,
  Select,
  SectionHeading,
  Textarea,
  type BadgeTone,
} from "@/components/ui";
import {
  stelGesprekVoorAction,
  wijsAfAction,
  zetStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";

/* ------------------------------ hulpfuncties ------------------------------ */

const STATUS_TONEN: Record<PipelineStatus, BadgeTone> = {
  matched: "neutraal",
  invited: "blauw",
  interested: "roze",
  applied: "blauw",
  interview_proposed: "roze",
  interview_scheduled: "roze",
  offer: "roze",
  hired: "blauw",
  declined: "neutraal",
  rejected: "neutraal",
  withdrawn: "neutraal",
  expired: "neutraal",
};

const ACTOR_LABELS: Record<string, string> = {
  practice: "praktijk",
  candidate: "kandidaat",
  system: "systeem",
};

function fmtDatum(datum: Date): string {
  return datum.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtDatumTijd(datum: Date): string {
  return datum.toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabelVan(status: string): string {
  return (
    PIPELINE_STATUS_LABELS[status as PipelineStatus] ?? status
  );
}

/** Afgerond traject: geen acties meer. */
function isAfgerond(status: PipelineStatus): boolean {
  return ["hired", "rejected", "declined", "withdrawn"].includes(status);
}

/* --------------------------------- pagina --------------------------------- */

export default async function PipelinePagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, ctx } = await getOrgForUserBySlug(slug, "pipeline.manage");

  const vacatures = await listVacancies(ctx);
  const perVacature = await Promise.all(
    vacatures.map(async (vacature) => ({
      vacature,
      entries: await listPipelineForVacancy(ctx, vacature.id),
    })),
  );
  const metKandidaten = perVacature.filter(({ entries }) => entries.length > 0);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Pipeline van"
        accent={org.name}
        description="Van match naar gesprek en plaatsing: alle kandidaten per vacature, met status, historie en de volgende stap."
      />

      {metKandidaten.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          }
          title="Nog geen kandidaten in de pipeline"
          description="Nodig kandidaten uit via de Match Studio of wacht op sollicitaties — zodra iemand reageert verschijnt het traject hier."
          action={
            <Link
              href={`/praktijk/${org.slug}`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Naar het dashboard
            </Link>
          }
        />
      ) : (
        metKandidaten.map(({ vacature, entries }) => (
          <VacaturePipeline
            key={vacature.id}
            slug={org.slug}
            vacature={vacature}
            entries={entries}
          />
        ))
      )}
    </div>
  );
}

/* ------------------------------- deelweergaven ---------------------------- */

function VacaturePipeline({
  slug,
  vacature,
  entries,
}: {
  slug: string;
  vacature: VacancyWithLocation;
  entries: PipelineCandidateEntry[];
}) {
  return (
    <section
      aria-label={`Pipeline van ${vacature.title}`}
      className="flex flex-col gap-4"
    >
      <SectionHeading
        eyebrow={`${label(vacature.role)} · ${vacature.location.city}`}
        title={vacature.title}
        description={`${entries.length} ${entries.length === 1 ? "kandidaat" : "kandidaten"} in de pipeline.`}
      />
      <div className="flex flex-col gap-4">
        {entries.map((entry) => (
          <KandidaatKaart
            key={entry.candidateUserId}
            slug={slug}
            vacancyId={vacature.id}
            entry={entry}
          />
        ))}
      </div>
    </section>
  );
}

function KandidaatKaart({
  slug,
  vacancyId,
  entry,
}: {
  slug: string;
  vacancyId: string;
  entry: PipelineCandidateEntry;
}) {
  const afgerond = isAfgerond(entry.status);
  const kanGesprek =
    !afgerond &&
    ["invited", "interested", "applied", "matched"].includes(entry.status);
  const kanAanbod =
    !afgerond &&
    ["interested", "applied", "interview_proposed", "interview_scheduled"].includes(
      entry.status,
    );
  const kanAannemen =
    !afgerond && ["interview_scheduled", "offer"].includes(entry.status);

  return (
    <Card className="flex flex-col gap-4">
      {/* kop: naam, score, status, activiteit */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">
              {entry.displayName}
            </h3>
            {entry.score !== null && entry.scoreLabel ? (
              <ScoreBadge
                score={entry.score}
                label={entry.scoreLabel as MatchLabel}
                className="px-2.5 py-0.5 text-xs"
              />
            ) : null}
            <Badge tone={STATUS_TONEN[entry.status]}>
              {PIPELINE_STATUS_LABELS[entry.status]}
            </Badge>
          </div>
          {!entry.naamZichtbaar ? (
            <p className="text-xs font-medium text-ink/60">
              Naam zichtbaar na toestemming van de kandidaat.
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs font-medium text-ink/60">
          Laatste activiteit: {fmtDatum(entry.lastActivity)}
        </span>
      </div>

      {/* match: redenen + aandachtspunten compact */}
      {entry.matchRedenen.length > 0 || entry.aandachtspunten.length > 0 ? (
        <div className="grid gap-3 rounded-2xl bg-brand-light/40 p-4 sm:grid-cols-2">
          {entry.matchRedenen.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                Waarom dit past
              </h4>
              <ul className="flex flex-col gap-1">
                {entry.matchRedenen.map((reden) => (
                  <li key={reden} className="text-sm leading-relaxed text-ink/85">
                    ✓ {reden}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {entry.aandachtspunten.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                Aandachtspunten
              </h4>
              <ul className="flex flex-col gap-1">
                {entry.aandachtspunten.map((punt) => (
                  <li key={punt} className="text-sm leading-relaxed text-ink/75">
                    • {punt}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* gesprek: voorstel of bevestiging */}
      {entry.interview?.status === "proposed" ? (
        <p className="text-sm font-medium text-ink/75">
          Gesprek voorgesteld — wacht op de kandidaat.{" "}
          {entry.interviewSlots
            .map((slot) => fmtDatumTijd(new Date(slot.startsAt)))
            .join(" · ")}
        </p>
      ) : null}
      {entry.interview?.status === "confirmed" && entry.interview.chosenSlot ? (
        <p className="text-sm font-semibold text-blauw-800">
          Gesprek bevestigd: {fmtDatumTijd(entry.interview.chosenSlot)}
        </p>
      ) : null}

      {/* statushistorie, uitklapbaar */}
      {entry.history.length > 0 ? (
        <details className="rounded-2xl bg-white/60 px-4 py-3">
          <summary className="-my-3 cursor-pointer py-3 text-sm font-semibold text-blauw-700">
            Statushistorie ({entry.history.length})
          </summary>
          <ol className="mt-3 flex flex-col gap-2 border-l-2 border-brand-light pl-4">
            {entry.history.map((wijziging) => (
              <li key={wijziging.id} className="text-sm text-ink/80">
                <span className="font-semibold text-ink">
                  {statusLabelVan(wijziging.toStatus)}
                </span>{" "}
                <span className="text-ink/60">
                  — {fmtDatumTijd(wijziging.createdAt)} · door{" "}
                  {ACTOR_LABELS[wijziging.actorType] ?? wijziging.actorType}
                  {wijziging.reasonCode
                    ? ` · ${
                        FEEDBACK_REASON_LABELS[
                          wijziging.reasonCode as keyof typeof FEEDBACK_REASON_LABELS
                        ] ?? wijziging.reasonCode
                      }`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {/* acties per fase */}
      {!afgerond ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {kanAanbod ? (
              <form
                action={zetStatusAction.bind(
                  null,
                  slug,
                  vacancyId,
                  entry.candidateUserId,
                  "offer",
                )}
              >
                <Button type="submit" size="sm">
                  Aanbod doen
                </Button>
              </form>
            ) : null}
            {kanAannemen ? (
              <form
                action={zetStatusAction.bind(
                  null,
                  slug,
                  vacancyId,
                  entry.candidateUserId,
                  "hired",
                )}
              >
                <Button type="submit" size="sm">
                  Aannemen
                </Button>
              </form>
            ) : null}
          </div>

          {kanGesprek ? (
            <details className="rounded-2xl bg-white/60 px-4 py-3">
              <summary className="-my-3 cursor-pointer py-3 text-sm font-semibold text-blauw-700">
                Gesprek voorstellen
              </summary>
              <form
                action={stelGesprekVoorAction.bind(
                  null,
                  slug,
                  vacancyId,
                  entry.candidateUserId,
                )}
                className="mt-3 flex flex-col gap-3"
              >
                <p className="text-sm text-ink/70">
                  Stel maximaal drie momenten voor; de kandidaat kiest er één.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Moment 1" htmlFor={`slot1-${entry.candidateUserId}`} required>
                    <Input
                      id={`slot1-${entry.candidateUserId}`}
                      name="slot1"
                      type="datetime-local"
                      required
                    />
                  </Field>
                  <Field label="Moment 2" htmlFor={`slot2-${entry.candidateUserId}`}>
                    <Input
                      id={`slot2-${entry.candidateUserId}`}
                      name="slot2"
                      type="datetime-local"
                    />
                  </Field>
                  <Field label="Moment 3" htmlFor={`slot3-${entry.candidateUserId}`}>
                    <Input
                      id={`slot3-${entry.candidateUserId}`}
                      name="slot3"
                      type="datetime-local"
                    />
                  </Field>
                </div>
                <Field label="Duur" htmlFor={`duur-${entry.candidateUserId}`}>
                  <Select
                    id={`duur-${entry.candidateUserId}`}
                    name="duurMinuten"
                    defaultValue="45"
                    className="sm:max-w-48"
                  >
                    <option value="30">30 minuten</option>
                    <option value="45">45 minuten</option>
                    <option value="60">60 minuten</option>
                  </Select>
                </Field>
                <Button type="submit" size="sm" className="self-start">
                  Voorstel versturen
                </Button>
              </form>
            </details>
          ) : null}

          <details className="rounded-2xl bg-white/60 px-4 py-3">
            <summary className="-my-3 cursor-pointer py-3 text-sm font-semibold text-ink/70">
              Afwijzen
            </summary>
            <form
              action={wijsAfAction.bind(
                null,
                slug,
                vacancyId,
                entry.candidateUserId,
              )}
              className="mt-3 flex flex-col gap-3"
            >
              <Field
                label="Reden"
                htmlFor={`reden-${entry.candidateUserId}`}
                required
                hint="De kandidaat ziet deze reden niet één-op-één; hij verbetert de matching."
              >
                <Select
                  id={`reden-${entry.candidateUserId}`}
                  name="reasonCode"
                  required
                  defaultValue=""
                  className="sm:max-w-72"
                >
                  <option value="" disabled>
                    Kies een reden…
                  </option>
                  {Object.entries(FEEDBACK_REASON_LABELS).map(([code, tekst]) => (
                    <option key={code} value={code}>
                      {tekst}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Toelichting"
                htmlFor={`note-${entry.candidateUserId}`}
                hint="Optioneel, max 500 tekens. E-mailadressen en telefoonnummers worden verwijderd."
              >
                <Textarea
                  id={`note-${entry.candidateUserId}`}
                  name="note"
                  rows={3}
                  maxLength={500}
                />
              </Field>
              <Button type="submit" variant="danger" size="sm" className="self-start">
                Kandidaat afwijzen
              </Button>
            </form>
          </details>
        </div>
      ) : null}
    </Card>
  );
}
