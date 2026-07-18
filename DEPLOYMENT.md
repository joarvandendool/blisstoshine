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

De app configureert zichzelf vanuit de Supabase-integratie — er is geen
handmatige env-configuratie nodig:

- **Database**: runtime gebruikt `DATABASE_URL` als die gezet is, anders de
  door de integratie geïnjecteerde `POSTGRES_PRISMA_URL`/`POSTGRES_URL`
  (zie `src/lib/db.ts`).
- **Migraties**: de buildstap draait `scripts/deploy-migrate.mjs`, die
  `prisma migrate deploy` uitvoert op de niet-gepoolde
  `POSTGRES_URL_NON_POOLING`; zonder database-URL wordt de stap overgeslagen.
- **Sessiegeheim**: `SESSION_SECRET` als die gezet is; anders wordt er
  deterministisch een geheim afgeleid van de database-connectiestring
  (`src/lib/auth.ts`). Aanbevolen voor productie: zet alsnog een eigen
  `SESSION_SECRET` (`openssl rand -hex 32`) — die wint altijd, en rotatie van
  databasecredentials logt dan geen gebruikers uit.
- **Plancatalogus**: synchroniseert zichzelf idempotent bij het eerste
  abonnement (`ensureOrgSubscription` → `syncPlanCatalog()`); een lege
  productiedatabase werkt dus direct. Optioneel: `npm run db:seed` met
  `ADMIN_PASSWORD` gezet voor demo-data en het beheerdersaccount.

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
