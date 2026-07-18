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

1. Zet in Vercel de env vars: `DATABASE_URL` (gebruik de `POSTGRES_PRISMA_URL`
   van de Supabase-integratie), `SESSION_SECRET` (64 hex tekens),
   `APP_ENV=production`.
2. Zet het build command op `prisma generate && prisma migrate deploy && next build`
   zodra de productie-database gekoppeld is. Zonder database faalt
   `migrate deploy` bewust — er wordt dan niets half uitgerold.
3. Draai eenmalig de plancatalogus-sync + seed van plannen:
   `npx tsx prisma/seed.ts --plans-only` (of laat de app dit idempotent doen bij
   de eerste abonnement-aanvraag via `syncPlanCatalog()`).

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
