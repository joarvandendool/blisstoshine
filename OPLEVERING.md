# Oplevering — eerste verticale slice Mondzorgwerkt

Datum: 18 juli 2026 · Branch: `claude/repo-cleanup-repurpose-rqbb60`

## Wat is gebouwd

Een end-to-end werkende verticale slice van het match- en capaciteitsplatform:

1. **Kandidaatprofiel** — zes-staps onboarding als samenstel-ervaring met de
   ideale werkweek (WeekGrid), vakinhoud incl. "wil leren", voorkeuren,
   privacy-instellingen en volledigheidsscore; profielpagina voor onderhoud.
2. **Praktijkorganisatie en -locatie** — multi-tenant (Organization →
   PracticeLocation → Membership met vijf rollen), start met 14 dagen trial.
3. **Gestructureerde vacature** — wizard met dezelfde taxonomie als het
   kandidaatprofiel; elk criterium vereist/gewenst/ter info; Talent
   Radar-preview vóór publicatie.
4. **Uitlegbare matching-engine** — deterministisch, geversioneerd (v1.0.0),
   gewichten centraal, vijf harde mismatches, ontwikkelmatch ("wil TRIOS
   leren" + begeleiding = positief), Nederlandse uitlegzinnen,
   MatchSnapshots op beslismomenten.
5. **Kandidaatmatchoverzicht** — matchfeed met uitnodigingen bovenaan;
   matchdetail met scoreopbouw per categorie, werkweek-overlay en
   verbetervoorstellen.
6. **Praktijk Match Studio** — werkweek links, kandidatenpool rechts; klikken
   op dagdelen simuleert direct een nieuwe pool (expliciet "nog niets
   opgeslagen", opslaan na bevestiging), delta-meldingen ("+N kandidaten"),
   uitnodigen met vastgelegde matchscore.
7. **Maak deze match mogelijk** — opportunity-engine met max. drie realistische
   voorstellen incl. geprojecteerde score en benodigde instemming; wijzigt
   nooit automatisch profielen of vacatures.
8. **Commerciële laag** — Plan/PlanVersion/Entitlement/Subscription/
   SubscriptionItem/UsageEvent/BillingCustomer + provider-onafhankelijke
   BillingProviderAdapter met LocalTestBillingProvider (gesimuleerde
   betaling, duidelijk gelabeld); limieten uitsluitend via entitlements.
9. **Productanalytics** — eigen eventlaag met de volledige kandidaat- en
   praktijkfunnel, PII-weigering in context, adapter-interface voor latere
   externe leverancier.
10. **Intern KPI-dashboard** — marketplace- en SaaS-metrics via centrale
    definities; onvoldoende data → letterlijk "onvoldoende data".

Plus: marketingpagina, auth (e-mail/wachtwoord), health check, auditlog,
feature flags, seed met realistische Nederlandse demo-data.

## Architectuurkeuzes

Zie [ARCHITECTURE.md](./ARCHITECTURE.md). Kern: Next.js 15 App Router +
TypeScript strict, PostgreSQL + Prisma, Zod, Tailwind v4; pure domeinmodules
in `src/domain` (geen React/DB-imports), services in `src/server`,
tenantisolatie server-side via capability-rollen in `src/lib/authz.ts`.
Billing en analytics achter adapters zodat Stripe/externe analytics later
inpluggen zonder domeinwijzigingen.

## Migraties

- `20260718164248_init` — volledig multi-tenant schema (18 modellen incl.
  MatchSnapshot, commerciële laag, AnalyticsEvent, AuditLog,
  MatchingConfigVersion).

## Tests en resultaten

- **113 Vitest-tests groen**: 98 domeintests (matching incl. alle verplichte
  scenario's, opportunities, entitlements, analytics, KPI's incl.
  MRR/upgrade/downgrade/churn) + 15 integratietests (tenantisolatie,
  rolbeperkingen, kandidaatprivacy, radar-privacydrempel, entitlements per
  plan, planversie-pinning, idempotente usage, trial-expiratie).
- **Playwright e2e: 10/10 groen** (desktopproject, herhaalbaar) over de
  volledige kritieke flow: profiel → organisatie → vacature → match →
  trial-vergrendeling → upgrade → simulatie (pool verandert aantoonbaar) →
  sollicitatie → gesprek/plaatsing → verificatie van alle zeven
  analytics-events in de database; zie `e2e/kritieke-flow.spec.ts`.
  De e2e-fase ontdekte en verhielp een echte mobiele bug: een ongelaagde
  CSS-reset op de marketingpagina overschreef alle Tailwind-spacing,
  waardoor de "Verder"-knop van de vacaturewizard op mobiel achter de
  tabbalk viel. In deze sandbox draait het WebKit-project niet
  (browserdownload geblokkeerd); mobiel is geverifieerd via Chromium op
  390px-viewport.
- `npm run lint`, `npm run typecheck`, `npm run build`: allemaal groen.
- Runtime handmatig geverifieerd: alle kernroutes zonder 500's; simulate-API
  aantoonbaar tenant-scoped (404 cross-tenant, 403 zonder membership, 401
  uitgelogd, 402 op trial) en het visie-scenario werkt: woensdag versoepelen
  maakt Sanne matchbaar (0 → 96%).

## Demo-inloggegevens (alleen dev/test)

Draai `npm run db:seed`; inloggegevens verschijnen in de console
(praktijk De Lindeboom op Growth, praktijk Aan de Maas op trial, 10
kandidaten, platform-admin voor `/intern`).

## Bekende beperkingen

- Betalingen zijn gesimuleerd (LocalTestBillingProvider); Stripe-aansluitpunt
  gedocumenteerd in `src/lib/billing/README.md`.
- Geen chat, cv-builder, mobiele app of externe AI (bewust buiten scope).
- Huisstijl-fonts zijn stand-ins (Archivo/Playfair Display); Aktiv Grotesk en
  Abril Display zijn drop-in te vervangen in `app/layout.tsx` zodra de
  licentiebestanden er zijn. De EPS/beeldmerk-bestanden stonden op een lokale
  machine en zijn nog niet als webassets toegevoegd.
- Geocoding via een vaste postcodetabel (~25 steden); een echte
  geocoding-dienst is een latere verbetering.
- E-mailnotificaties ontbreken nog (nieuwe-matchmeldingen zijn in-product).
- `next lint` en `package.json#prisma` zijn deprecated richting Next 16 /
  Prisma 7 — kleine migratie later.

## Risico's voor privacy en schaalbaarheid

- **Privacy**: kandidaatzichtbaarheid en radar-drempels zijn afgedwongen en
  getest, maar een formele DPIA en verwerkersovereenkomsten horen bij
  livegang. AnalyticsEvent bewaart pseudonieme id's — bewaartermijnbeleid
  nog vaststellen.
- **Schaalbaarheid**: matching draait nu per verzoek over de volledige
  kandidatenset (prima tot duizenden profielen); daarna vooraf filteren op
  rol/regio in SQL en/of matches materialiseren. De domeinmodule is hierop
  voorbereid (geen DB-afhankelijkheid).

## Drie logische vervolgstappen

1. **Stripe aansluiten** op de bestaande adapter (subscriptions, webhooks,
   idempotency, entitlement-provisioning, past_due-flow) en de
   abonnementspagina van gesimuleerd naar echt zetten.
2. **Notificatielaag**: e-mail bij nieuwe sterke match, uitnodiging en
   sollicitatiestatus — de events bestaan al, alleen bezorging ontbreekt.
3. **Productie-livegang**: Vercel-env vars (DATABASE_URL, SESSION_SECRET),
   `prisma migrate deploy` in de build, domein koppelen, monitoring op
   `/api/health`, eerste 3–5 pilotpraktijken onboarden.

## Te valideren commerciële hypotheses (met echte praktijken)

- Betalen praktijken €149–299/maand voor doorlopend capaciteitsinzicht, ook
  buiten actieve werving?
- Is de Match Studio-simulatie ("maak woensdag flexibel → +3 kandidaten") de
  feature die trial → betaald converteert?
- Accepteren kandidaten anonieme zichtbaarheid als standaard, en hoeveel
  uitnodigingen accepteren ze?
- Is de uitnodigingslimiet per maand de juiste upgrade-hefboom (of moet het
  aantal actieve vacatures dat zijn)?
- Multi-location: is centraal beheer + cross-locatiematching genoeg voor
  contractpricing bij ketens?
