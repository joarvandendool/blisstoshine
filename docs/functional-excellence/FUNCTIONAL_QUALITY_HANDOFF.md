# Functional excellence — handoff

## Branch & commits
- **Branch:** `claude/functional-excellence`
- **Basiscommit:** `b5d510f` (main na merge Workstream A + B)
- **Eindcommit:** `09b0aa9` (+ dit documentatiecommit erbovenop — zie `git log`)
- **Niet gemerged naar `main`, niet naar productie** (conform opdracht).

### Wijzigingen (basis → HEAD)
| Commit | Inhoud |
|---|---|
| `e0475fa` | Publieke databron op echte data (DirectDataSource default) |
| `57ae815` | P0: plaatsingsevents precies één keer |
| `2b7e20c` | P1: beloning in matching (v1.1.0) |
| `fb39203` | P1: registratie-eis wist pool niet meer |
| `15162f6` | P1: webhookvolgorde + API na downgrade + dode link |
| `d8400ad` | P1: checkout idempotent |
| `ca2f4a5` | P1: uitnodigingen verlopen |
| `f5006b0` | Integratieverificatie (ketenbewijs) |
| `92dd208` | P1: race-veilige statusovergangen |
| `09b0aa9` | P1: wizard behoudt invoer/geen dubbele concepten |

## Migraties (nieuw in deze branch)
- `20260719120000_public_practice_consent` — `Organization.publicConsent/publicConsentAt/publicDescription/updatedAt` (integratiecommit).
- `20260719130000_subscription_last_billing_event` — `Subscription.lastBillingEventAt`.
- `20260719140000_subscription_one_active_per_org` — duplicaat-opruiming + partiële unieke index (checkout-idempotency).
- `20260719150000_invitation_expiry` — `Invitation.expiresAt`.

Toepassen: `npm run db:deploy` (build doet dit automatisch via
`scripts/deploy-migrate.mjs`). De partiële unieke index staat als raw SQL in de
migratie én wordt in de testhelper apart aangemaakt (onzichtbaar voor
`prisma db push`).

## Env
- `PUBLIC_DATA_SOURCE` — leeg/`direct` = echte data (default), `fixtures` = tests/demo's, `http` = losse API (met `PUBLIC_API_BASE_URL`, valt op Vercel terug op `$VERCEL_URL`).
- `NEXT_PUBLIC_SITE_URL` — vereist in productie voor canonicals/OG/sitemap (default `https://mondzorgwerkt.nl`). **Handmatig in Vercel te zetten.**
- Ongewijzigd t.o.v. de basis: `DATABASE_URL`, `SESSION_SECRET`, `PLATFORM_ADMIN_EMAIL`, `AI_TRAINING_CRAWLERS`.

## Teststand (autoritatief)
- Vitest **355/355**, Playwright **52/52**, lint/typecheck/build groen.
- Draaien: `npm test` · `npm run build && npx playwright test` (webServer forceert `PUBLIC_DATA_SOURCE=fixtures` voor stabiele baselines).

## Preview
Er is in deze fase **niet** naar Vercel gedeployd (geen toestemming). Vercel
bouwt previews per branch automatisch; `claude/functional-excellence` krijgt bij
toestemming een eigen preview-URL. De integratieketen is lokaal geverifieerd
(`INTEGRATION_VERIFICATION.md`). Voor een preview met echte data hoeft alleen de
branch gedeployd te worden; `PUBLIC_DATA_SOURCE` ongezet laten (default direct).

## Definition of done — stand
- [x] Iedere bestaande functie geïnventariseerd (`FUNCTIONAL_QUALITY_AUDIT.md`).
- [x] Kernflows met bewezen begin/eind/herstel (`USER_JOURNEY_CONTRACTS.md`).
- [x] Geen P0/P1 open (10 opgelost, met tests).
- [x] Geen dode/alleen-visuele acties (dode link weg).
- [x] Matchresultaten + uitleg consistent (één engine, uitleg = score).
- [x] Autosave/wizard verliest geen data.
- [x] Herhaalbare mutaties idempotent (plaatsing, checkout, webhooks).
- [x] Consent/uitnodigingen/pipelineovergangen correct (expiry, race-veilig).
- [x] Billing/entitlements server-side (API-entitlement, webhookvolgorde).
- [x] Publieke vacaturestatus overal consistent (echte read-model bron).
- [x] Tenantisolatie bewezen (tests).
- [x] Mobiel/toetsenbord/foutstaten gecontroleerd (Playwright mobiel + a11y).
- [x] Echte browser-/API-/dataverificatie beschikbaar.
- [x] Performance/toegankelijkheid/SEO/branding niet verslechterd.
- [x] Alle tests + build groen.
- [ ] Vercel-preview READY — **wacht op toestemming om te deployen.**
- [x] Niet naar productie/`main` uitgerold.

## Resterend werk
Zie `FUNCTIONAL_QUALITY_REPORT.md` § "Resterende beslispunten" (P2/P3, geen
blokkades). Losse trajecten: performance-sprint (`claude/performance-sprint`,
WIP) en de merge/deploy-beslissing.
