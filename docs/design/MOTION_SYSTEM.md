# Motion-systeem

Status: fase 2, creatief concept. Definitieve tokens landen in fase 3
(designsysteem). Laatst bijgewerkt: 2026-07-19.

## Principes

1. **Rustig.** Motion valt pas op als je erop let. Niets flitst, stuitert
   of vraagt aandacht voor zichzelf; de interface voelt eerder "gedempt"
   dan "levendig".
2. **Vloeibaar.** Bewegingen lopen als gel: trage aanzet, zachte landing,
   korte afstanden. Vloeibaarheid komt uit easing en vormvervorming
   (morph, scale, opacity), niet uit grote verplaatsingen.
3. **Betekenisvol.** Elke animatie beantwoordt een vraag: wat is er
   veranderd, waar komt dit vandaan, is het gelukt? Als een animatie geen
   van die vragen beantwoordt, wordt hij geschrapt.

Dit is de motion-kant van "Precision in flow": de timing is precies
(tokens, consistent), de vorm van de beweging is vloeibaar.

## Tokens (voorstel voor fase 3)

### Duur

| Token | Waarde | Gebruik |
|---|---|---|
| `--motion-instant` | 80 ms | Directe feedback: hover, pressed, toggles |
| `--motion-fast` | 160 ms | Kleine staatwissels: chips, checkboxes, focus |
| `--motion-base` | 240 ms | Standaard: uitklappen, fades, kaartstaten |
| `--motion-slow` | 400 ms | Grotere overgangen: sheets, dialogen, score-updates |
| `--motion-hero` | 700 ms | Zeldzaam: Match Shape-morph, succesmomenten, hero-intro (max 1 per pagina) |

### Easing

| Token | Waarde | Gebruik |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Standaard: alles wat verschijnt of reageert |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Elementen die van staat A naar B glijden |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Verdwijnen: korter en onopvallender dan verschijnen |

Regels: geen bounce/overshoot-easings, geen springfysica met zichtbaar
naveren, geen `linear` behalve voor continue voortgang (progress, marquee
bestaat niet in dit systeem). Verschijnen duurt langer dan verdwijnen.

## Wat beweegt (en hoe)

- **Werkdagselectie.** Dag-chips wisselen staat in `--motion-fast`:
  achtergrondvlak vult zacht (#cddfee → #0120ec), label kruist contrast;
  geen schaal-sprong. Bij het wijzigen van beschikbaarheid mag de
  samenvatting (bijv. "3 dagen") in `--motion-base` mee-updaten met een
  cross-fade, zodat oorzaak → gevolg zichtbaar is.
- **Scoreverandering.** Scores tellen niet eindeloos op: één vloeiende
  waarde-overgang in `--motion-slow` (getal cross-fade of korte count, ring/
  balk groeit mee met `--ease-in-out`). Kleur verschuift alleen als de
  betekenisklasse verandert. Oude en nieuwe waarde zijn nooit tegelijk
  onduidelijk.
- **Simulaties** ("wat als ik woensdag ook werk?"). De heraanberekening
  toont een subtiele processtaat (zachte puls op de betrokken kaart, max
  1 cyclus) en de resultaten glijden in `--motion-slow` naar hun nieuwe
  waarden. Wat door de simulatie is veranderd, krijgt één keer een korte
  highlight-fade (#cddfee-tint) — geen permanente markering.
- **Match Shape.** Het merkmoment en de enige plek voor `--motion-hero`:
  de vorm morpht vloeibaar tussen profielen (padinterpolatie), maximaal
  één morph tegelijk, altijd te onderbreken door nieuwe input. De morph
  illustreert de match; alle exacte waarden blijven ernaast als statische,
  leesbare data.
- **Succesmomenten** (profiel compleet, match geaccepteerd, vacature
  geplaatst). Eén rustige bevestiging in `--motion-slow`–`--motion-hero`:
  vinkje dat zich tekent of blob-'m' die één keer zacht "ademt". Geen
  confetti, geen fullscreen-overlays, en het moment blokkeert nooit de
  volgende actie.
- **Basisinteracties.** Hover/focus/pressed in `--motion-instant`;
  uitklappers en accordeons in `--motion-base` met hoogte+opacity;
  dialogen/sheets in `--motion-slow` (fade + 8–16 px verplaatsing, geen
  zoom vanaf 0).

## Wat niet beweegt

- **Geen parallax.** Nergens, ook niet subtiel op de homepage.
- **Geen springende/zwevende kaarten.** Kaarten liften niet bij hover
  (hooguit schaduw/rand-verandering), niets wiebelt in een loop.
- **Geen lange intro's.** Geen laadchoreografie, geen gefaseerde
  hero-opbouw van seconden, geen splash-animaties. Content eerst; motion
  is nooit de reden dat iemand wacht.
- Geen autoplay-carrousels, geen scroll-hijacking, geen
  animatie-op-scroll die content verstopt (hooguit één zachte fade-in per
  sectie, eenmalig).
- Geen oneindige ambient-loops (drijvende blobs op de achtergrond); de
  organische vormen staan stil tenzij er een reden is.

## Reduced motion

`prefers-reduced-motion: reduce` levert een **volwaardige** ervaring, geen
uitgeklede: alle informatie, staten en bevestigingen blijven bestaan.

- Verplaatsingen en morphs worden directe wissels of pure opacity-fades
  van maximaal `--motion-fast`.
- De Match Shape-morph wordt een cross-fade tussen begin- en eindvorm;
  scores springen direct naar de nieuwe waarde met dezelfde
  highlight-fade als bevestiging.
- Processtaten (simulatie rekent) blijven zichtbaar via tekst/statische
  indicator in plaats van puls.
- Geen enkele functionaliteit of feedback mag uitsluitend uit beweging
  bestaan; dit wordt onderdeel van de accessibility-checks in fase 12.

## Implementatienotities (voor fase 3)

- Tokens als CSS custom properties naast de kleur/spacing-tokens; alle
  componenten verwijzen naar tokens, nooit naar losse ms-waarden.
- Voorkeur voor CSS-transities; JS-animatie (bijv. padmorph Match Shape)
  respecteert dezelfde tokens en `prefers-reduced-motion` via één gedeelde
  hook/utility.
- Animeer alleen `transform` en `opacity` (en paden in SVG); geen layout-
  animaties op `width/height/top/left` behalve gecontroleerde uitklappers.
