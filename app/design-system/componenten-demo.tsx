"use client";

// Componenten-sectie van /design-system: alle ui-primitieven in al hun
// states (default / hover / focus / disabled / error), plus links, velden,
// selects, een toggle, chips, tags/badges, kaarten en de laad-, lege- en
// foutstaten. Interactief waar dat de states demonstreert.

import { useId, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  ProgressBar,
  ScoreBadge,
  Select,
  Skeleton,
  Stat,
  Textarea,
  cx,
} from "@/components/ui";
import type { MatchLabel } from "@/domain/matching";

/* ------------------------------ helpers ------------------------------ */

function DemoBlok({
  titel,
  children,
  uitleg,
}: {
  titel: string;
  uitleg?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-strong flex flex-col gap-4 rounded-kaart p-6">
      <h3 className="text-mw-kop-3 font-semibold">{titel}</h3>
      {children}
      {uitleg ? (
        <p className="text-xs leading-relaxed text-mw-text-muted">{uitleg}</p>
      ) : null}
    </div>
  );
}

/** Eenvoudige toggle/switch — eigen implementatie voor het designsysteem. */
function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (waarde: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "inline-flex min-h-11 items-center gap-3 rounded-full py-1 pr-2 text-sm font-medium text-ink",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors duration-(--motion-fast) motion-reduce:transition-none",
          checked
            ? "border-blauw-700 bg-blauw-600"
            : "border-mw-border-strong bg-mw-surface-2",
        )}
      >
        <span
          className={cx(
            "absolute h-5 w-5 rounded-full bg-white shadow-(--shadow-mw-1) transition-transform duration-(--motion-fast) motion-reduce:transition-none",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------ secties ------------------------------ */

const SCORE_LABELS: MatchLabel[] = [
  "excellent",
  "good",
  "partial",
  "low",
  "ineligible",
];

export function ComponentenDemo() {
  const uid = useId();
  const [chips, setChips] = useState<Record<string, boolean>>({
    Mondhygiënist: true,
    Preventieassistent: false,
    Tandartsassistent: false,
  });
  const [toggleAan, setToggleAan] = useState(true);
  const [toggleUit, setToggleUit] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* knoppen */}
      <DemoBlok
        titel="Knoppen"
        uitleg="Eén cobalt-hoofdactie per view. Danger gebruikt de error-statuskleur (wit op error: 6,6:1) — nooit merkroze. Hover verdiept de kleur; focus is de globale cobalt-ring; disabled dempt naar 50%."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primair</Button>
          <Button variant="secondary">Secundair</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Verwijderen</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Klein</Button>
          <Button size="md">Middel</Button>
          <Button size="lg">Groot</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Primair disabled</Button>
          <Button variant="secondary" disabled>
            Secundair disabled
          </Button>
          <Button variant="danger" disabled>
            Danger disabled
          </Button>
        </div>
      </DemoBlok>

      {/* links en focus */}
      <DemoBlok
        titel="Links & focus"
        uitleg="Tab door dit blok: elk interactief element krijgt de globale focusring (2px cobalt, 2px offset) — focus is nooit alleen een kleurverandering. Links zijn cobalt met onderstreping bij hover/focus; tap-targets minimaal 44px."
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a
            href="#componenten"
            className="inline-flex min-h-11 items-center font-medium text-blauw-700 underline-offset-4 hover:underline"
          >
            Standaardlink
          </a>
          <a
            href="#componenten"
            className="inline-flex min-h-11 items-center font-medium text-blauw-700 underline underline-offset-4"
          >
            Link in lopende tekst
          </a>
          <a
            href="#componenten"
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-blauw-700 hover:underline"
          >
            Terug-link
            <span aria-hidden="true">→</span>
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary">Focus mij (tab)</Button>
          <Chip selected={false} onClick={() => undefined}>
            En mij
          </Chip>
          <Input placeholder="En dit veld" className="max-w-48" aria-label="Focusdemo veld" />
        </div>
      </DemoBlok>

      {/* velden */}
      <DemoBlok
        titel="Velden & selects"
        uitleg="Wit vlak, ink-tekst, duidelijke rand; hover verdiept de rand, focus kleurt hem cobalt. Fouten: rode rand via aria-invalid + tekstuele melding met alert-rol — nooit alleen kleur."
      >
        <div className="flex flex-col gap-4">
          <Field label="E-mailadres" htmlFor={`${uid}-mail`} hint="We sturen je een bevestiging." required>
            <Input id={`${uid}-mail`} type="email" placeholder="naam@praktijk.nl" />
          </Field>
          <Field
            label="Wachtwoord"
            htmlFor={`${uid}-ww`}
            error="Minimaal 8 tekens nodig."
          >
            <Input
              id={`${uid}-ww`}
              type="password"
              defaultValue="kort"
              aria-invalid="true"
            />
          </Field>
          <Field label="Functie" htmlFor={`${uid}-functie`}>
            <Select id={`${uid}-functie`} defaultValue="mondhygienist">
              <option value="mondhygienist">Mondhygiënist</option>
              <option value="tandartsassistent">Tandartsassistent</option>
              <option value="preventieassistent">Preventieassistent</option>
            </Select>
          </Field>
          <Field label="Motivatie" htmlFor={`${uid}-motivatie`}>
            <Textarea id={`${uid}-motivatie`} rows={2} placeholder="Vertel kort waarom dit past…" />
          </Field>
          <Field label="Uitgeschakeld veld" htmlFor={`${uid}-uit`}>
            <Input id={`${uid}-uit`} disabled value="Niet bewerkbaar" readOnly />
          </Field>
        </div>
      </DemoBlok>

      {/* toggles en chips */}
      <DemoBlok
        titel="Toggles & chips"
        uitleg="De toggle is een echte switch (role=switch, aria-checked). Chips dragen selectie met kleur én vinkje (aria-pressed); de geselecteerde staat verdiept bij hover, disabled dempt naar het disabled-token."
      >
        <div className="flex flex-col gap-1">
          <Toggle label="Ontvang matchmeldingen" checked={toggleAan} onChange={setToggleAan} />
          <Toggle label="Wekelijkse samenvatting" checked={toggleUit} onChange={setToggleUit} />
          <Toggle label="Uitgeschakelde optie" checked={false} onChange={() => undefined} disabled />
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(chips).map(([naam, geselecteerd]) => (
            <Chip
              key={naam}
              selected={geselecteerd}
              onClick={() => setChips((c) => ({ ...c, [naam]: !c[naam] }))}
            >
              {naam}
            </Chip>
          ))}
          <Chip disabled>Disabled chip</Chip>
        </div>
      </DemoBlok>

      {/* tags/badges */}
      <DemoBlok
        titel="Tags, badges & scores"
        uitleg="Eén gedefinieerde set met vaste radius en kleurrollen — geen decoratieve pills. De roze tint draagt alleen donkere tekst (7,2:1); de scorebadge kent vijf betekenisniveaus."
      >
        <div className="flex flex-wrap gap-2">
          <Badge>Blauw</Badge>
          <Badge tone="roze">Roze accent</Badge>
          <Badge tone="neutraal">Neutraal</Badge>
          <Badge tone="wit">Wit</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCORE_LABELS.map((label, i) => (
            <ScoreBadge key={label} label={label} score={95 - i * 18} />
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-8">
          <Stat value={93} suffix="%" label="Gemiddelde topmatch" />
          <Stat value={4} suffix="+" label="Voorkeursdagdelen" accent="roze" />
        </div>
        <ProgressBar value={68} label="Profiel compleet" showValue />
      </DemoBlok>

      {/* kaarten */}
      <DemoBlok
        titel="Kaarten"
        uitleg="Glass (0,72 wit onder tekst) en glass-strong (0,86) — uitlegbare transparantie: glas alleen voor lagen die ergens boven liggen, nooit glas op glas."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h4 className="font-semibold text-ink">Standaardkaart</h4>
            <p className="mt-1 text-sm text-mw-text-muted">
              .glass — 72% wit, blur 18px, kleine zachte schaduw.
            </p>
          </Card>
          <Card strong>
            <h4 className="font-semibold text-ink">Sterke kaart</h4>
            <p className="mt-1 text-sm text-mw-text-muted">
              .glass-strong — 86% wit, blur 26px, voor formulieren en data.
            </p>
          </Card>
        </div>
      </DemoBlok>

      {/* laad-, lege- en foutstaten */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        <div className="grid gap-6 lg:grid-cols-3">
          <DemoBlok
            titel="Laadstaat"
            uitleg="Skeletons pulseren zacht (alleen zonder reduced-motion) en melden zich via role=status. Elke app-route hoort een loading.tsx met dit patroon te krijgen (audit-P2 #5)."
          >
            <LoadingState label="Matches laden" lines={3} />
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-2/5" />
              </div>
            </div>
          </DemoBlok>
          <DemoBlok
            titel="Lege staat"
            uitleg="Kop, uitleg die vertelt wat je hier gaat zien én wat je kunt doen, plus één duidelijke actie."
          >
            <EmptyState
              title="Nog geen uitnodigingen"
              description="Zodra een praktijk je uitnodigt voor een gesprek, verschijnt die hier."
              action={<Button variant="secondary">Bekijk je matches</Button>}
            />
          </DemoBlok>
          <DemoBlok
            titel="Foutstaat"
            uitleg="ErrorState in merkstem met alert-rol en een herstelactie — status is rood (error-token), nooit roze."
          >
            <ErrorState
              title="Matches laden lukt niet"
              description="Controleer je verbinding en probeer het opnieuw."
              action={<Button variant="secondary">Probeer opnieuw</Button>}
            />
          </DemoBlok>
        </div>
      </div>
    </div>
  );
}
