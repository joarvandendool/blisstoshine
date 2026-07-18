"use client";

// PlanKiezer — de interactieve, waardegerichte planvergelijking van de
// abonnementspagina.
//
// - Elke plankaart opent met een uitkomstregel (tagline) en concrete
//   uitkomsten uit de centrale catalogus — geen kale featurelijst.
// - Interval-toggle (maandelijks/jaarlijks met korting); het gekozen interval
//   gaat mee de checkout in.
// - Checkout-flow: klik op plan → bevestigingsstap met samenvatting, prijs en
//   periode (checkout_started) → bevestigen (subscription_started/upgraded/
//   downgraded via de server action) → succes met MatchShape-viering.
//   Annuleren in de bevestigingsstap → checkout_abandoned.
// - "Vergelijk alle functies" opent de volledige vergelijkingstabel en meldt
//   éénmalig plan_compared via POST /api/events.
// - Multi-locatie heeft contractpricing: "Plan een gesprek", geen zelfbediening.
// - Opzeggen (per periode-einde) gebeurt pas na expliciete bevestiging.
// - Zonder billing.manage is alles read-only; de acties verdwijnen.
//
// Alle wijzigingen lopen via de server actions in ./actions; deze release
// gebruikt de lokale testprovider: testomgeving — geen echte betaling.

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Badge, Button, Card, Chip, cx } from "@/components/ui";
import { MatchShape } from "@/components/MatchShape";
import {
  annuleerCheckoutAction,
  heractiveerAction,
  startCheckoutAction,
  wijzigPlanAction,
  zegOpAction,
  type PlanActieResultaat,
} from "./actions";

/* -------------------------------- contracten ------------------------------- */

export type KiesbaarPlanCode = "essential" | "growth" | "multi_location";

export interface PlanKaartData {
  code: KiesbaarPlanCode;
  naam: string;
  /** Uitkomstregel uit de catalogus, bv. "Voor ketens en praktijkgroepen". */
  tagline: string;
  /** Concrete uitkomsten uit de catalogus. */
  outcomes: string[];
  /** Compacte limieten (locaties, vacatures, teamleden, uitnodigingen). */
  inbegrepen: string[];
  prijsMaandCents: number;
  prijsJaarCents: number;
  /** Contractpricing: geen zelfbediening, prijs op aanvraag. */
  opAanvraag: boolean;
  isHuidig: boolean;
}

/** Eén rij van de volledige vergelijkingstabel: label + waarde per plan. */
export interface VergelijkRij {
  label: string;
  /** Waarden in dezelfde volgorde als `plannen`. */
  waarden: string[];
}

export interface PlanKiezerProps {
  slug: string;
  /** Voor het plan_compared-event; membership wordt server-side geverifieerd. */
  organizationId: string;
  magBeheren: boolean;
  /** Huidige plancode ("trial", "essential", …) of null zonder abonnement. */
  huidigPlanCode: string | null;
  plannen: PlanKaartData[];
  vergelijking: VergelijkRij[];
  /** Plan dat de ontbrekende functie uit ?benodigd=… bevat (of null). */
  aanbevolenCode: string | null;
  /** Alleen tonen wanneer er iets op te zeggen valt. */
  kanOpzeggen: boolean;
  /** Opgezegd per periode-einde: heractiveren (opzegging terugdraaien) kan. */
  kanHeractiveren: boolean;
  /** Einde van de lopende periode (ISO), voor de opzegbevestiging. */
  periodeEindeIso: string | null;
}

type Interval = "monthly" | "yearly";

/* ------------------------------- hulpfuncties ------------------------------ */

const PLAN_VOLGORDE: Record<string, number> = {
  trial: 0,
  essential: 1,
  growth: 2,
  multi_location: 3,
};

function euro(cents: number): string {
  const heleEuros = cents % 100 === 0;
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: heleEuros ? 0 : 2,
    maximumFractionDigits: heleEuros ? 0 : 2,
  }).format(cents / 100);
}

function datumLang(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* -------------------------------- component -------------------------------- */

export function PlanKiezer({
  slug,
  organizationId,
  magBeheren,
  huidigPlanCode,
  plannen,
  vergelijking,
  aanbevolenCode,
  kanOpzeggen,
  kanHeractiveren,
  periodeEindeIso,
}: PlanKiezerProps) {
  const router = useRouter();
  const [interval, setIntervalKeuze] = useState<Interval>("monthly");
  const [melding, setMelding] = useState<PlanActieResultaat | null>(null);
  const [bevestigOpzeggen, setBevestigOpzeggen] = useState(false);
  const [bezigMet, setBezigMet] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Checkout-bevestigingsstap: het gekozen plan + het interval van dat moment.
  const [checkout, setCheckout] = useState<{
    plan: PlanKaartData;
    interval: Interval;
  } | null>(null);
  // Succesviering na een geslaagde wijziging.
  const [succes, setSucces] = useState<{ planNaam: string; melding: string } | null>(
    null,
  );

  // Volledige vergelijking: plan_compared wordt éénmalig gemeld.
  const [toonVergelijking, setToonVergelijking] = useState(false);
  const vergelijkingGemeld = useRef(false);

  const openVergelijking = () => {
    setToonVergelijking((open) => !open);
    if (vergelijkingGemeld.current) return;
    vergelijkingGemeld.current = true;
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "plan_compared", organizationId }),
    }).catch(() => {
      // Analytics faalt nooit hard richting de gebruiker.
    });
  };

  /* ---- checkout-flow ---- */

  const kiesPlan = (plan: PlanKaartData) => {
    setMelding(null);
    setSucces(null);
    setCheckout({ plan, interval });
    // checkout_started wordt server-side vastgelegd; fire-and-forget.
    void startCheckoutAction(slug, { planCode: plan.code, interval });
  };

  const annuleerCheckout = () => {
    if (!checkout) return;
    // checkout_abandoned server-side vastleggen; fire-and-forget.
    void annuleerCheckoutAction(slug, {
      planCode: checkout.plan.code,
      interval: checkout.interval,
    });
    setCheckout(null);
  };

  const bevestigCheckout = () => {
    if (!checkout) return;
    const { plan, interval: gekozenInterval } = checkout;
    setMelding(null);
    setBezigMet(plan.code);
    startTransition(async () => {
      const resultaat = await wijzigPlanAction(slug, {
        planCode: plan.code,
        interval: gekozenInterval,
      });
      setBezigMet(null);
      if (resultaat.ok) {
        setCheckout(null);
        setSucces({ planNaam: plan.naam, melding: resultaat.melding });
        router.refresh();
      } else {
        setMelding(resultaat);
      }
    });
  };

  const zegOp = () => {
    setMelding(null);
    setBezigMet("opzeggen");
    startTransition(async () => {
      const resultaat = await zegOpAction(slug);
      setMelding(resultaat);
      setBezigMet(null);
      setBevestigOpzeggen(false);
      if (resultaat.ok) router.refresh();
    });
  };

  const heractiveer = () => {
    setMelding(null);
    setBezigMet("heractiveren");
    startTransition(async () => {
      const resultaat = await heractiveerAction(slug);
      setMelding(resultaat);
      setBezigMet(null);
      if (resultaat.ok) router.refresh();
    });
  };

  /** Is de overstap naar dit plan een downgrade (gaat per periode-einde in)? */
  const isDowngrade = (planCode: string): boolean => {
    if (huidigPlanCode === null || huidigPlanCode === "trial") return false;
    const huidig = PLAN_VOLGORDE[huidigPlanCode] ?? 0;
    return (PLAN_VOLGORDE[planCode] ?? 0) < huidig;
  };

  /** Knoptekst: start, upgrade of downgrade — afhankelijk van het huidige plan. */
  const knopTekst = (plan: PlanKaartData): string => {
    if (huidigPlanCode === null || huidigPlanCode === "trial") {
      return `Start ${plan.naam}`;
    }
    const huidig = PLAN_VOLGORDE[huidigPlanCode] ?? 0;
    return PLAN_VOLGORDE[plan.code] > huidig
      ? `Upgrade naar ${plan.naam}`
      : `Downgrade naar ${plan.naam}`;
  };

  /* ---- succesviering: MatchShape + melding ---- */
  if (succes) {
    return (
      <Card strong className="flex flex-col items-center gap-4 py-10 text-center">
        <MatchShape score={97} size="hero" showScore={false} />
        <h3 className="text-2xl font-semibold tracking-tight text-ink">
          Welkom bij{" "}
          <em className="font-serif italic font-bold text-blauw-600">
            {succes.planNaam}
          </em>
        </h3>
        <p className="max-w-md text-[15px] leading-relaxed text-ink/70">
          {succes.melding}
        </p>
        <Button variant="secondary" onClick={() => setSucces(null)}>
          Terug naar het planoverzicht
        </Button>
      </Card>
    );
  }

  /* ---- bevestigingsstap (checkout) ---- */
  if (checkout) {
    const { plan, interval: gekozenInterval } = checkout;
    const prijsCents =
      gekozenInterval === "yearly" ? plan.prijsJaarCents : plan.prijsMaandCents;
    return (
      <Card strong className="flex max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-ink">
            Bevestig je overstap naar {plan.naam}
          </h3>
          <p className="text-sm text-ink/70">{plan.tagline}</p>
        </div>

        <dl className="flex flex-col gap-2 border-y border-ink/10 py-4 text-[15px]">
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-ink/70">Plan</dt>
            <dd className="font-semibold text-ink">{plan.naam}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-ink/70">Facturatie</dt>
            <dd className="font-semibold text-ink">
              {gekozenInterval === "yearly"
                ? "Jaarlijks (2 maanden korting)"
                : "Maandelijks"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-ink/70">Prijs</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {euro(prijsCents)}{" "}
              <span className="font-medium text-ink/60">
                {gekozenInterval === "yearly" ? "per jaar" : "per maand"}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-ink/70">Ingangsdatum</dt>
            <dd className="font-semibold text-ink">
              {isDowngrade(plan.code)
                ? periodeEindeIso
                  ? `Per periode-einde (${datumLang(periodeEindeIso)})`
                  : "Per einde van de lopende periode"
                : "Direct"}
            </dd>
          </div>
        </dl>

        {isDowngrade(plan.code) ? (
          <p className="text-sm leading-relaxed text-ink/70">
            Een downgrade wordt ingepland per het einde van je lopende periode:
            tot die datum behoud je alle functies van je huidige plan.
          </p>
        ) : null}

        <p className="text-sm font-medium text-ink/60">
          Testomgeving — geen echte betaling. Er wordt niets afgeschreven.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={bevestigCheckout} disabled={isPending}>
            {bezigMet === plan.code
              ? "Bezig met bevestigen…"
              : `Bevestig ${plan.naam}`}
          </Button>
          <Button
            variant="secondary"
            onClick={annuleerCheckout}
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

  /* ---- planoverzicht ---- */
  return (
    <div className="flex flex-col gap-6">
      {/* interval-toggle */}
      <div
        role="group"
        aria-label="Facturatie-interval"
        className="flex flex-wrap items-center gap-2"
      >
        <Chip
          selected={interval === "monthly"}
          onClick={() => setIntervalKeuze("monthly")}
        >
          Maandelijks
        </Chip>
        <Chip
          selected={interval === "yearly"}
          onClick={() => setIntervalKeuze("yearly")}
        >
          Jaarlijks — 2 maanden korting
        </Chip>
      </div>

      {/* meldingen van de server actions */}
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

      {/* plankaarten */}
      <ul className="grid gap-4 lg:grid-cols-3">
        {plannen.map((plan) => {
          const aanbevolen = !plan.isHuidig && plan.code === aanbevolenCode;
          return (
            <li key={plan.code} className="h-full">
              <Card
                strong={plan.isHuidig || aanbevolen}
                className={cx(
                  "flex h-full flex-col gap-4",
                  plan.isHuidig && "border-2 border-blauw-600",
                  aanbevolen && "border-2 border-roze-500",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xl font-semibold tracking-tight text-ink">
                    {plan.naam}
                  </h3>
                  {plan.isHuidig ? (
                    <Badge tone="blauw">Huidig plan</Badge>
                  ) : aanbevolen ? (
                    <Badge tone="roze">Aanbevolen</Badge>
                  ) : null}
                </div>

                {/* uitkomstregel */}
                <p className="text-[15px] font-medium leading-snug text-ink/80">
                  {plan.tagline}
                </p>

                {/* prijs */}
                {plan.opAanvraag ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-3xl font-semibold tracking-tight text-ink">
                      Op aanvraag
                    </div>
                    <p className="text-sm text-ink/70">
                      Contractpricing op maat voor praktijkgroepen.
                    </p>
                  </div>
                ) : interval === "monthly" ? (
                  <div className="flex flex-col gap-1">
                    <div className="text-3xl font-semibold tracking-tight text-ink">
                      {euro(plan.prijsMaandCents)}
                      <span className="text-base font-medium text-ink/60">
                        {" "}
                        / maand
                      </span>
                    </div>
                    <p className="text-sm text-ink/70">
                      of {euro(plan.prijsJaarCents)} per jaar met korting
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="text-3xl font-semibold tracking-tight text-ink">
                      {euro(plan.prijsJaarCents)}
                      <span className="text-base font-medium text-ink/60">
                        {" "}
                        / jaar
                      </span>
                    </div>
                    <p className="text-sm text-ink/70">
                      Je bespaart{" "}
                      {euro(plan.prijsMaandCents * 12 - plan.prijsJaarCents)} ten
                      opzichte van 12 maandtermijnen.
                    </p>
                  </div>
                )}

                {/* uitkomsten */}
                <ul className="flex flex-col gap-2">
                  {plan.outcomes.map((uitkomst) => (
                    <li
                      key={uitkomst}
                      className="flex gap-2 text-sm leading-relaxed text-ink/80"
                    >
                      <span
                        aria-hidden="true"
                        className="font-semibold text-blauw-600"
                      >
                        ✓
                      </span>
                      {uitkomst}
                    </li>
                  ))}
                </ul>

                {/* compacte limieten uit de catalogus */}
                <p className="mt-auto border-t border-ink/10 pt-3 text-[13px] leading-relaxed text-ink/60">
                  {plan.inbegrepen.join(" · ")}
                </p>

                {/* actie */}
                {plan.isHuidig ? (
                  <p className="text-sm font-medium text-ink/60">
                    Dit is je huidige plan.
                  </p>
                ) : !magBeheren ? null : plan.opAanvraag ? (
                  <a
                    href="mailto:info@mondzorgwerkt.nl?subject=Multi-locatie%20%E2%80%94%20plan%20een%20gesprek"
                    className={cx(
                      "inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-[15px] font-semibold",
                      "glass text-ink transition-colors duration-150 hover:bg-white/90 motion-reduce:transition-none",
                    )}
                  >
                    Plan een gesprek
                  </a>
                ) : (
                  <Button
                    onClick={() => kiesPlan(plan)}
                    disabled={isPending}
                    variant={aanbevolen ? "primary" : "secondary"}
                  >
                    {knopTekst(plan)}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {/* volledige vergelijking (plan_compared) */}
      <div className="flex flex-col gap-4">
        <div>
          <Button
            variant="ghost"
            onClick={openVergelijking}
            aria-expanded={toonVergelijking}
          >
            {toonVergelijking
              ? "Verberg de volledige vergelijking"
              : "Vergelijk alle functies"}
          </Button>
        </div>
        {toonVergelijking ? (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm text-ink">
              <caption className="sr-only">
                Volledige vergelijking van alle functies per plan
              </caption>
              <thead>
                <tr className="border-b border-ink/10">
                  <th
                    scope="col"
                    className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60"
                  >
                    Functie
                  </th>
                  {plannen.map((plan) => (
                    <th
                      key={plan.code}
                      scope="col"
                      className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60"
                    >
                      {plan.naam}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vergelijking.map((rij) => (
                  <tr
                    key={rij.label}
                    className="border-b border-ink/5 last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="py-2.5 pr-3 text-left font-medium text-ink"
                    >
                      {rij.label}
                    </th>
                    {rij.waarden.map((waarde, index) => (
                      <td
                        key={plannen[index]?.code ?? index}
                        className="py-2.5 pr-3 text-ink/80"
                      >
                        {waarde}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>

      <p className="text-sm font-medium text-ink/60">
        Testomgeving — geen echte betaling. Abonnementen worden in deze release
        gesimuleerd; er wordt niets afgeschreven.
      </p>

      {/* heractiveren: opzegging per periode-einde terugdraaien */}
      {magBeheren && kanHeractiveren ? (
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-ink">
              Toch doorgaan met je abonnement?
            </h3>
            <p className="text-sm leading-relaxed text-ink/70">
              Je abonnement is opgezegd
              {periodeEindeIso ? ` en stopt op ${datumLang(periodeEindeIso)}` : ""}.
              Draai de opzegging terug en alles loopt gewoon door.
            </p>
          </div>
          <Button onClick={heractiveer} disabled={isPending}>
            {bezigMet === "heractiveren"
              ? "Bezig met heractiveren…"
              : "Heractiveer mijn abonnement"}
          </Button>
        </Card>
      ) : null}

      {/* opzeggen, alleen voor beheerders met een lopend abonnement */}
      {magBeheren && kanOpzeggen ? (
        <div className="flex flex-col gap-3 border-t border-ink/10 pt-6">
          {bevestigOpzeggen ? (
            <Card className="flex flex-col gap-4">
              <h3 className="text-base font-semibold text-ink">
                Weet je zeker dat je wilt opzeggen?
              </h3>
              <p className="text-sm leading-relaxed text-ink/70">
                Je abonnement blijft actief tot{" "}
                {periodeEindeIso
                  ? datumLang(periodeEindeIso)
                  : "het einde van de lopende periode"}
                . Daarna vervallen de functies van je plan; je gegevens en
                vacatures blijven bewaard.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={zegOp} disabled={isPending}>
                  {bezigMet === "opzeggen"
                    ? "Bezig met opzeggen…"
                    : "Ja, zeg mijn abonnement op"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setBevestigOpzeggen(false)}
                  disabled={isPending}
                >
                  Nee, houd mijn plan
                </Button>
              </div>
            </Card>
          ) : (
            <div>
              <Button
                variant="ghost"
                onClick={() => setBevestigOpzeggen(true)}
                disabled={isPending}
              >
                Abonnement opzeggen
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
