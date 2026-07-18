# KPI-definities — financieel en commercieel (due diligence)

Dit document beschrijft elke financiële en commerciële KPI van het interne
dashboard (`/intern`): formule, invoerbron, drempels en beperkingen. De enige
bron van waarheid voor de berekeningen is `src/domain/kpi/definitions.ts`
(pure, geteste functies); `src/server/kpi.ts` levert uitsluitend de
invoerrijen aan. Dit document volgt de code exact — er staan geen cijfers of
aannames in die niet in de code staan.

## Leeswijzer en conventies

- **Bedragen** zijn eurocenten (integers); **verhoudingen** zijn fracties
  (0–1); **doorlooptijden** zijn dagen (mediaan).
- Elke KPI levert een waarde **of** expliciet `onvoldoende data` (met de
  definitietekst als tooltip). Er wordt nooit een getal getoond dat niet uit
  de invoer volgt.
- **MRR is terugkerende abonnementsomzet en géén boekhoudkundige
  (gerealiseerde of gefactureerde) omzet.** Deze scheiding staat letterlijk
  in de definitieteksten van MRR-afgeleide KPI's (ARR, ARPO/ARPA, GRR, NRR,
  payback, LTV).
- **Betalend** = abonnementsstatus `active` (trials en geannuleerde
  abonnementen tellen niet mee). In maandsnapshots geldt een organisatie als
  betalend bij `mrrCents > 0`.

## Invoerbronnen

| Bron | Inhoud | Gebruikt door |
| --- | --- | --- |
| Tabel `Subscription` (+ `PlanVersion`, `Plan`) | status, plancode, vastgepinde maandprijs (`priceMonthlyCents`), `createdAt` | alle MRR-/retentie-KPI's, cohorten, trial→betaald |
| Tabel `SubscriptionItem` | add-on-sleutel + aantal per abonnement | MRR-uitbreidingen (items) |
| `ADDON_CATALOG` (`src/domain/entitlements/catalog.ts`) | maandprijs per add-on-sleutel | itemprijzen in MRR/ARR/ARPA (sleutels buiten de catalogus tellen als 0) |
| Tabel `Organization` | `createdAt`, `activatedAt`, `status`, `acquisitionSource` | activatie- en conversie-KPI's |
| Tabel `AnalyticsEvent` | events zoals `checkout_started`, `subscription_started`, `talent_radar_viewed`, `candidate_invited` | checkoutconversie, mijlpalen |
| Tabel `Vacancy` | publicatiestatus per organisatie | onboarding-benadering, sterke-matchmijlpaal |
| — (geen bron) | kortingen, refunds, mislukte betalingen, facturatie-interval, kostendata | zie "Zonder invoerbron" hieronder |

**Maandsnapshots (benadering).** Er worden (nog) geen historische
MRR-snapshots per maand opgeslagen. `src/server/kpi.ts` benadert de
maand-op-maandvergelijking als volgt: *huidige maand* = alle abonnementen met
status `active`; *vorige maand* = alle niet-trialing abonnementen die vóór het
begin van de huidige kalendermaand zijn aangemaakt. Alle bewegings- en
retentie-KPI's (new/reactivatie/expansion/contraction/churned MRR, GRR, NRR,
logo-churn, logo-retentie) delen deze twee snapshots.

## Financiële KPI's (SaaS)

### MRR — maandelijks terugkerende omzet
- **Formule:** som over abonnementen met status `active` van
  `planPriceMonthlyCents + Σ (itemaantal × itemmaandprijs)`.
- **Invoerbron:** `Subscription` + `PlanVersion.priceMonthlyCents` +
  `SubscriptionItem` × `ADDON_CATALOG`-prijzen.
- **Drempels:** geen; zonder actieve abonnementen is de waarde 0.
- **Beperkingen:** onbekende itemsleutels tellen als 0. Jaarcontracten worden
  niet apart geprijsd omdat het interval niet wordt vastgelegd (zie
  contractmix); iedereen telt tegen de maandprijs van de vastgepinde
  planversie.

### ARR — jaarlijks terugkerende omzet (run-rate)
- **Formule:** `MRR × 12`.
- **Invoerbron:** zelfde als MRR.
- **Drempels:** geen; zonder actieve abonnementen is de waarde 0.
- **Beperkingen:** expliciet een **run-rate** (momentopname × 12), géén
  boekhoudkundige omzet en geen voorspelling van gefactureerde of ontvangen
  bedragen. Dit staat letterlijk in de definitietekst.

### ARPO / ARPA — gemiddelde omzet per organisatie (account)
- **Formule:** `MRR / aantal betalende organisaties`, afgerond op hele centen.
- **Invoerbron:** zelfde als MRR.
- **Drempels:** minimaal 1 betalende organisatie; anders onvoldoende data.
- **Beperkingen:** `arpa` is een hernoeming (alias) van `arpo` — in dit
  product is één account één organisatie. Beide exports bestaan; het is één
  meting.

### Nieuwe MRR
- **Formule:** som van de volledige huidige MRR van organisaties die deze
  maand betalend werden (vorige maand afwezig óf bekend met 0),
  **inclusief reactivaties**.
- **Invoerbron:** maandsnapshots (zie hierboven).
- **Drempels:** geen.
- **Beperkingen:** nieuwe MRR = echt nieuw + reactivatie; gebruik
  reactivatie-MRR om dat deel apart te zien (niet optellen, anders dubbel).

### Reactivatie-MRR
- **Formule:** som van de volledige huidige MRR van organisaties die vorige
  maand **bekend waren met 0 MRR** en nu weer > 0 betalen.
- **Invoerbron:** maandsnapshots.
- **Drempels:** geen.
- **Beperkingen:** er worden precies twee maandsnapshots vergeleken; een
  organisatie die vorige maand helemaal niet in de snapshots voorkwam telt
  als *nieuw*, ook als zij ooit eerder klant was. Reactivatie telt bewust
  **niet** mee in NRR.

### Expansion-MRR / Contraction-MRR / Churned MRR
- **Formules** (per organisatie, beide maanden vergeleken):
  - expansion: beide maanden betalend en gestegen → het verschil;
  - contraction: beide maanden betalend en gedaald → het verschil (positief);
  - churned: vorige maand betalend, nu niet (afwezig of 0) → volledige
    vorige MRR.
- **Invoerbron:** maandsnapshots.
- **Drempels:** geen.
- **Beperkingen:** benadering zolang er geen echte historische snapshots
  zijn (zie boven).

### GRR — gross revenue retention
- **Formule:** `(start-MRR − churned MRR − contraction-MRR) / start-MRR`,
  met start-MRR = som van de MRR van betalende organisaties vorige maand.
- **Invoerbron:** maandsnapshots.
- **Drempels:** minimaal **3 betalende organisaties** aan de start (en
  start-MRR > 0); anders onvoldoende data.
- **Beperkingen:** expansion, nieuwe klanten en reactivaties tellen niet mee;
  de uitkomst ligt daardoor altijd in [0, 1].

### NRR — net revenue retention
- **Formule:** `(start-MRR + expansion-MRR − churned MRR − contraction-MRR)
  / start-MRR`.
- **Invoerbron:** maandsnapshots.
- **Drempels:** minimaal **3 betalende organisaties** aan de start (en
  start-MRR > 0); anders onvoldoende data.
- **Beperkingen:** nieuwe klanten én **reactivaties tellen bewust niet mee**
  — NRR meet uitsluitend de omzetontwikkeling van de bestaande betalende
  klantenbasis. Dit staat letterlijk in de definitietekst.

### Logo-churn (maandelijks)
- **Formule:** `vertrokken betalende organisaties / betalende organisaties
  vorige maand`; vertrokken = nu afwezig of 0 MRR.
- **Invoerbron:** maandsnapshots.
- **Drempels:** minimaal **5 betalende organisaties** vorige maand.
- **Beperkingen:** zelfde snapshot-benadering als de MRR-beweging.

### Logo-retentie (maandelijks)
- **Formule:** `gebleven betalende organisaties / betalende organisaties
  begin van de maand` (complement van logo-churn).
- **Invoerbron:** maandsnapshots.
- **Drempels:** minimaal **5 betalende organisaties** aan de start.
- **Beperkingen:** zelfde snapshot-benadering als de MRR-beweging.

### Contractmix — aandeel MRR uit jaarcontracten
- **Formule:** `MRR uit jaarcontracten / totale MRR` over betalende rijen.
- **Invoerbron:** **ontbreekt.** De checkout kent wel een interval-keuze
  (maand/jaar), maar het `Subscription`-model legt het gekozen
  facturatie-interval niet vast (alleen `currentPeriodStart/End`, en een
  planwijziging reset naar maandelijks). Het dashboard toont daarom
  **onvoldoende data** met deze uitleg — er wordt geen interval aangenomen.
- **Drempels:** zodra er een interval-bron is: totale betalende MRR > 0.
- **Beperkingen:** de domeinfunctie (`maandVsJaarMix`) is klaar en getest en
  wordt aangesloten zodra het interval per abonnement wordt opgeslagen.

### Omzetverdeling per plan
- **Formule:** MRR (inclusief items) gesommeerd per plancode, over actieve
  abonnementen; deterministisch gesorteerd op plancode.
- **Invoerbron:** zelfde als MRR.
- **Drempels:** geen.

### Cohortretentie per startmaand
- **Formule:** per startmaand-cohort: `nog actieve organisaties / totaal in
  het cohort`. Startmaand = maand van het eerste abonnement van de
  organisatie; actief = minstens één niet-geannuleerd abonnement.
- **Invoerbron:** `Subscription.createdAt` en `Subscription.status`.
- **Drempels:** cohorten met minder dan **3 organisaties** tonen onvoldoende
  data.
- **Beperkingen:** vereenvoudigde retentie (nog actief op peildatum), geen
  maand-voor-maand-retentiecurve.

### Omzetconcentratie (top-1 en top-3)
- **Formule:** MRR per organisatie gesommeerd (meerdere abonnementen tellen
  op); top-1 = aandeel van de grootste klant, top-N = gezamenlijk aandeel van
  de N grootste klanten in de totale MRR.
- **Invoerbron:** huidige maandsnapshot.
- **Drempels:** totale betalende MRR > 0; anders onvoldoende data.
- **Beperkingen:** met minder dan N betalende organisaties is de
  top-N-concentratie per definitie 1.

## Zonder invoerbron: altijd "onvoldoende data"

Deze KPI's bestaan in de domeinlaag met een eerlijke definitie en retourneren
**altijd** onvoldoende data — er wordt niets verzonnen:

| KPI | Definitie (letterlijk uit de code) |
| --- | --- |
| Kortingen totaal (`kortingenTotaal`) | "Totaal verleende kortingen … Nog geen invoerbron: wordt gemeten zodra echte betalingen via Stripe lopen." |
| Refunds totaal (`refundsTotaal`) | "Totaal terugbetaalde bedragen (refunds) … Nog geen invoerbron: wordt gemeten zodra echte betalingen via Stripe lopen." |
| Mislukte betalingen (`failedPaymentsCount`) | "Aantal mislukte betalingen … Nog geen invoerbron: wordt gemeten zodra echte betalingen via Stripe lopen." |

Reden: de huidige `LocalTestBillingProvider` verwerkt geen echte betalingen,
kortingen of refunds.

## Unit economics: CAC, payback en LTV (kostendata vereist)

Pure functies die kostendata als parameter **eisen**. Het product legt zelf
geen marketing-/saleskosten of marges vast; zonder aangeleverde kosteninvoer
(parameter `null`) geldt onvoldoende data met de tekst "kostendata ontbreekt".

### CAC — customer acquisition cost
- **Formule:** `acquisitiekosten (marketing + sales) / nieuwe betalende
  klanten` over dezelfde periode, afgerond op hele centen.
- **Invoerbron:** extern aan te leveren (`CacCostInput`); geen producttabel.
- **Drempels:** kosteninvoer aanwezig én ≥ 1 nieuwe betalende klant.

### CAC per kanaal
- **Formule:** per kanaal `kanaalkosten / nieuwe betalende klanten uit dat
  kanaal`; deterministisch gesorteerd op kanaalnaam.
- **Invoerbron:** extern aan te leveren (`ChannelCacInput[]`).
- **Drempels:** kosteninvoer aanwezig; kanalen zonder nieuwe klanten tonen
  per kanaal onvoldoende data.

### CAC-terugverdientijd op brutomarge
- **Formule:** `CAC / (maandelijkse ARPA × brutomarge)`, in maanden.
- **Invoerbron:** extern aan te leveren (`CacPaybackInput`).
- **Drempels:** kosteninvoer aanwezig én `ARPA × brutomarge > 0`.
- **Beperkingen:** ARPA is gebaseerd op MRR, niet op boekhoudkundige omzet.

### LTV — customer lifetime value
- **Formule:** `(maandelijkse ARPA × brutomarge) / maandelijkse logo-churn`,
  afgerond op hele centen.
- **Invoerbron:** extern aan te leveren (`LtvInput`).
- **Drempels:** kosten-/margedata aanwezig, `ARPA × brutomarge > 0` én
  churn > 0 (bij churn ≤ 0 is de levensduur niet meetbaar — dat levert
  onvoldoende data op, geen "oneindige" LTV).
- **Beperkingen:** ARPA is gebaseerd op MRR, niet op boekhoudkundige omzet.

## Commerciële KPI's (activatie en conversie)

### Nieuwe praktijkaccounts (30 dagen)
- **Formule:** aantal organisaties met `createdAt` in de afgelopen 30 dagen.
- **Invoerbron:** `Organization.createdAt`.
- **Drempels:** geen (0 is een geldige waarde).

### Onboarding afgerond
- **Formule:** `accounts met afgeronde onboarding / alle accounts`.
- **Invoerbron:** `Organization.activatedAt` en `Vacancy` (benadering:
  onboarding geldt als afgerond bij activatie óf minstens één ooit
  gepubliceerde vacature).
- **Drempels:** minimaal **3 accounts**.
- **Beperkingen:** benadering; er is geen expliciete onboarding-afrondstatus.

### Time-to-activation (mediaan)
- **Formule:** mediaan van `activatedAt − createdAt` in dagen, over
  geactiveerde praktijken.
- **Invoerbron:** `Organization.createdAt` / `Organization.activatedAt`.
- **Drempels:** minimaal **3 geactiveerde praktijken**.

### Mijlpalen: Talent Radar bekeken / eerste sterke match / eerste uitnodiging
- **Formule:** per mijlpaal het aandeel actieve praktijken dat de mijlpaal
  heeft gehaald.
- **Invoerbron:** events `talent_radar_viewed` en `candidate_invited`
  (`AnalyticsEvent`); de sterke-matchmijlpaal wordt live doorgerekend via de
  matchingservice (goede of uitstekende match op een gepubliceerde vacature).
- **Drempels:** minimaal **3 praktijken** per mijlpaal.

### Trialstarts
- **Formule:** aantal organisaties dat een proefperiode is gestart.
- **Invoerbron:** eerste abonnement met plancode `trial` per organisatie.
- **Drempels:** geen.

### Trial → betaald
- **Formule:** `organisaties met een eerste betaald (niet-trial) abonnement /
  gestarte proefperiodes`.
- **Invoerbron:** `Subscription` per organisatie (eerste trial, eerste
  niet-trial).
- **Drempels:** minimaal **5 proefperiodes**.
- **Beperkingen:** "eerste betaling" is de aanmaak van het eerste
  niet-trial-abonnement via de `LocalTestBillingProvider` — geen echte
  betalingen.

### Checkoutconversie
- **Formule:** `(subscription_started + subscription_upgraded +
  subscription_downgraded) / checkout_started`, begrensd op 1.
- **Invoerbron:** `AnalyticsEvent`.
- **Drempels:** minimaal **5 gestarte checkouts**.

### Registratie → betaling (mediaan)
- **Formule:** mediaan van `eerste betaald abonnement − registratie` in dagen.
- **Invoerbron:** `Organization.createdAt` + eerste niet-trial-`Subscription`.
- **Drempels:** minimaal **3 conversies**.

### Conversie per plan
- **Formule:** per plancode `afgeronde abonnementsstarts/-wijzigingen /
  gestarte checkouts`, begrensd op 1.
- **Invoerbron:** `AnalyticsEvent` met plan-context.
- **Drempels:** groepen met minder dan **3 gestarte checkouts** tonen
  onvoldoende data.

### Conversie per acquisitiebron
- **Formule:** per bron `geconverteerde trials / gestarte trials`;
  organisaties zonder bron vallen in het segment "onbekend".
- **Invoerbron:** `Organization.acquisitionSource` + trialrijen.
- **Drempels:** groepen kleiner dan **3** tonen onvoldoende data.

## Verificatie

- Alle formules zijn getest in `tests/domain/kpi.test.ts`,
  `tests/domain/kpi-commercieel.test.ts` en
  `tests/domain/kpi-financieel.test.ts` (randgevallen inbegrepen: geen
  start-MRR, reactivatie buiten NRR, ontbrekende kostendata, altijd-
  onvoldoende-data voor kortingen/refunds/mislukte betalingen).
- Wijzigingen aan definities horen ALTIJD samen te gaan met een update van
  dit document én de bijbehorende tests.
