# Functionele kwaliteitsrapportage — Mondzorgwerkt

Branch `claude/functional-excellence` · basiscommit `b5d510f` · eindcommit
`09b0aa9` (zie handoff voor de actuele HEAD). Alle wijzigingen met tests
geborgd; niet naar `main` of productie zonder toestemming.

## Oplossingen per bevinding

| # | Bevinding | Oplossing | Commit | Test |
|---|---|---|---|---|
| P1-10 | Publieke site op fixtures | `DirectDataSource` als default (in-process echte data); http-modus gerepareerd; nieuw `/api/public/v1/practices`; consent als echte kolommen | `e0475fa` | `public-site-direct`, `INTEGRATION_VERIFICATION.md` |
| P0-1 | Dubbele plaatsingsevents | `markFilled` = énige `vacancy_filled`-emitter (transitieguard); `updateApplicationStatus` vuurt alleen bij echte overgang, niet meer `vacancy_filled` | `57ae815` | `hired-events.test` |
| P1-1 | Beloning niet gematcht | `beoordeelBeloning` (zzp %/loondienst salaris) als zacht signaal binnen dienstverband; v1.1.0; gewichten uren 0,5/contract 0,25/beloning 0,25 | `2b7e20c` | `matching.test` (tabelgestuurd) |
| P1-2 | Registratie-eis wist pool | alleen `HARD_REGISTRATIONS` (BIG) hard; overige → aandachtspunt | `fb39203` | `matching.test` |
| P1-3 | Out-of-order webhook | `Subscription.lastBillingEventAt`; ouder event genegeerd | `15162f6` | `commercieel.test` |
| P1-4 | API na downgrade | `enforceEntitlement(api_access)` bij elk org-API-verzoek | `15162f6` | `public-api.test` |
| P1-8 | Dode "Bekijk"-link | verwijderd; Match Studio blijft de per-vacature pagina | `15162f6` | `kritieke-flow` (Match Studio) |
| P1-5 | Checkout niet idempotent | partiële unieke index (1 actief abonnement/org) + P2002-afhandeling | `d8400ad` | `commercieel.test` |
| P1-6 | Uitnodiging verloopt nooit | `Invitation.expiresAt` (+30d), geweigerd bij accepteren (410), status `expired` | `ca2f4a5` | `pipeline.test` |
| P1-7 | Application-status race | conditionele update vanuit ingelezen status → 409 voor de verliezer | `92dd208` | `hired-events.test` |
| P1-9 | Wizard-dataverlies + dubbele concepten | wizardstand in sessionStorage (incl. vacancyId), gewist bij publicatie | `09b0aa9` | `kritieke-flow` |

## Gewijzigde businessregels
- **Matching v1.0.0 → v1.1.0** (geversioneerd, `MATCHING_GOVERNANCE.md` bijgewerkt): beloning telt mee als zacht signaal; niet-afleidbare verplichte registraties zijn zacht i.p.v. hard. Eligibility-hardregels verder ongewijzigd; determinisme behouden; bestaande MatchSnapshots houden hun oude versienummer.
- **Publieke databron:** default nu echte data (`direct`); fixtures alleen expliciet (`PUBLIC_DATA_SOURCE=fixtures`, o.a. Playwright).
- **Billing:** één actief abonnement per organisatie afgedwongen; webhookvolgorde bewaakt; API-toegang live gecontroleerd.
- **Uitnodigingen:** geldig 30 dagen.

## Testbewijs (autoritatieve baseline na integratie + fixes)
- Vitest: **355/355** groen (was 312 op de merge-basis; +43 nieuwe/uitgebreide tests, o.a. compensatie-grenswaarden, plaatsingsevents, webhookvolgorde, checkout-idempotency, expiry, statusrace, API-downgrade).
- Playwright: **52/52** groen (desktop + mobiel; 24 visuele baselines onveranderd).
- Lint, typecheck, productiebuild: groen.
- Kritieke E2E (kritieke-flow) meermaals achtereen groen gedraaid tijdens verificatie.

## Visuele controle
Playwright visuele suite (390/768/1440) ongewijzigd groen; geen baseline
aangepast in deze fase (de twee pricing-baselines waren al in de integratiecommit
bijgewerkt wegens seed-datums). Geen nieuwe kleuren/kaartstijlen; `mw-*`-tokens
en Workstream B-identiteit intact.

## Performancecontrole
Publieke performancebudgetten (First Load 103–119 kB, CLS 0,0) niet verslechterd
— geen nieuwe scripts/afbeeldingen toegevoegd; wijzigingen zijn server-logica en
één client-eiland (wizard sessionStorage, verwaarloosbaar). De aparte
performance-sprint (branch `claude/performance-sprint`) loopt los hiervan.

## Ketenverificatie (browser → API → database)
Zie `docs/parallel/INTEGRATION_VERIFICATION.md`: `/vacatures` en
`/api/public/v1/jobs` tonen dezelfde geseede vacature; consent-gate 200/404;
geen fixture-lek; hire-flow schrijft precies de juiste AnalyticsEvents in de DB
(kritieke-flow stap 10).

## Resterende beslispunten / restwerk (P2/P3, geen blokkades)
- Interviewtijden tijdzone-vast maken (`Europe/Amsterdam`) + overlap-/toekomstvalidatie.
- Kale `<form action>`-knoppen `useFormStatus`-disable geven (dubbelklik).
- Pipeline-overgangen volledig in `$transaction`; consentversie vastleggen.
- Notificaties bij offer/hired/rejected/nieuwe sollicitatie/decline.
- Deterministische tiebreaker/`orderBy` op gebruikerszichtbare sortering.
- Talent Radar-reisafstand centraliseren; ongeldige urenrange → 0; magic numbers naar `MATCHING_CONFIG`.
- Betaalde add-ons koppelen aan afdwingpunt of uit de catalogus; trialverloop-melding; TOCTOU-limieten in transactie.
- Veldgekoppelde foutmeldingen + NL Zod-messages defensief; onboarding-positie hervatten.
- Stripe: productie-webhookroute + signatuurverificatie vóór livegang.
- `/design-system` gaten of accepteren (nu noindex + niet gelinkt).
