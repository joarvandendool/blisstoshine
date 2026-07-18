# Billing en omzet

**Belangrijkste feit vooraf: er lopen in deze release géén echte betalingen.**
Alle abonnementen zijn `local_test`-abonnementen die rechtstreeks in de
database worden beheerd (`src/lib/billing/local.ts:1-8`). Er komt geen euro
binnen; er is geen betaalmethode-, factuur- of btw-afhandeling. Omzet- en
conversie-KPI's meten dus gesimuleerde checkouts.

## Architectuur: Plan → PlanVersion → Entitlement → Subscription(+Items)

- **Catalogus als code.** Alle planlogica staat op één plek:
  `src/domain/entitlements/catalog.ts` (pure domeinmodule, deep-frozen).
  Plancodes: `trial` (14 dagen), `essential` (€149/m), `growth` (€299/m),
  `multi_location` (contractpricing, prijs €0 met `meta.pricing:
  "contract"`). Jaarprijs = 10× maandprijs (~2 maanden korting).
- **Versionering en pinning.** Elke prijs-/entitlementwijziging wordt een
  nieuwe `PlanVersion`; bestaande abonnementen blijven vastgepind op hun
  versie (`Subscription.planVersionId`). `syncPlanCatalog()` synchroniseert
  de catalogus idempotent naar de database
  (`src/lib/billing/index.ts:110`).
- **Entitlements als enige poort.** Features en limieten worden uitsluitend
  gecontroleerd via `enforceEntitlement()` / `enforceLimit()`
  (`src/lib/billing/index.ts:330-364`), die een nette `EntitlementError`
  met HTTP-status 402 en Nederlandse upgrade-hint gooien. Onbekende sleutels
  of onherkenbare plandata vergrendelen fail-closed
  (`lockedEntitlements()`, `src/lib/billing/index.ts:253-298`).
  Afdwingpunten in de services: `max_locations`
  (`src/server/organizations.ts:237`), `max_members` (`:456`),
  `max_active_vacancies` (`src/server/vacancies.ts:290`),
  `max_candidate_invites_per_month` (`src/server/invitations.ts:92`, met
  idempotente `UsageEvent`-registratie), `talent_radar`
  (`src/server/radar.ts:272`), `cross_location_matching`
  (`src/server/matching.ts:268`), `api_access`
  (`src/server/integrations.ts:47`), `premium_market_insights`
  (`src/server/market-monitor.ts:637`).
- **Add-ons (SubscriptionItem).** Acht add-ons in `ADDON_CATALOG`
  (extra locatie €49, extra seat €15, extra vacature €25, invite-pack-25 €39,
  uitgebreide analytics €49, API-toegang €99, uitgebreide historie €19,
  premium marktinzichten €59 per maand) met een **declaratief** effect op de
  entitlements: limietverhoging per stuk of feature-schakelaar
  (`applySubscriptionItems`). Beheer via `setSubscriptionItems()`
  (`src/lib/billing/index.ts:418`) — declaratief, idempotent, met auditregel;
  niet beschikbaar op het trialplan. Geen klantspecifieke uitzonderingen in
  code.

## Lifecycle

Alle overgangen schrijven een `AuditLog`-regel (tabel in
`src/lib/billing/README.md`).

- **Start**: `startSubscription()` — trial start `trialing` met
  `trialEndsAt`; betaald plan start `active` met maand- of jaarperiode
  (`src/lib/billing/local.ts:83`).
- **Upgrade (per direct)**: `changePlan()` — nieuwe planversie, status
  `active`, nieuwe maandperiode; wist trial, grace en eerdere planning
  (`src/lib/billing/local.ts:136`). Bekende beperking: geen proratie en de
  periode herstart — zie "Wat er NIET is".
- **Downgrade (gepland)**: `schedulePlanChange()` zet
  `scheduledPlanVersionId` + `scheduledChangeAt` = einde lopende periode;
  terugplannen naar het huidige plan annuleert de planning
  (`src/lib/billing/local.ts:182`). Effectuering door
  `applyScheduledChanges()` (`src/lib/billing/index.ts:492`) — idempotent,
  bedoeld voor een cron; **er is nog geen scheduler die hem periodiek
  aanroept** (`src/lib/billing/README.md`).
- **Trial-verloop**: afgeleide toestand — na `trialEndsAt` zijn de
  entitlements vergrendeld zonder statuswijziging in de database
  (`src/domain/entitlements`, `effectiveSubscriptionState`).
- **Mislukte betaling → grace**: `processInboundWebhook(…,
  "payment_failed")` zet `past_due` met `graceUntil` = nu + 14 dagen
  (`GRACE_DAYS`, `src/lib/billing/index.ts:41`); binnen de grace blijven
  entitlements gelden (coulance), daarna vergrendeld. Billing-beheerders
  (owner, billing_manager) krijgen een idempotente in-app-notificatie
  (`src/lib/billing/index.ts:691`). `payment_succeeded` herstelt naar
  `active` met een nieuwe periode. Verwerking is idempotent via
  `InboundWebhookEvent` unique(provider, externalId).
- **Opzegging en heractivatie**: `cancelSubscription(atPeriodEnd)` en
  `reactivateSubscription()` (opzegging terugdraaien binnen de periode, of
  een nieuw abonnement op hetzelfde plan na beëindiging) —
  `src/lib/billing/local.ts:244-316`.

Testdekking: `tests/integration/commercieel.test.ts` — o.a. "entitlements per
plan", "planwijziging", "trial-expiratie", "uitbreidingen (add-ons)",
"geplande downgrade (per periode-einde)", "heractivatie", "failed payment →
past_due met coulance (grace)", "inkomende webhooks"; plus
`tests/domain/entitlements.test.ts` (catalogus, checkLimit, versionering).

## LocalTestBillingProvider versus toekomstig Stripe

De hele codebase praat tegen de interface `BillingProviderAdapter`
(`src/lib/billing/index.ts:60-83`); `getBillingProvider()` levert nu altijd
de `LocalTestBillingProvider`. Het Stripe-aansluitpunt is volledig
uitgeschreven in `src/lib/billing/README.md`: adapter-implementatie per
methode, webhook-endpoint met handtekeningverificatie, eventmapping
(`invoice.payment_failed` → `payment_failed`, enz.), benodigde env's
(`BILLING_PROVIDER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
price-ID-mapping) en de scheduler-eis. De lokale provider is het
referentiegedrag: dezelfde lifecycle, dezelfde audits, dezelfde idempotentie.

## Wat er NIET is (bewust en eerlijk)

- **Geen echte betalingen**: geen Stripe-keys, geen API-calls, geen
  webhook-endpoint, geen facturen, geen btw, geen incasso/dunning
  (`src/lib/billing/README.md`, "Expliciet NIET in deze release").
- **Geen proratie**: een upgrade start een nieuwe volledige maandperiode
  zonder verrekening; jaarinterval is alleen bij de start te kiezen
  (`SCALE_AUDIT.md` §6.3-6.4).
- **Geen scheduler**: `applyScheduledChanges()` moet handmatig of via een
  toekomstige cron draaien; geen `vercel.json` aanwezig.
- **`multi_location` is technisch gratis** (contractpricing zonder
  offerteflow) — commercieel proces buiten de code (`SCALE_AUDIT.md` §6.5).
- Add-onprijzen worden vastgelegd maar niet gefactureerd (er is immers geen
  betaalprovider).
