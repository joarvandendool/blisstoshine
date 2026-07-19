# Workstream B — Codex visual-public-discovery: handoff

Slotdocument (fase 12+13 afgerond). Parallel aan Workstream A (Claude,
branch `claude/scale-core`).

## Basis en eindstand

- **Basis-SHA (zelfde checkpoint als Claude):**
  `e5aa19de1c99ee69306ac5a545b723eb0681e4ba`
- **Werkbranch:** `codex/visual-public-discovery`
- **Eind-SHA vóór de slotcommit:**
  `be5fd9949d716dfbd8d600f80eff1eaeb22dd526` — de slotcommit
  (fase 12+13 + deze handoff) volgt hier direct op en is daarna de
  feitelijke branch-HEAD.
- Geen merge naar `claude/scale-core`, `main` of productie.

### Commits basis → HEAD

| SHA | Inhoud |
| --- | --- |
| `de4432f` | Fase 1: visuele productaudit (15 geprioriteerde bevindingen) |
| `1f84f8a` | Fase 2: bronanalyse + creatief concept "Precision in flow" |
| `6a30135` | Fase 3+4: mw-designtokens, /design-system, Match Shape v2 |
| `ad1aaa2` | Fase 5–7: publieke homepage, /vacatures + detail, /praktijken/[slug] |
| `be5fd99` | Fase 8–11: kennislaag, SEO/JSON-LD, AI-crawlerbeleid, attributie |
| *(slotcommit)* | Fase 12+13: a11y-fixes, performance, visuele regressietests, handoff |

## Status

- [x] Branch aangemaakt vanaf basis-SHA
- [x] Fase 1: visuele audit (`docs/design/CURRENT_VISUAL_AUDIT.md`)
- [x] Fase 2: bronmateriaal + creatief concept "Precision in flow"
- [x] Fase 3: designsysteem + /design-system
- [x] Fase 4: originele Match Shape (v2)
- [x] Fase 5: publieke homepage (adapter `src/public-site/data/*`, PublicShell)
- [x] Fase 6: openbare vacatures (/vacatures + /vacatures/[slug], fixtures-bron)
- [x] Fase 7: openbare praktijkpagina's (/praktijken/[slug], consent-vlag)
- [x] Fase 8: publieke kennislaag (zes handgeschreven artikelen)
- [x] Fase 9: traditionele SEO (canonical, OG, sitemap, JSON-LD)
- [x] Fase 10: AI-discoverability (robots + AI_TRAINING_CRAWLERS)
- [x] Fase 11: AI-/SEO-analytics (attribution, PUBLIC_EVENTS, anonieme tak)
- [x] Fase 12: responsive en accessibility (zie § Accessibility)
- [x] Fase 13: performance + visuele regressietests
      (`docs/design/PUBLIC_PERFORMANCE.md`, `e2e/visueel-publiek.spec.ts`)

## Eigendomsgrenzen

Deze werkstroom raakt NIET: Prisma/migraties, Supabase, domeinservices,
matching/opportunity, billing/subscriptions/entitlements, account health,
multi-location, private API's, autorisatie, marktdata-aggregatie,
public read-model-API's (backend), integraties, backendanalytics.

Wel: brand-/moodboardanalyse, design tokens en -systeem, Match Shape,
publieke homepage, /vacatures + detail, /praktijken/[slug], kennispagina's,
SEO, AI-discoverability, robots/sitemap/JSON-LD, social assets, publieke
navigatie, responsive/accessibility, visuele regressietests, performance.

## Nieuwe routes (volledige lijst)

Publiek (allemaal binnen PublicShell, met SEO-metadata):

- `/` — vervangende publieke homepage (Match Shape-hero, drie stappen,
  actuele vacatures, praktijken met consent)
- `/vacatures` — overzicht met GET-filters (werkt zonder JS), paginering,
  lege staat; `app/vacatures/loading.tsx` als skeleton-laadstaat
- `/vacatures/[slug]` — detail; gesloten vacatures tonen de vervuld-staat
  met drie vergelijkbare vacatures, zonder JobPosting-JSON-LD
- `/praktijken/[slug]` — alleen praktijken mét publicatie-consent (anders 404)
- `/functies/mondhygienist`, `/functies/tandartsassistent`
- `/specialisaties/parodontologie`
- `/technologie/intra-orale-scanners`
- `/salaris/tandartsassistent` (bandbreedtes als indicatie + methodologie)
- `/arbeidsmarkt/mondhygienist/utrecht` (kwalitatief; cijfers pas zodra het
  market-insights read-model levert — niets verzonnen)
- `/sitemap.xml`, `/robots.txt`, `/opengraph-image`
- `/design-system` — interne referentie (robots-noindex)
- 404 — `app/not-found.tsx` (fase 12): merk-404 binnen PublicShell met
  h1/landmarks en werkende herstelroutes (verving de kale standaard-404)

## Design tokens

Eén bron: `app/globals.css` — de `@theme`-blokken met de `mw-*`-tokens
(kleur incl. gemeten contrastwaarden, typografie-schaal, radius, blur,
schaduw) plus de niet-utility-tokens in `:root` (spacing, motion, z-index,
glass, iris). Componenten verwijzen altijd naar tokens. Documentatie en
levende specimens: `/design-system`; bronnen: `docs/design/*.md`
(BRAND_TRANSLATION, VISUAL_PRINCIPLES, MOTION_SYSTEM, …).

## Componenten

- **Match Shape v2** — `src/components/MatchShape.tsx`: twee originele
  organische vormen (kandidaat vloeibaar/roze, praktijk stabiel/cobalt);
  afstand/overlap volgt de score, vijf dimensies moduleren vorm. Puur
  SVG + CSS; drift alleen zonder reduced motion; `MatchShapeShare`
  (1200×630) voor social.
- **PublicShell** — `src/public-site/PublicShell.tsx`: header/footer/
  skip-link/landmarks van de hele publieke laag; `PublicNav.tsx` is het
  enige navigatie-client-eiland (mobiel menu, Escape geeft focus terug
  aan de knop).
- **Kennistemplate** — `src/public-site/kennis/KennisArtikelPagina.tsx`
  + `artikelen.ts` (zes artikelen, gedeeld sjabloon incl. JSON-LD).
- Overig publiek: `JobCard`, `MiniWeek`, `PracticeVisual` (abstracte
  praktijkvisual, geen stockfoto's), `Breadcrumbs` (zichtbaar +
  BreadcrumbList), `JsonLd`, `TrackedLink`, `PublicAnalytics`.
- ui-aanvullingen in `src/components/ui.tsx` (o.a. Skeleton, Badge-tonen)
  en het responsieve WeekGrid (`.wg-*`-containerqueries in globals.css).

## Assets

- Enige beeld-asset: de gegenereerde `/opengraph-image`
  (`app/opengraph-image.tsx`). Geen externe assets, geen stockfotografie,
  geen derde-partij-fonts buiten next/font (self-hosted).

## Gedeelde bestanden (reden + impact)

| Bestand | Wijziging | Reden / impact |
| --- | --- | --- |
| `app/layout.tsx` | `metadataBase` (fase 9); fase 13: Playfair-gewicht 800 verwijderd, `display: "swap"` expliciet | Canonical/OG-URL's env-gestuurd; kleinere fontlading. Geen gedragswijziging voor de app-routes. |
| `app/api/events/route.ts` | Anonieme tak voor de vier PUBLIC_EVENTS (geen `requireUser`, in-memory rate-limit 60/min per IP, IP nooit opgeslagen) | Publieke funnel-metingen. Bestaande ingelogde events onveranderd. |
| `src/domain/analytics/events.ts` | Const-groep `PUBLIC_EVENTS` (additief) | De domeintest telt de groep mee via `.length`; geen bestaande sleutels aangeraakt. |
| `app/(auth)/registreren/page.tsx`, `inloggen/page.tsx` | Fase 12: inline wissellinks kregen een ≥44px hit-area (padding + negatieve marge, geen layoutverschuiving) | Tap-targets; geen functionele wijziging. |
| `playwright.config.ts` | baseURL/webServer naar poort **3600** (WS-B-range 3600-3699); expect-timeout 15s + `toHaveScreenshot.maxDiffPixelRatio 0.02`; project "mobiel" op Chromium gepind | De agent-/CI-omgeving levert alleen Chromium; iPhone 14-emulatie (viewport/touch/UA) blijft. |

## Public read-model — verwachtingen

De publieke pagina's praten uitsluitend met `PublicDataSource`
(`src/public-site/data/types.ts`); twee implementaties in `adapter.ts`:

- **fixtures** (default): `fixtures.ts`, expliciet gemarkeerd als fictief.
- **http**: `/api/public/v1/{jobs,jobs/[slug],practices,practices/[slug],taxonomies}`
  met fetch + revalidate 300s; 404 → null → eigen not-found-afhandeling.

Schakelaar: env `PUBLIC_DATA_SOURCE=fixtures|http` (default fixtures);
voor http zet `PUBLIC_API_BASE_URL` de absolute basis (default
`http://localhost:3000`). De backend-branch (`claude/scale-core`,
contract `docs/parallel/PUBLIC_READ_MODEL.md` aldaar) levert de
endpoints, inclusief: alleen praktijken mét consent, alleen gepubliceerde
vacatures in het overzicht (gesloten wel per slug bereikbaar), locaties
nooit exacter dan stad + postcode-4.

## Analytics-events (fase 11)

Bron-attributie: `src/public-site/attribution.ts` classificeert
`document.referrer` + `utm_source` naar de gesloten set
`google | chatgpt | claude | perplexity | answer_engine_overig | social |
direct`; eerste-touch in sessionStorage (`mw_bron_eerste_touch`). De ruwe
referrer-URL verlaat de browser nooit.

| Event | Wanneer | Context (gesloten set) |
| --- | --- | --- |
| `public_page_viewed` | éénmalig per pagina, `PublicAnalytics` in PublicShell | `bron`, `route_type` |
| `public_job_viewed` | vacaturedetail (slug-loos) | `bron`, `rol`, `regio` |
| `public_apply_clicked` | klik "Solliciteer direct" | `bron`, `rol`, `regio` |
| `public_register_clicked` | registratie-CTA's | `bron`, `rol`/`regio` óf `route_type` |

Contextvalidatie in de route: `bron` uit de bronnenlijst; `route_type`/
`rol` alleen `[a-z_]`; `regio` max 64 tekens; `.strict()`.

## SEO-configuratie

- **`NEXT_PUBLIC_SITE_URL` is vereist in productie** — basis voor
  metadataBase/canonicals/sitemap/JSON-LD (`src/public-site/seo.ts`;
  default `https://mondzorgwerkt.nl`).
- Canonical van /vacatures wijst altijd naar de filterloze pagina-1;
  URL's met >1 actief filter krijgen robots-noindex.
- JobPosting-JSON-LD uitsluitend bij `status: published`; Organization
  op `/`; Place op praktijkpagina's; BreadcrumbList overal met kruimelpad.

## Crawlerbeleid

`app/robots.ts`: reguliere crawlers toegestaan op de publieke laag,
privéroutes disallow + noindex-layouts. AI-trainingscrawlers
(GPTBot e.d.) default **disallow**; opt-in via env
`AI_TRAINING_CRAWLERS=allow`. AI-antwoordcrawlers (zoek/answer engines)
toegestaan. Details + MCP-voorbereiding: `docs/design/CRAWLER_POLICY.md`.

## Tests

- **Unit (vitest):** 158 tests, 11 bestanden — groen.
- **Bestaande e2e:** `kritieke-flow.spec.ts` (10) + `beta-flow.spec.ts`
  (2) = 12 tests, in beide projecten (desktop + mobiel) = 24 runs — groen.
  Eén latente testbug gefixt in beta-flow: de Iris-test greep de
  desktopnav met `exact: true`, die op een echt mobiel viewport
  CSS-verborgen is (en dus onzichtbaar voor getByRole) — nu matcht de
  regex de zichtbare navigatie (desktopbalk óf bottom tabs). Dit bleek
  pas nu het mobiele project hier echt draait (zie § Bekende risico's).
- **Nieuw — `e2e/visueel-publiek.spec.ts` (tag @visueel, alleen
  desktop-project, viewports in de spec):** 28 tests groen:
  24 screenshot-asserties (homepage/overzicht op 390+768+1440; detail
  open, detail gesloten, praktijk, kennis, /design-system, /registreren,
  lege staat, 404 en de ingelogde pricingpagina op 390+1440;
  `maxDiffPixelRatio 0.02`, 24 baselines in
  `e2e/visueel-publiek.spec.ts-snapshots/`) + 4 functionele checks
  (reduced motion, toetsenbord door het mobiele menu incl. Escape-focus,
  extreem lange titel zonder overflow via de long-title-fixture,
  nul resultaten met invoerbehoud).
- **Bewust overgeslagen:** een screenshot van de laadstaat — de
  fixtures-adapter resolvet synchroon waardoor `loading.tsx` niet
  betrouwbaar te vangen is zonder testpaden in productiecode; genoteerd
  in de spec-kop.

Draaien: server op 3600 (of laat de webServer-config hem starten) →
`npx playwright test`. Baselines vernieuwen:
`npx playwright test visueel-publiek --project=desktop --update-snapshots`.

## Screenshots

- Eindscreenshots (homepage, /vacatures, vacaturedetail, kennispagina op
  390 + 1440): sessie-scratchmap `…/scratchpad/ws-b-eind/*.png`.
- Auditscreenshots fase 1: scratchmap van de auditfase (zie
  CURRENT_VISUAL_AUDIT.md § Methode).
- Duurzame baselines: `e2e/visueel-publiek.spec.ts-snapshots/` (in git).

## Performance

Zie `docs/design/PUBLIC_PERFORMANCE.md` (labmeting, geen RUM). Kern:
LCP overal tekst (geen afbeeldingen in de publieke laag), CLS 0,0 op
alle routes/viewports, First Load JS 103–119 kB per publieke route
(doel ≤ ~130 kB), 2 self-hosted fontbestanden met display swap,
0 derde-partijscripts, Match Shape-drift ≈ 0,25 % CPU idle (geen
IntersectionObserver-pauzering nodig — gemeten onnodig).

## Accessibility-status (fase 12)

Gemeten (computed styles, WCAG-luminantie) op 390/768/1440 over de tien
publieke routes + /registreren + /inloggen + kandidaat-kernroutes
(/kandidaat, /kandidaat/uitnodigingen, onboarding): geen horizontale
overflow, overal precies één `main` en één `h1`, alle navs gelabeld,
tekstcontrast ≥ AA, zichtbare focus, Escape sluit het mobiele menu.

Gevonden en gefixt in deze fase:

1. 404 was de kale standaardpagina zonder `main`/h1 → merk-404
   (`app/not-found.tsx`).
2. /design-system had geen h1 en 36px-navlinks → h1 + min-h-11-targets.
3. Werkdag-checkboxes in de /vacatures-filterbalk waren 36px breed op
   mobiel → vullen nu de rij (≥44px), vanaf `sm` compact.
4. Inline wissellinks op /registreren en /inloggen waren 15px hoog →
   ≥44px hit-area zonder layoutverschuiving.
5. Escape in het mobiele menu liet de focus in het niets vallen →
   focus keert terug naar de menuknop.
6. Extreem lange woorden/titels rekten de detail-gridkolommen op
   (58px overflow op 390) → `min-w-0` op gridkolommen + `break-words`
   op koppen + `overflow-wrap:anywhere` op de laatste kruimel;
   geverifieerd met een long-title-fixture + e2e-test.
7. Het bewust-foute contrastspecimen op /design-system ("wit op roze")
   is nu aria-hidden met sr-only-uitleg (specimen, geen echte tekst).

Bewuste uitzonderingen: het "Disabled chip"-specimen (disabled UI is
WCAG-vrijgesteld) en de 16px-checkbox in de motion-demo (het effectieve
klikgebied is het omliggende ≥44px-label).

## Bekende risico's

- **Fixtures als databron** tot de integratie: de publieke laag toont
  fictieve vacatures/praktijken (expliciet gemarkeerd in fixtures.ts).
  Niet live zetten zonder `PUBLIC_DATA_SOURCE=http`.
- **Fonts zijn stand-ins**: Archivo ≈ Aktiv Grotesk, Playfair Display
  italic ≈ Abril Display ExtraBoldItalic. Drop-in vervangbaar in
  `app/layout.tsx` zodra de licentiebestanden er zijn; de visuele
  baselines moeten dan opnieuw gegenereerd worden.
- Het e2e-project "mobiel" draait op Chromium met iPhone-emulatie (geen
  WebKit in de agent-omgeving); echte Safari-verificatie blijft een
  release-check.
- De visuele baselines zijn platform-gebonden (linux); op macOS/Windows
  worden nieuwe baselines gegenereerd (`-snapshots/*-linux.png`).
- De pricing-screenshots bevatten seed-afhankelijke datums
  (periode-einde); dat valt ruim binnen de 2%-diff-tolerantie maar is
  de eerste verdachte bij een onverwachte diff.

## Integratie-instructies (claude/scale-core + deze branch)

1. Merge/rebase beide branches samen; er is géén overlappend eigendom
   behalve de vijf "gedeelde bestanden" hierboven (allemaal additief).
2. Zet `PUBLIC_DATA_SOURCE=http` (en `PUBLIC_API_BASE_URL` als het
   read-model niet op dezelfde origin draait). Er is geen codewijziging
   nodig: alleen de adapter-implementatie wisselt.
3. De consent-vlag (`practiceConsent`) komt dan uit echte data; de
   adapter en de UI filteren er al op — de backend blijft de bron van
   waarheid en hoort praktijken zonder consent überhaupt niet uit te
   leveren.
4. Verwijder daarna desgewenst `fixtures.ts` (of laat hem staan voor
   previews/Storybook-achtig gebruik; hij lekt nooit naar http-modus).
5. Zet in productie `NEXT_PUBLIC_SITE_URL` (vereist, zie § SEO) en
   besluit bewust over `AI_TRAINING_CRAWLERS`.
6. Draai `npx playwright test` — de visuele baselines bewaken de
   publieke laag; bij bewuste restyling baselines regenereren.

## Vercel-preview-notitie

Previews krijgen per deployment een eigen URL: zet
`NEXT_PUBLIC_SITE_URL` niet hard op previews (of accepteer dat
canonicals naar productie wijzen — dat is meestal gewenst tegen
duplicate content). `/design-system` en alle privéroutes zijn al
noindex; previews zelf horen achter Vercel's preview-protection. De
build is zelfconfigurerend (prisma generate + migrate in `npm run
build`) — previews hebben een `DATABASE_URL` en `SESSION_SECRET` nodig,
de publieke laag zelf draait op fixtures zonder extra env.
