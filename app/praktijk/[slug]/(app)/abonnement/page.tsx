// Abonnementspagina — huidig plan + status, gebruik t.o.v. limieten en de
// planvergelijking uit PLAN_CATALOG. Alleen leden met de capability
// billing.manage (owner/admin) kunnen wijzigen; andere rollen zien alles
// read-only met een duidelijke melding.
//
// ?benodigd=<entitlement-key>: EntitlementError-momenten elders in het product
// linken hierheen; de pagina legt dan bovenaan contextueel uit welk plan die
// functie bevat en markeert dat plan als aanbevolen.
//
// Betaling is in deze release gesimuleerd (LocalTestBillingProvider):
// testomgeving — geen echte betaling.

import { notFound, redirect } from "next/navigation";
import { AuthzError, roleCan } from "@/lib/authz";
import { effectiveEntitlements, getActiveSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import {
  ENTITLEMENT_KEYS,
  ENTITLEMENT_LABELS,
  PLAN_CATALOG,
  can,
  entitlementsFor,
  getPlanVersion,
  limitOf,
  type EntitlementKey,
  type EntitlementSet,
} from "@/domain/entitlements";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  Badge,
  Card,
  PageHeader,
  ProgressBar,
  SectionHeading,
  type BadgeTone,
} from "@/components/ui";
import { MatchShape } from "@/components/MatchShape";
import {
  PlanKiezer,
  type KiesbaarPlanCode,
  type PlanKaartData,
  type VergelijkRij,
} from "./plan-kiezer";

export const dynamic = "force-dynamic";

/* ------------------------------- constanten -------------------------------- */

const KIESBARE_PLANNEN = ["essential", "growth", "multi_location"] as const;

const STATUS_WEERGAVE: Record<string, { tekst: string; toon: BadgeTone }> = {
  trialing: { tekst: "Proefperiode", toon: "blauw" },
  active: { tekst: "Actief", toon: "blauw" },
  past_due: { tekst: "Betaling achterstallig", toon: "roze" },
  canceled: { tekst: "Beëindigd", toon: "neutraal" },
};

/* ------------------------------ hulpfuncties ------------------------------- */

function isEntitlementKey(waarde: string): waarde is EntitlementKey {
  return (ENTITLEMENT_KEYS as readonly string[]).includes(waarde);
}

/** Datum in lopende tekst, bv. "12 augustus 2026". */
function datumLang(datum: Date): string {
  return datum.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Resterende hele dagen tot een datum (minimaal 0). */
function dagenTot(datum: Date): number {
  return Math.max(0, Math.ceil((datum.getTime() - Date.now()) / 86_400_000));
}

function aantalTekst(aantal: number | null, enkelvoud: string, meervoud: string): string {
  if (aantal === null) return `Onbeperkt ${meervoud}`;
  return `${aantal} ${aantal === 1 ? enkelvoud : meervoud}`;
}

/** Compacte limietregels van een plan, afgeleid uit de catalogus. */
function inbegrepenLimieten(set: EntitlementSet): string[] {
  const uitnodigLimiet = limitOf(set, "max_candidate_invites_per_month");
  return [
    aantalTekst(limitOf(set, "max_locations"), "locatie", "locaties"),
    aantalTekst(
      limitOf(set, "max_active_vacancies"),
      "actieve vacature",
      "actieve vacatures",
    ),
    aantalTekst(limitOf(set, "max_members"), "teamlid", "teamleden"),
    uitnodigLimiet === null
      ? "onbeperkt uitnodigen"
      : `${uitnodigLimiet} uitnodigingen per maand`,
  ];
}

/** Waarde van één entitlement voor de vergelijkingstabel, in het Nederlands. */
function vergelijkWaarde(set: EntitlementSet, key: EntitlementKey): string {
  if (key === "analytics_level") {
    return set.analytics_level.meta?.level === "advanced" ? "Uitgebreid" : "Basis";
  }
  if (!can(set, key)) return "—";
  const limiet = limitOf(set, key);
  if (limiet === null) return "✓";
  return String(limiet);
}

/** Volledige vergelijkingstabel: alle entitlements per kiesbaar plan. */
function vergelijkingsRijen(sets: EntitlementSet[]): VergelijkRij[] {
  return ENTITLEMENT_KEYS.map((key) => {
    const label = ENTITLEMENT_LABELS[key];
    return {
      label: `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
      waarden: sets.map((set) => vergelijkWaarde(set, key)),
    };
  });
}

/* ------------------------------ deelweergaven ------------------------------ */

/** Eén gebruiksregel: label, teller en voortgangsbalk t.o.v. de planlimiet. */
function GebruikRij({
  naam,
  gebruikAantal,
  limiet,
}: {
  naam: string;
  gebruikAantal: number;
  limiet: number | null;
}) {
  if (limiet === 0) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{naam}</span>
        <span className="text-sm font-medium text-ink/60">
          Niet beschikbaar in je huidige plan
        </span>
      </div>
    );
  }

  if (limiet === null) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-ink">{naam}</span>
        <span className="text-sm font-medium tabular-nums text-ink/80">
          {gebruikAantal} in gebruik · <strong className="font-semibold">onbeperkt</strong>
        </span>
      </div>
    );
  }

  const bereikt = gebruikAantal >= limiet;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-ink">{naam}</span>
        <span className="text-sm font-medium tabular-nums text-ink/80">
          {gebruikAantal} van {limiet}
          {bereikt ? (
            <strong className="ml-2 font-semibold text-roze-800">
              — limiet bereikt
            </strong>
          ) : null}
        </span>
      </div>
      <ProgressBar
        value={gebruikAantal}
        max={limiet}
        label={`${naam}: ${gebruikAantal} van ${limiet} in gebruik`}
      />
    </div>
  );
}

/* --------------------------------- pagina ---------------------------------- */

export default async function AbonnementPagina({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ benodigd?: string | string[] }>;
}) {
  const [{ slug }, { benodigd }] = await Promise.all([params, searchParams]);

  // De (app)-layout controleert het membership al; hier opnieuw de poort
  // zodat de tenantisolatie ook zonder layout gegarandeerd is. Bekijken mag
  // elke rol; wijzigen vereist billing.manage (afgedwongen in de actions).
  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug);
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      notFound();
    }
    throw fout;
  }
  const { org, ctx } = toegang;
  const magBeheren = roleCan(ctx.role, "billing.manage");

  const nu = new Date();
  const maandStart = new Date(nu.getFullYear(), nu.getMonth(), 1);

  const [
    abonnement,
    effectief,
    aantalLocaties,
    aantalActieveVacatures,
    aantalTeamleden,
    aantalUitnodigingen,
  ] = await Promise.all([
    getActiveSubscription(ctx.organizationId),
    effectiveEntitlements(ctx.organizationId),
    prisma.practiceLocation.count({
      where: { organizationId: ctx.organizationId },
    }),
    prisma.vacancy.count({
      where: { organizationId: ctx.organizationId, status: "published" },
    }),
    prisma.membership.count({
      where: { organizationId: ctx.organizationId, status: "active" },
    }),
    prisma.usageEvent.count({
      where: {
        organizationId: ctx.organizationId,
        key: "candidate_invite",
        createdAt: { gte: maandStart },
      },
    }),
  ]);

  /* ---- contextuele uitleg bij ?benodigd=<key> ---- */
  const benodigdRuw = Array.isArray(benodigd) ? benodigd[0] : benodigd;
  const benodigdKey =
    benodigdRuw !== undefined && isEntitlementKey(benodigdRuw) ? benodigdRuw : null;

  let benodigdUitleg: { titel: string; tekst: string } | null = null;
  let aanbevolenCode: KiesbaarPlanCode | null = null;
  if (benodigdKey) {
    const huidigeLimiet = limitOf(effectief.entitlements, benodigdKey);
    const passend = KIESBARE_PLANNEN.filter((code) => {
      const set = entitlementsFor(code);
      if (!can(set, benodigdKey)) return false;
      const planLimiet = limitOf(set, benodigdKey);
      if (planLimiet === null) return true;
      if (huidigeLimiet === null) return false;
      return planLimiet > huidigeLimiet;
    });
    aanbevolenCode = passend[0] ?? null;

    const featureLabel = ENTITLEMENT_LABELS[benodigdKey];
    const planNamen = passend.map((code) => PLAN_CATALOG[code].name);
    const namenTekst =
      planNamen.length > 1
        ? `${planNamen.slice(0, -1).join(", ")} en ${planNamen[planNamen.length - 1]}`
        : (planNamen[0] ?? "");
    benodigdUitleg = can(effectief.entitlements, benodigdKey)
      ? {
          titel: `Meer ruimte nodig voor ${featureLabel}`,
          tekst:
            planNamen.length > 0
              ? `Je hebt de limiet voor ${featureLabel} van je huidige plan bereikt. Met ${namenTekst} krijg je meer ruimte — vergelijk de plannen hieronder.`
              : `Je hebt de limiet voor ${featureLabel} van je huidige plan bereikt. Vergelijk de plannen hieronder.`,
        }
      : {
          titel: `${featureLabel.charAt(0).toUpperCase()}${featureLabel.slice(1)} zit niet in je huidige plan`,
          tekst:
            planNamen.length > 0
              ? `Deze functie (${featureLabel}) is onderdeel van ${namenTekst}. Vergelijk de plannen hieronder en stap over wanneer je er klaar voor bent.`
              : `Deze functie (${featureLabel}) is in geen van de huidige plannen beschikbaar. Neem contact met ons op voor de mogelijkheden.`,
        };
  }

  /* ---- huidig plan + status ---- */
  const planNaam = effectief.planCode
    ? PLAN_CATALOG[effectief.planCode].name
    : "Geen abonnement";
  const statusWeergave = abonnement
    ? (STATUS_WEERGAVE[abonnement.status] ?? {
        tekst: abonnement.status,
        toon: "neutraal" as BadgeTone,
      })
    : { tekst: "Geen abonnement", toon: "neutraal" as BadgeTone };
  const trialDagenOver =
    abonnement?.status === "trialing" && abonnement.trialEndsAt
      ? dagenTot(abonnement.trialEndsAt)
      : null;

  /* ---- gebruik t.o.v. limieten ---- */
  const gebruik = [
    {
      naam: "Locaties",
      gebruikAantal: aantalLocaties,
      limiet: limitOf(effectief.entitlements, "max_locations"),
    },
    {
      naam: "Actieve vacatures",
      gebruikAantal: aantalActieveVacatures,
      limiet: limitOf(effectief.entitlements, "max_active_vacancies"),
    },
    {
      naam: "Teamleden",
      gebruikAantal: aantalTeamleden,
      limiet: limitOf(effectief.entitlements, "max_members"),
    },
    {
      naam: "Kandidaat-uitnodigingen deze maand",
      gebruikAantal: aantalUitnodigingen,
      limiet: limitOf(effectief.entitlements, "max_candidate_invites_per_month"),
    },
  ];

  /* ---- planvergelijking uit de catalogus ---- */
  const planSets = KIESBARE_PLANNEN.map((code) => entitlementsFor(code));
  const plannen: PlanKaartData[] = KIESBARE_PLANNEN.map((code, index) => {
    const definitie = PLAN_CATALOG[code];
    const versie = getPlanVersion(code);
    return {
      code,
      naam: definitie.name,
      tagline: definitie.tagline ?? "",
      outcomes: [...(definitie.outcomes ?? [])],
      inbegrepen: inbegrepenLimieten(planSets[index]),
      prijsMaandCents: versie.priceMonthlyCents,
      prijsJaarCents: versie.priceYearlyCents,
      opAanvraag: versie.meta?.pricing === "contract",
      isHuidig: effectief.planCode === code,
    };
  });
  const vergelijking = vergelijkingsRijen(planSets);

  // Zonder contextuele aanbeveling (?benodigd=…) is Growth het aanbevolen
  // plan — tenzij het al het huidige plan is.
  if (aanbevolenCode === null && effectief.planCode !== "growth") {
    aanbevolenCode = "growth";
  }

  const kanOpzeggen =
    abonnement !== null &&
    !abonnement.cancelAtPeriodEnd &&
    abonnement.planVersion.plan.code !== "trial";

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        title="Jouw"
        accent="abonnement"
        description={`Het plan, het gebruik en de facturatie van ${org.name} op één plek.`}
        actions={<Badge tone="wit">Testomgeving — geen echte betaling</Badge>}
      />

      {/* contextuele uitleg vanuit een EntitlementError-moment elders */}
      {benodigdUitleg ? (
        <Card strong className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-ink">{benodigdUitleg.titel}</h2>
          <p className="text-[15px] leading-relaxed text-ink/80">
            {benodigdUitleg.tekst}
          </p>
        </Card>
      ) : null}

      {/* read-only melding voor rollen zonder billing.manage */}
      {!magBeheren ? (
        <Card className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">
            Je bekijkt deze pagina met leesrechten.
          </p>
          <p className="text-sm leading-relaxed text-ink/70">
            Alleen de eigenaar of een beheerder van {org.name} kan het
            abonnement wijzigen of opzeggen. De gegevens hieronder kun je wel
            gewoon bekijken.
          </p>
        </Card>
      ) : null}

      {/* huidig plan + status */}
      <section aria-labelledby="huidig-plan" className="flex flex-col gap-4">
        <h2 id="huidig-plan" className="sr-only">
          Huidig plan en status
        </h2>
        <Card strong className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tracking-tight text-ink">
              {planNaam}
            </span>
            <Badge tone={statusWeergave.toon}>{statusWeergave.tekst}</Badge>
            {abonnement?.cancelAtPeriodEnd ? (
              <Badge tone="roze">Opgezegd per periode-einde</Badge>
            ) : null}
          </div>

          <div className="flex flex-col gap-1 text-[15px] leading-relaxed text-ink/80">
            {abonnement === null ? (
              <p>
                Er is geen actief abonnement — kies hieronder een plan om verder
                te gaan.
              </p>
            ) : abonnement.status === "trialing" ? (
              <p>
                Nog{" "}
                <strong className="font-semibold text-ink">
                  {trialDagenOver} {trialDagenOver === 1 ? "dag" : "dagen"}
                </strong>{" "}
                proefperiode — loopt tot {datumLang(abonnement.currentPeriodEnd)}.
              </p>
            ) : abonnement.cancelAtPeriodEnd ? (
              <p>
                Je abonnement is opgezegd en blijft actief tot{" "}
                <strong className="font-semibold text-ink">
                  {datumLang(abonnement.currentPeriodEnd)}
                </strong>
                ; daarna stopt het vanzelf.
              </p>
            ) : (
              <p>
                Volgende verlenging op{" "}
                <strong className="font-semibold text-ink">
                  {datumLang(abonnement.currentPeriodEnd)}
                </strong>
                .
              </p>
            )}

            {abonnement?.status === "past_due" ? (
              <p className="font-medium text-roze-800">
                De laatste verlenging is niet gelukt. Je functies blijven
                tijdelijk werken; kies hieronder opnieuw een plan om het
                abonnement te herstellen.
              </p>
            ) : null}
            {effectief.status === "trial_expired" ? (
              <p className="font-medium text-roze-800">
                Je proefperiode is afgelopen — kies hieronder een plan om alle
                functies weer te gebruiken.
              </p>
            ) : null}
          </div>
        </Card>
      </section>

      {/* gebruik t.o.v. limieten */}
      <section aria-labelledby="gebruik-titel" className="flex flex-col gap-4">
        <SectionHeading
          eyebrow="Gebruik"
          title="Wat gebruik je van je"
          accent="plan?"
        />
        <h2 id="gebruik-titel" className="sr-only">
          Gebruik ten opzichte van de limieten van je plan
        </h2>
        <Card className="flex flex-col gap-5">
          {gebruik.map((rij) => (
            <GebruikRij
              key={rij.naam}
              naam={rij.naam}
              gebruikAantal={rij.gebruikAantal}
              limiet={rij.limiet}
            />
          ))}
        </Card>
      </section>

      {/* planvergelijking + acties */}
      <section aria-labelledby="plannen-titel" className="flex flex-col gap-4">
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeading
            eyebrow="Plannen"
            title="Kies het plan dat bij je"
            accent="ambitie past"
            description="Elk plan draait om wat je ermee bereikt: van je eerste vacature tot structureel werven over meerdere locaties. Wissel wanneer je wilt — een wijziging gaat direct in."
          />
          {/* pricinghero: de matchvorm als visuele signatuur van het aanbod */}
          <MatchShape
            score={92}
            size="hero"
            showScore={false}
            className="hidden shrink-0 sm:inline-flex"
          />
        </div>
        <h2 id="plannen-titel" className="sr-only">
          Planvergelijking
        </h2>
        <PlanKiezer
          slug={org.slug}
          organizationId={ctx.organizationId}
          magBeheren={magBeheren}
          huidigPlanCode={effectief.planCode}
          plannen={plannen}
          vergelijking={vergelijking}
          aanbevolenCode={aanbevolenCode}
          kanOpzeggen={kanOpzeggen}
          periodeEindeIso={abonnement?.currentPeriodEnd.toISOString() ?? null}
        />
      </section>
    </div>
  );
}
