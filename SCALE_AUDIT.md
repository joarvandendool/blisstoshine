# SCALE_AUDIT — Private beta Mondzorgwerkt

Datum: 18 juli 2026 · Branch: `claude/scale-core` (checkpoint `e5aa19d`, handoff `e0405d0`)
Doel: feitelijke basis voor de schaalfases van Workstream A (multi-location, subscriptions/expansion, account health, marktmonitor, matching v2 shadow, publieke read models, integraties, hardening, financiële metrics, due diligence).

## 0. Checksuite (uitgevoerd op deze branch, ongewijzigde code)

| Check | Uitkomst |
|---|---|
| `npm run lint` | Groen, 0 warnings — mét deprecation-melding: `next lint` verdwijnt in Next.js 16 |
| `npm run typecheck` (`tsc --noEmit`, strict) | Groen |
| `npx vitest run` | Groen: 11 testbestanden, 157 tests (6× domein, 5× integratie tegen testdatabase) |
| `npm run build` | Groen (prisma generate + `scripts/deploy-migrate.mjs` + next build; 27 routes) |
| E2E (Playwright) | Niet opnieuw gedraaid (geen codewijziging); bij checkpoint 12/12 groen (`e2e/kritieke-flow.spec.ts` 10 tests, `e2e/beta-flow.spec.ts` 2 tests) |

Gebruiks- en omzetdata: **onvoldoende data** — er is geen productieverkeer geïnspecteerd; alle KPI-schermen tonen zelf "onvoldoende data" waar cijfers ontbreken (`src/server/kpi.ts`, `app/intern/page.tsx`).

---

## 1. Wat volledig werkt

- **Authenticatie en tenantisolatie.** Sessie-auth met bcrypt + HMAC-ondertekende HttpOnly-cookie (`src/lib/auth.ts`); autorisatie via één capability-matrix per rol en `requireMembership`/`requireCandidate`/`requirePlatformAdmin` (`src/lib/authz.ts`). Alle servicelagen scopen op `ctx.organizationId` uit geverifieerd membership; vreemde data geeft 404 (bv. `eigenVacature` in `src/server/matching.ts:53`, `eigenLocatie` in `src/server/vacancies.ts:87`). Integratietests dekken dit (`tests/integration/authz.test.ts`, 9 tests).
- **Alle vijf API-route-handlers zijn geautoriseerd gecontroleerd**: `/api/events` (requireUser + membership-verificatie + event-allowlist), `/api/notificaties` (requireUser, userId alleen uit sessie), `/api/praktijk/studio/simulate` (membership + capability + entitlement 402), `/api/auth/logout`, `/api/health` (publiek, lekt geen secrets). Server actions beginnen consequent met `requireUser`/Zod-validatie (bv. `app/(auth)/actions.ts`, `app/praktijk/start/actions.ts`).
- **Matching-engine v1.0.0**: deterministisch, geversioneerd, uitlegbaar (`src/domain/matching/engine.ts`, 727 regels; config `src/domain/matching/config.ts`), opportunity-engine (`src/domain/opportunity/engine.ts`) en MatchSnapshots op beslismomenten (`src/server/matching.ts:274`).
- **Volledige beta-flows**: kandidaat-onboarding in stappen, commerciële praktijkonboarding met Talent Radar-waardemoment en eenmalige activatie (`src/server/onboarding.ts`), vacaturewizard, uitnodigingen met maandlimiet en snapshot (`src/server/invitations.ts`), sollicitaties, pipeline met onwijzigbaar statusjournaal, gespreksplanning en consent (`src/server/pipeline.ts`, 920 regels), bezettingsplanner met gaten-naar-vacatureconcept (`src/server/capacity.ts`).
- **Entitlements en plannen**: catalogus als geversioneerde code (`src/domain/entitlements/catalog.ts`), idempotente sync naar DB, afdwinging via `enforceEntitlement`/`enforceLimit` met nette 402-fouten (`src/lib/billing/index.ts`); trial → upgrade → annulering end-to-end getest (`tests/integration/commercieel.test.ts`).
- **Privacylaag in matching**: visibility visible/anonymous/hidden, geanonimiseerde weergavenaam (`src/server/matching.ts:45`), k-anonimiteit ≥ 5 in Talent Radar en bezetting (`TALENT_RADAR_MIN_GROUP`, `src/lib/config.ts`), PII-filter op analytics-context (`src/domain/analytics/events.ts:138`), e-mail/telefoon-scrubbing op pipeline-notities (`src/server/pipeline.ts:135`).
- **Intern dashboard** (`/intern`): marketplace-, SaaS-, commerciële en gebruiks-KPI's uit centrale definities (`src/domain/kpi/definitions.ts`, 1066 regels), feedbackinzichten met minimumgroepsgrootte, dev-outbox-inzage — alles achter `requirePlatformAdmin` (defense-in-depth in layout én pagina).
- **Audit- en analyticssporen**: `AuditLog` op alle commerciële en beheersacties, `AnalyticsEvent` server-side met allowlist voor client-events.

## 2. Wat gedeeltelijk werkt

| Onderdeel | Stand | Bewijs |
|---|---|---|
| Betalingen | Alleen `LocalTestBillingProvider`: abonnementen direct in de DB, geen echte betaling, factuur of betaalmethode. Stripe alleen als beschreven aansluitpunt. | `src/lib/billing/local.ts:1-8`, `src/lib/billing/index.ts:69`, `src/lib/billing/README.md` |
| E-mail | Alleen outbox: `OutboxEmail`-rijen, niets wordt verzonden; inzage via `/intern/outbox`. Geen provider-hook geïmplementeerd. | `src/lib/notifications.ts:3-5`, `app/intern/outbox/page.tsx` |
| Multi-location | Datamodel (Organization → 1..n PracticeLocation), `addLocation` met `max_locations`-limiet bestaat in de servicelaag, maar er is **geen UI** die het aanroept; rollen/capabilities zijn organisatiebreed — **geen locatiegebonden rechten**; entitlement `cross_location_matching` wordt **nergens** afgedwongen. | `prisma/schema.prisma:61`, `src/server/organizations.ts:199-210`, `src/lib/authz.ts:29-60` |
| Ledenbeheer | Vijf rollen en capability `members.manage` gedefinieerd, maar geen UI/service om teamleden uit te nodigen of rollen te wijzigen — organisaties zijn effectief éénpersoons (behalve seed-data). | `src/lib/authz.ts:29`, geen treffers `members.manage` in `app/**` of `src/server/**` |
| Notificaties | Kern (idempotent, voorkeuren, in-app + outbox) werkt; drie typen (`no_response_reminder`, `vacancy_expiring`, `strong_match_found`) zijn gedefinieerd en instelbaar maar worden **nooit verstuurd** — er is geen scheduler/cron (geen `vercel.json`). | `src/lib/notifications.ts:16-24`, enige verwijzing: labels in `app/instellingen/notificaties/page.tsx:28-30` |
| Vacature-verloop | `Vacancy.expiresAt` en status `expired` bestaan in het schema maar worden nergens gezet of afgedwongen. | `prisma/schema.prisma:226`, geen schrijvende treffers in `src/server/**` |
| Consent | Verlenen en (her)verlenen werkt in de servicelaag incl. `revokeConsent`, maar er is geen UI waarmee een kandidaat consent kan intrekken. | `src/server/pipeline.ts:333`, geen treffers `revokeConsent` in `app/**` |
| Abonnementsuitbreidingen | `SubscriptionItem` (extra_location, recruiter_seat, invite_pack) bestaat als model maar wordt in geen enkele billing-flow gebruikt. | `prisma/schema.prisma:382`, geen gebruik buiten schema/KPI-definities |
| `past_due` | Toestand wordt afgeleid (periode verstreken) en geeft coulance-entitlements, maar niets zet een abonnement actief op `past_due` en er volgt geen actie. | `src/domain/entitlements/index.ts:180`, `src/lib/billing/index.ts:218` |
| Wachtwoordbeheer | Login/registratie werken; er is **geen wachtwoord-vergeten/reset-flow** en geen e-mailverificatie bij registratie. | geen treffers "reset"/"vergeten" in `app/**`; `app/(auth)/actions.ts` |
| Entitlements zonder feature | `api_access`, `export_enabled`, `candidate_pools` staan in de catalogus maar er bestaat geen API, export of pools-functionaliteit. | `src/domain/entitlements/catalog.ts:19-21`, geen afdwinging buiten catalogus |

## 3. Technische schuld

1. **Ongebruikte bestanden**: `app/praktijk/nieuw/nieuw-form.tsx` en `app/praktijk/nieuw/actions.ts` — de pagina redirect naar `/praktijk/start` en zegt zelf dat beide "(ongebruikt) blijven staan" (`app/praktijk/nieuw/page.tsx:3`).
2. **Matching laadt alles per verzoek**: `vindbareKandidaten()` haalt álle actieve profielen op (`src/server/matching.ts:34-39`) en `matchesForCandidate` álle gepubliceerde vacatures (`:125`); elke feed-/studio-/radar-view is O(kandidaten × vacatures) in Node zonder paginering, caching of voorberekende read models. Werkbaar in beta, niet op schaal.
3. **`next lint` deprecated** (verwijderd in Next 16) — migratie naar ESLint CLI nodig (`package.json#scripts.lint`, bevestigd in de lint-output).
4. **`package.json#prisma` (seed-config) deprecated** in Prisma 6/7 — verplaatsen naar `prisma.config.ts` (`package.json:22-24`).
5. **Dubbele logica**: `MIDDEN_NEDERLAND` in `src/server/candidates.ts:21` én `src/server/organizations.ts:27`; `addDays` in `src/lib/billing/local.ts:23` én `src/lib/billing/index.ts:357`; `withAppSchema` in `src/lib/db.ts:13` én `scripts/deploy-migrate.mjs:12`; `alsJson` in `src/server/matching.ts:265` én `prisma/seed.ts`.
6. **Ontbrekende FK-relaties**: `PipelineStatusChange`, `Interview`, `CandidateConsent`, `MatchDecisionFeedback`, `Notification.userId` en `AnalyticsEvent` gebruiken kale string-ID's zonder `@relation` — geen referentiële integriteit op DB-niveau, wees-records mogelijk (`prisma/schema.prisma:460-547`).
7. **Ontbrekende indexen**: `AnalyticsEvent` heeft geen index op `userId`/`candidateId` (wel op name/org); `Vacancy` geen index op `locationId` (bezetting/locatiequeries); journaaltabellen groeien onbegrensd zonder archiveringspad.
8. **Migraties in de build**: `npm run build` draait `prisma migrate deploy` (`scripts/deploy-migrate.mjs`) — builds en schema-wijzigingen zijn gekoppeld; zonder DB-URL wordt de stap stil overgeslagen. Op schaal hoort dit in een aparte release-stap.
9. **Build-artefacten in git**: `test-results/.last-run.json` is gecommit; `tsconfig.tsbuildinfo` staat lokaal in de root (wel ge-ignored sinds `b7c0b51`).
10. **Geen middleware/geen security headers**: `next.config.mjs` is leeg — geen CSP, HSTS, X-Frame-Options e.d.

## 4. Beveiligingsrisico's

1. **Eerste-gebruiker-wordt-admin-bootstrap** (`src/lib/auth.ts:125`, commit `c140511`): op een lege database wordt de allereerste registrant automatisch platform-admin (`/intern`, alle tenants-KPI's, outbox met e-mailinhoud). Wie op een vers geprovisionde productieomgeving als eerste registreert — of registreert nadat de DB is geleegd/gereset — wordt platformbeheerder. Race-conditie: twee gelijktijdige registraties kunnen bovendien beide `count()===0` zien.
2. **Geen rate limiting of lockout op auth**: `loginAction`/`registerAction` (`app/(auth)/actions.ts`) en alle API-routes zijn onbeperkt aan te roepen — brute force op wachtwoorden en registratie-spam (met outbox-vervuiling) zijn mogelijk. Geen treffers op "rate"/"throttle" in de hele codebase.
3. **Sessiegeheim afgeleid van de database-URL** (`src/lib/auth.ts:24-45`): zonder `SESSION_SECRET` wordt het HMAC-geheim gederiveerd uit de DB-connectiestring met een vaste, publieke salt (`"mondzorgwerkt-sessie-v1"` staat in de repo). Iedereen met leestoegang tot de env/DB-URL (logging, backup, integratie) kan sessietokens smeden voor **elke** userId, incl. de admin. Er is alleen een console-warning, geen harde eis.
4. **Geen sessie-invalidatie**: tokens zijn stateless en 14 dagen geldig (`SESSION_TTL_MS`); er is geen server-side sessiestore, geen "log overal uit", en omdat er geen wachtwoordwijziging/reset bestaat kan een gelekt token of wachtwoord niet worden ingetrokken zonder de DB in te gaan.
5. **CSRF niet geanalyseerd voor route handlers**: server actions krijgen Next.js' ingebouwde origin-check, maar de POST-handlers (`/api/notificaties`, `/api/events`, `/api/praktijk/studio/simulate`, `/api/auth/logout`) doen geen Origin/CSRF-controle. Het risico wordt in de praktijk beperkt door `sameSite: "lax"` op de cookie (`src/lib/auth.ts:83`), maar dat is impliciet en nergens gedocumenteerd of getest; een expliciete Origin-check ontbreekt.
6. **Seed-accounts met bekende wachtwoorden**: `admin@mondzorgwerkt.nl` / `demo-admin-2026` e.a. staan hardcoded in `prisma/seed.ts:50-52`. De seed is idempotent en draait tegen elke `DATABASE_URL` — per ongeluk op productie draaien plaatst een platform-admin-backdoor. Er is geen `APP_ENV`-guard in de seed.
7. **Geen e-mailverificatie**: registratie op andermans e-mailadres is mogelijk; notificatiemails (t.z.t. echt verzonden) gaan naar onbevestigde adressen.
8. Positief: alle onderzochte endpoints en actions dwingen autorisatie correct af (zie §1); IDOR-checks op `locationId`/`vacancyId` lopen via org-gescopede lookups (`src/server/vacancies.ts:87`, `src/server/capacity.ts`); geen gevonden endpoint dat client-input als organisatie-ID vertrouwt.

## 5. Privacyrisico's

1. **Geen bewaartermijnen of verwijderbeleid**: `AnalyticsEvent`, `AuditLog`, `MatchSnapshot`, `PipelineStatusChange`, `OutboxEmail` en `Notification` groeien onbeperkt; nergens in code of docs staat een retentietermijn (geen treffers op "bewaartermijn/retention").
2. **Geen inzage-, export- of verwijderflows (AVG art. 15/17/20)**: er bestaat geen accountverwijdering, geen data-export en geen anonimisering; `prisma.user.delete`/profielverwijdering komt nergens voor.
3. **MatchSnapshots bevatten volledige profielgegevens** (`profileData`, `prisma/schema.prisma:257`) die blijven bestaan los van het profiel — een latere verwijder-/anonimiseerflow moet deze snapshots expliciet meenemen, anders blijft persoonsdata achter.
4. **Consent-scope is smal en eenzijdig**: `CandidateConsent.scope` kent alleen `contact_details`; intrekken kan technisch (`revokeConsent`, `src/server/pipeline.ts:333`) maar niet via de UI, en er is geen consent-overzicht voor de kandidaat.
5. **Vrije-tekstvelden ongelijk behandeld**: pipeline-notities worden geschoond van e-mail/telefoon (`src/server/pipeline.ts:135-139`), maar `Application.motivation` (`src/server/applications.ts:95`), `Invitation.message` en `Interview.message` worden onbewerkt opgeslagen — kandidaten/praktijken kunnen er contactgegevens of gevoelige informatie in kwijt die buiten het consentmodel om gedeeld wordt.
6. **Outbox als PII-verzameling**: `/intern/outbox` toont volledige e-mailinhoud van alle gebruikers aan platform-admins; zonder retentie stapelt dit zich op.
7. Positief: anonimiteitsmodel (visible/anonymous/hidden), k-anonimiteit ≥ 5 op alle aggregaties en het PII-filter op analytics zijn consequent doorgevoerd (zie §1).

## 6. Omzetrisico's

1. **Geen echte betalingen**: alleen `local_test`-abonnementen; er komt geen euro binnen en er is geen betaalmethode-, factuur- of BTW-afhandeling (`src/lib/billing/local.ts`). Checkout-conversie in de KPI's meet dus gesimuleerde checkouts.
2. **Geen dunning**: `past_due` bestaat als afgeleide toestand met coulance-entitlements, maar er zijn geen betalingsherinneringen, geen retry-logica en geen automatische vergrendeling na wanbetaling.
3. **Geen prijshandhaving bij planwijziging midden in de periode**: `changePlan` zet het abonnement per direct op een **nieuwe volledige maandperiode** zonder proratie of verrekening (`src/lib/billing/local.ts:149-159`) — een downgrade halverwege een (t.z.t. betaalde) periode geeft de resterende dagen weg; een upgrade herstart de periode gratis. Ook beëindigt elke wijziging de trial per direct.
4. **Jaarinterval alleen bij start**: `changePlan` factureert altijd per maand; overstap naar jaarbetaling na de start is niet mogelijk (`src/lib/billing/local.ts:157`).
5. **`multi_location` staat op €0** met `meta.pricing: "contract"` (`src/domain/entitlements/catalog.ts:234`) — er is geen offerteflow of handhaving; het duurste plan is technisch gratis te activeren via de plan-kiezer als die het aanbiedt.
6. **Expansion-omzet onmogelijk**: `SubscriptionItem` (extra locaties, seats, invite-packs) wordt nergens verkocht of gefactureerd.
7. Werkelijke omzet/conversie: **onvoldoende data** (geen productiegebruik geïnspecteerd).

## 7. Retentierisico's

1. **Notificaties bereiken niemand buiten de app**: e-mail blijft in de outbox; een kandidaat of praktijk die niet inlogt, ziet nooit een uitnodiging, gespreksvoorstel of reminder.
2. **Geen periodieke heractivering**: geen scheduler/cron (geen `vercel.json`, geen job-runner); de reminder-typen `no_response_reminder`, `vacancy_expiring` en `strong_match_found` worden nooit verstuurd. Ook trial-verloop triggert geen bericht.
3. **Bezettingsplanner mist contracturen en verlofsoorten**: `TeamMember` kent alleen naam, functie, vaste werkdagen (Json) en één afwezigheidsperiode (`absentFrom`/`absentUntil`, `prisma/schema.prisma:577-591`) — geen contracturen, geen verlofsoorten (vakantie/ziekte/zwangerschap), geen meerdere of terugkerende afwezigheden. Voor structureel capaciteitsbeheer is dat te grof.
4. **Responsstatistieken zonder gevolg**: `src/server/response-stats.ts` meet reactiesnelheid van praktijken, maar er hangt geen nudge of health-signaal aan (relevant voor de fase account health).

## 8. Datakwaliteitsrisico's

1. **Geocoding op een vaste tabel van ±25 steden**: PC4/PC2-lookup met terugval naar het stadscentrum en anders `MIDDEN_NEDERLAND` (`src/server/geo.ts`, `src/server/candidates.ts:21`) — reistijden en dus matchscores zijn systematisch onnauwkeurig buiten die steden; kandidaten met onbekende postcode krijgen allemaal dezelfde coördinaat.
2. **Json-velden zonder DB-validatie**: `availability`, `schedule`, `criteria`, `staffingTarget`, `onboardingState`, `slots` zijn vrije Json; de app herstelt stil met casts (`castAvailability`, `src/server/candidates.ts:75`) maar de database accepteert elke vorm — geen check constraints op bv. `hoursMin <= hoursMax` of salarisbereiken.
3. **Seed-data vermengt met echte data**: de seed is idempotent en upsert demo-praktijken, -kandidaten en -pipelinehistorie in dezelfde database/hetzelfde schema als echte gebruikers, zonder markering (`prisma/seed.ts:1-8`) — KPI's op `/intern` tellen demo en echt bij elkaar op, en er is geen `APP_ENV`-guard tegen draaien op productie.
4. **Geen referentiële integriteit op journaal- en consenttabellen** (zie §3.6): verwijderde vacatures/gebruikers laten wees-records achter die aggregaties (response-stats, feedback-insights, KPI's) vervuilen.
5. **Vaste ISO-datums in de seed-historie** (bewust, voor reproduceerbare KPI's) betekenen dat tijdreeks-KPI's in een gemengde omgeving een kunstmatig verleden tonen.

---

## 9. Geprioriteerde verbeteringen (maximaal vijftien)

| # | Prio | Onderwerp | Waarom | Omvang | Fase Workstream A |
|---|---|---|---|---|---|
| 1 | Hoog | Admin-bootstrap vervangen door expliciete provisioning (env-var/invite) en verwijderen uit `registerUser` | Admin-overname op verse of gereset productiedatabase (`src/lib/auth.ts:125`) | S | Hardening |
| 2 | Hoog | `SESSION_SECRET` verplicht maken in productie; DB-URL-afleiding schrappen; wachtwoordreset + sessie-invalidatie | Smeedbare sessietokens bij lekken van DB-URL; gelekte credentials nu onherroepbaar | M | Hardening |
| 3 | Hoog | Rate limiting + lockout op login/registratie en API-routes | Brute force en registratie-spam nu onbeperkt mogelijk | S | Hardening |
| 4 | Hoog | Stripe-adapter achter `BillingProviderAdapter` incl. webhooks, facturen en dunning-flow | Zonder echte betalingen geen omzet; adapterpunt ligt klaar (`src/lib/billing/README.md`) | L | Subscriptions/expansion |
| 5 | Hoog | E-mailprovider op de outbox + e-mailverificatie bij registratie | Notificaties bereiken nu niemand buiten de app; grootste retentiehefboom | M | Account health |
| 6 | Hoog | Proratie en prijshandhaving bij planwijziging (incl. jaarinterval en trial-behoud) | Omzetlekkage: periode-reset zonder verrekening (`src/lib/billing/local.ts:149`) | M | Subscriptions/expansion |
| 7 | Hoog | Voorberekende match-read-models (per vacature/kandidaat) i.p.v. alle profielen per verzoek | O(kandidaten × vacatures) per pageview schaalt niet; ook basis voor publieke cijfers | L | Publieke read models / matching v2 shadow |
| 8 | Hoog | Scheduler (cron): reminders, vacature-expiry, trial-einde, heractivering, outbox-verzending | Drie notificatietypen en `expiresAt` bestaan maar doen niets; geen enkele periodieke taak | M | Account health |
| 9 | Midden | AVG-flows: inzage/export/verwijdering (incl. MatchSnapshots), bewaartermijnen, consent-intrekken-UI | Verplicht bij groei; nu volledig afwezig; due-diligence-blokkade | L | Hardening / due diligence |
| 10 | Midden | Locatiebeheer-UI + locatiegebonden rechten + afdwinging `cross_location_matching` | Multi-location-plan is verkoopbaar maar functioneel leeg; rollen zijn org-breed | L | Multi-location |
| 11 | Midden | Ledenbeheer (uitnodigen, rollen wijzigen, seats tellen tegen `max_members`) | Vijf rollen en capability bestaan zonder UI; nodig voor teams én seat-expansion | M | Multi-location / subscriptions |
| 12 | Midden | Echte geocoding (bv. PDOK/BAG) met fallback en herberekening van bestaande coördinaten | Matchkwaliteit buiten de 25 steden systematisch onnauwkeurig (`src/server/geo.ts`) | M | Marktmonitor / matching v2 shadow |
| 13 | Midden | FK-relaties + indexen op journaal-/consenttabellen; DB-constraints op uren/salarisbereiken | Referentiële integriteit en aggregatiekwaliteit; goedkoop nu, duur later | M | Hardening / financiële metrics |
| 14 | Laag | Seed-guard op `APP_ENV` + markering demo-data (of apart demo-tenant-vlag) | Demo-admin-backdoor en vervuilde KPI's bij per-ongeluk-seed op productie | S | Due diligence / financiële metrics |
| 15 | Laag | Toolingschuld: `next lint` → ESLint CLI, `package.json#prisma` → `prisma.config.ts`, ongebruikte `app/praktijk/nieuw/nieuw-form.tsx`/`actions.ts` en `test-results/.last-run.json` opruimen, migraties uit de build-stap | Deprecations blokkeren straks upgrades (Next 16, Prisma 7); dode code verwart | S | Hardening |
