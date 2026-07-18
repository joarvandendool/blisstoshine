# Architectuur

Due-diligencedocumentatie Mondzorgwerkt · branch `claude/scale-core` · juli 2026.
Dit document vat de technische architectuur samen voor een externe beoordelaar.
De oorspronkelijke architectuurkeuzes staan in de root (`ARCHITECTURE.md`);
dit document beschrijft de actuele stand inclusief de schaalfases (Workstream A).

## Stack in één oogopslag

| Laag | Keuze | Bron |
|---|---|---|
| Framework | Next.js 15 (App Router) + React 19, strikt TypeScript | `package.json` |
| Database | PostgreSQL (lokaal in dev; productie Supabase via Vercel-integratie) | `src/lib/db.ts` |
| ORM | Prisma 6, migraties in `prisma/migrations/` (5 migraties) | `prisma/schema.prisma` |
| Validatie | Zod op alle server-side input | o.a. `app/(auth)/actions.ts` |
| Auth | Eigen lichte sessie-auth (bcrypt + HMAC-cookie) | `src/lib/auth.ts` |
| Billing | Provider-onafhankelijke adapter; alleen `LocalTestBillingProvider` | `src/lib/billing/` |
| Tests | Vitest (domein + integratie tegen testdatabase), Playwright (e2e) | `tests/`, `e2e/` |

## Lagenmodel

```
app/                    Routes en server actions (dunne laag; autorisatie + Zod)
  api/                  Route handlers: /api/health, /api/events, /api/notificaties,
                        /api/praktijk/studio/simulate, /api/public/v1/** (publieke read models)
src/server/             Services die domein + Prisma verbinden (per bounded context:
                        matching, vacancies, pipeline, capacity, organizations,
                        integrations, market-monitor, account-health, shadow-matching, …)
src/domain/             PURE domeinmodules — geen React-, route- of DB-imports:
                        matching (v1 + v2-schaduw), opportunity, entitlements,
                        kpi, health, market, matching-eval, analytics, taxonomy
src/lib/                Infrastructuur: db, auth, authz, billing, notifications,
                        rate-limit, api-auth, webhooks, analytics, audit, config
prisma/                 Schema, migraties, seed (met productieguard)
tests/, e2e/            Vitest-suites en Playwright-flows
```

**Domeinregel (afgedwongen per conventie en review):** `src/domain/**`
importeert nooit uit `app/`, `src/server/`, `src/lib/` of `@prisma/client`
(zie de kopcommentaren, bv. `src/domain/entitlements/catalog.ts:3`,
`src/domain/market/aggregate.ts:1`). Domeinlogica is daardoor deterministisch
testbaar en verplaatsbaar (worker, edge) zonder herschrijven.

## Dataflow (typisch verzoek)

1. **Route/server action** valideert input met Zod en bouwt een
   autorisatiecontext: `requireUser()` / `requireMembership(orgId, capability,
   locationId?)` / `requireCandidate()` / `requirePlatformAdmin()`
   (`src/lib/authz.ts`).
2. **Service** (`src/server/**`) accepteert uitsluitend dat `OrgContext`-object
   en scopet elke query op `ctx.organizationId` en — waar relevant — op de
   locatiegebonden rechten (`allowedLocationIds`, `assertLocationAllowed`).
3. **Domein** (`src/domain/**`) berekent puur: matching, entitlements, KPI's,
   marktaggregaties, account health. Identieke invoer → identieke uitvoer.
4. **Vastlegging**: gevoelige acties naar `AuditLog` (`src/lib/audit.ts`),
   productevents naar `AnalyticsEvent` via een strikte, PII-werende envelope
   (`src/domain/analytics/events.ts`), beslismomenten naar `MatchSnapshot`
   (`src/server/matching.ts:421`).

## Belangrijkste architectuurkeuzes en afwegingen

**Eigen sessie-auth i.p.v. Auth.js/Clerk.** Bewust minimaal: alle
authenticatie loopt via `getSessionUser()`/`requireUser()`
(`src/lib/auth.ts`), zodat een volwaardige provider later inhangbaar is
zonder servicewijzigingen. Afweging: minder features (geen SSO, geen
wachtwoordreset — zie KNOWN_RISKS.md) tegen volledige controle en geen
externe afhankelijkheid in de beta.

**Configuratie-als-code, geversioneerd.** De plancatalogus
(`src/domain/entitlements/catalog.ts`), matchinggewichten
(`src/domain/matching/config.ts`) en health-gewichten
(`src/domain/health/index.ts`) staan als bevroren, geversioneerde constanten
in code en worden idempotent naar de database gesynchroniseerd
(`syncPlanCatalog()` in `src/lib/billing/index.ts:110`). Afweging: een
planwijziging vergt een deploy, maar elke uitkomst is reproduceerbaar en
reviewbaar — voor een matchingplatform met commerciële entitlements weegt
herleidbaarheid zwaarder dan runtime-configureerbaarheid.

**Database als enige infrastructuur.** Rate limiting
(`RateLimitCounter`, `src/lib/rate-limit.ts`), webhook-queue met backoff
(`WebhookDelivery`, `src/lib/webhooks.ts`), e-mail-outbox (`OutboxEmail`) en
caches (`MarketInsightSnapshot`) draaien allemaal op Postgres — geen Redis,
geen queue-dienst. Afweging: werkt identiek over serverless-instanties heen
en houdt de operationele voetafdruk klein; op grotere schaal is een echte
queue/cache een logische volgende stap.

**Matching per verzoek, geen voorberekende read models.**
`poolForMatchVacancy()` (`src/server/matching.ts:114`) scoort per aanvraag
alle actieve profielen tegen een vacature (O(kandidaten × vacatures)).
Werkbaar in de private beta; de schaalgrens is bekend en gedocumenteerd
(`SCALE_AUDIT.md` §3.2, KNOWN_RISKS.md).

**Publieke read models als apart contract.** `/api/public/v1/**` heeft eigen
mappers (`src/server/public/read-models.ts`), stabiliteitsgaranties
(identifiers permanent, velden additief), CDN-caching met ETag en eigen
rate limiting — gedocumenteerd als contract in
`docs/parallel/PUBLIC_READ_MODEL.md`. Er is via deze endpoints nooit
kandidaatdata bereikbaar.

**Twee parallelle werkstromen.** Dit platform (Workstream A: data, domein,
API's) is gescheiden ontwikkeld van de publieke marketing/branding
(Workstream B); de eigendomsverdeling en gedeelde bestanden staan in
`docs/parallel/CLAUDE_SCALE_HANDOFF.md`.

## Kwaliteitsborging

Bij het laatste audit-checkpoint (`SCALE_AUDIT.md` §0): lint, typecheck
(strict), 157 unittests/integratietests en de productiebuild groen; 12
Playwright-e2e-tests groen bij checkpoint. De integratietests draaien tegen
een echte testdatabase (`tests/setup.ts`, `TEST_DATABASE_URL`).

## Gerelateerde documenten

- `DATA_MODEL.md`, `SECURITY.md`, `TENANT_ISOLATION.md`, `PRIVACY.md`,
  `BILLING_AND_REVENUE.md`, `MATCHING_GOVERNANCE.md`, `KPI_DEFINITIONS.md`
  (deze map)
- Operationeel runbook: `docs/OPERATIONS.md` (health checks, headers/CSRF,
  privacy/retentie, cron-aanbevelingen, back-ups, migratieprocedure)
