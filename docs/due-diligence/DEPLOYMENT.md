# Deployment

Samenvatting voor due diligence. Het volledige, actuele deploydocument is
`DEPLOYMENT.md` in de repositoryroot; het operationele runbook is
`docs/OPERATIONS.md` (health checks, security headers, retentie,
cron-aanbevelingen, back-ups/herstel, migratieprocedure). Bij
tegenstrijdigheid is de root-`DEPLOYMENT.md` leidend.

## Omgevingen

| Omgeving | Database | Configuratie |
|---|---|---|
| dev | lokale PostgreSQL (`mondzorgwerkt`) | `.env` (niet in git; `.env.example` documenteert alles) |
| test | lokale PostgreSQL (`mondzorgwerkt_test`) | `TEST_DATABASE_URL` via `tests/setup.ts` |
| productie | Vercel + Supabase-integratie | Vercel env vars |

Secrets staan nooit in de repository.

## Zelfconfiguratie op Vercel/Supabase

De app configureert zichzelf grotendeels vanuit de door de integratie
geïnjecteerde variabelen:

- **Database-URL-resolutie** (`src/lib/db.ts`): expliciete `DATABASE_URL`
  wint; anders `POSTGRES_PRISMA_URL`/`POSTGRES_URL` van de integratie, waarbij
  de app in een eigen Postgres-schema draait (`?schema=mondzorgwerkt`) zodat
  bestaande tabellen in `public` onaangeroerd blijven.
- **Migraties in de build**: `npm run build` = `prisma generate` +
  `scripts/deploy-migrate.mjs` (draait `prisma migrate deploy` op de
  niet-gepoolde `POSTGRES_URL_NON_POOLING`; zonder DB-URL wordt de stap
  overgeslagen) + `next build`. Kanttekening: op schaal hoort migreren in een
  aparte release-stap (`SCALE_AUDIT.md` §3.8).
- **Plancatalogus**: synchroniseert zichzelf idempotent bij het eerste
  abonnement (`ensureOrgSubscription` → `syncPlanCatalog()`); een lege
  productiedatabase werkt direct.
- **Rate limiting**: werkt zonder configuratie via de
  `RateLimitCounter`-tabel (`src/lib/rate-limit.ts`).

## Verplichte variabelen vóór echte livegang

1. **`SESSION_SECRET`** (≥ 32 tekens, `openssl rand -hex 32`). Zonder deze
   valt de app terug op een geheim afgeleid van de database-URL — werkbaar
   voor previews, maar smeedbare sessies voor iedereen met leestoegang tot
   die URL (zie SECURITY.md). Optioneel verzwaart `SESSION_PEPPER` de
   terugval. Rotatie logt alle gebruikers uit.
2. **`PLATFORM_ADMIN_EMAIL`**: alleen een registratie met exact dit adres
   wordt (eenmalig, zolang er geen admin bestaat) platform-admin. Zonder deze
   variabele wordt niemand automatisch admin.

Overige relevante variabelen: `APP_ENV` (dev/test/production;
`src/lib/config.ts`), feature flags als `FLAG_<NAAM>=1`
(`featureFlag()`), en `SEED_FORCE=1` als bewuste override op de seed-guard
(de seed weigert op `APP_ENV=production` omdat hij demo-accounts met bekende
wachtwoorden plaatst — `prisma/seed.ts:53`).

## Lokaal draaien en verifiëren

```bash
npm install
cp .env.example .env          # SESSION_SECRET vullen
npx prisma migrate dev
npm run db:seed               # Nederlandse voorbeelddata (dev/test)
npm run dev

npm run lint && npm run typecheck && npm test   # unit + integratie
npm run build
npm run test:e2e                                # vereist build + seed
```

## Verificatie na deploy

`GET /api/health` geeft 200 wanneer database en sessiegeheim in orde zijn
(anders 503, met per-check-detail) — gebruik dit voor uptime-monitoring en
post-deployverificatie (`app/api/health/route.ts`).

## Wat er (nog) niet is

- **Geen scheduler/cron**: er is geen `vercel.json`; periodieke taken
  (geplande planwijzigingen, webhook-bezorging, retentie-opruiming,
  reminders, outbox-verzending) draaien niet vanzelf. De aanbevolen
  cron-inrichting staat in `docs/OPERATIONS.md` §7 (zie KNOWN_RISKS.md).
- **Geen CI-pipeline in de repository** (geen `.github/workflows`): de
  checksuite draait lokaal/via het buildproces.
- **Geen aparte staging-omgeving** gedefinieerd; Vercel-previews vervullen
  die rol informeel.
