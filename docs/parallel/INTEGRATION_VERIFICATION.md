# Integratieverificatie — publieke laag op echte data

Bewijs dat de openbare site (Workstream B) na de integratie op échte
databasegegevens draait via de in-process `DirectDataSource` (default), niet
op fixtures, en dat de keten browser → server → database → response klopt.

## Methode

- Productiebuild: `npm run build` (groen).
- Database geseed: `SEED_FORCE=1 npm run db:seed` (lokale Postgres `mondzorgwerkt`).
- Server: `npm run start -- --port 3620` **zonder** `PUBLIC_DATA_SOURCE`
  (dus default `direct` = echte data).
- Geverifieerd met `curl` tegen de draaiende server.

## Resultaten (2026-07-19)

| Controle | Verwacht | Waargenomen |
|---|---|---|
| `/vacatures` toont geseede vacature "Tandartsassistent 2–3 dagen" | aanwezig | ✅ aanwezig |
| `GET /api/public/v1/jobs` levert dezelfde vacature (slug/org/locatie) | zelfde item | ✅ `tandartsassistent-2-3-dagen-amsterdam-027c49`, org "Tandartspraktijk de Watertoren", Amsterdam/1011 |
| `GET /api/public/v1/jobs/{slug}` matcht de titel | zelfde titel | ✅ "Tandartsassistent 2–3 dagen" |
| Vacaturedetailpagina `/vacatures/{slug}` | 200 | ✅ 200 |
| Fixturenaam "Tandartspraktijk De Linde" op de homepage | 0 (geen lek) | ✅ 0 |
| Consented seed-praktijk `/praktijken/mondzorgpraktijk-de-lindeboom` | 200 | ✅ 200 |
| Niet-consented praktijk `/praktijken/tandartspraktijk-de-watertoren` | 404 | ✅ 404 (consentfilter werkt) |

## Conclusie

De publieke pagina's tonen echte databasegegevens (geen fixtures), de HTTP-API
levert hetzelfde read-model, en de consentregel (alleen praktijken mét
publicatieconsent) wordt afgedwongen. Fixtures worden uitsluitend nog gebruikt
wanneer `PUBLIC_DATA_SOURCE=fixtures` expliciet is gezet — de Playwright-suite
doet dat om de visuele baselines stabiel te houden (zie `playwright.config.ts`).

## Regressiestand na integratie + fixes (autoritatieve baseline)

- Vitest: 354/354 groen.
- Playwright: 52/52 groen (desktop + mobiel, incl. 24 visuele baselines).
- Lint, typecheck, productiebuild: groen.
