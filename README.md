# mondzorgwerkt

Premium match- en capaciteitsplatform voor Nederlandse mondzorgpraktijken.
Tweezijdige marktplaats: kandidaten gebruiken het platform gratis, praktijken
betalen een SaaS-abonnement en gebruiken het product ook als ze niet actief
werven.

**Kernbelofte** — kandidaten: *stel je ideale werkweek samen en ontdek
praktijken die echt bij je passen.* Praktijken: *zie direct wie past, welke
dagen aansluiten en wat je kunt aanpassen om een match mogelijk te maken.*

## Documentatie

| Document | Inhoud |
|----------|--------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, lagen, domeinregels, multi-tenancy, commercieel model |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Omgevingen, lokaal draaien, productie, herstel |
| [src/lib/billing/README.md](./src/lib/billing/README.md) | Waar Stripe later wordt aangesloten |

## Snel starten

```bash
npm install
cp .env.example .env          # SESSION_SECRET vullen: openssl rand -hex 32
npx prisma migrate dev
npm run db:seed               # realistische demo-data + inloggegevens in console
npm run dev
```

## Kwaliteit

```bash
npm run lint && npm run typecheck && npm test    # unit + integratie
npm run build                                     # productiebuild
npm run test:e2e                                  # kritieke gebruikersflow
```

## Structuur in één oogopslag

- `src/domain/` — pure domeinlogica (matching, opportunities, entitlements,
  analytics-events, KPI-definities). Geen React/DB-imports; volledig getest.
- `src/server/` — services die domein, Prisma en autorisatie verbinden.
- `src/lib/` — db, auth, authz (tenantisolatie), billing-adapter, analytics-adapter.
- `app/` — App Router: marketing, kandidaat-, praktijk- en interne omgeving.
