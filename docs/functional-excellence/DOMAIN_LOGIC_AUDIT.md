# Domeinlogica-audit — matching & billing

Aanvulling op `docs/due-diligence/MATCHING_GOVERNANCE.md` en
`docs/due-diligence/KPI_DEFINITIONS.md`. Beschrijft de bevindingen én de
doorgevoerde wijzigingen (v1.1.0 van de matching-engine).

## Matching

### Canonieke engine
Eén pure engine `computeMatch` (`src/domain/matching/engine.ts`) + wrapper
`computeMatchWithOpportunities`. Alle oppervlakken gebruiken deze: matchfeed,
matchdetail, `candidatesForVacancy`, cross-locatiepool, Match Studio/simulate,
Talent Radar, uitnodigingen, sollicitaties, schaduw v1+v2. De publieke laag
rekent nooit zelf. Geen zelf-berekende scores gevonden.

### Criteriamatrix (v1.1.0)
| Criterium | Hard/zacht | Categorie (gewicht) |
|---|---|---|
| Functie | hard (`functie_ongelijk`) | roleAndExperience (0,15) |
| BIG-registratie | hard (`HARD_REGISTRATIONS`) | roleAndExperience |
| Overige registraties (KRT/KRM/röntgen) | **zacht** aandachtspunt `registratie_niet_in_profiel` (was: hard → pool-wipe) | roleAndExperience |
| Verplicht dagdeel geen overlap | hard | availability (0,35) |
| Dagen/dagdelen overlap | zacht (required×2, preferred×1) | availability |
| Geen gedeelde contractvorm | hard | employment (0,10) |
| Uren-overlap | zacht | employment (0,50 binnen) |
| Contractvorm-overlap | zacht | employment (0,25 binnen) |
| **Beloning (zzp %/loondienst salaris)** | **zacht** (nieuw v1.1.0) | employment (0,25 binnen) |
| Startdatum na harde deadline | hard (`startdatum_te_laat`) | employment |
| Reistijd | zacht (nooit hard) | travel (0,15) |
| Apparatuur/software (ontwikkelmatch) | zacht | equipmentAndSoftware (0,10) |
| Specialisaties | zacht | specializations (0,10) |
| Ervaringsniveau | zacht | roleAndExperience |
| Werkplekvoorkeuren | zacht | workplacePreferences (0,05) |

### Compensatie-lek
Een harde mismatch keert vroeg terug met `eligible:false, score:0` — kan niet
door zachte overeenkomsten worden gecompenseerd. Bevestigd door
`matching.test.ts`.

### Ontbrekende gegevens
Per categorie terugval op de neutrale score 60; nooit auto-0 of auto-perfect.
Beloning ontbrekend → neutraal (geen straf). Actieve/zichtbare kandidaten en
gepubliceerde vacatures worden overal correct gefilterd.

### Beloning (fix P1-1)
`beoordeelBeloning` (`engine.ts`): zzp gebruikt `revenueShareMin` (wens) vs
`revenueShareMax` (bod), loondienst `salaryMin` vs `salaryMax`. Regel: bod ≥
wens → volledig; anders `bod/wens` naar rato. Omzetpercentage blijft een geheel
getal 0–100 (nooit fractie/uurtarief). Gunstigste gedeelde contractvorm telt.
Zacht signaal: te laag bod → `beloning_onder_wens`; passend → `beloning_sluit_aan`.
Grondslag: feedback-redencode `salaris_tarief`. Tabelgestuurde grenswaardetests
toegevoegd.

### Registraties (fix P1-2)
Alleen `HARD_REGISTRATIONS` (`big_tandarts`, `big_mondhygienist`) sluiten hard
uit; die zitten definitorisch aan de functie vast. Overige gevraagde
registraties legt het profiel niet betrouwbaar vast en gelden als zacht
aandachtspunt, zodat een courante eis niet de héle pool wegfiltert.

### Determinisme
Engine volledig deterministisch (getest, `toStrictEqual`). Bekend restpunt (P2):
gebruikerszichtbare sortering bij gelijke scores heeft nog geen tiebreaker/
expliciete `orderBy` — genoteerd in het report.

### Percentage vs. fractie
Door de hele stack consistent geheel getal 0–100 (schema/validatie/UI/seeds).
Geen deling door 100 op `revenueShare`; geen uurtarief-UI voor zzp.

### v1 vs v2 (schaduw)
v2 (`2.0.0-shadow`) beïnvloedt geen zichtbare uitkomst; hergebruikt v1's
eligibility. De v1.1.0-wijziging raakt v2's scoring niet (v2 is een aparte
variant; annotatie ongewijzigd, schaduw-only).

## Billing / entitlements

Domeinlaag (`src/domain/entitlements`) puur en fail-closed; entitlements overal
server-side afgedwongen. Bevindingen + fixes:

- **Webhookvolgorde (P1-3, fix):** `Subscription.lastBillingEventAt`; een event
  met `occurredAt` ouder dan de laatst verwerkte status wordt genegeerd, zodat
  een vertraagd `payment_failed` een geboekt `payment_succeeded` niet terugdraait.
- **API-toegang na downgrade (P1-4, fix):** `handleOrgApi` dwingt bij élk verzoek
  `enforceEntitlement(api_access)` af (403 bij verlies).
- **Checkout-idempotency (P1-5, fix):** partiële unieke index (één
  niet-geannuleerd abonnement per org) + P2002-afhandeling → geen dubbel actief
  abonnement bij dubbelklik.
- **Restpunten (P2):** `active`-met-verstreken-periode zonder grace houdt toegang
  (verlengings-webhook vereist); betaalde add-ons zonder afdwingpunt;
  TOCTOU-races op maandlimieten; geen trialverloop-melding. Geen echte betalingen
  (LocalTestBillingProvider); Stripe-webhookroute + signatuurverificatie nog te
  bouwen bij livegang.
