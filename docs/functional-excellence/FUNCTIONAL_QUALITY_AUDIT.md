# Functionele kwaliteitsaudit — Mondzorgwerkt

Branch `claude/functional-excellence`, basiscommit `b5d510f` (main na de merge
van Workstream A + B). Deze audit inventariseert iedere bestaande
gebruikersgerichte functie en classificeert de bevindingen P0–P3. De
oplossingen staan in `FUNCTIONAL_QUALITY_REPORT.md`.

Methode: statische analyse van routes, navigatie, componenten, API's,
`prisma/schema.prisma`, migraties, tests en documentatie, plus gerichte
domeinanalyses (matching, consent/pipeline, billing/entitlements, formulieren).
Eindverificatie in een echte browser/HTTP-keten (`INTEGRATION_VERIFICATION.md`,
Playwright 52/52).

## 1. Inventaris per gebied (bereikbaarheid)

### Publiek (geen auth) — databron: `getPublicDataSource()`, default `direct` (echte data)
| Route | Bestand | Status |
|---|---|---|
| `/` | `app/page.tsx` | goed |
| `/vacatures`, `/vacatures/[slug]` | `app/vacatures/**` | goed |
| `/praktijken/[slug]` (consent-gated) | `app/praktijken/[slug]/page.tsx` | goed |
| `/functies|salaris|specialisaties|technologie|arbeidsmarkt/[slug]` | kennislaag | goed (alleen via footer ontsloten — P3) |
| `/design-system` | `app/design-system/**` | publiek, noindex — P2 (bewuste uitzondering, zie report) |
| `/inloggen`, `/registreren`, `/not-found`, `/sitemap.xml`, `/robots.txt` | — | goed |

### Kandidaat (`requireCandidate`) — `app/kandidaat/**`
Matchfeed, uitnodigingen (+bevestigd), profiel, matchdetail, onboarding. Alle
nav-items hebben een route. Status: goed.

### Praktijk (`getOrgForUserBySlug` + capability) — `app/praktijk/[slug]/**`
Dashboard, pipeline, bezetting, vacaturewizard, Match Studio, radar, team,
inzichten, integraties, abonnement. Status: goed (dode "Bekijk"-link was P1 —
opgelost).

### Intern (`requirePlatformAdmin`) — `app/intern/**`
Overzicht/KPI, health, monitor, matching (schaduw), outbox. Dubbele autorisatie
(layout + pagina). Status: goed.

### Instellingen (`requireUser`) — `app/instellingen/**`
Notificaties, privacy (+export). Status: goed (zwak ontsloten vanuit nav — P3).

### API — `app/api/**`
`/api/events` (publiek + anoniem rate-limited), `/api/health`, `/api/notificaties`
(`requireUser`), `/api/praktijk/studio/simulate` (membership+entitlement),
`/api/public/v1/{jobs,practices,taxonomies,market-insights}` (publiek + rate
limit), `/api/public/v1/org/*` (API-key + scope + **entitlement**).

## 2. Bevindingen (geclassificeerd)

### P0
| # | Bevinding | Bestand |
|---|---|---|
| P0-1 | `vacancy_filled`/`candidate_hired` vuren dubbel per plaatsing (KPI-vervuiling, dubbele plaatsing) | `applications.ts`, `vacancies.ts` |

### P1
| # | Bevinding | Bestand |
|---|---|---|
| P1-1 | Beloning (zzp-omzetpercentage / loondienst-salaris) wordt niet gematcht — pay-mismatch scoort als perfecte match | `domain/matching/*`, mappers |
| P1-2 | Verplichte niet-afleidbare registratie (KRT/KRM/röntgen) maakt de hele kandidatenpool ineligible | `domain/matching/engine.ts` |
| P1-3 | Ouder (out-of-order) betaalwebhook draait een geldige actieve status terug | `lib/billing/index.ts` |
| P1-4 | Bestaande API-sleutels blijven werken na downgrade/verlies van `api_access` | `app/api/public/v1/org/helpers.ts` |
| P1-5 | Checkout niet idempotent → dubbelklik kan twee actieve abonnementen aanmaken | `lib/billing/local.ts` |
| P1-6 | Uitnodigingen verlopen nooit; geen expiry afgedwongen bij accepteren | `server/invitations.ts` |
| P1-7 | Race op application-statusovergangen → stand/journaal divergeren (last-write-wins) | `server/applications.ts` |
| P1-8 | Dode "Bekijk"-link op praktijkdashboard → 404 | `app/praktijk/[slug]/(app)/page.tsx` |
| P1-9 | Vacaturewizard verliest invoer bij refresh en stapelt dubbele conceptvacatures | `vacatures/nieuw/vacature-wizard.tsx` |
| P1-10 | Publieke site draaide op fictieve fixtures i.p.v. echte data (opgelost in de integratiecommit `e0475fa`) | `public-site/data/adapter.ts` |

Alle P0- en P1-bevindingen zijn opgelost en met tests geborgd (zie report).

### P2 (afgewogen; opgelost waar het de flow aantoonbaar verbetert)
- P2-1 Interviewtijden tijdzone-onveilig (`toLocaleString` zonder `timeZone`) + geen overlapcontrole/toekomstvalidatie.
- P2-2 Kale `<form action>`-knoppen niet uitgeschakeld tijdens pending (dubbelklik) op uitnodigingen/pipeline/notificaties/privacy.
- P2-3 Read-modify-write zonder transactie bij parallelle sectie-opslag (profiel/onboarding-state).
- P2-4 Pipeline-overgangen niet volledig transactioneel (statuswijziging + journaal + recordUsage los).
- P2-5 Ontbrekende notificaties bij offer/hired/rejected en nieuwe sollicitatie/decline.
- P2-6 `in_review` en handmatige `interview` collapsen in het journaal.
- P2-7 Determinisme: gebruikerszichtbare sortering zonder tiebreaker/`orderBy`.
- P2-8 Talent Radar dupliceert reisafstandslogica met afwijkende hardheid.
- P2-9 Ongeldige urenrange scoort neutraal (60) i.p.v. 0.
- P2-10 Uitkomstbepalende magic numbers buiten `MATCHING_CONFIG`.
- P2-11 `/design-system` publiek zonder gate (bewuste uitzondering: gating breekt de visuele regressiesuite; noindex + niet gelinkt).
- P2-12 Fixtures onvoorwaardelijk geïmporteerd in de adapterbundel.
- P2-13 Betaalde add-ons zonder afdwingpunt (analytics_advanced/extended_history/candidate_pools).
- P2-14 TOCTOU-races op maandlimieten (invites/vacatures/locaties/leden).

### P3 (cosmetisch/hygiëne)
Generieke i.p.v. veldgekoppelde foutmeldingen; Engelse Zod-defaults op
client-afgeschermde velden; positieverlies onboarding bij refresh; MatchShape
toont 5/7 categorieën; geen publieke praktijken-index; kennispagina's alleen via
footer; consent-scope `contact_details` toont alleen naam; schema-doccomment
mist `interview_proposed`.

## 3. Expliciete zoektocht (opdrachtchecklist)
- Dode knoppen: alleen de "Bekijk"-link (P1-8, opgelost); overige `onClick`-handlers roepen echte acties aan.
- Links naar ontbrekende routes: alleen "Bekijk" (opgelost).
- Alleen visueel werkende acties: geen gevonden (server-bevestigde acties).
- Hardcoded cijfers: paywall-preview inzichten (aria-hidden, bewust) en homepage-illustratie (als voorbeeld gelabeld) — geen misleiding.
- Fixtures in productieflows: opgelost (echte data default; fixtures alleen expliciet voor tests/demo's).
- Dubbele implementaties: radar-reisafstand (P2-8).
- Inconsistente statussen: journaal-vrijetekst vs enums (gedocumenteerd in `STATE_MACHINE_REFERENCE.md`).
- Formulieren die niet echt opslaan: geen; wizard-dataverlies opgelost (P1-9).
- Succes vóór serverbevestiging: geen gevonden.
- TODO's/tijdelijke fallbacks: fixtures-terugval (nu alleen expliciet).
- API-responsevorm ≠ UI-types: opgelost in de integratiecommit (contract gelijkgetrokken).
- Onbereikbare features: instellingen/kennis zwak ontsloten (P3).
