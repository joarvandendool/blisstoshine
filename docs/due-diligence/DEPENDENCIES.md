# Dependencies

Bron: `package.json`. De afhankelijkheidsvoetafdruk is bewust klein:
**zes runtime-dependencies**, geen externe SaaS-SDK's (geen Stripe-, e-mail-
of analytics-client), geen auth-framework. Licenties zijn vermeld voor zover
algemeen bekend van het pakket; ze zijn **niet per geïnstalleerde versie
gecontroleerd** in `node_modules`.

## Runtime (dependencies)

| Pakket | Versie | Rol | Licentie | Risico-inschatting |
|---|---|---|---|---|
| `next` | ^15.3.3 | Framework: routing, server actions, build, deploy-doelplatform (Vercel) | MIT | Laag-midden: kern van de app; grote community, maar upgradepad Next 16 vergt werk (`next lint` deprecated, `SCALE_AUDIT.md` §3.3). Vendor-affiniteit met Vercel is functioneel, geen lock-in op API-niveau. |
| `react` / `react-dom` | ^19.1.0 | UI-runtime | MIT | Laag: standaard, stabiel. |
| `@prisma/client` | ^6.8.2 | ORM-runtime; alle databasetoegang (`src/lib/db.ts`) | Apache-2.0 | Midden: centrale afhankelijkheid; seed-config in `package.json#prisma` is deprecated richting Prisma 7 (`SCALE_AUDIT.md` §3.4). Migratiepad bestaat. |
| `zod` | ^3.24.4 | Server-side inputvalidatie en het PII-werende analytics-schema (`src/domain/analytics/events.ts`) | MIT | Laag: klein, puur, breed gebruikt. |
| `bcryptjs` | ^3.0.2 | Wachtwoordhashing (`src/lib/auth.ts`) | MIT | Midden: pure-JS-implementatie (trager dan native `bcrypt`, werkt overal serverless). Cost-factor 10 is gangbaar; heroverwegen bij schaal. |

Cryptografie voor sessies, API-sleutels en webhook-signing gebruikt uitsluitend
Node's ingebouwde `node:crypto` (HMAC-SHA256, sha256, timingSafeEqual) — geen
extra dependency.

## Ontwikkeltijd (devDependencies)

| Pakket | Rol | Licentie |
|---|---|---|
| `prisma` (CLI) ^6.8.2 | Migraties, generate, seed | Apache-2.0 |
| `typescript` ^5.8.3 | Strikte typechecking (`npm run typecheck`) | Apache-2.0 |
| `vitest` ^3.1.4 | Unit- en integratietests (157 tests) | MIT |
| `@playwright/test` ^1.52.0 | E2E-tests (12 tests) | Apache-2.0 |
| `eslint` ^9 + `eslint-config-next` | Linting (via het deprecated `next lint`) | MIT |
| `tailwindcss` ^4.1.7 + `@tailwindcss/postcss` | Styling | MIT |
| `tsx` ^4.19.4 | TypeScript-runner voor de seed | MIT |
| `dotenv` ^16.5.0 | Env-bestanden in tests/scripts | BSD-2-Clause |
| `@types/*` | Typedefinities | MIT |

## Beoordeling voor due diligence

- **Geen copyleft-licenties** (GPL/AGPL) in de directe dependencies volgens
  de bekende licentievormen hierboven; transitieve dependencies zijn **niet
  gecontroleerd** (geen licentiescan of SBOM in de repo).
- **Geen betaalde of proprietary runtime-afhankelijkheden.** De enige
  commerciële diensten zijn hostinginfrastructuur (Vercel, Supabase), geen
  code-afhankelijkheden.
- **Bewuste gaten**: e-mailverzending, betalingen en externe analytics zijn
  níet als dependency aanwezig omdat die functies bewust nog niet zijn
  aangesloten (outbox, LocalTestBillingProvider, eigen eventtabel) — zie
  KNOWN_RISKS.md.
- **Fontlicenties**: de huisstijlfonts (Aktiv Grotesk, Abril Display) zijn
  commercieel en niet meegeleverd; als stand-ins worden open Google-fonts
  geladen via `next/font` (root-`ARCHITECTURE.md`, "Huisstijl"). Vóór livegang
  met de echte huisstijl zijn fontlicenties nodig.
- **Geen geautomatiseerde dependency-audit** (geen Dependabot/renovate-config,
  geen `npm audit`-gate in CI) — aanbevolen vervolgstap.
