# Deployment en herstel

## Omgevingen

| Omgeving   | Database                              | Config |
|------------|----------------------------------------|--------|
| dev        | lokale PostgreSQL (`mondzorgwerkt`)    | `.env` (niet in git) |
| test       | lokale PostgreSQL (`mondzorgwerkt_test`) | `TEST_DATABASE_URL`, gezet door `tests/setup.ts` |
| production | Vercel + Supabase-integratie           | Vercel env vars |

Secrets staan nooit in de repository. `.env.example` documenteert alle variabelen.

## Lokaal draaien

```bash
npm install
cp .env.example .env        # vul SESSION_SECRET met: openssl rand -hex 32
npx prisma migrate dev      # maakt schema aan
npm run db:seed             # realistische Nederlandse voorbeelddata
npm run dev
```

Testgebruikers na seed: zie `prisma/seed.ts` (wachtwoorden alleen voor dev/test).

## Verifiëren

```bash
npm run lint && npm run typecheck && npm test   # unit + integratie
npm run build                                    # productiebuild
npm run test:e2e                                 # kritieke flow (vereist build + seed)
```

## Productie (Vercel)

De app configureert zichzelf grotendeels vanuit de Supabase-integratie; voor
een echte livegang zijn twee variabelen verplicht bewust te zetten
(`SESSION_SECRET` en `PLATFORM_ADMIN_EMAIL`):

- **Database**: runtime gebruikt `DATABASE_URL` als die gezet is, anders de
  door de integratie geïnjecteerde `POSTGRES_PRISMA_URL`/`POSTGRES_URL`
  (zie `src/lib/db.ts`).
- **Migraties**: de buildstap draait `scripts/deploy-migrate.mjs`, die
  `prisma migrate deploy` uitvoert op de niet-gepoolde
  `POSTGRES_URL_NON_POOLING`; zonder database-URL wordt de stap overgeslagen.
- **Sessiegeheim — `SESSION_SECRET` (verplicht vóór echte livegang)**: zet
  een eigen geheim van minimaal 32 tekens (`openssl rand -hex 32`). Zonder
  deze variabele valt de app terug op een geheim dat deterministisch wordt
  afgeleid van de database-connectiestring (`src/lib/auth.ts`) — werkbaar
  voor previews, maar iedereen met leestoegang tot de database-URL (logging,
  back-ups, integraties) kan dan sessietokens smeden; de app logt hierover
  bij elke koude start een waarschuwing. Optioneel verzwaart `SESSION_PEPPER`
  die terugval-afleiding met een extra statische pepper die je buiten de
  database-URL om beheert. Let op: rotatie van `SESSION_SECRET` (of, in de
  terugvalmodus, van de databasecredentials of `SESSION_PEPPER`) logt alle
  gebruikers uit — sessies zijn stateless ondertekend.
- **Platformbeheerder — `PLATFORM_ADMIN_EMAIL`**: zet dit op het e-mailadres
  van de beoogde beheerder. Alleen een registratie met exact dat adres
  (hoofdletterongevoelig) wordt automatisch platform-admin, en uitsluitend
  zolang er nog géén platform-admin bestaat (eenmalige bootstrap; ook op een
  database die al gewone gebruikers bevat). Zonder deze variabele wordt
  niemand automatisch admin; extra admins zet je bewust via de database.
  De oude regel "eerste gebruiker op een lege database wordt admin" bestaat
  niet meer.
- **Rate limiting**: login (10 per 15 min per e-mailadres, 30 per 15 min per
  IP, lockout na 8 mislukte pogingen per 15 min) en registratie (5 per uur
  per IP) zijn begrensd via de `RateLimitCounter`-tabel
  (`src/lib/rate-limit.ts`); geen configuratie nodig. Bij databasefouten
  faalt de limiter open (beschikbaarheid boven strengheid).
- **Seed-guard — `SEED_FORCE`**: `npm run db:seed` weigert te draaien met
  `APP_ENV=production` omdat de seed demo-data en demo-wachtwoorden plaatst;
  alleen bewust te forceren met `SEED_FORCE=1`.
- **Plancatalogus**: synchroniseert zichzelf idempotent bij het eerste
  abonnement (`ensureOrgSubscription` → `syncPlanCatalog()`); een lege
  productiedatabase werkt dus direct. Optioneel: `npm run db:seed` met
  `ADMIN_PASSWORD` gezet voor demo-data en het beheerdersaccount (zie de
  seed-guard hierboven).

## Herstel

- Migraties zijn voorwaarts; terugdraaien = nieuwe corrigerende migratie
  (`prisma migrate dev --name fix_x`), nooit handmatig schema wijzigen.
- `GET /api/health` geeft 200 wanneer database en configuratie in orde zijn;
  gebruik dit voor uptime-monitoring en post-deployverificatie.
- `AuditLog` bevat gevoelige acties (publicaties, planwijzigingen) met actor
  en tijdstip voor forensisch herstel.
- Databaseback-ups: bij Supabase dagelijks automatisch; test restore per kwartaal.

## Feature flags

Risicovolle releases gaan achter een env-flag: `FLAG_<NAAM>=1` en in code
`featureFlag("naam")` uit `src/lib/config.ts`.
