# Bekende risico's en open punten

Eerlijke, verifieerbare lijst. Elke regel verwijst naar code of naar
`SCALE_AUDIT.md` (audit van 18 juli 2026 op het checkpoint van deze branch;
waar de schaalfases een punt inmiddels hebben opgelost staat dat erbij).

**Wat dit product uitdrukkelijk NIET claimt:** er zijn geen
SOC 2-/ISO 27001-certificeringen (niet behaald en niet aangevraagd), geen
externe pentest, geen productieomzet, geen betalende klanten of getekende
contracten bekend in deze repository, en geen formele complianceverklaringen.
KPI-schermen tonen "onvoldoende data" waar productiedata ontbreekt
(`src/server/kpi.ts`, `SCALE_AUDIT.md` §0).

## 1. Kernrisico's (functioneel onvolledig, bewust)

| Risico | Toelichting | Bron |
|---|---|---|
| **Gesimuleerde betalingen** | Alleen `LocalTestBillingProvider`; geen echte betaling, factuur, btw of dunning. Stripe is een gedocumenteerd aansluitpunt, geen implementatie. Omzet-KPI's meten gesimuleerde checkouts. | `src/lib/billing/local.ts:1-8`, `src/lib/billing/README.md` |
| **E-mail-outbox zonder verzending** | Alle e-mail blijft als `OutboxEmail`-rij staan; niets wordt verzonden. Wie niet inlogt, mist uitnodigingen en gespreksvoorstellen — het grootste retentierisico. | `src/lib/notifications.ts:3-5`, `SCALE_AUDIT.md` §7.1 |
| **Sessiegeheim-terugval** | Zonder `SESSION_SECRET` wordt het HMAC-geheim afgeleid van de database-URL (vaste salt in de repo). Wie de DB-URL kan lezen, kan sessietokens smeden. Alleen een waarschuwing + health-check-signaal; niet hard afgedwongen. | `src/lib/auth.ts:40-57`, SECURITY.md |
| **Matching-schaalgrens** | Matchfeed/Studio/Radar scoren per verzoek alle actieve profielen × vacatures in Node (O(n×m)); geen voorberekende read models, paginering of caching. Werkbaar in beta, niet op schaal. | `src/server/matching.ts:114`, `SCALE_AUDIT.md` §3.2, §9.7 |
| **Geen scheduler** | Geen `vercel.json`/cron: geplande downgrades (`applyScheduledChanges`), webhook-bezorging (`attemptDeliveries`), reminders, vacature-expiry en trial-einde-berichten draaien niet vanzelf. | `src/lib/billing/README.md`, `src/lib/webhooks.ts:13-15`, `SCALE_AUDIT.md` §7.2 |

## 2. Status van de open punten uit SCALE_AUDIT.md §9

| # | Onderwerp | Status op deze branch |
|---|---|---|
| 1 | Admin-bootstrap "eerste gebruiker wordt admin" | **Opgelost**: alleen via `PLATFORM_ADMIN_EMAIL`, eenmalig (`src/lib/auth.ts:135-149`; getest in `tests/integration/security.test.ts`). |
| 2 | `SESSION_SECRET` verplicht + wachtwoordreset + sessie-invalidatie | **Deels**: terugval verzwaring (`SESSION_PEPPER`), waarschuwing en health-check bestaan; wachtwoordreset en sessie-invalidatie ontbreken nog. |
| 3 | Rate limiting + lockout op auth | **Opgelost**: login-/registratielimieten en lockout (`src/lib/rate-limit.ts`, getest in `tests/integration/security.test.ts`). |
| 4 | Stripe-adapter incl. webhooks/dunning | **Open**: alleen aansluitpuntdocumentatie; inbound-webhookverwerking en grace bestaan al provider-neutraal (`processInboundWebhook`). |
| 5 | E-mailprovider + e-mailverificatie | **Open** (outbox only). |
| 6 | Proratie/prijshandhaving bij planwijziging | **Deels**: downgrade gaat nu netjes per periode-einde (`schedulePlanChange`); proratie bij upgrade en jaarinterval-overstap ontbreken. |
| 7 | Voorberekende match-read-models | **Open** voor de interne matching; publieke read models bestaan wel (`/api/public/v1/**`, met CDN-cache/ETag). |
| 8 | Scheduler (cron) | **Open**. |
| 9 | AVG-flows (inzage/export/verwijdering, retentie, consent-UI) | **Grotendeels opgelost**: zelfbediening op `/instellingen/privacy` (inzage, JSON-export, verwijdering-als-anonimisering, én consent inzien/intrekken in de sectie "Gedeelde gegevens" — server action → `revokeConsent` met audit) via `src/server/privacy.ts` en `src/server/pipeline.ts`, bewaartermijnen + `scripts/retention.mjs`. Nog open: een cron voor de retentie (PRIVACY.md). |
| 10 | Locatiebeheer-UI + locatiegebonden rechten + `cross_location_matching` | **Opgelost in de service-/authz-laag**: `Membership.locationIds`, `assertLocationAllowed`, entitlement-afdwinging (`src/server/matching.ts:268`), getest in `tests/integration/multilocation.test.ts`. |
| 11 | Ledenbeheer (uitnodigen, rollen, seats) | **Opgelost in de servicelaag**: `inviteMember`/`updateMember`/`deactivateMember` met `max_members`-limiet (`src/server/organizations.ts:428-547`), getest ("ledenbeheer"). |
| 12 | Echte geocoding | **Open**: vaste PC4/PC2-tabel van ±25 steden met terugval — matchscores buiten die steden systematisch onnauwkeurig (`src/server/geo.ts`, `SCALE_AUDIT.md` §8.1). |
| 13 | FK-relaties + indexen op journaaltabellen | **Deels**: additieve indexen op hete querypaden en retentiepaden zijn toegevoegd (`prisma/migrations/20260719000000_hardening_indexes/`); de ontbrekende `@relation`-koppelingen op journaal-/consenttabellen blijven open (`SCALE_AUDIT.md` §3.6). |
| 14 | Seed-guard + demo-datamarkering | **Deels opgelost**: guard op `APP_ENV=production` (`prisma/seed.ts:53`); demo-data wordt nog niet gemarkeerd en vermengt in KPI's als de seed bewust draait. |
| 15 | Toolingschuld (`next lint`, `package.json#prisma`, dode bestanden) | **Open** (deprecations richting Next 16 / Prisma 7). |

## 3. Overige aandachtspunten

- **Vrije-tekstvelden ongelijk geschoond**: pipeline-notities worden van
  contactgegevens ontdaan, `Application.motivation` / `Invitation.message` /
  `Interview.message` niet (`SCALE_AUDIT.md` §5.5).
- **Security headers/CSP en Origin-check zijn inmiddels toegevoegd**
  (`next.config.mjs`, `src/lib/security.ts`); restpunt is de CSP met
  `'unsafe-inline'` voor scripts (bewuste afweging, aanscherpbaar via
  nonce-middleware) — SCALE_AUDIT §3.10/§4.5 zijn daarmee opgelost.
- **Vacature-expiry inert**: `expiresAt`/status `expired` worden nergens
  gezet of afgedwongen (`SCALE_AUDIT.md` §2).
- **Fail-open rate limiting** bij databasefouten — bewuste keuze
  (beschikbaarheid boven strengheid), maar een DoS op de database schakelt
  daarmee ook de limiter uit (`src/lib/rate-limit.ts:28`).
- **Geen CI-pipeline, geen dependency-audit-automatisering, geen
  APM/alerting** in de repository (DEPENDENCIES.md, DISASTER_RECOVERY.md).
- **Huisstijlfonts niet gelicentieerd meegeleverd**; open stand-ins actief
  (root-`ARCHITECTURE.md`).
