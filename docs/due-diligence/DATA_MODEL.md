# Datamodel

Bron van waarheid: `prisma/schema.prisma` (PostgreSQL). Migraties:
`prisma/migrations/` — `20260718164248_init`, `20260718201800_private_beta`,
`20260718210000_zzp_omzetpercentage`, `20260718230000_scale_core`,
`20260719000000_hardening_indexes`. Dit document beschrijft de betekenis en
samenhang van de modellen, niet elke kolom.

## 1. Identiteit

- **User** — één account per persoon (e-mail + bcrypt-hash). Eén `User` kan
  tegelijk kandidaat zijn (via `CandidateProfile`) en lid van praktijken (via
  `Membership`). `isPlatformAdmin` geeft toegang tot `/intern`.

## 2. Tenants: praktijkorganisaties

- **Organization** — de tenant. Alle praktijkdata hangt hieraan; services
  scopen elke query op `organizationId` (zie TENANT_ISOLATION.md). Bevat
  bedrijfsgegevens (KvK, factuurmail), `acquisitionSource` en het eenmalige
  activatiemoment (`activatedAt`).
- **PracticeLocation** — 1..n locaties per organisatie, met adres/coördinaten,
  gestructureerde praktijkkenmerken (taxonomiesleutels: apparatuur, software,
  specialisaties, patiëntpopulatie) en een gewenste bezetting per dagdeel
  (`staffingTarget`).
- **Membership** — koppelt User aan Organization met een rol (`owner`, `admin`,
  `recruiter`, `hiring_manager`, `viewer`, `billing_manager`) en optioneel
  **locatiegebonden rechten**: `locationIds` leeg = alle locaties, anders
  alleen de genoemde (`src/lib/authz.ts:105`).

## 3. Kandidaten

- **CandidateProfile** — het matchbare profiel: functie, ervaring, reisbereik,
  uren/contractwensen (incl. `revenueShareMin` voor zzp-omzetpercentage),
  beschikbaarheid per weekdag+dagdeel (Json), vaardigheden en leerwensen
  (taxonomiesleutels) en werkplekvoorkeuren. Privacykern: `visibility`
  (`visible` / `anonymous` / `hidden`) en `status` (alleen `active` is
  vindbaar) — zie PRIVACY.md.

## 4. Vacatures en matching

- **Vacancy** — vacature per locatie, met rooster (Json), criteria met niveau
  (`required`/`preferred`/`informational`), cultuur/ontwikkelaanbod, status
  (`draft`→`published`→`paused`/`filled`/`expired`) en een permanente publieke
  `slug` voor de read-model-API. Let op: `expiresAt`/status `expired` bestaan
  in het schema maar worden nergens gezet (`SCALE_AUDIT.md` §2).
- **MatchSnapshot** — onveranderlijke vastlegging van een matchresultaat op een
  beslismoment (uitnodiging, sollicitatie, simulatie): score, label,
  `algorithmVersion`, volledig `result` én de bepalende profiel- en
  vacaturegegevens van dat moment. Dit maakt elke beslissing achteraf
  herleidbaar (zie MATCHING_GOVERNANCE.md) — en is tegelijk een aandachtspunt
  bij verwijderverzoeken (zie PRIVACY.md).
- **Application** / **Invitation** — sollicitatie resp. uitnodiging per
  (vacature, kandidaat), uniek per paar, beide optioneel gekoppeld aan het
  snapshot van het beslismoment.
- **MatchingConfigVersion** — geversioneerde JSON-dump van de matchingconfig
  (geschreven door de seed, `prisma/seed.ts`), zodat oude snapshots ook bij
  toekomstige configwijzigingen verklaarbaar blijven.
- **ShadowMatchScore** — v2-schaduwscores naast v1 (base/shadow score,
  eligibility en verklaard verschil per categorie); raakt nooit zichtbare
  matchdata (`src/server/shadow-matching.ts`).

## 5. Pipeline, gesprekken en consent

- **PipelineStatusChange** — onwijzigbaar journaal van elk kandidaat-
  vacaturetraject (van/naar-status, actor, redencode). De actuele stand leeft
  op Invitation/Application; dit is de audittrail.
- **Interview** — gespreksplanning: praktijk stelt momenten voor (Json-slots),
  kandidaat bevestigt er één.
- **CandidateConsent** — expliciete toestemming van een kandidaat om naam en
  contactgegevens te delen met één organisatie, optioneel beperkt tot één
  vacature; `revokedAt` maakt intrekken mogelijk (service:
  `src/server/pipeline.ts:333`). Zonder rij blijft de kandidaat anoniem.
- **MatchDecisionFeedback** — gestructureerde reden bij afwijzingen en
  intrekkingen (vaste `reasonCode`-lijst). Verandert per ontwerp nooit
  automatisch scores (zie MATCHING_GOVERNANCE.md).

## 6. Commerciële laag

- **Plan → PlanVersion → Entitlement** — geversioneerde catalogus (bron in
  code: `src/domain/entitlements/catalog.ts`, idempotent gesynchroniseerd via
  `syncPlanCatalog()`). Bestaande abonnementen blijven vastgepind op hun
  planversie; prijswijzigingen raken alleen nieuwe/gewijzigde abonnementen.
- **Subscription** — toestand per organisatie (`trialing`/`active`/`past_due`/
  `canceled`), periodegrenzen, opzegging per periode-einde, **geplande
  planwijziging** (`scheduledPlanVersionId`/`scheduledChangeAt`) en
  **coulance** na mislukte betaling (`graceUntil`).
- **SubscriptionItem** — add-ons (extra locatie, seat, vacature, invite-pack,
  featurepakketten) met declaratief effect op de entitlements
  (`applySubscriptionItems`, zie BILLING_AND_REVENUE.md).
- **UsageEvent** — idempotente gebruiksregistratie (unieke `idempotencyKey`),
  bv. kandidaat-uitnodigingen tegen de maandlimiet.
- **BillingCustomer** — koppeling organisatie ↔ betaalprovider
  (`local_test` nu; `stripe` later).
- **InboundWebhookEvent** — idempotentie-anker voor inkomende provider-
  webhooks (uniek per provider + externalId).

## 7. Notificaties en e-mail

- **Notification** — in-app-melding, idempotent via unieke `dedupeKey`.
- **NotificationPreference** — kanaalvoorkeur (in-app/e-mail) per type of "all".
- **OutboxEmail** — e-mail-outbox: er wordt in deze release **niets echt
  verzonden**; rijen zijn inspecteerbaar via `/intern/outbox`
  (`src/lib/notifications.ts:3`).

## 8. Bezetting en capaciteit

- **TeamMember** — huidig teamlid van een locatie (géén platformgebruiker):
  functie, vaste werkdagen, contracturen, dienstverband, in-/uitstroomdatums.
- **TeamAbsence** — getypeerd verzuim/verlof (verlof, ziekte,
  zwangerschapsverlof) met periode, meerdere per teamlid.
- **StaffingScenario** — onveranderlijk capaciteitsscenario (simulatie →
  bevestigd/verworpen) voor wat-als-planning.

## 9. Schaalfase: health, markt, integraties, hardening

- **AccountHealthSnapshot** — uitlegbare, geversioneerde gezondheidsscore per
  organisatie (status + redenen), uitsluitend intern
  (`src/domain/health/index.ts`).
- **MarketInsightSnapshot** — cache van privacyveilige marktaggregaties
  (uniek per view + dimensie + periode, met `sampleSize`).
- **ApiKey** — API-sleutels per organisatie: alleen sha256-hash + publiek
  prefix opgeslagen, scopes, intrekbaar (`src/lib/api-auth.ts`).
- **WebhookSubscription / WebhookDelivery** — uitgaande webhooks met
  HMAC-secret, idempotente deliveries en backoff/dead-letter
  (`src/lib/webhooks.ts`).
- **ExportJob** — CSV-exportopdrachten per organisatie
  (`src/server/integrations.ts:318`).
- **PrivacyRequest** — journaal van AVG-verzoeken (export/verwijdering/
  correctie), geschreven door de privacylaag (`src/server/privacy.ts`) bij
  elke inzage-, export- en verwijderactie (zie PRIVACY.md).
- **RateLimitCounter** — vaste-venstertellers voor rate limiting over
  serverless-instanties heen (`src/lib/rate-limit.ts`).

## 10. Analytics en audit

- **AnalyticsEvent** — productevents met stabiele namen
  (`src/domain/analytics/events.ts`); `candidateId` is een pseudoniem en de
  envelope weert PII-achtige sleutels (zie PRIVACY.md).
- **AuditLog** — wie deed wat wanneer bij gevoelige acties (publicaties,
  planwijzigingen, consent, ledenbeheer), met organisatie en actor.

## Bekende beperkingen van het schema

- Journaal- en consenttabellen (`PipelineStatusChange`, `Interview`,
  `CandidateConsent`, `MatchDecisionFeedback`, `Notification.userId`,
  `AnalyticsEvent`) gebruiken kale string-ID's zonder `@relation` — geen
  referentiële integriteit op DB-niveau (`SCALE_AUDIT.md` §3.6).
- Json-velden (`availability`, `schedule`, `criteria`, `staffingTarget`)
  worden alleen applicatief gevalideerd; de database accepteert elke vorm
  (`SCALE_AUDIT.md` §8.2).
- Bewaartermijnen bestaan voor analytics, notificaties, verzonden outbox-mail
  en rate-limittellers (`src/server/privacy.ts`, `scripts/retention.mjs`),
  maar de journaaltabellen (`AuditLog`, `MatchSnapshot`,
  `PipelineStatusChange`) groeien bewust onbegrensd als geanonimiseerde
  bedrijfsadministratie, en er is geen cron die de retentie automatisch
  draait (zie PRIVACY.md en KNOWN_RISKS.md).
