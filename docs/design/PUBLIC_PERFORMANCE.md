# Publieke laag — performance (Workstream B, fase 13)

**Labmeting, geen RUM.** Alle cijfers hieronder zijn gemeten op de
productiebuild (`next build` + `next start`, poort 3600) met headless
Chromium/Playwright op localhost, zonder netwerk- of CPU-throttling.
Ze bewijzen de *structuur* (welk element de LCP is, of er layout shift
bestaat, wat er continu draait) — geen absolute veldwaarden. Velddata
(RUM) bestaat pas na livegang.

Meetscript: PerformanceObserver (`largest-contentful-paint`,
`layout-shift`) + CDP `Performance.getMetrics`, per route op 390 px en
1440 px. Datum: 2026-07-19, branch `codex/visual-public-discovery`.

## LCP-element per publieke route

Doel: de LCP is tekst of lichte SVG, nooit een zware afbeelding.

| Route | LCP-element (390 px) | LCP-element (1440 px) | LCP-tijd (lab) |
| --- | --- | --- | --- |
| `/` | `<p>` (hero-subtekst) | `<h1>` (hero-kop) | 112–120 ms |
| `/vacatures` | `<p>` | `<p>` | 124–144 ms |
| `/vacatures/[slug]` (open) | `<p>` (beschrijving) | `<p>` | 124–136 ms |
| `/vacatures/[slug]` (gesloten) | `<p>` | `<p>` | 116–136 ms |
| `/praktijken/[slug]` | `<p>` | `<p>` | 92–100 ms |
| `/functies/mondhygienist` | `<p>` | `<p>` | 80–116 ms |
| `/salaris/tandartsassistent` | `<h1>` | `<p>` | 72–96 ms |
| `/design-system` | `<p>` | `<p>` | 140–144 ms |
| `/registreren` | `<p>` | `<p>` | 116–132 ms |

→ **Overal tekst.** Er bestaat geen enkel `<img>`-element in de publieke
laag; het enige beeld is de gegenereerde `/opengraph-image` (alleen voor
social crawlers, nooit in de pagina).

## CLS

**0,0000 op elke gemeten route en viewport** (incl. scroll tot de
footer). Ruimte is gereserveerd: vaste headerhoogte (h-16), skeletons in
`app/vacatures/loading.tsx` met dezelfde afmetingen als de kaarten, geen
late banners of embeds.

## Fonts

- `next/font/google`, self-hosted subset **latin**, `display: swap`
  (expliciet), preload door Next.
- **2 fontbestanden** per pagina: Archivo (variabel; gewichten 400–700
  in één bestand) en Playfair Display **italic 700**. Het ongebruikte
  gewicht 800 is in fase 13 verwijderd (het product gebruikt serif
  uitsluitend op 700 via `.accent-serif`/`font-bold`).

## Match Shape-kosten

- Geen continue JavaScript: de compositie is deterministisch berekend
  bij render; de drift is pure CSS (`mz-blob-a/b`) en bestaat alleen
  binnen `@media (prefers-reduced-motion: no-preference)`.
- Gemeten main-thread-kosten in 5 s idle (CDP TaskDuration):
  **≤ 13 ms per 5 s (≈ 0,25 % CPU)** op de homepage met hero-shape;
  overige publieke routes 1–3 ms. Offscreen pauzeren via
  IntersectionObserver is daarmee **meetbaar onnodig** — bewust niet
  toegevoegd (zou een client-eiland groter maken voor niets.)
- `/design-system` (intern, veel demo's tegelijk) meet 58–71 ms per 5 s
  (≈ 1,4 %) — acceptabel voor een interne referentiepagina.

## Bundelgroottes (uit `next build`, First Load JS)

Doel ≤ ~130 kB per publieke route; gedeelde basis is 102 kB.

| Route | Route-JS | First Load JS |
| --- | --- | --- |
| `/` | 374 B | **117 kB** |
| `/vacatures` | 206 B | **111 kB** |
| `/vacatures/[slug]` | 371 B | **115 kB** |
| `/praktijken/[slug]` | 365 B | **111 kB** |
| `/functies/[slug]`, `/specialisaties/[slug]`, `/technologie/[slug]`, `/salaris/[slug]`, `/arbeidsmarkt/...` | 203 B | **110 kB** |
| `/design-system` (intern) | 9,91 kB | **119 kB** |
| `/registreren`, `/inloggen` | 1,71 kB | **107 kB** |
| `/_not-found` (404) | ~1 kB | **103 kB** |

Alle publieke routes zitten ruim onder de 130 kB. De client-eilanden van
de publieke laag zijn klein: het mobiele menu, `PublicAnalytics`
(page-view-event), `TrackedLink` en de MatchShape/WeekGrid-componenten
(die grotendeels server-renderbaar zijn).

## Derde-partijscripts en afbeeldingen

- **0 derde-partij-requests** op alle gemeten routes (gemeten op
  responsniveau). Fonts zijn self-hosted; er is geen analytics-,
  consent- of chat-script. Eigen analytics loopt via één `fetch` naar
  `/api/events`.
- Afbeeldingen: alleen de gegenereerde `/opengraph-image` bestaat — ok.

## Blur op mobiel

- De sticky header gebruikt `backdrop-blur` over een strook van 64 px —
  klein oppervlak, geen meetbare scrollkosten.
- Glass-kaarten (blur 18/26 px) zijn kaartgroot, nooit viewport-vullend
  op 390 px; het gemeten idle-/scrollbudget blijft daarmee triviaal
  (zie Match Shape-tabel). Geen wijziging nodig.

## Conclusie

Geen openstaande performance-defecten in de publieke laag. De enige
fase 13-wijziging in code: Playfair 800 verwijderd en `display: "swap"`
geëxpliciteerd in `app/layout.tsx`.
