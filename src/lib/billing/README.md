# Billing — huidige stand en Stripe-aansluitpunt

## Wat er nu is

Deze release bevat **geen productiebetalingen**. Alle billing loopt via de
provider-onafhankelijke interface `BillingProviderAdapter` (zie `index.ts`),
met als enige implementatie de `LocalTestBillingProvider` (`local.ts`):
abonnementen worden rechtstreeks in de database aangemaakt, gewijzigd en
geannuleerd, met auditlogging via `src/lib/audit.ts`. Daarmee is de volledige
commerciële flow end-to-end testbaar zonder externe afhankelijkheid.

De plancatalogus in `src/domain/entitlements` is de bron van waarheid;
`syncPlanCatalog()` synchroniseert die idempotent naar de tabellen `Plan`,
`PlanVersion` en `Entitlement`.

### Volledige lifecycle (lokaal, idempotent, met audit)

| Gebeurtenis | Implementatie | Audit-actie |
|---|---|---|
| Start (trial of betaald) | `startSubscription()` | `subscription.start` |
| Upgrade (per direct) | `changePlan()` — nieuwe maandperiode, wist grace/planning | `subscription.change_plan` |
| Downgrade (gepland) | `schedulePlanChange()` — zet `scheduledPlanVersionId` + `scheduledChangeAt` = periode-einde | `subscription.schedule_change` / `.cancel` |
| Verwerking planningen | `applyScheduledChanges()` (`index.ts`) — voert vervallen planwijzigingen door en effectueert opzeggingen waarvan de periode voorbij is; aanroepbaar vanuit een cron/job en getest | `subscription.scheduled_change.apply`, `subscription.cancel.effectuate` |
| Annulering | `cancelSubscription(atPeriodEnd)` | `subscription.cancel` |
| Heractivatie | `reactivateSubscription()` — binnen de lopende periode wordt de opzegging teruggedraaid; is het laatste abonnement al beëindigd, dan start een nieuw abonnement op hetzelfde plan | `subscription.reactivate` |
| Trial-expiratie | afgeleide toestand (`effectiveSubscriptionState`), vergrendelt entitlements | — |
| Mislukte betaling | `processInboundWebhook(…, "payment_failed", …)` → status `past_due` + `graceUntil` = nu + `GRACE_DAYS` (14); binnen de grace blijven de entitlements gelden (coulance), daarna vergrendeld (`src/domain/entitlements`) | `subscription.payment_failed` + in-app-notificatie voor billing-beheerders |
| Geslaagde betaling | `processInboundWebhook(…, "payment_succeeded", …)` → status `active`, grace gewist, nieuwe maandperiode | `subscription.payment_succeeded` |
| Prijsversies | planversie-pinning: bestaande abonnementen behouden hun `PlanVersion`; nieuwe versies gelden alleen voor nieuwe/gewijzigde abonnementen | — |

`applyScheduledChanges()` heeft in deze release **geen scheduler**: er is geen
cron of job-runner die hem periodiek aanroept (bekend gat, zie SCALE_AUDIT §2).
Hij is idempotent en veilig om vaak te draaien.

### Uitbreidingen (add-ons)

Add-ons staan als `ADDON_CATALOG` in `src/domain/entitlements/catalog.ts`
(extra_location, extra_seat, extra_active_vacancy, invite_pack_25,
analytics_advanced_addon, api_access_addon, extended_history,
premium_market_insights) — elk met een maandprijs in centen en een declaratief
effect op de entitlements. `setSubscriptionItems()` (index.ts) beheert de
`SubscriptionItem`-rijen; de pure functie `applySubscriptionItems()` telt
limieten op en schakelt features aan, en `effectiveEntitlements()` past die
toe zolang het abonnement toegang geeft. **Geen klantspecifieke uitzonderingen
in code** — alles loopt via catalogus + aantallen.

### Inkomende webhooks

`processInboundWebhook(provider, externalId, type, payload)` is idempotent via
`InboundWebhookEvent` `unique(provider, externalId)`: hetzelfde event twee
keer aanbieden geeft precies één verwerking (tweede keer: stil duplicaat).
De lokale testflow is `simulateLocalPaymentEvent(orgId, type, externalId?)`
(`local.ts`), die payment_failed/payment_succeeded simuleert onder provider
`local_test`.

## Waar Stripe later wordt aangesloten

Stripe is **niet productierijp** in deze release: er zijn geen keys, geen
API-calls en geen webhook-endpoint. Wat er moet gebeuren:

1. **Adapter implementeren.** Maak `stripe.ts` met een
   `StripeBillingProvider implements BillingProviderAdapter`:
   - `ensureCustomer` → `customers.create`; sla het `cus_…`-ID op in
     `BillingCustomer` (`provider: "stripe"`).
   - `startSubscription` → Checkout Session of `subscriptions.create` met de
     Stripe-price die hoort bij de planversie (mapping planversie ↔ price-ID
     in `PlanVersion.meta` of een aparte tabel).
   - `changePlan` → `subscriptions.update` met proration.
   - `schedulePlanChange` → Stripe **Subscription Schedules** (of
     `subscriptions.update` met `proration_behavior: "none"` per periode-einde);
     de lokale variant spiegelt dit met `scheduledPlanVersionId`/`At`.
   - `cancelSubscription` → `subscriptions.update` (`cancel_at_period_end`)
     of `subscriptions.cancel`.
   - `reactivateSubscription` → `subscriptions.update`
     (`cancel_at_period_end: false`) binnen de periode, anders een nieuwe
     subscription.
   - Add-ons: elk `SubscriptionItem` wordt een extra **subscription item** op
     de Stripe-subscription (eigen recurring price per add-on;
     mapping add-on-key ↔ price-ID nodig). `setSubscriptionItems()` roept dan
     `subscriptionItems.create/update/del` aan.

   Laat `getBillingProvider()` in `index.ts` vervolgens resolven op basis van
   de omgeving (`BILLING_PROVIDER=stripe` → Stripe, anders lokale
   testprovider).

2. **Webhook-endpoint.** Route handler op `app/api/webhooks/stripe` die de
   handtekening verifieert (`stripe.webhooks.constructEvent` met
   `STRIPE_WEBHOOK_SECRET`) en daarna delegeert naar
   `processInboundWebhook("stripe", event.id, <gemapt type>, payload)`.
   De idempotentie (event-ID hooguit één keer verwerken) zit daar al in.

   **Eventmapping** (Stripe-event → intern type):

   | Stripe-event | Intern type / afhandeling |
   |---|---|
   | `invoice.payment_failed` | `payment_failed` → `past_due` + `graceUntil` (nu + 14 dagen), notificatie/audit |
   | `invoice.paid` / `invoice.payment_succeeded` | `payment_succeeded` → `active`, grace gewist, nieuwe periodegrenzen (neem die uit het Stripe-invoice over i.p.v. "nu + 1 maand") |
   | `checkout.session.completed` | abonnement aanmaken/activeren en de planversie vastpinnen (nieuw intern type, bv. `subscription_provisioned`) |
   | `customer.subscription.updated` | periodegrenzen/plan/items synchroniseren (nieuw intern type) |
   | `customer.subscription.deleted` | `status: canceled` (nieuw intern type, bv. `subscription_deleted`) |

   De payload moet naar een `organizationId` herleid worden via
   `BillingCustomer.providerCustomerId` (`cus_…`) — de lokale flow geeft de
   `organizationId` direct mee.

3. **Ontbrekende productieconfiguratie** (env's, geen secrets in git):
   - `BILLING_PROVIDER=stripe` — providerkeuze in `getBillingProvider()`.
   - `STRIPE_SECRET_KEY` — server-side API-key (nooit committen).
   - `STRIPE_WEBHOOK_SECRET` — handtekeningverificatie van het endpoint.
   - `STRIPE_PUBLISHABLE_KEY` — alleen nodig zodra er client-side checkout is.
   - Price-ID-mapping per planversie én per add-on (bv.
     `PlanVersion.meta.stripePriceId` / `ADDON_CATALOG`-meta of env's als
     `STRIPE_PRICE_GROWTH_V1_MONTHLY`); prijzen moeten in Stripe worden
     aangemaakt vóór livegang.
   - Een scheduler (cron/QStash/Vercel Cron met `vercel.json`) die
     `applyScheduledChanges()` periodiek draait — Stripe stuurt weliswaar
     events, maar de lokale planningen en vangnetten hebben een ticker nodig.
   - Belastinginstellingen (btw), facturatiegegevens en het Stripe-dashboard
     (dunning-instellingen: retries + e-mails) — buiten de codebase.

4. **Audit logging.** Elke statuswijziging via webhook of adapter logt naar
   `AuditLog` — dezelfde acties als de lokale provider nu al schrijft (zie de
   lifecycle-tabel hierboven).

## Expliciet NIET in deze release

- Echte betalingen of Stripe-API-calls (geen keys, geen webhook-endpoint).
- Facturatie, btw-afhandeling en incasso.
- Proration bij up-/downgrades (upgrade start een nieuwe maandperiode zonder
  verrekening; downgrade gaat per periode-einde in).
- Een scheduler die `applyScheduledChanges()` periodiek aanroept.

De rest van de codebase merkt van de overstap naar Stripe niets: alles loopt
via `BillingProviderAdapter`, `processInboundWebhook()` en de
entitlement-functies in `index.ts`.
