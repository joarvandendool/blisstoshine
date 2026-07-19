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
- [x] Fase 8: publieke kennislaag (src/public-site/kennis/*, zes
      handgeschreven artikelen op /functies, /specialisaties, /technologie,
      /salaris en /arbeidsmarkt — generateStaticParams beperkt, 404 voor
      onbekende slugs)
- [x] Fase 9: traditionele SEO (generateMetadata + canonical via
      metadataBase/NEXT_PUBLIC_SITE_URL, opengraph-image, sitemap.ts,
      JSON-LD: JobPosting alleen published, Organization op /, Place op
      praktijkpagina's, BreadcrumbList; noindex bij >1 actief filter)
- [x] Fase 10: AI-discoverability (app/robots.ts met env
      AI_TRAINING_CRAWLERS, noindex-layouts voor privéroutes,
      docs/design/CRAWLER_POLICY.md incl. MCP-voorbereiding)
- [x] Fase 11: AI-/SEO-analytics (attribution.ts, PUBLIC_EVENTS,
      anonieme rate-limited tak in /api/events, zie § Analytics-events)
- [ ] Fase 12: responsive en accessibility
- [ ] Fase 13: performance + visuele regressietests

## Analytics-events (fase 11)

Nieuwe const-groep `PUBLIC_EVENTS` in `src/domain/analytics/events.ts`
(additief; de domeintest telt de groep mee via `.length`). De vier events
worden client-side gemeld via POST `/api/events`, dat voor deze events een
ANONIEME tak heeft: geen `requireUser`, geen `userId`, wel een in-memory
rate-limit per IP (60/min; het IP wordt nooit in het event opgeslagen).

Bron-attributie: `src/public-site/attribution.ts` classificeert
`document.referrer` + `utm_source` naar een gesloten set
`google | chatgpt | claude | perplexity | answer_engine_overig | social |
direct` en bewaart de eerste-touch-bron in sessionStorage
(`mw_bron_eerste_touch`). De ruwe referrer-URL verlaat de browser nooit;
de geclassificeerde bron gaat óók als `acquisitionSource` de envelope in.

| Event | Wanneer | Context (gesloten set, geen vrije identifiers) |
| --- | --- | --- |
| `public_page_viewed` | éénmalig per pagina(navigatie), client-eiland `PublicAnalytics` in PublicShell | `bron`, `route_type` (`home` \| `vacatures` \| `vacature_detail` \| `praktijk` \| `kennis` \| `overig`) |
| `public_job_viewed` | bij weergave van een vacaturedetailpagina (slug-loos) | `bron`, `rol` (taxonomiesleutel), `regio` |
| `public_apply_clicked` | klik op "Solliciteer direct" op een vacaturedetail | `bron`, `rol`, `regio` |
| `public_register_clicked` | klik op registratie-CTA's (homepage-hero, vacaturedetail "Bekijk mijn match", praktijkpagina "Maak een profiel") | `bron`, en `rol`/`regio` óf `route_type` |

Daarmee is de funnel bron → registratie → activatie te leggen: de
public-events dragen de bron, de bestaande backend-events
(`onboarding_started` … `candidate_profile_activated`,
`organization_created` … `practice_activated`) dekken het vervolg.

Contextvalidatie in de route: `bron` moet uit de gesloten bronnenlijst
komen; `route_type`/`rol` alleen `[a-z_]`; `regio` max 64 tekens; extra
sleutels worden geweigerd (`.strict()`).

## Eind-SHA, routes, tokens, assets, tests, risico's

Nieuwe publieke routes (fase 8–10):

- `/functies/mondhygienist`, `/functies/tandartsassistent`
- `/specialisaties/parodontologie`
- `/technologie/intra-orale-scanners`
- `/salaris/tandartsassistent` (bandbreedtes als indicatie + methodologie)
- `/arbeidsmarkt/mondhygienist/utrecht` (kwalitatief; cijfers pas indicatief
  zodra het market-insights read-model levert — niets verzonnen)
- `/sitemap.xml`, `/robots.txt`, `/opengraph-image`

Wordt verder ingevuld bij afronding.
