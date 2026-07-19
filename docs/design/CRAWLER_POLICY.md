# Crawlerbeleid — SEO en AI-discoverability

Status: Workstream B, fase 9–10. Laatst bijgewerkt: 2026-07-19.
Implementatie: `app/robots.ts`, `app/sitemap.ts`, noindex-layouts onder
`app/{kandidaat,praktijk,intern,instellingen,design-system}`.

## Uitgangspunt

De openbare inhoud (homepage, /vacatures, /praktijken, kennisbank) is er om
gevonden te worden — door zoekmachines én door AI-answer-engines die
bezoekers naar het platform sturen. Alles wat achter een login hoort
(kandidaat- en praktijkomgeving) is nooit crawlbaar of indexeerbaar.

## robots.txt (app/robots.ts)

| User-agent | Doel | Beleid |
| --- | --- | --- |
| `*` (o.a. Googlebot) | zoekindex | Allow `/`, Disallow privéroutes |
| `OAI-SearchBot` | ChatGPT-zoekfunctie (verwijst bezoekers door) | Allow `/`, Disallow privéroutes |
| `Claude-SearchBot` | Claude-zoekfunctie (verwijst bezoekers door) | Allow `/`, Disallow privéroutes |
| `Claude-User` | bezoek namens een Claude-gebruiker (agentisch) | Allow `/`, Disallow privéroutes |
| `GPTBot` | trainingsdata OpenAI | **Disallow `/` (default)** — env-gestuurd |
| `ClaudeBot` | trainingsdata Anthropic | **Disallow `/` (default)** — env-gestuurd |

Privéroutes (voor alle bots op Disallow): `/kandidaat`, `/praktijk`,
`/intern`, `/instellingen`, `/design-system`, `/api`.

De sitemap-verwijzing staat op `NEXT_PUBLIC_SITE_URL/sitemap.xml`.

### Rationale

- **Answer/search-crawlers toestaan:** OAI-SearchBot, Claude-SearchBot en
  Claude-User halen inhoud op om een gebruiker direct te helpen en linken
  naar de bron. Dat is precies het verkeer dat we willen; de bron-attributie
  (fase 11) maakt het meetbaar (`bron: chatgpt|claude|...`).
- **Trainingscrawlers standaard weigeren:** GPTBot en ClaudeBot verzamelen
  trainingsdata zonder gegarandeerde verwijzing terug. Standaard staat dit
  op Disallow. Wie het bewust open wil zetten (bijv. omdat aanwezigheid in
  modellen op termijn discovery oplevert), zet de env
  `AI_TRAINING_CRAWLERS=allow` (elke andere waarde of afwezigheid =
  `disallow`). Eén schakelaar, geen code-aanpassing.

## robots.txt is GEEN beveiliging

robots.txt is een verzoek aan welwillende crawlers — niets méér. Kwaadwillige
bots negeren het, en het bestand maakt paden juist zichtbaar. De echte
bescherming van privéroutes bestaat uit twee onafhankelijke lagen:

1. **Autorisatie**: elke privéroute vereist een sessie
   (`requireUser`/`requireCandidate`/`requireMembership`/
   `requirePlatformAdmin` in de layouts en server actions). Zonder login is
   er letterlijk geen inhoud om te crawlen.
2. **robots-noindex**: de layouts van `/kandidaat`, `/praktijk`, `/intern`,
   `/instellingen` en `/design-system` exporteren
   `robots: { index: false, follow: false }`, zodat ook per ongeluk gelekte
   of gedeelde URL's (bijv. login-redirectpagina's) nooit in een index
   belanden.

De Disallow-regels in robots.txt zijn alleen de derde, beleefde laag om
crawlbudget en logruis te besparen.

## Indexeerbare inhoud en structured data (fase 9)

- **Sitemap** (`app/sitemap.ts`): statische routes, kennisbank
  (lastModified = actualisatiedatum), gepubliceerde vacatures
  (lastModified = updatedAt) en praktijken mét publicatie-consent. Alles
  via de public-site-adapter; privéroutes staan er nooit in.
- **JSON-LD**: `JobPosting` uitsluitend op `/vacatures/[slug]` bij status
  `published` en exact gelijk aan de zichtbare inhoud; gesloten vacatures
  blijven indexeerbaar (zichtbare vervuld-status) maar zonder
  JobPosting-markup. `Organization` op `/`, `Place` op praktijkpagina's,
  `BreadcrumbList` overal waar een zichtbaar kruimelpad staat, `Article`
  op kennispagina's.
- **Canonical/paginering**: gefilterde en gepagineerde /vacatures-URL's
  canonicaliseren naar `/vacatures`; URL's met meer dan één actief filter
  krijgen robots-noindex (dunne combinaties).
- **Server-side rendering**: vacaturedetails bevatten alle kerninformatie
  (titel, praktijk, locatie, werkdagen, uren, vergoeding, contractvorm,
  apparatuur, software, specialisaties, beschrijving, vereisten, datums,
  sollicitatiemogelijkheid) in de eerste HTML — geverifieerd met curl
  zonder JavaScript. AI-agents zonder JS-runtime lezen dus dezelfde
  inhoud als bezoekers.

## Voorbereiding: toekomstige read-only MCP-laag (documentatie, geen implementatie)

Naast crawlbare HTML kan het platform later een expliciete, machineleesbare
laag aanbieden via het Model Context Protocol (MCP), zodat AI-assistenten
gestructureerd kunnen zoeken in plaats van HTML te schrapen. Kaders voor
die toekomstige laag:

- **Read-only en uitsluitend openbaar**: de MCP-laag ontsluit alleen wat nu
  al publiek is — gepubliceerde vacatures, praktijken mét consent en de
  kennisbank. Dezelfde bron als de site: het public read-model
  (`/api/public/v1/*`); nooit Prisma of domeinservices rechtstreeks.
- **Nooit kandidaatdata**: profielen, matches, sollicitaties en alles wat
  een login vereist blijft categorisch buiten de MCP-laag, ook geaggregeerd.
- **Zelfde privacyregels als de site**: locaties nooit exacter dan stad +
  postcode-4; arbeidsmarktcijfers alleen indicatief uit het toekomstige
  market-insights read-model, met peildatum en steekproefomvang.
- **Denkrichting tools**: `zoek_vacatures(functie, regio, dagen)`,
  `vacature_details(slug)`, `praktijk_details(slug)`, `kennisbank(pad)` —
  rate-limited en met dezelfde attributieverplichting (bronvermelding +
  link) als de answer-engines.
- **Eigendom**: implementatie hoort bij de backend-werkstroom (public
  read-model); dit document legt alleen het beleid vast.
