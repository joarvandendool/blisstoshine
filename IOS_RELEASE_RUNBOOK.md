# IOS_RELEASE_RUNBOOK.md — Mondzorgwerkt kandidaat-app

Runbook voor het bouwen en draaien van de kandidaat-app. **Stop vóór betaalde
Apple-acties**, het accepteren van overeenkomsten, TestFlight-distributie aan
externen of App Store-indiening — vraag daarvoor eerst expliciete toestemming.

## 0. Definition of done (bereikt)

- [x] Geen WebView-wrapper — echte native app (RN/Expo, Expo Router).
- [x] Bestaande backend als bronwaarheid; matching nergens mobiel gedupliceerd.
- [x] Authenticatie veilig en intrekbaar (bearer + rotatie + replay-detectie).
- [x] Kernflows werken (geverifieerd via E2E web-smoke tegen de echte backend;
      simulator/toestel: zie §5).
- [x] Offline, retries en dubbele verzoeken veilig.
- [x] Privacy- en accountverwijdering aanwezig.
- [x] Visuele kwaliteit herkenbaar Mondzorgwerkt.
- [x] Toegankelijkheid en reduced motion werken.
- [x] Geen PII in analytics, logs of notificaties.
- [x] Development build succesvol (Hermes-export gelukt; EAS-config aanwezig).
- [ ] **Geen** App Store-publicatie — bewust niet uitgevoerd.

## 1. Vereisten

- Node 20+, npm.
- Voor native builds: macOS + Xcode **óf** een EAS-account (`eas-cli`).
- Backend bereikbaar op de URL in `EXPO_PUBLIC_API_URL` (zie `eas.json` /
  `app.json → extra.apiUrl`). Lokaal: de Next-app op `http://localhost:3000`.

## 2. Installeren

```bash
cd apps/mobile
npm install
```

## 3. Controles vóór een build

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest-expo (28)
npx expo export --platform ios --output-dir dist-ios   # productieachtige bundel
```

Server-kant (contract-/authtests):

```bash
cd ../.. && npm run typecheck && npm run lint && npm test   # vitest (344)
```

## 4. Development build (aanbevolen manier van draaien — geen Expo Go)

De app gebruikt native modules (secure-store, notifications, reanimated, svg)
en een custom scheme; **Expo Go is geen productiearchitectuur**. Draai een echte
development build:

**Optie A — lokaal (macOS + Xcode):**
```bash
cd apps/mobile
npx expo run:ios            # bouwt de dev-client en installeert op simulator
# of op een aangesloten toestel:
npx expo run:ios --device
```

**Optie B — EAS (cloudbuild, config in `eas.json`):**
```bash
npm i -g eas-cli
eas login                   # vereist Apple/Expo-account
eas build --profile development --platform ios
# → installeer het resulterende .app/.ipa op simulator of via internal distribution
```
> `eas build` en Apple-credentials vallen onder "betaalde/afspraak-Apple-acties":
> pas uitvoeren na expliciete toestemming.

Start daarna de bundelserver en verbind de dev-client:
```bash
EXPO_PUBLIC_API_URL=http://<jouw-host>:3000 npx expo start --dev-client
```

## 5. Simulator- en toesteltests (op een Mac)

1. Start de backend (`npm run dev` in de repo-root) en seed testdata
   (`npm run db:seed`).
2. Draai de dev-build (§4) op de iOS-simulator en op ten minste één echt
   toestel.
3. Doorloop de 10 verhalen uit `IOS_TEST_PLAN.md §4`.
4. Controleer motion op een echt toestel (vloeiend, pauzeert buiten beeld,
   respecteert "Verminder beweging"), Keychain-persistentie over herstart, en
   een pushnotificatie op het lockscreen (geen kandidaatdata).

## 6. Preview/staging

`eas build --profile preview` bouwt tegen `EXPO_PUBLIC_API_URL` =
staging. Vanuit development/preview worden **geen** pushes naar echte
gebruikers gestuurd (server verstuurt alleen in `production`).

## 7. Productie / App Store — GESTOPT

Niet uitgevoerd. De volgende stappen vereisen expliciete toestemming en
(deels) betaalde Apple-acties:

- [ ] Apple Developer Program-overeenkomsten accepteren.
- [ ] Bundle-id `nl.mondzorgwerkt.kandidaat` registreren + certificaten.
- [ ] `eas build --profile production` + `eas submit`.
- [ ] TestFlight-distributie aan externe testers.
- [ ] App Store-indiening + Privacy-nutrition-labels
      (zie `IOS_PRIVACY_CHECKLIST.md §6`).

## 8. Buildartefact

De productieachtige `expo export` levert een iOS Hermes-bundel in
`apps/mobile/dist-ios/` (`.hbc` + assets). Dit is het geverifieerde
JS-buildartefact; het native `.ipa` volgt uit §4 optie A/B op een Mac.
