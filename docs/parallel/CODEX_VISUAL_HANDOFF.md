# Workstream B — Codex visual-public-discovery: handoff

Levend document. Parallel aan Workstream A (Claude, branch `claude/scale-core`).

## Basis

- **Basis-SHA (zelfde checkpoint als Claude):**
  `e5aa19de1c99ee69306ac5a545b723eb0681e4ba`
- **Werkbranch:** `codex/visual-public-discovery`
- Geen merge naar `claude/scale-core`, `main` of productie.

## Eigendomsgrenzen

Deze werkstroom raakt NIET: Prisma/migraties, Supabase, domeinservices,
matching/opportunity, billing/subscriptions/entitlements, account health,
multi-location, private API's, autorisatie, marktdata-aggregatie,
public read-model-API's (backend), integraties, backendanalytics.

Wel: brand-/moodboardanalyse, design tokens en -systeem, Match Shape,
publieke homepage, /vacatures + detail, /praktijken/[slug], kennispagina's,
SEO, AI-discoverability, robots/sitemap/JSON-LD, social assets, publieke
navigatie, responsive/accessibility, visuele regressietests, performance.

## Backenddata-koppeling

De public read-model-API's (`/api/public/v1/*`) bestaan op branch
`claude/scale-core` (contract: `docs/parallel/PUBLIC_READ_MODEL.md` aldaar)
maar NIET op deze basis-SHA. Deze werkstroom gebruikt daarom een dunne
adapter (`src/public-site/data/adapter.ts`) met twee implementaties:
fixtures (development, expliciet gemarkeerd) en het afgesproken
HTTP-read-model. Geen Prisma- of domeinlogica-duplicatie; de integratiefase
wisselt alleen de adapter-implementatie.

## Status

- [x] Branch aangemaakt vanaf basis-SHA
- [ ] Fase 1: visuele audit
- [ ] Fase 2: bronmateriaal + creatief concept "Precision in flow"
- [ ] Fase 3: designsysteem + /design-system
- [ ] Fase 4: originele Match Shape
- [x] Fase 5: publieke homepage (adapter `src/public-site/data/*`, PublicShell)
- [x] Fase 6: openbare vacatures (/vacatures + /vacatures/[slug], fixtures-bron)
- [x] Fase 7: openbare praktijkpagina's (/praktijken/[slug], consent-vlag)
- [ ] Fase 8: publieke kennislaag
- [ ] Fase 9: traditionele SEO
- [ ] Fase 10: AI-discoverability
- [ ] Fase 11: AI-/SEO-analytics
- [ ] Fase 12: responsive en accessibility
- [ ] Fase 13: performance + visuele regressietests

## Eind-SHA, routes, tokens, assets, tests, risico's

Wordt ingevuld bij afronding.
