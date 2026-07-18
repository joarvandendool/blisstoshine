# Mondzorgwerkt — Architectuur

Vastgelegd vóór implementatie, zoals de opdracht vraagt. Dit document beschrijft de
gekozen architectuur voor de eerste verticale slice van het match- en
capaciteitsplatform.

## Repository-inspectie (uitgangssituatie)

De repository bevatte bij aanvang alleen een statische marketing-homepage
(Next.js 15, App Router, JSX, geen database, geen auth, geen tests). Er zijn geen
`AGENTS.md`, bestaande billing- of analyticsintegraties. Het project geldt daarmee
als "leeg" in de zin van de opdracht; de voorgeschreven standaardstack is gekozen.

## Stack

| Laag            | Keuze                                | Toelichting |
|-----------------|--------------------------------------|-------------|
| Framework       | Next.js 15 App Router + TypeScript   | Bestond al (JSX); geconverteerd naar strikt TypeScript |
| Database        | PostgreSQL 16                        | Lokaal in dev; productie via Vercel/Supabase (`POSTGRES_URL`) |
| ORM             | Prisma                               | Migraties in `prisma/migrations` |
| Validatie       | Zod                                  | Alle input server-side gevalideerd |
| Styling         | Tailwind CSS v4 + design tokens      | Merkkleuren als CSS-variabelen |
| Unit tests      | Vitest                               | Domeinlogica + autorisatie + commercieel |
| E2E             | Playwright                           | Kritieke gebruikersflow |
| Auth            | Eigen lichte sessie-auth (e-mail + wachtwoord, bcrypt, HttpOnly-cookie met HMAC-ondertekening) | Bewust minimaal; NextAuth/Auth.js kan later worden ingehangen zonder domeinwijzigingen (alles loopt via `src/lib/auth.ts`) |
| Billing         | Provider-onafhankelijke laag + `LocalTestBillingProvider` | Geen productiebetalingen; Stripe-adapter later aan te sluiten op `BillingProviderAdapter` |
| Analytics       | Eigen eventtabel + `AnalyticsAdapter`-interface | Externe leverancier later aansluitbaar zonder domeinwijzigingen |

## Lagen en mappen

```
app/                     Routes (App Router)
  page.tsx               Marketing-homepage (bestond al, behouden)
  kandidaat/…            Kandidaat: onboarding, werkweek, matchfeed, matchdetail
  praktijk/…             Praktijk: dashboard, vacaturewizard, Match Studio,
                         Talent Radar, abonnement
  intern/…               Intern KPI-dashboard (alleen platform-admins)
  api/…                  Route handlers (dunne laag boven services)
src/
  domain/                Pure domeinmodules — GEEN React-, route- of DB-imports
    taxonomy/            Gedeelde taxonomie (functies, dagdelen, apparatuur, …)
    matching/            Matching-engine (deterministisch, geversioneerd)
    opportunity/         Opportunity-engine ("Maak deze match mogelijk")
    entitlements/        Plan-, planversie- en entitlement-logica
    analytics/           Eventnamen + payloadcontracten
    kpi/                 Centrale KPI-definities (één bron van waarheid)
  server/                Services die domein + Prisma verbinden
  lib/                   db, auth, authz, analytics-adapter, billing-adapter, config
  components/            UI-primitieven, MatchShape, WeekGrid, …
prisma/                  schema.prisma, migraties, seed
tests/                   Vitest (unit + autorisatie/commercieel, tegen testdatabase)
e2e/                     Playwright
```

**Domeinregel:** `src/domain/**` importeert nooit uit `app/`, `src/server/`,
`src/lib/` of `@prisma/client`. Matching is daardoor los testbaar en de engine kan
later ongewijzigd in een worker of edge-functie draaien.

## Multi-tenancy en autorisatie

- Praktijken zijn `Organization`s met `PracticeLocation`s en `Membership`s
  (rollen: owner, admin, recruiter, hiring_manager, viewer).
- Tenantisolatie wordt server-side afgedwongen via `src/lib/authz.ts`:
  services accepteren altijd een `AuthContext` en scopen elke query op
  `organizationId` uit een geverifieerd membership — nooit op client-input.
- Kandidaten zijn `User`s met een `CandidateProfile`; privacy via
  zichtbaarheids- en anonimiteitsinstellingen op het profiel.
- Platform-admins (`User.isPlatformAdmin`) zien het interne KPI-dashboard.
- Expliciete autorisatietests dekken tenantisolatie, rolbeperkingen en
  kandidaatprivacy.

## Matching

- Deterministische regels, geen externe AI. Gewichten en drempels staan in
  `src/domain/matching/config.ts` met een `algorithmVersion` (semver).
- Harde mismatches maken een kandidaat `ineligible` met redenen.
- Ontwikkelmatch: `direct_experience | strong_interest | wants_to_learn |
  neutral | mismatch` — "wil leren + praktijk biedt begeleiding" scoort positief.
- Bij belangrijke momenten (uitnodiging, sollicitatie) wordt een `MatchSnapshot`
  bewaard met score, versie, redenen en de bepalende gegevens.

## Commercieel model

- `Plan` → `PlanVersion` → `Entitlement` (configuratie, geversioneerd) en
  `Subscription`/`SubscriptionItem` (toestand per organisatie) + `UsageEvent`
  (idempotent via `idempotencyKey`).
- Limieten worden uitsluitend gecontroleerd via
  `src/domain/entitlements` (`can(org, "vacancy.publish")`-stijl) — geen
  verspreide `if (plan === …)`-checks.
- Plancodes: `trial`, `essential`, `growth`, `multi_location`.
- `BillingProviderAdapter`-interface; in deze release alleen
  `LocalTestBillingProvider` (lokale testabonnementen). Stripe-aansluitpunt is
  gedocumenteerd in `src/lib/billing/README.md`.

## Analytics en KPI's

- Stabiele eventnamen in `src/domain/analytics/events.ts` (kandidaat- en
  praktijkfunnel uit de opdracht). Events bevatten organizationId/locationId/
  plan/acquisitionSource waar passend, en geen overbodige persoonsgegevens.
- Opslag in `AnalyticsEvent`-tabel via `AnalyticsAdapter` (DB-implementatie nu,
  externe leverancier later).
- KPI-definities staan éénmaal in `src/domain/kpi/definitions.ts`; het interne
  dashboard rekent uitsluitend via deze module. Bij onvoldoende data toont het
  dashboard letterlijk "onvoldoende data".

## Huisstijl

- Merkbasis: lichtblauw `#cddfee`, primair blauw `#0120ec`, roze accent
  `#ed6ca5`; Aktiv Grotesk (interface) en Abril Display ExtraBold Italic
  (editorial titels); transparante, vloeibare glass-vormen als signatuur.
- De aangeleverde huisstijlmappen (EPS/beeldmerk/logo) staan op een lokale
  machine en zijn in deze omgeving niet beschikbaar; als referentie is de
  huisstijl-PDF gebruikt. Aktiv Grotesk en Abril Display zijn commerciële
  fonts zonder meegeleverde licentiebestanden — als tijdelijke, visueel
  verwante stand-ins worden Archivo (interface) en Playfair Display Italic
  (editorial) geladen via `next/font`. Zodra de licentiebestanden beschikbaar
  zijn is dit een drop-in vervanging in `app/layout.tsx`.
- `MatchShape` (SVG + CSS, geen 3D-engine) is de visuele signatuur: twee
  transparante vormen die naar elkaar toe bewegen naarmate de match sterker is,
  met subtiele invloed van vijf dimensies en volledige reduced-motion- en
  tekstfallback.

## Omgevingen en overdraagbaarheid

- `.env` lokaal (niet gecommit), `.env.example` gedocumenteerd; secrets nooit
  in de repository.
- Migraties via `prisma migrate`; seed met realistische Nederlandse voorbeeldata.
- Health check op `/api/health`; auditlog-tabel voor gevoelige acties;
  feature flags via `src/lib/config.ts`.
- Deployment: Vercel (project `mondzorgwerkt`). Productie-database via de
  Supabase-integratie (`POSTGRES_PRISMA_URL`). `prisma migrate deploy` draait in
  de buildstap zodra de productie-database is gekoppeld — zie DEPLOYMENT.md.
