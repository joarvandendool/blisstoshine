# Disaster recovery en incidentrespons

Zie ook `DEPLOYMENT.md` (root) voor de omgevings- en herstelbasis en
`docs/OPERATIONS.md` (operationeel runbook: §6 back-ups/herstel, §7
cron-taken, §8 migratieprocedure en rollback, §9 providerstatus).

## Back-ups

- Productiedatabase draait op Supabase (via de Vercel-integratie).
  **Dagelijkse automatische back-ups** door Supabase; afgesproken proces:
  restore-test per kwartaal (`DEPLOYMENT.md`, "Herstel").
- Er is geen aanvullende, eigen back-upautomatisering in de repository; het
  back-upbeleid leunt op de Supabase-laag. Point-in-time-recovery is een
  Supabase-planfeature en is niet in code geconfigureerd — **niet
  gecontroleerd** in deze audit.
- De plancatalogus is als code herstelbaar: een lege database bouwt zichzelf
  op via migraties + `syncPlanCatalog()` bij het eerste abonnement
  (`src/lib/billing/index.ts:110`, `DEPLOYMENT.md`).

## Herstelprocedure (database)

1. Herstel de Supabase-back-up naar een nieuwe of bestaande instance.
2. Controleer dat de app-schema-scheiding intact is: de app draait in het
   Postgres-schema `mondzorgwerkt` (`withAppSchema()`, `src/lib/db.ts:14`).
3. Draai `prisma migrate deploy` (of laat de buildstap dit doen —
   `scripts/deploy-migrate.mjs` op de niet-gepoolde
   `POSTGRES_URL_NON_POOLING`).
4. Verifieer met `GET /api/health` (zie hieronder) en een functionele
   steekproef (login, matchfeed, abonnementspagina).
5. Let op sessies: bij gewijzigde databasecredentials in
   SESSION_SECRET-terugvalmodus zijn alle sessies ongeldig (zie SECURITY.md).

## Migratiebeleid: uitsluitend voorwaarts

Migraties worden nooit teruggedraaid en het schema nooit handmatig gewijzigd:
een fout wordt hersteld met een **nieuwe corrigerende migratie**
(`prisma migrate dev --name fix_x`) — `DEPLOYMENT.md`, "Herstel". De
migratiehistorie (`prisma/migrations/`) is daarmee een volledige,
reproduceerbare opbouw van het schema. Kanttekening: `npm run build` draait
`prisma migrate deploy` in de buildstap; op schaal hoort dit in een aparte
release-stap (`SCALE_AUDIT.md` §3.8).

## Health checks en monitoring

- `GET /api/health` (`app/api/health/route.ts`) geeft 200 wanneer database
  én sessiegeheim in orde zijn, anders 503, met per-check-detail
  (`{ ready, checks: { database, sessionSecret }, env }`) en zonder secrets.
  Te gebruiken voor uptime-monitoring en post-deployverificatie.
- Er is geen APM/alerting-integratie in de codebase; logging loopt
  gestructureerd via console/Vercel-logs met een herkenbaar prefix per
  subsysteem, zonder persoonsgegevens. Het Sentry-aanhaakpunt is beschreven
  in `docs/OPERATIONS.md` §5 — bewust nog niet gekoppeld.

## Forensiek

- `AuditLog` bevat alle gevoelige acties (publicaties, planwijzigingen,
  consent, ledenbeheer, sleutelbeheer) met actor, entiteit en tijdstip.
- `PipelineStatusChange` is een onwijzigbaar journaal van elk traject.
- `InboundWebhookEvent` en `WebhookDelivery` maken betaal- en
  integratieverkeer reconstrueerbaar (idempotencyKeys, pogingen, fouten).

## Wat te doen bij een datalek

Procespunt — vastgelegd als procedure, niet als code:

1. **Beperk en herstel**: trek gecompromitteerde toegang in. API-sleutels:
   `revokeApiKey` / rotatie (`src/server/integrations.ts:116,148`).
   Sessies: roteer `SESSION_SECRET` — dit logt álle gebruikers uit
   (stateless tokens, `src/lib/auth.ts`). Databasecredentials: roteren via
   Supabase.
2. **Onderzoek de omvang** met `AuditLog`, `AnalyticsEvent`-tijdlijnen en de
   webhook-/outboxtabellen: welke gegevens, welke betrokkenen, welke periode.
3. **Meldplicht datalekken: beoordeel binnen 72 uur** of melding bij de
   Autoriteit Persoonsgegevens nodig is (AVG art. 33) en of betrokkenen
   geïnformeerd moeten worden (art. 34). Dit is een verplichting van de
   verwerkingsverantwoordelijke; leg de afweging schriftelijk vast, ook bij
   níet melden.
4. **Nazorg**: corrigerende migratie/hardening, aanvulling van dit document
   en KNOWN_RISKS.md.

Kanttekening (eerlijk): er is nog geen geoefend incident-response-draaiboek,
geen aangewezen functionaris en geen automatische detectie; bovenstaande is
het afgesproken minimale proces.

## Bekende DR-beperkingen

- Geen scheduler: taken die periodiek horen te draaien
  (`applyScheduledChanges()`, `attemptDeliveries()`, retentie-opruiming via
  `scripts/retention.mjs`, toekomstige outbox-verzending) hebben geen cron —
  herstel-/verwerkingsachterstanden vergen handmatige actie. Alle genoemde
  taken zijn idempotent en veilig om dubbel te draaien
  (`docs/OPERATIONS.md` §7, `src/lib/webhooks.ts:13-15`).
- Fail-open rate limiting bij databasefouten (bewust: beschikbaarheid boven
  strengheid, `src/lib/rate-limit.ts:28`).
- Restore-tests per kwartaal zijn afspraak, nog niet aantoonbaar uitgevoerd
  (geen productiegeschiedenis).
