# IOS_PRIVACY_CHECKLIST.md — Mondzorgwerkt kandidaat-app

Privacy- en App Store-checklist voor de kandidaatgerichte iOS-app. Er worden
**geen juridische claims gedaan die niet door vastgesteld beleid worden
gedekt**: dit document beschrijft wat de app en backend feitelijk doen
(afdwingbaar in code) en verwijst voor het bredere beleid naar de bestaande
AVG-implementatie (`src/server/privacy.ts`, `/instellingen/privacy`).

## 1. In-app privacyverklaring (makkelijk vindbaar)

Scherm **Profiel → Privacy en gegevens** (`app/(app)/instellingen/privacy.tsx`)
toont, zonder scrollen weg te stoppen:

- [x] **Welke gegevens worden verzameld** — account (naam, e-mail),
      kandidaatprofiel (functie, ervaring, postcode, werkweek, uren,
      reisafstand, startdatum, apparatuur/scannerervaring, specialisaties,
      contractvoorkeur, zzp-omzetpercentage), sollicitaties, uitnodigingen,
      gesprekken, toestemmingen en meldingen.
- [x] **Waarom** — uitsluitend matchen met vacatures in de mondzorg en het
      afhandelen van sollicitaties/gesprekken; geen verkoop van gegevens, geen
      advertentietracking, gepseudonimiseerde analytics.
- [x] **Hoe toestemming wordt ingetrokken** — per praktijk intrekbaar
      (`revokeConsent`), plus zichtbaarheidsinstelling in het profiel.
- [x] **Welke gegevens worden verwijderd** — naam/e-mail geanonimiseerd,
      profiel + meldingen verwijderd, toestemmingen ingetrokken, alle
      app-sessies en pushtokens vervallen.
- [x] **Welke wettelijk bewaarde gegevens blijven** — geanonimiseerde
      matchvastleggingen en het besluitenjournaal blijven als
      bedrijfsadministratie bestaan, zonder naam of contactgegevens
      (conform de bestaande retentie in `src/server/privacy.ts`).

Een live gegevensoverzicht (AVG art. 15, `gegevensOverzicht`) toont per
categorie het aantal bewaarde records.

## 2. Accountverwijdering vanuit de app (App Store-vereiste)

Omdat de app accountcreatie ondersteunt, kan een gebruiker vanuit de app
accountverwijdering **starten**:

- [x] Scherm **Account verwijderen** (`app/(app)/instellingen/account-verwijderen.tsx`),
      bereikbaar via Profiel → Privacy en gegevens → Account verwijderen.
- [x] Bewuste bevestiging: typwoord `"verwijderen"` (zelfde als de webapp).
- [x] `DELETE /api/mobile/v1/account` → `verwijderAccount(userId)`
      (anonimisering in één transactie, `PrivacyRequest kind="verwijdering"`),
      daarna intrekking van álle mobiele sessies en verwijdering van alle
      pushtokens.
- [x] Na serverbevestiging wordt lokaal alles gewist en keert de app terug
      naar het openbare deel.
- [x] Bewezen door de integratietest *"toont het gegevensoverzicht en
      verwijdert het account volledig"*.

## 3. Dataminimalisatie & beveiliging

- [x] Tokens uitsluitend in de iOS Keychain (`expo-secure-store`); **nooit**
      in AsyncStorage (bewezen door `secure-tokens.test.ts`).
- [x] Geen service-rolekey of geheime env-variabelen in de app.
- [x] Coördinaten van de kandidaat worden **niet** naar de app gestuurd —
      alleen de postcode (`toProfileView`, `toMatchDetail`).
- [x] `isPlatformAdmin` wordt niet naar mobiel gelekt.
- [x] Server-side tenant- en eigendomscontrole op elke route
      (`requireUser`/`requireCandidate`); bewezen door *"gebruiker B kan niet
      bij data van gebruiker A"*.
- [x] Tokenrotatie, uitloggen, sessie-intrekking en replay-detectie
      (`mobile-auth.ts`); bewezen door de auth-integratietests.
- [x] Rate limiting hergebruikt de bestaande fixed-window-tellers (login,
      register, refresh).
- [x] **Geen persoonsgegevens in analytics of crashlogs** — analytics gaan via
      de bestaande PII-filterende envelope; er is geen aparte crash-/analytics-
      SDK toegevoegd die PII zou verzamelen.
- [x] **Alle caches gewist bij uitloggen** (`wisCache` + `wisTokens` +
      pushtoken-afmelding in `session.tsx`).
- [x] **Geen kandidaatdata in onbeveiligde notificatietekst** — pushtitels zijn
      generiek, body is neutraal ("Open de app voor de details"); details staan
      achter de login (`src/server/mobile/push.ts`).

## 4. Toestemming & push

- [x] Pushnotificaties vragen expliciete systeemtoestemming (opt-in), pas na
      een bewuste keuze in onboarding of instellingen.
- [x] Notificatievoorkeuren per type (in-app/e-mail/push).
- [x] Tokenregistratie + rotatie bij de server; verwijdering bij uitloggen.
- [x] Vanuit development/preview worden **geen** pushes naar echte gebruikers
      gestuurd.

## 5. Consent-model (server beslist)

- [x] Praktijken zien de naam van een kandidaat alleen bij `visibility="visible"`,
      na expliciete consent voor die context, of wanneer de kandidaat zelf
      solliciteert.
- [x] Consent is per organisatie/vacature en altijd intrekbaar; de app toont de
      actieve toestemmingen en biedt intrekken aan.

## 6. App Store Privacy-nutrition (in te vullen bij indiening)

Te declareren gegevenscategorieën en gebruik (op basis van bovenstaande):
contactgegevens (naam, e-mail) en gebruikersinhoud (profiel) — gebruikt voor
**App-functionaliteit**, **gekoppeld aan de gebruiker**, **niet** gebruikt voor
tracking of advertenties. Locatie: alleen postcode (grof), app-functionaliteit.
Vul de definitieve nutrition-labels in tijdens de indiening en houd ze in lijn
met dit document.

> App Store-indiening en TestFlight-distributie aan externen gebeuren **niet**
> zonder expliciete toestemming (zie DoD in de opdracht).
