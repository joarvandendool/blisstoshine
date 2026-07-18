"use client";

// PlanKiezer — de interactieve planvergelijking van de abonnementspagina.
//
// - Interval-toggle (maandelijks/jaarlijks met korting) verandert alleen de
//   getoonde prijs; het gekozen interval gaat mee bij een abonnementsstart.
// - Het huidige plan is gemarkeerd met een badge én een rand (nooit alleen
//   kleur); het aanbevolen plan (uit ?benodigd=…) krijgt een "Aanbevolen"-tag.
// - Multi-locatie heeft contractpricing: "op aanvraag", geen zelfbediening.
// - Opzeggen (per periode-einde) gebeurt pas na expliciete bevestiging.
// - Zonder billing.manage is alles read-only; de acties verdwijnen.
//
// Alle wijzigingen lopen via de server actions in ./actions; deze release
// gebruikt de lokale testprovider: testomgeving — geen echte betaling.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, Chip, cx } from "@/components/ui";
import {
  wijzigPlanAction,
  zegOpAction,
  type PlanActieResultaat,
} from "./actions";

/* -------------------------------- contracten ------------------------------- */

export type KiesbaarPlanCode = "essential" | "growth" | "multi_location";

export interface PlanKaartData {
  code: KiesbaarPlanCode;
  naam: string;
  prijsMaandCents: number;
  prijsJaarCents: number;
  /** Contractpricing: geen zelfbediening, prijs op aanvraag. */
  opAanvraag: boolean;
  kernfeatures: string[];
  isHuidig: boolean;
}

export interface PlanKiezerProps {
  slug: string;
  magBeheren: boolean;
  /** Huidige plancode ("trial", "essential", …) of null zonder abonnement. */
  huidigPlanCode: string | null;
  plannen: PlanKaartData[];
  /** Plan dat de ontbrekende functie uit ?benodigd=… bevat (of null). */
  aanbevolenCode: string | null;
  /** Alleen tonen wanneer er iets op te zeggen valt. */
  kanOpzeggen: boolean;
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
  magBeheren,
  huidigPlanCode,
  plannen,
  aanbevolenCode,
  kanOpzeggen,
  periodeEindeIso,
}: PlanKiezerProps) {
  const router = useRouter();
  const [interval, setIntervalKeuze] = useState<Interval>("monthly");
  const [melding, setMelding] = useState<PlanActieResultaat | null>(null);
  const [bevestigOpzeggen, setBevestigOpzeggen] = useState(false);
  const [bezigMet, setBezigMet] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const voerUit = (sleutel: string, actie: () => Promise<PlanActieResultaat>) => {
    setMelding(null);
    setBezigMet(sleutel);
    startTransition(async () => {
      const resultaat = await actie();
      setMelding(resultaat);
      setBezigMet(null);
      setBevestigOpzeggen(false);
      if (resultaat.ok) router.refresh();
    });
  };

  const kiesPlan = (planCode: KiesbaarPlanCode) =>
    voerUit(planCode, () => wijzigPlanAction(slug, { planCode, interval }));

  const zegOp = () => voerUit("opzeggen", () => zegOpAction(slug));

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
                strong={plan.isHuidig}
                className={cx(
                  "flex h-full flex-col gap-4",
                  plan.isHuidig && "border-2 border-blauw-600",
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

                {/* kernfeatures */}
                <ul className="flex flex-1 flex-col gap-2">
                  {plan.kernfeatures.map((feature) => (
                    <li
                      key={feature}
                      className="flex gap-2 text-sm leading-relaxed text-ink/80"
                    >
                      <span aria-hidden="true" className="font-semibold text-blauw-600">
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* actie */}
                {plan.isHuidig ? (
                  <p className="text-sm font-medium text-ink/60">
                    Dit is je huidige plan.
                  </p>
                ) : !magBeheren ? null : plan.opAanvraag ? (
                  <a
                    href="mailto:info@mondzorgwerkt.nl?subject=Multi-locatie%20op%20aanvraag"
                    className={cx(
                      "inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-[15px] font-semibold",
                      "glass text-ink transition-colors duration-150 hover:bg-white/90 motion-reduce:transition-none",
                    )}
                  >
                    Vraag een voorstel aan
                  </a>
                ) : (
                  <Button
                    onClick={() => kiesPlan(plan.code)}
                    disabled={isPending}
                    variant={aanbevolen ? "primary" : "secondary"}
                  >
                    {bezigMet === plan.code ? "Bezig met wijzigen…" : knopTekst(plan)}
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <p className="text-sm font-medium text-ink/60">
        Testomgeving — geen echte betaling. Abonnementen worden in deze release
        gesimuleerd; er wordt niets afgeschreven.
      </p>

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
                {periodeEindeIso ? datumLang(periodeEindeIso) : "het einde van de lopende periode"}
                . Daarna vervallen de functies van je plan; je gegevens en
                vacatures blijven bewaard.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="danger" onClick={zegOp} disabled={isPending}>
                  {bezigMet === "opzeggen" ? "Bezig met opzeggen…" : "Ja, zeg mijn abonnement op"}
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
