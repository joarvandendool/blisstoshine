// Uitnodigingen van de kandidaat: per uitnodiging de praktijk, vacature,
// matchscore met de redenen waarom de praktijk past, de persoonlijke
// boodschap, en de acties "Ik heb interesse" (met expliciete consent-keuze
// voor naam + contactgegevens) en "Afwijzen" (met optionele gestructureerde
// reden). Ligt er een gespreksvoorstel, dan kiest de kandidaat hier een
// moment (radio-kaarten) en volgt een bevestigingsscherm met MatchShape.
//
// Privacyduidelijkheid: vóór de interesse-actie staat precies wat de praktijk
// nu al ziet (functie, regio, ervaring, dagen, apparatuur, specialisaties,
// matchredenen) en wat er pas ná toestemming wordt gedeeld (naam, e-mail).
//
// Bij het openen van deze pagina worden nieuwe uitnodigingen als gezien
// beschouwd (invitation_viewed + notificatie op gelezen).

import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCandidate } from "@/lib/authz";
import {
  listInvitationsForCandidate,
  markInvitationsViewed,
  type CandidateInvitationEntry,
} from "@/server/invitations";
import {
  FEEDBACK_REASON_LABELS,
  listInterviewsForCandidate,
  redenenUitSnapshot,
  type CandidateInterviewEntry,
} from "@/server/pipeline";
import { castAvailability } from "@/server/candidates";
import { geocodePostcode } from "@/server/geo";
import { DAYPARTS, WEEKDAYS, label } from "@/domain/taxonomy";
import type { MatchLabel } from "@/domain/matching";
import type { CandidateProfile, User } from "@prisma/client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ScoreBadge,
  Select,
  SectionHeading,
  Textarea,
  cx,
} from "@/components/ui";
import {
  bevestigGesprekAction,
  toonInteresseAction,
  wijsUitnodigingAfAction,
} from "./actions";

export const dynamic = "force-dynamic";

/* ------------------------------ hulpfuncties ------------------------------ */

const ERVARING_LABELS: Record<string, string> = {
  starter: "Starter",
  medior: "Medior",
  senior: "Senior",
};

const UITNODIGING_STATUS: Record<
  string,
  { tekst: string; toon: "blauw" | "roze" | "neutraal" }
> = {
  accepted: { tekst: "Interesse getoond", toon: "roze" },
  declined: { tekst: "Afgewezen", toon: "neutraal" },
  expired: { tekst: "Verlopen", toon: "neutraal" },
};

function fmtSlot(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Werkdagen waarop de kandidaat (deels) beschikbaar is, bv. "Di, Do, Vr". */
function beschikbareDagen(profile: CandidateProfile): string {
  const beschikbaarheid = castAvailability(profile.availability);
  const dagen = WEEKDAYS.filter((dag) =>
    DAYPARTS.some((dagdeel) => beschikbaarheid[dag][dagdeel] !== "unavailable"),
  ).map((dag) => dag.charAt(0).toUpperCase() + dag.slice(1));
  return dagen.length > 0 ? dagen.join(", ") : "Nog niet opgegeven";
}

/* --------------------------------- pagina --------------------------------- */

export default async function UitnodigingenPagina() {
  const { user, profile } = await requireCandidate();
  if (!profile) redirect("/kandidaat/onboarding");

  // Nieuwe uitnodigingen gelden vanaf nu als gezien (invitation_viewed).
  await markInvitationsViewed();

  const [uitnodigingen, gesprekken] = await Promise.all([
    listInvitationsForCandidate(),
    listInterviewsForCandidate(),
  ]);

  const gesprekPerVacature = new Map(
    gesprekken.map((entry) => [entry.vacancyId, entry]),
  );
  const vacaturesMetUitnodiging = new Set(
    uitnodigingen.map((entry) => entry.vacancy.id),
  );
  const losseGesprekken = gesprekken.filter(
    (entry) => !vacaturesMetUitnodiging.has(entry.vacancyId),
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Jouw"
        accent="uitnodigingen"
        description="Praktijken die jouw profiel zagen en je persoonlijk uitnodigen. Jij bepaalt wat je deelt en met wie je in gesprek gaat."
      />

      {uitnodigingen.length === 0 && losseGesprekken.length === 0 ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
              <path
                d="M4 7l8 6 8-6M4 7v10h16V7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
          title="Nog geen uitnodigingen"
          description="Zodra een praktijk je uitnodigt zie je hier de match, de boodschap en jouw keuzes. Een compleet profiel vergroot de kans op uitnodigingen."
          action={
            <Link
              href="/kandidaat"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Bekijk je matches
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {uitnodigingen.map((entry) => (
            <UitnodigingsDetail
              key={entry.invitation.id}
              entry={entry}
              gesprek={gesprekPerVacature.get(entry.vacancy.id) ?? null}
              user={user}
              profile={profile}
            />
          ))}
        </div>
      )}

      {losseGesprekken.length > 0 ? (
        <section aria-labelledby="gesprekken-titel" className="flex flex-col gap-4">
          <SectionHeading
            eyebrow="Plannen"
            title="Gespreks"
            accent="voorstellen"
            description="Praktijken waar je op gesolliciteerd hebt stellen deze momenten voor."
          />
          <h2 id="gesprekken-titel" className="sr-only">
            Gespreksvoorstellen
          </h2>
          <div className="flex flex-col gap-4">
            {losseGesprekken.map((entry) => (
              <Card key={entry.interview.id} strong className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <Badge tone="roze">Gespreksvoorstel</Badge>
                  <h3 className="mt-1 text-lg font-semibold text-ink">
                    {entry.vacancyTitle}
                  </h3>
                  <p className="text-sm text-ink/70">
                    {entry.organizationName}
                    {entry.city ? ` · ${entry.city}` : ""}
                  </p>
                </div>
                <GesprekBlok gesprek={entry} />
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------- deelweergaven ---------------------------- */

function UitnodigingsDetail({
  entry,
  gesprek,
  user,
  profile,
}: {
  entry: CandidateInvitationEntry;
  gesprek: CandidateInterviewEntry | null;
  user: Pick<User, "name" | "email">;
  profile: CandidateProfile;
}) {
  const { invitation, vacancy, location, organizationName, snapshot } = entry;
  const open = invitation.status === "sent";
  const statusWeergave = UITNODIGING_STATUS[invitation.status];
  const redenen = redenenUitSnapshot(snapshot?.result, "strengths", 3);

  return (
    <Card strong className="flex flex-col gap-5">
      {/* kop */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Badge tone="roze">Persoonlijke uitnodiging</Badge>
          <h3 className="mt-1 text-lg font-semibold text-ink">{vacancy.title}</h3>
          <p className="text-sm text-ink/70">
            {organizationName} · {location.city}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {snapshot ? (
            <ScoreBadge score={snapshot.score} label={snapshot.label as MatchLabel} />
          ) : null}
          <Link
            href={`/kandidaat/matches/${vacancy.id}`}
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Bekijk de volledige match
          </Link>
        </div>
      </div>

      {/* waarom de praktijk past */}
      {redenen.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
            Waarom deze praktijk bij je past
          </h4>
          <ul className="flex flex-col gap-1">
            {redenen.map((reden) => (
              <li key={reden} className="text-[15px] leading-relaxed text-ink/85">
                ✓ {reden}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* persoonlijke boodschap */}
      {invitation.message ? (
        <blockquote className="rounded-2xl bg-brand-light/50 px-4 py-3 text-[15px] leading-relaxed text-ink/85">
          “{invitation.message}”
        </blockquote>
      ) : null}

      {/* gespreksvoorstel of bevestigd gesprek */}
      {gesprek ? <GesprekBlok gesprek={gesprek} /> : null}

      {open ? (
        <>
          <PrivacyUitleg user={user} profile={profile} />

          {/* interesse tonen met expliciete consent-keuze */}
          <form
            action={toonInteresseAction.bind(null, invitation.id)}
            className="flex flex-col gap-3 rounded-2xl bg-white/70 p-4"
          >
            <label className="flex items-start gap-3 text-[15px] leading-relaxed text-ink">
              <input
                type="checkbox"
                name="deelContact"
                value="ja"
                className="mt-1 h-4 w-4 shrink-0 accent-blauw-600"
              />
              <span>
                Deel mijn naam en contactgegevens met deze praktijk.
                <span className="block text-sm text-ink/60">
                  Optioneel — zonder vinkje blijf je anoniem tot je later alsnog
                  toestemming geeft.
                </span>
              </span>
            </label>
            <Button type="submit" className="self-start">
              Ik heb interesse
            </Button>
          </form>

          {/* afwijzen met optionele reden */}
          <details className="rounded-2xl bg-white/60 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink/70">
              Afwijzen
            </summary>
            <form
              action={wijsUitnodigingAfAction.bind(null, invitation.id)}
              className="mt-3 flex flex-col gap-3"
            >
              <Field
                label="Reden"
                htmlFor={`reden-${invitation.id}`}
                hint="Optioneel — je reden helpt ons betere matches voor je te vinden."
              >
                <Select
                  id={`reden-${invitation.id}`}
                  name="reasonCode"
                  defaultValue=""
                  className="sm:max-w-72"
                >
                  <option value="">Liever geen reden opgeven</option>
                  {Object.entries(FEEDBACK_REASON_LABELS).map(([code, tekst]) => (
                    <option key={code} value={code}>
                      {tekst}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Toelichting" htmlFor={`note-${invitation.id}`}>
                <Textarea
                  id={`note-${invitation.id}`}
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
                Uitnodiging afwijzen
              </Button>
            </form>
          </details>
        </>
      ) : statusWeergave ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={statusWeergave.toon}>{statusWeergave.tekst}</Badge>
        </div>
      ) : null}
    </Card>
  );
}

/** Wat is er nu al gedeeld, en wat pas ná toestemming? */
function PrivacyUitleg({
  user,
  profile,
}: {
  user: Pick<User, "name" | "email">;
  profile: CandidateProfile;
}) {
  const regio = geocodePostcode(profile.postcode)?.city ?? "jouw regio";
  const nuGedeeld: Array<[string, string]> = [
    ["Functie", label(profile.role)],
    ["Regio", regio],
    ["Ervaring", ERVARING_LABELS[profile.experienceLevel] ?? profile.experienceLevel],
    ["Dagen", beschikbareDagen(profile)],
    [
      "Apparatuur",
      profile.equipmentExperience.length > 0
        ? profile.equipmentExperience.map((sleutel) => label(sleutel)).join(", ")
        : "Geen opgegeven",
    ],
    [
      "Specialisaties",
      profile.specializations.length > 0
        ? profile.specializations.map((sleutel) => label(sleutel)).join(", ")
        : "Geen opgegeven",
    ],
    ["Matchredenen", "De uitleg van jullie matchscore"],
  ];

  return (
    <div className="grid gap-3 rounded-2xl bg-brand-light/40 p-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
          Dit ziet de praktijk nu al
        </h4>
        <ul className="flex flex-col gap-1">
          {nuGedeeld.map(([naam, waarde]) => (
            <li key={naam} className="text-sm leading-relaxed text-ink/80">
              <span className="font-semibold text-ink">{naam}:</span> {waarde}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
          Pas ná jouw toestemming
        </h4>
        <ul className="flex flex-col gap-1">
          <li className="text-sm leading-relaxed text-ink/80">
            <span className="font-semibold text-ink">Naam:</span> {user.name}
          </li>
          <li className="text-sm leading-relaxed text-ink/80">
            <span className="font-semibold text-ink">E-mail:</span> {user.email}
          </li>
        </ul>
        <p className="text-sm text-ink/60">
          Tot die tijd ziet de praktijk je als “{label(profile.role)} uit regio{" "}
          {regio}”.
        </p>
      </div>
    </div>
  );
}

/** Slot-kiezer (radio-kaarten) of het bevestigde moment. */
function GesprekBlok({ gesprek }: { gesprek: CandidateInterviewEntry }) {
  const { interview, slots } = gesprek;

  if (interview.status === "confirmed" && interview.chosenSlot) {
    return (
      <p className="rounded-2xl bg-brand-light/50 px-4 py-3 text-[15px] font-semibold text-blauw-900">
        Gesprek bevestigd: {fmtSlot(interview.chosenSlot.toISOString())}
      </p>
    );
  }
  if (interview.status !== "proposed" || slots.length === 0) return null;

  return (
    <form
      action={bevestigGesprekAction.bind(null, interview.id)}
      className="flex flex-col gap-3 rounded-2xl bg-white/70 p-4"
    >
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold text-ink">
          Kies een gespreksmoment
        </h4>
        {interview.message ? (
          <p className="text-sm text-ink/70">“{interview.message}”</p>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((slot, index) => (
          <label
            key={slot.startsAt}
            className={cx(
              "flex cursor-pointer items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3",
              "transition-colors duration-150 hover:border-blauw-600 motion-reduce:transition-none",
              "has-checked:border-blauw-600 has-checked:bg-brand-light/50",
            )}
          >
            <input
              type="radio"
              name="slot"
              value={slot.startsAt}
              required
              defaultChecked={index === 0}
              className="h-4 w-4 shrink-0 accent-blauw-600"
            />
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold text-ink">
                {fmtSlot(slot.startsAt)}
              </span>
              <span className="text-sm text-ink/60">
                {slot.durationMinutes} minuten
              </span>
            </span>
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" className="self-start">
        Dit moment bevestigen
      </Button>
    </form>
  );
}
