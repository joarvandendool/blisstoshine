# Visuele principes — creatief concept "Precision in flow"

Status: fase 2, creatief concept. Laatst bijgewerkt: 2026-07-19.

## Het concept

**Precision in flow.** Het product staat op het snijvlak van twee werelden:

- **Mondzorg** = precisie, betrouwbaarheid, vakmanschap. Millimeterwerk,
  protocollen, hygiëne, vertrouwen.
- **Loopbaan** = voorkeur, flexibiliteit, beweging. Werkdagen die schuiven,
  wensen die veranderen, matches die ontstaan.

Het visuele systeem verbeeldt die spanning letterlijk: **een strak,
onzichtbaar precies raamwerk waarin zachte, vloeibare vormen bewegen.**
Het raster, de data en de typografie zijn het "precision"-deel; de blob-'m',
de kleurvlakken, de Match Shape en de motion zijn het "flow"-deel. Geen van
beide wint: flow zonder precisie wordt kinderachtig, precisie zonder flow
wordt een spreadsheet.

Dit sluit direct aan op de huisstijl (strakke grotesk + vloeiende italic in
één wordmark; harde kleurvlakken + organische blob) en op het moodboard
(glasobjecten op strakke lichte velden).

## De zeven principes

### 1. Strakke onderliggende grids

- Alles staat op een consequent kolommenraster en een vaste spacing-schaal
  (tokens in fase 3). Uitlijning is de stille bewijsvoering van vakmanschap.
- Organische vormen mogen het grid doorbreken, maar hun ankerpunten
  (positie, marges) liggen óp het grid. Eén bewuste gridbreker per view.
- Kaarten, tabellen en formulieren zijn recht en voorspelbaar; afgeronde
  hoeken komen uit één radius-schaal, geen willekeurige rondingen per
  component.

### 2. Heldere data

- Cijfers en scores zijn het product; ze krijgen typografische voorrang:
  groot, tabellair uitgelijnd (tabular figures), met eenheid en context.
- Elke visualisatie beantwoordt één vraag en is zonder legenda-puzzels
  leesbaar. Merkblauw is de datakleur; roze markeert het menselijke datapunt
  (voorkeur, match), nooit meer dan één roze reeks tegelijk.
- Geen decoratieve grafieken: als de grafiek geen beslissing ondersteunt,
  is het een getal met een label.

### 3. Zachte, vloeibare vormen

- De organische vormfamilie is afgeleid van de blob-'m': boonvormige lobben
  met oppervlaktespanning. Deze familie levert sectie-achtergrondvormen,
  lege-staat-illustraties en de Match Shape.
- Vormen zijn massief (#cddfee of #0120ec) of glas (alleen heldenmomenten),
  altijd traag en gespannen — geen spetters, sterren of confetti-vormen.
- Maximaal één grote organische vorm per viewport; hij ondersteunt de
  content en overlapt nooit tekst of interactieve elementen.

### 4. Uitlegbare transparantie

- Transparantie (glas, frost, blur) wordt alleen gebruikt waar hij iets
  betekent: een laag die tijdelijk boven de content hangt (dialoog, sheet)
  mag frosted zijn omdat hij letterlijk "boven" ligt; een sierpaneel niet.
- Regels: achterliggende content blijft herkenbaar, tekst op transparante
  lagen haalt altijd AA-contrast via een voldoende dekkende toplaag, en
  transparantie stapelt nooit (geen glas op glas).
- Dit principe geldt ook figuurlijk: het product legt uit waarom een match
  scoort zoals hij scoort. Visuele transparantie en uitlegbaarheid van data
  zijn hetzelfde merkgebaar.

### 5. Verfijnde motion

- Beweging is traag, gedempt en betekenisvol; zie MOTION_SYSTEM.md voor
  tokens en toepassingen. Op principeniveau: motion toont oorzaak en gevolg
  (dit veranderde, dáárom beweegt dat), nooit sfeer om de sfeer.
- Vloeibaarheid zit in easing en vormvervorming, niet in afstand: elementen
  vervormen en faden meer dan ze vliegen.

### 6. Menselijke fotografie

- Echte mensen in echte praktijken, natuurlijk licht; zie
  PHOTOGRAPHY_DIRECTION.md. Fotografie is het bewijs dat achter de data
  mensen zitten — daarom nooit generieke stock of AI-mensen.
- Tot er eigen fotografie is: abstracte eigen vormen (principe 3), geen
  tijdelijke stockfoto's "voor nu".

### 7. Rustige, zelfverzekerde typografie

- Kleine, goed gespatieerde koppen op veel witruimte in plaats van
  schreeuwende display-groottes. Autoriteit door rust.
- Het merkgebaar sans + italic-serif ("mondzorg**werkt**") maximaal één keer
  per view, op het belangrijkste kop-moment.
- Lopende tekst is near-black op licht, ruime regelafstand, meetbare
  regellengte (45–75 tekens). Geen gecentreerde bodytekst.

## Anti-principes (hard verboden)

1. **Geen tandiconen.** Geen kiezen, tanden, borstels, smiles of
   flosdraad-illustraties in de interface. De blob-'m' is de enige
   merkvorm; de mondzorg-associatie blijft impliciet.
2. **Geen gradienttekst.** Tekst is altijd één egale kleur. Gradients
   bestaan hooguit als zeer zacht atmosferisch vlak op de achtergrond.
3. **Geen enorme glows.** Geen neon-gloed rond kaarten of knoppen, geen
   blur-halo's van 100 px. Schaduwen zijn klein, zacht en fysisch logisch.
4. **Geen willekeurige pills.** Badges, tags en chips komen uit één
   gedefinieerde componentenset met vaste radius, kleurrollen en betekenis;
   geen decoratieve pill-labels ("✨ Nieuw ✨") verspreid over pagina's.
5. **Geen generieke dashboardhero.** Geen "screenshot van het product in
   perspectief zwevend boven een gradient" op de homepage. De hero is een
   eigen compositie: typografie, één organische vorm, echte data of echte
   fotografie.
6. **Geen onleesbare glassmorphism.** Geen frosted panelen met wit-op-wit
   tekst, geen glas als standaard kaartstijl. Transparantie alleen volgens
   principe 4.

## Toetsvragen bij elk ontwerp

1. Zie je het grid (uitlijning) én de flow (één zachte vorm of beweging)?
2. Is er precies één #0120ec-hoofdactie en hooguit één roze accent?
3. Kan het glas/de transparantie uitgelegd worden (welke laag, waarom)?
4. Blijft alles leesbaar bij uitgeschakelde motion en zonder kleur (AA)?
5. Zou een tandarts-praktijkhouder dit vertrouwen én een 26-jarige
   mondhygiënist dit fris vinden? Beide moeten "ja" zijn.
