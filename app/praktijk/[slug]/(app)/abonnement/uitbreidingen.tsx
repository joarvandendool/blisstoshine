"use client";

// Uitbreidingen — add-ons als configureerbare abonnementsitems op de
// abonnementspagina.
//
// - Per add-on een aantal-stepper (limiet-add-ons) of aan/uit (features,
//   maxQuantity 1), met het prijsgevolg per maand live in beeld.
// - Bevestigingsstap in hetzelfde patroon als de plan-checkout:
//   openen → checkout_started, annuleren → checkout_abandoned,
//   bevestigen → wijzigUitbreidingenAction (subscription_upgraded + audit).
// - Zonder billing.manage is alles read-only; op het trialplan is de sectie
//   uitgelegd maar niet bedienbaar.
//
// Alle wijzigingen lopen via de server actions in ./actions; deze release
// gebruikt de lokale testprovider: testomgeving — geen echte betaling.

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, cx } from "@/components/ui";
import {
  annuleerUitbreidingCheckoutAction,
  startUitbreidingCheckoutAction,
  wijzigUitbreidingenAction,
  type PlanActieResultaat,
} from "./actions";

/* -------------------------------- contracten ------------------------------- */

export interface UitbreidingData {
  key: string;
  naam: string;
  omschrijving: string;
  /** Effect in het Nederlands, bv. "+1 locatie per stuk". */
  effectTekst: string;
  prijsMaandCents: number;
  maxAantal: number;
  huidigAantal: number;
}

export interface UitbreidingenProps {
  slug: string;
  magBeheren: boolean;
  /** false op het trialplan of zonder lopend abonnement: read-only met uitleg. */
  beschikbaar: boolean;
  uitbreidingen: UitbreidingData[];
}

/* ------------------------------- hulpfuncties ------------------------------ */

function euro(cents: number): string {
  const heleEuros = cents % 100 === 0;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: heleEuros ? 0 : 2,
    maximumFractionDigits: heleEuros ? 0 : 2,
  }).format(cents / 100);
}

/* -------------------------------- component -------------------------------- */

export function Uitbreidingen({
  slug,
  magBeheren,
  beschikbaar,
  uitbreidingen,
}: UitbreidingenProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [melding, setMelding] = useState<PlanActieResultaat | null>(null);
  const [bevestigen, setBevestigen] = useState(false);

  const [aantallen, setAantallen] = useState<Record<string, number>>(() =>
    Object.fromEntries(uitbreidingen.map((u) => [u.key, u.huidigAantal])),
  );

  const gewijzigd = useMemo(
    () => uitbreidingen.filter((u) => (aantallen[u.key] ?? 0) !== u.huidigAantal),
    [uitbreidingen, aantallen],
  );

  const huidigTotaal = useMemo(
    () =>
      uitbreidingen.reduce((som, u) => som + u.prijsMaandCents * u.huidigAantal, 0),
    [uitbreidingen],
  );
  const nieuwTotaal = useMemo(
    () =>
      uitbreidingen.reduce(
        (som, u) => som + u.prijsMaandCents * (aantallen[u.key] ?? 0),
        0,
      ),
    [uitbreidingen, aantallen],
  );
  const verschil = nieuwTotaal - huidigTotaal;

  const zetAantal = (key: string, waarde: number, max: number) => {
    setMelding(null);
    setAantallen((huidige) => ({
      ...huidige,
      [key]: Math.max(0, Math.min(max, Math.floor(waarde))),
    }));
  };

  const itemsPayload = () =>
    gewijzigd.map((u) => ({ key: u.key, quantity: aantallen[u.key] ?? 0 }));

  const openBevestiging = () => {
    if (gewijzigd.length === 0) return;
    setMelding(null);
    setBevestigen(true);
    // checkout_started wordt server-side vastgelegd; fire-and-forget.
    void startUitbreidingCheckoutAction(slug, { items: itemsPayload() });
  };

  const annuleerBevestiging = () => {
    // checkout_abandoned server-side vastleggen; fire-and-forget.
    void annuleerUitbreidingCheckoutAction(slug, { items: itemsPayload() });
    setBevestigen(false);
  };

  const bevestig = () => {
    startTransition(async () => {
      const resultaat = await wijzigUitbreidingenAction(slug, {
        items: itemsPayload(),
      });
      setMelding(resultaat);
      if (resultaat.ok) {
        setBevestigen(false);
        router.refresh();
      }
    });
  };

  /* ---- niet beschikbaar (trial of geen abonnement): uitleg, geen bediening */
  if (!beschikbaar) {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-[15px] font-semibold text-ink">
          Uitbreidingen zijn beschikbaar bij een betaald plan.
        </p>
        <p className="text-sm leading-relaxed text-ink/70">
          Met uitbreidingen voeg je per maand extra ruimte toe aan je plan —
          bijvoorbeeld een extra locatie, extra teamleden of een pakket
          uitnodigingen. Kies eerst een betaald plan; daarna kun je hier
          uitbreidingen aan- en uitzetten.
        </p>
      </Card>
    );
  }

  /* ---- bevestigingsstap ---- */
  if (bevestigen) {
    return (
      <Card strong className="flex max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-ink">
            Bevestig je uitbreidingen
          </h3>
          <p className="text-sm text-ink/70">
            De nieuwe limieten gelden per direct; het maandbedrag wijzigt mee.
          </p>
        </div>

        <dl className="flex flex-col gap-2 border-y border-ink/10 py-4 text-[15px]">
          {gewijzigd.map((u) => {
            const nieuw = aantallen[u.key] ?? 0;
            return (
              <div key={u.key} className="flex items-center justify-between gap-3">
                <dt className="font-medium text-ink/70">{u.naam}</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {u.huidigAantal} → {nieuw}
                  <span className="ml-2 font-medium text-ink/60">
                    ({euro(u.prijsMaandCents * nieuw)} per maand)
                  </span>
                </dd>
              </div>
            );
          })}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-ink/10 pt-3">
            <dt className="font-medium text-ink/70">
              Totaal uitbreidingen per maand
            </dt>
            <dd className="font-semibold tabular-nums text-ink">
              {euro(nieuwTotaal)}
              <span
                className={cx(
                  "ml-2 font-medium",
                  verschil > 0 ? "text-ink/60" : "text-blauw-900",
                )}
              >
                ({verschil >= 0 ? "+" : "−"}
                {euro(Math.abs(verschil))})
              </span>
            </dd>
          </div>
        </dl>

        <p className="text-sm font-medium text-ink/60">
          Testomgeving — geen echte betaling. Er wordt niets afgeschreven.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={bevestig} disabled={isPending}>
            {isPending ? "Bezig met bevestigen…" : "Bevestig uitbreidingen"}
          </Button>
          <Button
            variant="secondary"
            onClick={annuleerBevestiging}
            disabled={isPending}
          >
            Annuleren
          </Button>
        </div>

        {melding && !melding.ok ? (
          <p
            role="alert"
            className="rounded-2xl bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800"
          >
            {melding.melding}
          </p>
        ) : null}
      </Card>
    );
  }

  /* ---- overzicht met steppers ---- */
  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite">
        {melding ? (
          <p
            className={cx(
              "rounded-2xl px-4 py-3 text-sm font-medium",
              melding.ok
                ? "bg-brand-light/70 text-blauw-900"
                : "bg-roze-100 text-roze-800",
            )}
          >
            {melding.melding}
          </p>
        ) : null}
      </div>

      <Card className="flex flex-col gap-5">
        <ul className="flex flex-col gap-5">
          {uitbreidingen.map((u) => {
            const aantal = aantallen[u.key] ?? 0;
            const aanUit = u.maxAantal === 1;
            return (
              <li
                key={u.key}
                className="flex flex-col gap-2 border-b border-ink/5 pb-5 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">
                      {u.naam}
                    </span>
                    <Badge tone="wit">{u.effectTekst}</Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-ink/70">
                    {u.omschrijving}
                  </p>
                  <p className="text-sm font-medium tabular-nums text-ink/80">
                    {euro(u.prijsMaandCents)} per maand
                    {aanUit ? "" : " per stuk"}
                  </p>
                </div>

                {magBeheren ? (
                  aanUit ? (
                    <Button
                      variant={aantal > 0 ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => zetAantal(u.key, aantal > 0 ? 0 : 1, 1)}
                      disabled={isPending}
                      aria-pressed={aantal > 0}
                    >
                      {aantal > 0 ? "Uitzetten" : "Aanzetten"}
                    </Button>
                  ) : (
                    <div
                      className="flex shrink-0 items-center gap-2"
                      role="group"
                      aria-label={`Aantal voor ${u.naam}`}
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => zetAantal(u.key, aantal - 1, u.maxAantal)}
                        disabled={isPending || aantal <= 0}
                        aria-label={`Eén minder ${u.naam}`}
                      >
                        −
                      </Button>
                      <span className="min-w-8 text-center text-[15px] font-semibold tabular-nums text-ink">
                        {aantal}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => zetAantal(u.key, aantal + 1, u.maxAantal)}
                        disabled={isPending || aantal >= u.maxAantal}
                        aria-label={`Eén meer ${u.naam}`}
                      >
                        +
                      </Button>
                    </div>
                  )
                ) : (
                  <span className="text-sm font-medium tabular-nums text-ink/70">
                    {aanUit ? (aantal > 0 ? "Aan" : "Uit") : `${aantal} actief`}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[15px] font-semibold tabular-nums text-ink">
            Uitbreidingen per maand: {euro(nieuwTotaal)}
            {verschil !== 0 ? (
              <span className="ml-2 font-medium text-ink/60">
                ({verschil > 0 ? "+" : "−"}
                {euro(Math.abs(verschil))} t.o.v. nu)
              </span>
            ) : null}
          </p>
          {magBeheren ? (
            <Button
              onClick={openBevestiging}
              disabled={isPending || gewijzigd.length === 0}
            >
              Wijzigingen bevestigen
            </Button>
          ) : null}
        </div>

        {!magBeheren ? (
          <p className="text-sm font-medium text-ink/60">
            Alleen de eigenaar of een beheerder kan uitbreidingen wijzigen.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
