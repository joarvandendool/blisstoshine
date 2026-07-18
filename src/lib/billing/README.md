# Billing — huidige stand en Stripe-aansluitpunt

## Wat er nu is

Deze release bevat **geen productiebetalingen**. Alle billing loopt via de
provider-onafhankelijke interface `BillingProviderAdapter` (zie `index.ts`),
met als enige implementatie de `LocalTestBillingProvider` (`local.ts`):
abonnementen worden rechtstreeks in de database aangemaakt, gewijzigd en
geannuleerd, met auditlogging via `src/lib/audit.ts`. Daarmee is de volledige
commerciële flow (trial → upgrade → annulering, entitlements, limieten)
end-to-end testbaar zonder externe afhankelijkheid.

De plancatalogus in `src/domain/entitlements` is de bron van waarheid;
`syncPlanCatalog()` synchroniseert die idempotent naar de tabellen `Plan`,
`PlanVersion` en `Entitlement`.

## Waar Stripe later wordt aangesloten

1. **Adapter implementeren.** Maak `stripe.ts` met een
   `StripeBillingProvider implements BillingProviderAdapter`:
   - `ensureCustomer` → `customers.create`; sla het `cus_…`-ID op in
     `BillingCustomer` (`provider: "stripe"`).
   - `startSubscription` → Checkout Session of `subscriptions.create` met de
     Stripe-price die hoort bij de planversie (mapping planversie ↔ price-ID
     in `PlanVersion.meta` of een aparte tabel).
   - `changePlan` / `cancelSubscription` → `subscriptions.update` (proration
     resp. `cancel_at_period_end`).

   Laat `getBillingProvider()` in `index.ts` vervolgens resolven op basis van
   de omgeving (`BILLING_PROVIDER=stripe` → Stripe, anders lokale
   testprovider).

2. **Webhooks → abonnementsstatus.** Route handler op
   `app/api/webhooks/stripe` die de events vertaalt naar `Subscription`-rijen:
   - `checkout.session.completed` → abonnement aanmaken/activeren én de
     entitlements provisionen (planversie vastpinnen, `status: active`,
     periode overnemen uit Stripe);
   - `invoice.payment_failed` → `status: past_due` (de domeinlaag geeft
     tijdens dunning coulance — entitlements blijven gelden);
   - `invoice.paid` → `status: active` en nieuwe periodegrenzen;
   - `customer.subscription.deleted` → `status: canceled`.

3. **Idempotency.** Webhooks komen dubbel of buiten volgorde binnen: verwerk
   elk Stripe-event-ID hooguit één keer (zelfde patroon als
   `UsageEvent.idempotencyKey`) en gebruik Stripe-idempotency-keys bij
   uitgaande calls.

4. **Audit logging.** Elke statuswijziging via webhook of adapter logt naar
   `AuditLog` (`subscription.start`, `subscription.change_plan`,
   `subscription.cancel`, `subscription.past_due`, …) — zelfde acties als de
   lokale provider nu al schrijft.

## Expliciet NIET in deze release

- Echte betalingen of Stripe-API-calls (geen keys, geen webhooks).
- Facturatie, btw-afhandeling en incasso.
- Proration bij up-/downgrades (de lokale provider start simpelweg een nieuwe
  maandperiode).

De rest van de codebase merkt van de overstap naar Stripe niets: alles loopt
via `BillingProviderAdapter` en de entitlement-functies in `index.ts`.
