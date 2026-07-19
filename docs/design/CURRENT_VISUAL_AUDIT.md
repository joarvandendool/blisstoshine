# Visuele productaudit — huidige staat (Workstream B, fase 1)

Status: audit van de private-beta-checkpoint op branch `codex/visual-public-discovery`.
Datum: 2026-07-19. Alleen analyse — geen codewijzigingen.

## Methode

- Productiebuild (`next build`, Next.js 15.5.20) + productieserver op poort 3300, seed-data via `npm run db:seed`.
- Playwright/Chromium-screenshots op 390, 768 en 1440 px van negen schermen (27 screenshots): `/`, `/registreren?type=kandidaat`, `/registreren?type=praktijk`, `/inloggen`, onboarding stap 1 en 2 (vers kandidaataccount), matchfeed, matchdetail en `/kandidaat/uitnodigingen` (ingelogd als `kandidaat@demo.nl`).
- Gemeten in de browser (computed styles): fontfamilies/-groottes, contrastratio's (WCAG-luminantieformule tegen effectieve achtergrond), tap-targetafmetingen van alle interactieve elementen, horizontale overflow, afbeeldingsgebruik en focusgedrag na Tab. Ruwe data: `metrics.json` naast de screenshots in de audit-scratchmap.
- Referentiekader: hoofddoel *premium health-tech / moderne editorial / consumer-kwaliteit* en de anti-doelen (geen standaard vacaturebank, geen generiek SaaS-dashboard, geen pastelkaartenverzameling, geen onleesbare glassmorphism), plus het concept "Precision in flow" uit `VISUAL_PRINCIPLES.md`.

Systeembrede meetresultaten vooraf:

- **Typografie.** Alle koppen en lopende tekst renderen in Archivo (stand-in Aktiv Grotesk), gewicht 600 voor koppen. Playfair Display (stand-in Abril Display) komt uitsluitend voor als los italic accentwoord in koppen en in het wordmark. Hero-h1 schaalt 44 px (390) → 53,76 px (768) → 84 px (1440); app-koppen 30 → 40 px.
- **Contrast.** Lopende tekst is ink `#0a0d1c` op wit/licht: 18,1:1 — ruim boven AA. Eén structurele uitzondering: wit op roze `#ed6ca5` = **2,88:1** (faalt AA, zie bevinding 1).
- **Focus.** Globale focusstijl `outline: 2px solid #0120ec` is aanwezig en na Tab daadwerkelijk zichtbaar (gemeten op `/inloggen`, alle viewports). Goed.
- **Responsive.** Geen horizontale overflow op enige route/viewport (scrollWidth == viewport, 27/27 gemeten). Kandidaat-app heeft op mobiel een vaste onderbalk (Matches / Uitnodigingen / Profiel).
- **Performance.** First Load JS 102–127 kB per route (gedeeld 102 kB); zwaarste route is de vacature-studio (11,6 kB route + 121 kB). Nul `<img>`-elementen in het hele geauditeerde product; fonts self-hosted via `next/font`. Prima technische basis — het visuele gewicht zit in CSS-gradients, niet in assets.
- **States.** Er bestaat geen enkele `loading.tsx` of `error.tsx` in `app/`; alleen de standaard `_not-found`. Empty state bestaat alleen op uitnodigingen.

## Beoordeling per route

### `/` — marketingpagina (huidige, te vervangen basis)

Screenshots: `01-home--{390,768,1440}.png`

De pagina zet het merk neer: wordmark met italic *werkt*, hero met serif-accent ("Werk dat *past*"), gradient-orbs in brand-licht/roze, serif-cijfers voor stats. De hiërarchie is klassiek en leesbaar (label → h1 → sub → zoekkaart → chips → stats). Maar als basis voor de publieke discovery is hij fundamenteel misleidend: de hero-zoekbalk ("Functie of trefwoord" / "Plaats of regio" / "Zoek vacatures") heeft **geen form, handler of doel** (`app/page.tsx` r. 88–92), de drie "uitgelichte vacatures" zijn hardcoded, "Bekijk alle vacatures" linkt naar `/registreren` en `/vacatures` geeft 404. De statistieken (250+, 120, 93%) zijn niet-onderbouwde claims. Structuur is verder een voorspelbaar vacaturebank-sjabloon (hero+zoek → vacaturekaartjes → 3 stappen → CTA-banner → quote): precies anti-doel 1. De roze CTA "Plaats een vacature" faalt contrast (2,88:1). Navigatielinks zijn 23 px hoog; op 390 px verdwijnt de sectienav volledig (alleen "Maak profiel" blijft, geen menu). Nul fotografie; de pagina leunt volledig op pastelgradients en witte kaarten.

### `/registreren` (kandidaat + praktijk) en `/inloggen`

Screenshots: `02-…`, `03-…`, `04-inloggen--…`

Nette, rustige formulieren: één kaart, duidelijke labels boven de velden, invoervelden 50 px hoog, primaire knop 52 px, foutloze wisselkoppeling tussen de twee accounttypes met aangepaste titel/intro (goed). Contrast en focus in orde. Maar het geheel is kaal voor het belangrijkste conversiemoment: de kaart zweeft in een verder volledig lege gradient-viewport (op 1440 px is ±75% van het scherm leeg), er is geen wachtwoord-tonen-toggle, geen wachtwoord-vergeten-route, geen enkele merkinhoud of reassurance naast het formulier ("gratis", privacy, wat er hierna gebeurt). De helpertekst "Minimaal 8 tekens" is het enige affordance-detail. Consumer-kwaliteit vraagt hier meer warmte en context; premium health-tech vraagt vertrouwenssignalen.

### `/kandidaat/onboarding` — stap 1 en 2

Screenshots: `05-onboarding-stap1--…`, `06-onboarding-stap2--…`

Sterkste schermen van het product. Eigen full-screen flow zonder appshell, voortgangsbalk + "Stap 1 van 6", persoonlijke welkomstregel, grote chips (41–50 px) en keuzekaarten met uitleg, kop met serif-accent ("Wat *doe je?*"). Stap 1 heeft nul te kleine tap-targets op alle viewports — het beste gemeten scherm. Stap 2 (werkweekgrid) is conceptueel het hart van het product maar visueel het zwakst: de lege staat toont alleen grijze "—"-tekens zonder enige celbegrenzing of knop-affordance (op 1440 px oogt de kaart als een lege tabel), en op 390 px zijn de dagdeelknoppen **32 px breed** (21 van 24 interactieve elementen < 44 px). Op desktop valt de inhoud in de bovenste helft en zweeft "Verder" rechtsonder aan een lege onderkant. De legenda (Voorkeur/Beschikbaar/Niet beschikbaar) is klein en staat ná het grid.

### `/kandidaat` — matchfeed

Screenshots: `07-matchfeed--…`

Kop "Hallo *Sanne*" + eyebrow "MATCHFEED" + "Jouw *matches*" met tellerzin: goede editorial aanzet. Daaronder valt het uit elkaar: elf visueel identieke witte kaarten met identieke blauwe scorebadge ("90% Uitstekende match" ×9), identieke betekenisloze gradient-blob als avatar, en elf keer dezelfde CTA "Bekijk match" (136×43 px). Er is geen visueel onderscheid tussen de topmatch (91%) en nummer elf (90%), geen praktijkidentiteit, geen structuurritme — dit is het generieke SaaS-lijstje/vacaturebankgevoel dat de anti-doelen benoemen. De seed toont bovendien twee exact identieke 91%-kaarten en negen "Mondhygiënist E2E 1784…"-testvacatures, wat elke demo ontsiert. Navigatiepills en "Uitloggen" zijn 36–40 px hoog (net onder de 44-px-richtlijn).

### `/kandidaat/matches/[vacancyId]` — matchdetail

Screenshots: `08-matchdetail--…`

Inhoudelijk het meest onderscheidende scherm: groot serif-scorecijfer "91 *%*", scoreopbouw per dimensie met balken, sterke punten/aandachtspunten, werkweek-naast-rooster-grid, "wat deze match sterker maakt" met concreet effect ("stijgt naar 93%"), praktijkinfo en sollicitatieformulier met motivatieveld. Dit is géén vacaturebank — hier zit de productwaarde. Visueel blijft het onder zijn kunnen: elke sectie is dezelfde witte kaart, de score-blob bovenaan is dezelfde generieke gradient-cirkel als elk feed-avatar (draagt geen betekenis), "← Terug naar je matches" is een 155×15 px target, en "Niet opgegeven" staat twee keer prominent in de praktijkkaart (lege data gepresenteerd als inhoud). Het rooster-grid heeft hier wél duidelijke gevulde staten (blauwe "Match"-cellen) — het contrast met de lege onboarding-staat bewijst dat affordance daar het probleem is.

### `/kandidaat/uitnodigingen`

Screenshots: `09-uitnodigingen--…`

Goede empty state: icoon, kop, uitleg die vertelt wat je hier gaat zien én wat je eraan kunt doen, plus CTA "Bekijk je matches". Dit is het juiste patroon. Het icoon is echter een generieke grijze Material-envelop in een grijze cirkel — het enige illustratieve element van het scherm is merkloos. Onder de kaart rest een grote lege gradient-ruimte (op 1440 px ±40% van de viewport).

## Geprioriteerde bevindingen (max. 15)

Prioriteit: P1 = blokkeert het hoofddoel of faalt een norm; P2 = duidelijk onder doelniveau; P3 = polijst.

| # | Prio | Bevinding | Bewijs / route | Voorgestelde richting |
|---|------|-----------|----------------|-----------------------|
| 1 | P1 | Wit-op-roze CTA faalt WCAG AA: 2,88:1 (15 px semibold; ook onder 3:1 voor groot) | Gemeten: "Plaats een vacature", `/` (metrics `01-home`) | Roze `#ed6ca5` nooit als vlak achter witte tekst; ink-tekst op roze, of roze reserveren als accent/lijn — voorkomt tegelijk het pastelgevoel |
| 2 | P1 | Matchfeed is een monotone stapel identieke kaarten: zelfde badge, zelfde blob, elf keer "Bekijk match"; topmatch onzichtbaar t.o.v. nr. 11 | `07-matchfeed--*`; 9× "90% Uitstekende match" | Editorial hiërarchie: uitgelichte topmatch groot, rest compacter; score visueel gedifferentieerd; kaartinhoud (praktijk, dagen) als identiteit i.p.v. decoratieve blob — anti-SaaS-lijstje |
| 3 | P1 | Werkweekgrid (kernproduct-interactie) heeft geen affordance in lege staat en 32 px brede targets op mobiel | `06-onboarding-stap2--390`: 21/24 targets < 44 px; lege cellen tonen alleen "—" | Zichtbare celvlakken met hover/tap-staten, min. 44 px targets, legenda vóór of ín het grid; "precision"-raster expliciet maken |
| 4 | P1 | Homepage bevat dode/onechte UI: zoekbalk zonder werking, hardcoded "vacatures", "Bekijk alle vacatures" → registratie, `/vacatures` = 404, onbewezen stats | `app/page.tsx` r. 88–92, 151, 221; curl `/vacatures` → 404 | In de nieuwe publieke discovery: alleen echte, werkende toegangen tonen; claims vervangen door aantoonbare inhoud (echte matches/praktijken) — vertrouwensbasis voor health-tech |
| 5 | P2 | Geen enkele loading-, skeleton- of error-state in het hele product; server-rendered navigatie toont niets tijdens wachten | `find app -name loading.tsx -o -name error.tsx` → leeg | `loading.tsx` met glass-skeletons per app-route + error boundaries in merkstem; hoort bij consumer-kwaliteit |
| 6 | P2 | Nul fotografie/illustratie in het gehele product; merk leunt volledig op gradient-orbs + witte kaarten | 0 `<img>` op alle 27 metingen; `PHOTOGRAPHY_DIRECTION.md` onbenut | Fotografie/illustratielaag invoeren volgens bestaande richting — belangrijkste hefboom tegen "pastelkaartenverzameling" |
| 7 | P2 | Tap-targets structureel onder 44 px: marketingnav 23 px, app-navpills 36 px, "Terug naar je matches" 15 px hoog | Metrics `01-home--1440`, `07-matchfeed--*`, `08-matchdetail--*` | Minimaal 44×44 px effectief klikgebied (padding), zeker in nav en terug-links |
| 8 | P2 | Elke sectie op elke route is hetzelfde kaartrecept (wit, 24–28 px radius, glass-schaduw) — routes zijn onderling nauwelijks herkenbaar | Alle screenshots; matchdetail = 7 identieke kaarten gestapeld | Kaartsysteem met rollen (hero-kaart, datakaart, lijstitem) en per rol eigen dichtheid/achtergrond; grid als anker |
| 9 | P2 | Auth-schermen zijn het kaalste moment van de funnel: zwevende kaart in leeg gradientveld, geen wachtwoord-tonen, geen wachtwoord-vergeten, geen reassurance | `02–04--1440`: ±75% lege viewport | Tweeledig auth-scherm (merk/waarde naast formulier), wachtwoord-toggle en herstelroute toevoegen |
| 10 | P2 | Serif-accent is een formule geworden: exact één italic woord in vrijwel elke kop op elke route | h1-metingen alle routes; `Wat *doe je?*`, `Jouw *matches*`, `Jouw *uitnodigingen*`… | Editorial variatie: serif ook op display-schaal (het "91%" op matchdetail is het goede voorbeeld), soms géén accent; voorkom tic |
| 11 | P3 | De gradient-blob draagt nergens betekenis: zelfde cirkel als feed-avatar, praktijk-avatar én scorevisual | `07-…`, `08-matchdetail` (blob boven "91%") | Blob reserveren voor de Match Shape (vorm ↔ score/werkweek); praktijken een echte identiteit geven (initialen/foto) |
| 12 | P3 | Onboarding-desktoplayout laat onderste schermhelft leeg; "Verder" zweeft los rechtsonder | `06-onboarding-stap2--1440` | Content verticaal centreren of maxbreedte verkleinen; knoppenrij aan de inhoud koppelen |
| 13 | P3 | Lege data gepresenteerd als inhoud: "Niet opgegeven" 2× prominent in praktijkkaart | `08-matchdetail--*`, sectie "Over Testpraktijk Startflow" | Lege velden verbergen of omzetten in een uitnodiging aan de praktijk; toon alleen wat waarde heeft |
| 14 | P3 | Seed-/testdata vervuilt elke demo: 9× "Mondhygiënist E2E 1784…", dubbele identieke 91%-kaarten | `07-matchfeed--*` | E2E-vacatures uit de seed-feed filteren; demodata cureren als portfolio-materiaal |
| 15 | P3 | Enige illustratieve element in de app (empty-state-icoon) is een merkloze grijze Material-envelop; marketingfooter mist vertrouwenssignalen | `09-uitnodigingen--*`, `01-home--*` footer | Empty-state-iconografie in eigen vormtaal; footer met contact/juridische gegevens voor health-tech-vertrouwen |

## Conclusie

De fundamenten zijn beter dan de eerste indruk: tekstcontrast (18,1:1), zichtbare focusstijl, nul horizontale overflow, lichte bundels (≤127 kB First Load JS) en een matchdetailpagina waarvan de *inhoud* al doet wat een standaard vacaturebank niet kan. De afstand tot "premium health-tech / moderne editorial" zit niet in de techniek maar in drie dingen: (1) één kaartrecept en één serif-trucje die overal herhaald worden, waardoor het geheel richting generiek SaaS/pastel drijft; (2) de kerninteractie (werkweekgrid) en de matchfeed die hun betekenis niet visueel dragen; en (3) een marketingpagina die een product voorspiegelt dat er (nog) niet is. De vervangende publieke discovery kan het beste vertrekken vanuit wat matchdetail al bewijst — echte, uitlegbare matchdata als editorial materiaal — in plaats van vanuit het huidige hero-zoekbalk-sjabloon.
