# OPERATIONS — productiehardening en beheer

Fase 10 van Workstream A. Aanvulling op `DEPLOYMENT.md` (omgevingen, envs,
migratie-uitvoering) en `SCALE_AUDIT.md` (feitelijke stand). Doelpubliek:
degene die de productieomgeving draait.

## 1. Health checks

- **`GET /api/health`** — publiek, lekt geen secrets. Gebruik dit als
  uptime-probe (Vercel monitor, UptimeRobot, Checkly): verwacht HTTP 200.
- Het endpoint controleert o.a. databasebereikbaarheid en of er een bruikbaar
  sessiegeheim is (`hasSessionSecret`, `src/lib/auth.ts`).
- Aanbevolen frequentie: elke 1–5 minuten, alerting bij 2 opeenvolgende fouten.

## 2. Security headers en CSRF

- **Headers** staan centraal in `next.config.mjs` (gedeeld configbestand;
  wijzigingen loggen in `docs/parallel/CLAUDE_SCALE_HANDOFF.md`):
  X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy, HSTS en een pragmatische CSP. De CSP staat
  `script-src 'self' 'unsafe-inline'` toe omdat Next.js App Router inline
  bootstrap-scripts injecteert; aanscherpen naar nonce-based CSP kan later via
  middleware. **Gevolg voor alle werkstromen:** externe scripts, stylesheets,
  fonts en afbeeldingen worden door de browser geblokkeerd — assets self-hosten.
- **Server actions** hebben Next.js' ingebouwde Origin/Host-vergelijking
  (Next weigert cross-origin POST's naar actions standaard); daar is geen
  extra CSRF-maatregel nodig.
- **Route handlers die met sessiecookies muteren** hebben die ingebouwde
  bescherming níét en draaien daarom `assertSameOrigin()` uit
  `src/lib/security.ts`: `POST /api/events`, `POST /api/notificaties`,
  `POST /api/praktijk/studio/simulate`. Publieke GET-API's en de
  Bearer-API's onder `/api/public/v1/*` dragen geen cookies en hebben geen
  CSRF-oppervlak. Eigen host(s) worden herkend via de Host/x-forwarded-host
  van het verzoek plus `VERCEL_URL`/`VERCEL_BRANCH_URL`/
  `VERCEL_PROJECT_PRODUCTION_URL`/`APP_HOST`.
- De sessiecookie staat bovendien op `sameSite: "lax"` (`src/lib/auth.ts`)
  als tweede laag.

## 3. Privacy/AVG

- **Zelfbediening** op `/instellingen/privacy`: inzage (categorie-overzicht),
  export (JSON-download, art. 15/20), correctie (verwijzing naar de
  profielpagina's), toestemmingen (sectie "Gedeelde gegevens": actieve
  consents per praktijk/vacature inzien en per rij intrekken met
  bevestigingsstap, art. 7 — server action → `revokeConsent`,
  `src/server/pipeline.ts`, met audit- en analyticsregel) en verwijdering
  (twee-staps, art. 17). Consent verlénen gebeurt per uitnodiging op de
  uitnodigingenpagina van de kandidaat.
- **Verwijdering = directe anonimisering** (`src/server/privacy.ts`): naam →
  "Verwijderde gebruiker", e-mail → `verwijderd+<id>@anon.mondzorgwerkt.nl`,
  wachtwoordhash geroteerd naar een onbruikbare random waarde, kandidaatprofiel
  hard verwijderd, toestemmingen en memberships ingetrokken, notificaties/
  voorkeuren en outbox-mail naar het oude adres gewist, sessie uitgelogd.
- **Bewuste afweging:** MatchSnapshots, het pipeline-journaal
  (`PipelineStatusChange`), `MatchDecisionFeedback` en `AuditLog` blijven
  bestaan als **geanonimiseerde bedrijfsadministratie**. Ze verwijzen na
  verwijdering alleen nog naar een user-id zonder naam/e-mail/profiel en zijn
  nodig voor geschillen, misbruikdetectie en KPI-integriteit. Elke privacy-
  actie wordt vastgelegd in `PrivacyRequest` én `AuditLog`.
- Let op: `MatchSnapshot.profileData` bevat profielgegevens van het
  matchmoment (geen naam/e-mail — wel bv. postcode/beschikbaarheid). Wie hier
  strikter in wil zijn kan een latere scrub-stap toevoegen; dat is een bewuste
  vervolgkeuze, geen omissie.

## 4. Bewaartermijnen (retention)

Termijnen zijn geëxporteerde constanten in `src/server/privacy.ts` (één bron
van waarheid):

| Data | Termijn | Actie |
|---|---|---|
| `AnalyticsEvent` | 24 maanden | verwijderen |
| `Notification` | 6 maanden | verwijderen |
| `OutboxEmail` (status `sent`) | 3 maanden | verwijderen |
| `RateLimitCounter` | 7 dagen | verwijderen |
| Draft-kandidaatprofielen (inactief) | 18 maanden | gebruiker anonimiseren |

Uitvoeren (droogloop is de standaard; pas `--apply` verwijdert echt):

```bash
npx tsx scripts/retention.mjs           # droogloop: telt alleen
npx tsx scripts/retention.mjs --apply   # ruimt echt op (audit-regel in AuditLog)
```

Het script draait via `tsx` omdat het de TypeScript-retentiefuncties zelf
importeert (geen gedupliceerde termijnen). Aanbevolen cron: dagelijks, buiten
kantooruren (zie §7).

## 5. Logging en foutmonitoring

- **Afspraak gestructureerde logging:** services loggen via
  `console.error`/`console.warn` met een herkenbaar Nederlands prefix per
  subsysteem ("rateLimit:", "retention:", "deploy-migrate:",
  "sendNotification faalde", …) en zonder persoonsgegevens in de logregel.
  Vercel bewaart deze runtime-logs; filter op prefix.
- **Fail-open vs fail-closed:** rate limiting, analytics, notificaties en
  auditlog falen bewust *zacht* (beschikbaarheid boven strengheid) en loggen
  de fout; autorisatie en tenantisolatie falen altijd *hard*.
- **Foutmonitoring-aanhaakpunt (Sentry, later):** er is bewust nog geen
  provider gekoppeld. Aanhaakpunt: `@sentry/nextjs` initialiseren via
  `instrumentation.ts` + `next.config.mjs` (gedeeld bestand — wijziging dan
  loggen in het handoff-document). Tot die tijd: Vercel-runtime-logs en de
  `AuditLog`-tabel.

## 6. Back-ups en herstel (Supabase)

- Productiedata staat in Supabase (Postgres). Supabase Pro maakt **dagelijkse
  automatische back-ups** (7 dagen retentie op Pro; PITR als add-on).
  Controleer in het Supabase-dashboard onder Database → Backups dat dit
  aanstaat vóór livegang.
- **Herstelprocedure:** herstel via het Supabase-dashboard naar het gewenste
  punt; draai daarna `npx prisma migrate status` om te verifiëren dat de
  migratiestand van de herstelde database overeenkomt met de gedeployde code
  (zo niet: de bijbehorende oudere deploy terugzetten of `migrate deploy`
  draaien). Let op: herstel logt niemand uit (sessies zijn stateless), maar
  na-herstel-registraties kunnen conflicteren met teruggezette e-mailadressen.
- Handmatige export vóór riskante operaties: `pg_dump` op de niet-gepoolde
  `POSTGRES_URL_NON_POOLING`.

## 7. Cron-taken

Er draait nog géén scheduler (geen `vercel.json`). Bij livegang inrichten
(Vercel Cron of externe runner die een beveiligd endpoint/script aanroept):

| Taak | Functie | Aanbevolen frequentie |
|---|---|---|
| Geplande abonnementswijzigingen | `applyScheduledChanges()` (`src/lib/billing/index.ts`) | elk uur |
| Webhook-bezorging (retries) | `attemptDeliveries()` (`src/lib/webhooks.ts`) | elke 5–15 min |
| Retentie-opruiming | `npx tsx scripts/retention.mjs --apply` | dagelijks, 's nachts |
| Account-health-herberekening | `recomputeAccountHealth()` (`src/server/account-health.ts`) per actieve organisatie | dagelijks |

`applyScheduledChanges` en `attemptDeliveries` zijn idempotent;
retentie is dat per definitie. Alle vier kunnen ongestraft dubbel draaien.

## 8. Migratieprocedure en rollback

- Migraties zijn **uitsluitend voorwaarts** en additief waar mogelijk;
  terugdraaien = een nieuwe corrigerende migratie, nooit `migrate reset` op
  productie.
- Uitvoering zit in de build (`scripts/deploy-migrate.mjs`, draait
  `prisma migrate deploy` op de niet-gepoolde URL). Op schaal hoort dit in
  een aparte release-stap (bekend punt, `SCALE_AUDIT.md` §3.8).
- Handgeschreven migraties (zoals `20260719000000_hardening_indexes`) volgen
  de Prisma-naamconventie voor indexen zodat schema en database identiek
  blijven; verifieer met `prisma migrate diff`.
- **Rollback van code** kan altijd via Vercel (vorige deployment promoten);
  het schema blijft dan staan — daarom mogen migraties niets verwijderen of
  hernoemen zonder overgangsperiode.

## 9. Externe providerstatus

Afhankelijkheden en waar hun status te vinden is:

| Provider | Rol | Status |
|---|---|---|
| Vercel | hosting, previews, cron | status.vercel.com |
| Supabase | Postgres, back-ups | status.supabase.com |
| Stripe (t.z.t.) | betalingen — nu alleen `LocalTestBillingProvider` | status.stripe.com |
| E-mailprovider (t.z.t.) | verzending — nu alleen outbox | n.t.b. |

## 10. Bekende performancepunten (bewust niet in deze fase gewijzigd)

Gevonden tijdens de indexcontrole; ze liggen in servicelagen van eerdere
fases en zijn hier alleen genoteerd:

- **Matching laadt alles per verzoek**: `vindbareKandidaten()` en
  `matchesForCandidate()` (`src/server/matching.ts`) halen álle actieve
  profielen resp. álle gepubliceerde vacatures op — O(kandidaten × vacatures)
  per view, zonder paginering of `take`. Werkbaar in beta; op schaal zijn
  voorberekende read models nodig (`SCALE_AUDIT.md` §3.2).
- **KPI-verzamelaars lezen volledige tabellen**: `src/server/kpi.ts` haalt
  o.a. alle vacatures en alle relevante `AnalyticsEvent`-rijen op (deels nu
  begrensd door de 24-maands retentie) en `saasKpis()` alle abonnementen.
  Acceptabel achter `requirePlatformAdmin` bij beta-volumes.
- **Marktmonitor en shadow-matching lezen het volledige pipeline-journaal**
  (`prisma.pipelineStatusChange.findMany` zonder filter,
  `src/server/market-monitor.ts`, `src/server/shadow-matching.ts`). Bij groei:
  begrenzen op periode en aggregeren in `MarketInsightSnapshot`.
- **`listPublicJobs` filtert regio in Node** na een onbegrensde fetch
  (`src/server/public/queries.ts`); paginering gebeurt wel, maar ná de query.

Nieuwe indexen van deze fase (met de dragende query): zie
`prisma/migrations/20260719000000_hardening_indexes/migration.sql`.
