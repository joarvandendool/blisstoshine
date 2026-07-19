# Huisstijlvertaling — van identiteit naar productinterface

Status: fase 2, bronmateriaal. Laatst bijgewerkt: 2026-07-19.

## Bron

Huisstijlgids "Mondzorg Werkt — Visual Identity" (Design Studio Mathilda,
15 pagina's, PDF). De originele werkbestanden (logo-exports, fontbestanden)
staan op een lokale Mac en zijn niet in deze repo aanwezig; dit document is
de vastgelegde vertaling zodat het designsysteem (fase 3) zonder de bron
verder kan.

## Merkonderdelen

### Wordmark: `mondzorgwerkt`

- Eén woord, geen spatie. "mondzorg" in Aktiv Grotesk Ex Regular (lowercase
  sans), "werkt" in Abril Display ExtraBoldItalic (italic serif) — de
  sans staat voor het vak (precisie), de italic serif voor het werken/
  bewegen (voorkeur, flexibiliteit).
- Kleurvarianten in de gids: blauw (#0120ec) op licht (#cddfee) en licht op
  blauw. Beide zijn toegestaan; kies altijd de variant met het hoogste
  contrast op de betreffende ondergrond.

Gebruik in de interface:

- Navigatiebalk: wordmark klein (hoogte ~20–24 px), links, in #0120ec op
  lichte ondergrond. Niet de glass-versie in de navigatie.
- Footer: wordmark mag groter, licht op #0120ec-vlak.
- Nooit de wordmark in #ed6ca5, nooit met schaduw, gradient of outline,
  nooit letterspatiëring of gewichten aanpassen.
- Zolang de originele vectorbestanden ontbreken: wordmark benaderen als
  gestileerde tekstcompositie met de fallback-fonts (zie Typografie) en
  markeren als placeholder; vervangen zodra de echte SVG beschikbaar is.
  De placeholder niet naar productie-marketingmateriaal buiten de app
  doorzetten.

### Beeldmerk: blob-'m'

- Organische lowercase 'm' uit twee/drie zachte, boonvormige lobben; leest
  subtiel als kies/mond zonder letterlijk tandicoon te zijn. Er is ook een
  bredere 'mw'-variant ("Variatie" in de gids).
- Twee uitvoeringen:
  1. **Flat**: massief #0120ec op #cddfee of andersom. Werkbaar op elk
     formaat; dit is de standaard in de interface (favicon, avatarfallback,
     lege staten, opsommingsaccent).
  2. **Glass**: 3D-gel/glasversie met chroomrand en zachte highlights.
     Alleen als heldenobject: één per pagina, groot, veel witruimte
     (homepage-hero, succesmomenten, og-images). Nooit klein, nooit
     herhaald, nooit als knop of icoon.
- Vrije ruimte: minimaal de hoogte van één lob rondom. Niet roteren,
  spiegelen, uitrekken of van kleur wisselen buiten de merk-kleurparen.
- Zolang assets ontbreken: flat versie als eigen SVG hertekenen op basis van
  de gids (zelfde lobbenlogica), glass-versie pas bouwen in fase 3 als eigen
  CSS/SVG-compositie — geen gedownloade 3D-renders.

## Kleurrollen

De gids definieert drie kleuren: primair paar #cddfee + #0120ec, secundair
#ed6ca5. In de interface krijgen ze strikte rollen:

| Kleur     | Naam (token-suggestie) | Rol in de interface |
|-----------|------------------------|----------------------|
| `#cddfee` | `brand-ice`            | **Atmosfeer/canvas.** Paginasecties, zachte vlakken, hover-tinten, selectie-achtergronden, grote rustige oppervlakken. Nooit voor tekst. |
| `#0120ec` | `brand-blue`           | **Primaire actie en identiteit.** Knoppen, links, actieve staten, focusringen, de wordmark, datavisualisatie-primair. Eén duidelijke blauwe actie per view. |
| `#ed6ca5` | `brand-pink`           | **Menselijk accent.** Momenten die over mensen en voorkeur gaan: match-accenten, voorkeursmarkeringen, kleine highlights, illustratieve details. Nooit voor primaire knoppen, foutmeldingen of grote vlakken. |

Aanvullende regels:

- Neutralen (wit, near-black voor tekst, grijstinten) komen uit het
  designsysteem, niet uit de gids; de drie merkkleuren blijven schoon.
- #0120ec op #cddfee haalt ruim voldoende contrast voor grote elementen,
  maar controleer tekstcontrast per geval (WCAG AA: 4.5:1 voor bodytekst);
  bodytekst staat op wit of #cddfee in near-black, niet in merkblauw op
  ijsblauw bij kleine corpsen.
- #ed6ca5 op wit haalt géén AA voor kleine tekst — roze dus nooit als
  tekstkleur voor lopende tekst; alleen vlakjes, lijnen, grafiekaccenten of
  grote display-cijfers met verzwaarde toets.
- Semantische kleuren (succes, waarschuwing, fout) zijn aparte tokens en
  gebruiken nadrukkelijk niet het roze of merkblauw, zodat merk en status
  nooit verward raken.

## Typografie

### Origineel (huisstijl)

- **Hoofdteksten:** Aktiv Grotesk Ex Regular (breed lopende grotesk).
- **Titels:** Abril Display ExtraBoldItalic (didone italic, "Wist je dat?").

### Licentiestatus en fallback

- Aktiv Grotesk (Dalton Maag) en Abril Display (TypeTogether) zijn
  **commerciële fonts**. Er is nog geen webfontlicentie geregeld en de
  fontbestanden zitten **niet** in de repo. **Download of embed geen
  illegale kopieën** — ook niet tijdelijk, ook niet uit een CDN-mirror.
- Gedocumenteerde fallbacks, al aangesloten via `next/font/google` in
  `app/layout.tsx`:
  - **Archivo** → stand-in voor Aktiv Grotesk Ex (grotesk met vergelijkbare
    breedte; gebruik desgewenst Archivo's width-as/Expanded voor
    display-koppen om het "Ex"-karakter te benaderen).
  - **Playfair Display (Italic)** → stand-in voor Abril Display
    ExtraBoldItalic (didone-contrast; gebruik 700–800 italic voor titels).
- Tokens verwijzen naar rollen (`--font-sans`, `--font-serif`), nooit naar
  fontnamen, zodat een latere licentie-aankoop een drop-in wissel is.

### Rolverdeling in de interface

- `--font-sans` (Archivo): alle UI — navigatie, knoppen, formulieren,
  tabellen, bodytekst, data.
- `--font-serif` italic (Playfair Display): schaars en editorial — één
  woord of woordgroep per kop ("werkt"-logica), grote display-momenten,
  citaten. Nooit voor UI-labels, knoppen, formulieren of lopende tekst.
- De sans+italic-serif-menging binnen één kop is het typografische
  merkgebaar; gebruik het bewust en maximaal één keer per view.

## Doorvertalingen uit de gids (toon)

De gids toont packaging in transparante zakken, totebags met fotografische
mond en visitekaartjes met flosdraad ("GO WITH THE FLOSS"). De les daaruit
voor het product is de **toon**: nuchter-geestig, materiaal-gedreven,
typografisch zelfverzekerd — humor via concept, niet via illustratie-
grapjes of emoji. Lege staten en microcopy mogen die droge, speelse toon
overnemen; het visuele systeem blijft strak.

## Samenvatting van beslissingen

1. Drie kleuren met strikte rollen: #cddfee atmosfeer, #0120ec de ene
   actiekleur, #ed6ca5 schaars menselijk accent.
2. Blob-'m' flat is het werkpaard; glass alleen als heldenobject, één per
   pagina, en altijd als eigen (her)bouwde asset.
3. Archivo + Playfair Display via `next/font` als gedocumenteerde legale
   fallbacks; tokens op rol, wissel naar Aktiv Grotesk/Abril Display zodra
   licenties rond zijn.
