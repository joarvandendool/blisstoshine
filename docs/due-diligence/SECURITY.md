# Beveiliging

Elke bewering hieronder is verifieerbaar in de genoemde bestanden.
Testdekking: `tests/integration/security.test.ts`,
`tests/integration/authz.test.ts`, `tests/integration/webhooks.test.ts`,
`tests/integration/public-api.test.ts`. Operationele kant (headers,
retentie, cron-aanbevelingen): `docs/OPERATIONS.md`.

## Authenticatie

- E-mail + wachtwoord, gehasht met bcrypt (cost 10) — `src/lib/auth.ts:132`.
- Sessie: HttpOnly-cookie (`mz_session`) met HMAC-SHA256-ondertekende payload
  (`userId.expiry.mac`), `sameSite: "lax"`, `secure` in productie, TTL 14
  dagen (`src/lib/auth.ts:11-99`). Verificatie is timing-safe
  (`timingSafeEqual`, `src/lib/auth.ts:86`).
- **Geen** e-mailverificatie bij registratie en **geen**
  wachtwoord-vergeten-flow (zie "Bekende beperkingen").

### SESSION_SECRET-terugval en risico-afweging

Het HMAC-geheim komt bij voorkeur uit env `SESSION_SECRET` (≥ 32 tekens). Is
die niet gezet, dan wordt het geheim **deterministisch afgeleid uit de
database-connectiestring** met een vaste, publiek bekende salt
(`"mondzorgwerkt-sessie-v1"`) en optioneel een extra `SESSION_PEPPER`
(`src/lib/auth.ts:40-57`).

Afweging zoals bedoeld: de terugval maakt previews/nieuwe omgevingen direct
werkbaar zonder handmatige configuratie; de DB-URL is geheim en heeft hoge
entropie. Het risico: **iedereen met leestoegang tot de database-URL**
(logging, back-ups, integraties) kan in terugvalmodus sessietokens smeden voor
elke gebruiker, inclusief de platform-admin — de salt staat immers in de repo.
Mitigaties in code en proces:

- productie logt bij elke koude start een expliciete waarschuwing
  (`src/lib/auth.ts:18-27`);
- `GET /api/health` rapporteert `sessionSecret` als aparte check
  (`app/api/health/route.ts`);
- `DEPLOYMENT.md` markeert `SESSION_SECRET` als **verplicht vóór echte
  livegang**; `SESSION_PEPPER` verzwaart desnoods de terugval.

Restrisico: de eis is niet hard afgedwongen (de app start ook zonder). Zie
KNOWN_RISKS.md.

### Sessiebeheer-beperkingen

Sessies zijn stateless: er is geen server-side sessiestore, dus geen
"log overal uit" en geen intrekking van een individueel token. Rotatie van
`SESSION_SECRET` (of in terugvalmodus: van de DB-credentials/pepper) logt
iedereen uit. Zonder wachtwoordreset-flow is een gelekt wachtwoord alleen via
direct databasebeheer te herstellen.

### Platform-admin-bootstrap

De vroegere regel "eerste registrant op een lege database wordt admin" is
vervangen: alleen een registratie met exact het adres uit env
`PLATFORM_ADMIN_EMAIL` (hoofdletterongevoelig) wordt admin, en uitsluitend
zolang er nog géén admin bestaat (`src/lib/auth.ts:135-149`). Getest in
`tests/integration/security.test.ts` ("admin-bootstrap via
PLATFORM_ADMIN_EMAIL").

## Autorisatie (authz)

- **Eén capability-matrix per rol** (`ROLE_CAPABILITIES`,
  `src/lib/authz.ts:35-69`): owner/admin/recruiter/hiring_manager/viewer/
  billing_manager met capabilities als `vacancy.publish`, `billing.manage`,
  `members.manage`, `location.manage`. Geen verspreide rolchecks.
- Services accepteren uitsluitend een `OrgContext` uit
  `requireMembership(orgId, capability?, locationId?)` — opgebouwd uit een
  geverifieerd, actief membership, nooit uit client-input
  (`src/lib/authz.ts:90-110`).
- Locatiegebonden rechten: `Membership.locationIds` beperkt een lid tot
  specifieke locaties; afdwinging via `assertLocationAllowed()` /
  `allowedLocationIds()` (`src/lib/authz.ts:117-127`). Zie
  TENANT_ISOLATION.md.
- Platformbrede modules (KPI, account health, marktmonitor, schaduwmatching)
  mogen per afspraak alleen ná `requirePlatformAdmin()` worden aangeroepen;
  de pagina's onder `/intern` dwingen dit af in layout én pagina
  (defense-in-depth, `SCALE_AUDIT.md` §1).

## Rate limiting en lockout

Vaste-venstertellers op de tabel `RateLimitCounter` — werkt over
serverless-instanties heen zonder Redis; bij databasefouten **fail-open**
(beschikbaarheid boven strengheid, met logregel) — `src/lib/rate-limit.ts`.

| Doel | Limiet | Bron |
|---|---|---|
| Login per e-mailadres | 10 / 15 min | `DEPLOYMENT.md`, `app/(auth)/actions.ts` |
| Login per IP | 30 / 15 min | idem |
| Lockout na mislukte logins | 8 / 15 min (peek vóór poging, tellen bij mislukking — `peekRateLimit`, `src/lib/rate-limit.ts:71`) | idem |
| Registratie per IP | 5 / uur | idem |
| Publieke API per IP | 120 / min (429 + `Retry-After`) | `src/lib/api-auth.ts:182` |
| Integratie-API per sleutel | 300 / min | `src/lib/api-auth.ts:103` |

Getest in `tests/integration/security.test.ts` (vensters, lockout,
registratielimiet).

## API-sleutels (integratie-API)

`src/lib/api-auth.ts`:

- Formaat `mzw_<live|test>_<40 hex>`; de volledige sleutel wordt **precies één
  keer** getoond bij aanmaak/rotatie; opgeslagen worden alleen de sha256-hash
  en een publiek prefix voor lookup.
- Verificatie is timing-safe; intrekken (`revokedAt`) weigert direct
  (getest: `tests/integration/webhooks.test.ts` "API-sleutel intrekken").
- Scopes (`jobs:read`, `pipeline:read`, `capacity:read`, `webhooks:manage`)
  worden per endpoint afgedwongen via `requireScope()`; sleutelbeheer zelf
  vereist membership-capability én entitlement `api_access`
  (`src/server/integrations.ts:47`).

## Webhook-signing (uitgaand)

`src/lib/webhooks.ts`: elke bezorging is een POST met
`X-Mzw-Timestamp` (Unix-seconden) en
`X-Mzw-Signature = hex(hmac-sha256(secret, "timestamp.body"))`; ontvangers
verifiëren timing-safe en wijzen timestamps > 5 minuten af (replaybescherming;
verificatiehulp `verifyWebhookSignature()` meegeleverd). Deliveries zijn
idempotent (unieke key van org + event + payload-hash + subscription) met
exponentiële backoff (1m→5m→30m→2u→12u) en dead-letter na 5 pogingen.
Getest in `tests/integration/webhooks.test.ts`.

Inkomende provider-webhooks zijn idempotent via `InboundWebhookEvent`
unique(provider, externalId) (`src/lib/billing/index.ts:581`).

## Security headers en CSRF

- **Security headers op alle routes** via `next.config.mjs`:
  X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy,
  Permissions-Policy, HSTS (2 jaar, incl. subdomeinen) en een pragmatische
  CSP (`default-src 'self'`, geen externe bronnen, `frame-ancestors 'none'`).
  Afweging expliciet in het bestand: `script-src` staat `'unsafe-inline'` toe
  omdat Next.js App Router inline bootstrap-scripts injecteert; aanscherpen
  naar nonce-based CSP kan later via middleware.
- **Expliciete Origin-check (CSRF)** op de cookie-gedragen muterende route
  handlers (`POST /api/events`, `/api/notificaties`,
  `/api/praktijk/studio/simulate`): `assertSameOrigin()` in
  `src/lib/security.ts` weigert cross-origin POST's (403); eigen hosts worden
  herkend via Host/x-forwarded-host plus de Vercel-env's/`APP_HOST`. Server
  actions hebben Next.js' ingebouwde origin-controle; `sameSite: "lax"` op de
  cookie is de tweede laag. Zie `docs/OPERATIONS.md` §2.

## Overige maatregelen

- Auditlog op gevoelige acties (`src/lib/audit.ts`; alle abonnements-,
  consent- en beheersacties schrijven een regel).
- Seed-guard: `npm run db:seed` weigert bij `APP_ENV=production`, alleen te
  forceren met `SEED_FORCE=1` (`prisma/seed.ts:53`) — de seed bevat immers
  demo-accounts met bekende wachtwoorden.
- Publieke endpoints lekken geen kandidaatdata (getest:
  `tests/integration/public-api.test.ts`, "privacy van de publieke
  responses"); `/api/health` lekt geen secrets.

## Bekende beperkingen (eerlijk benoemd)

1. `SESSION_SECRET` is in productie niet hard verplicht (alleen waarschuwing
   + health-check-signaal).
2. Geen wachtwoordreset en geen e-mailverificatie; geen sessie-invalidatie
   per individuele gebruiker (`SCALE_AUDIT.md` §2 en §4.4). Volledige
   accountverwijdering (met sessie-uitlog) bestaat wel via de AVG-flow
   (`src/server/privacy.ts`).
3. De CSP bevat `'unsafe-inline'` voor scripts en styles (noodzakelijk voor
   Next.js zonder nonce-middleware) — bewuste, gedocumenteerde afweging in
   `next.config.mjs`.
4. Geen externe pentest en geen SOC 2-/ISO 27001-certificering uitgevoerd of
   aangevraagd (zie KNOWN_RISKS.md).
