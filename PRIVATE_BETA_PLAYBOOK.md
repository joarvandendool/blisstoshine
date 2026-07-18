# Private Beta Playbook — Mondzorgwerkt

Kort werkdocument voor de eerste betaweken. Doel: leren welke functies
activatie, retentie en omzet veroorzaken — niet zoveel mogelijk gebruikers.

## Ideale eerste klantprofiel (praktijken)

- Zelfstandige praktijk of kleine groep (1–3 locaties), 2–6 behandelkamers
- Heeft NU een openstaande stoel of structureel bezettingsprobleem
  (mondhygiënist of tandartsassistent — de schaarste is daar het grootst)
- Eigenaar of praktijkmanager beslist zelf over uitgaven tot ±€300/maand
- Regio met voldoende kandidaataanbod in de seed-regio's (Randstad, Utrecht,
  Brabant) zodat de Talent Radar direct iets laat zien
- Vermijd voorlopig: grote ketens (lange besluitvorming), praktijken die al
  vastzitten aan een bemiddelingsbureau-contract

## Onboardingstappen (begeleid, maar het product moet het zelf kunnen)

1. Stuur vooraf niets — laat de praktijk zelf registreren via /registreren?type=praktijk
2. Observeer (schermdeling of sessie-opname met toestemming): registratie →
   /praktijk/start → 7 stappen → Talent Radar → publicatie
3. Grijp alleen in als de praktijk >2 minuten vastzit; noteer waar
4. Meet: time-to-activation (registratie → practice_activated)
5. Belrondje na 48 uur: eerste indruk + of ze de Radar-cijfers geloofden

## Welke hypothese test ieder scherm

| Scherm | Hypothese |
|--------|-----------|
| Praktijkonboarding (/praktijk/start) | Een praktijk kan zonder hulp in <5 min van account naar gepubliceerde behoefte |
| Talent Radar (stap 6) | Marktinzicht vóór betaling is het "aha-moment" dat activatie voorspelt |
| Aanbevelingen ("maak vrijdag flexibel → +4") | Praktijken passen eisen aan als het effect zichtbaar is |
| Match Studio | Simuleren is de reden om te blijven inloggen, ook zonder actieve werving |
| Abonnementspagina | Uitkomstgerichte pricing converteert beter dan featurelijsten; Growth is het ankerplan |
| Uitnodiging + consent (kandidaat) | Kandidaten reageren vaker als anonimiteit tot expliciete toestemming gegarandeerd is |
| Gespreksplanner | Slots voorstellen in het platform verkort time-to-interview t.o.v. mailen |
| Bezettingsplanner | Praktijken zonder vacature loggen terugkerend in voor bezettingsinzicht |

## Wekelijkse KPI's (intern dashboard, /intern)

- Nieuwe praktijkaccounts en onboarding completion rate
- Time-to-activation (mediaan) en % practice_activated
- Talent Radar bekeken %, eerste uitnodiging %
- Trial starts, trial-to-paid, checkout conversion
- WAP (wekelijks actieve praktijken) en simulaties per praktijk
- Uitnodiging-acceptatie, mediane reactietijd, time-to-interview
- Plaatsingen en fill rate
- MRR + mutaties (new/expansion/contraction/churned)
- Feedbackredenen-top-3 (waarom wijzen partijen af)

Regel: elke metric met "onvoldoende data" blijft leeg — geen conclusies
trekken onder de drempels.

## Interviewvragen — praktijken (na week 1 en week 4)

1. Wat dacht je toen je de Talent Radar-cijfers voor het eerst zag? Geloofde je ze?
2. Welke aanpassing (dag flexibel, uren, begeleiding) heb je overwogen of gedaan — en waarom (niet)?
3. Wat zou er moeten gebeuren om €299/maand hiervoor te betalen — en wat maakt het nu (nog) niet waard?
4. Wanneer zou je inloggen als je géén vacature hebt? Doe je dat nu al (bezetting)?
5. Hoe verhoudt dit zich tot je huidige aanpak (bureau, Indeed, eigen netwerk) in tijd en kosten?
6. Wie in de praktijk zou hier nog meer mee werken?

## Interviewvragen — kandidaten (na eerste uitnodiging of sollicitatie)

1. Voelde de matchscore en de uitleg kloppend? Wat klopte niet?
2. Was duidelijk welke gegevens de praktijk wél en niet van je zag? Vertrouwde je dat?
3. Wat maakte dat je wel/niet op de uitnodiging reageerde?
4. Hoe was het kiezen van een gespreksmoment vergeleken met heen-en-weer mailen?
5. Zou je je werkweek hier actueel houden — waarom (niet)?
6. Wat mist er om dit boven Indeed/LinkedIn/bemiddelaars te verkiezen?

## Besliscriteria (na 6–8 weken, ±10 praktijken en ±40 kandidaten)

**Doorgaan (schalen)** als:
- ≥60% van de nieuwe praktijken activeert zonder hulp
- ≥3 praktijken betalen of committeren zich na de trial
- ≥50% uitnodiging-responsratio bij kandidaten
- Minstens 2 plaatsingen of geplande gesprekken per week over de hele beta

**Aanpassen (itereren)** als:
- Activatie hoog maar conversie laag → pricing/paywall-plaatsing herzien
- Conversie ok maar retentie laag → bezettingsplanner en meldingen verdiepen
- Kandidaten reageren niet → aanbodzijde eerst (kandidaatwerving, respons-SLA's)

**Stoppen/pivoteren** als:
- <30% activatie ondanks begeleiding én
- geen enkele praktijk wil betalen na 8 weken én
- interviews wijzen op een structureel bezwaar (bv. men wil bemiddeling, geen software)

## Praktisch

- Demo-omgeving: `npm run db:seed` — inloggegevens in de console
- Productieconfiguratie: zie DEPLOYMENT.md (zelfconfiguratie via Supabase-integratie)
- E-mail staat in de beta in een outbox (/intern/outbox) — vertel testers dat
  meldingen in-app verschijnen
