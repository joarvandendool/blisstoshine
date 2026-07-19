# MOBILE_ARCHITECTURE.md — Mondzorgwerkt kandidaat-app (iOS)

Een aparte, kandidaatgerichte iOS-client boven op het bestaande Mondzorgwerkt-
platform. **Geen WebView-wrapper**: een echte native app (React Native/Expo)
die uitsluitend via geauthenticeerde, versieerbare API's met de bestaande
backend praat. De webapp en server blijven de bronwaarheid; matching,
toestemming, uitnodigingen, plaatsingen en entitlements worden altijd
server-side beslist.

## 1. Repository-indeling

De app is als workspace-achtige map naast de bestaande Next.js-app geplaatst;
de webapp is niet geherstructureerd om een monorepo af te dwingen.

```
/                         bestaande Next.js-app (bronwaarheid)
├─ app/api/mobile/v1/**   nieuwe mobiele BFF-routes (dun boven src/server/*)
├─ src/lib/mobile-auth.ts intrekbaar bearer-sessiemodel (nieuw)
├─ src/server/mobile/**   http-helpers, view-mappers, zod-schemas, push
├─ packages/api-contract/ GEDEELD puur TypeScript-contract (web ↔ mobiel)
└─ apps/mobile/           de Expo-app (React Native, Expo Router, TypeScript)
   ├─ app/**              schermen (file-based routing)
   ├─ src/components/**   MatchShape, WeekGrid, UI-primitieven
   ├─ src/lib/**          api-client, secure-tokens, session, push, cache
   ├─ src/theme/tokens.ts Mondzorgwerkt-designtokens
   └─ e2e/                Playwright web-smoke (screenshots + verhalen)
```

### Wat wél gedeeld wordt (`packages/api-contract`, puur TypeScript)

- **API-contracten** — wire-types van `/api/mobile/v1/*` (`src/api.ts`).
- **Domeintypes** — `MatchResult`, `MatchVacancy`, `MatchCandidate` etc.
  (her-geëxporteerd uit `src/domain/matching/types.ts`).
- **Schemas/validaties** — zuivere decoders (`decodeAvailability`,
  `decodeSchedule`, `decodeIsoDate`, `decodeEnum`) die identiek aan de server
  interpreteren.
- **Vertalingen/labels** — de Nederlandse `LABELS`-map uit de taxonomie.
- **Design tokens** — als losse module in de app (`src/theme/tokens.ts`).
- **Zuivere utilities** — deep-linkresolutie (`resolveDeepLink`,
  `targetToPath`), matchcategorie-helpers.

### Wat NOOIT in de app zit

Prisma, databaseclients, server-only modules, Next.js Server Actions,
service-rolecredentials en geheime environmentvariabelen. De app importeert
alleen uit `@mondzorgwerkt/api-contract` en `src/domain/taxonomy` (beide puur).
De metro-config beperkt de watchfolders bewust tot `packages/` en
`src/domain/`.

## 2. Technische stack

| Onderdeel | Keuze |
|---|---|
| Framework | React Native 0.86, Expo SDK 57 (actuele stabiele SDK) |
| Taal | TypeScript (strict) |
| Navigatie | Expo Router (file-based, native stack + tabs) |
| Runtime | **Echte Expo development build** (`expo-dev-client`) — **geen Expo Go** als productiearchitectuur |
| Veilige opslag | `expo-secure-store` (iOS Keychain) |
| Notificaties | `expo-notifications` (Expo push) |
| Animatie | `react-native-reanimated` (transform/opacity, native driver) |
| Vectoren | `react-native-svg` (MatchShape) |

## 3. Datastroom

```
Scherm → src/lib/endpoints.ts (getypeerd) → src/lib/api.ts (fetch, auth,
retry, refresh) → /api/mobile/v1/* (Next route handler) → src/server/*
(bestaande services, ongewijzigd) → Prisma → Postgres
                                    ↑
              src/server/mobile/views.ts mapt naar het gedeelde wire-contract
```

De mobiele routes zijn dunne wrappers: ze parsen (zod), roepen exact dezelfde
servicefuncties aan die de webapp gebruikt (`saveProfileStep`,
`matchesForCandidate`, `applyToVacancy`, `respondToInvitation`,
`confirmInterview`, `revokeConsent`, `verwijderAccount`, …) en mappen de
uitkomst naar het contract. Er wordt **geen** businesslogica gedupliceerd.

### Matching wordt nooit mobiel herrekend

De app toont uitsluitend het server-`MatchResult`: `score`, `label`,
`summary`, `strengths`, `attentionPoints`, `categoryScores`, `opportunities`
en `algorithmVersion`. De `MatchShape`-visual en de categoriebalken zijn pure
presentatie van die servergetallen. Er zit geen scorewiskunde in de app.

## 4. Authenticatie (mobiel sessiemodel)

De webapp gebruikt een stateless HttpOnly-cookie. Voor mobiel is een
**intrekbaar bearer-tokenmodel** toegevoegd zonder de webbeveiliging te
wijzigen (`src/lib/mobile-auth.ts`, model `MobileSession`):

- **Access-token** `mzm_at_<64 hex>` — opaak, alleen sha256-hash opgeslagen,
  30 minuten geldig, DB-lookup per verzoek → intrekking werkt direct.
- **Refresh-token** `mzm_rt_<64 hex>` — single-use met rotatie, 30 dagen.
  Hergebruik van een al geroteerd token (`previousRefreshTokenHash`) is een
  replay-signaal en trekt de hele sessie in.
- **Opslag** — uitsluitend Keychain via `expo-secure-store`, nooit
  AsyncStorage.
- **Transport** — `Authorization: Bearer mzm_at_…`. Geen cookies → geen
  CSRF-oppervlak; de bestaande `assertSameOrigin`-bescherming van
  cookie-endpoints blijft ongewijzigd.
- **Serverbrug** — `getSessionUser()` accepteert naast de cookie ook een
  geldige mobiele access-token, zodat `requireUser()`/`requireCandidate()` en
  álle services ongewijzigd werken; tenant- en eigendomscontroles blijven
  server-side.
- **Uitloggen/intrekken** — trekt de sessie in en verwijdert de pushtokens;
  de app wist alle SecureStore-items en in-memory caches. `sessies`-endpoint +
  `DELETE /sessions/:id` voor apparaatbeheer op afstand.

## 5. Betrouwbaarheid: offline, retries en dubbele verzoeken

Client (`src/lib/api.ts`):

- **Disable-on-tap + single-flight** (`enkeleVlucht`): dubbel tikken levert
  hooguit één verzoek op.
- **Retry met backoff** alleen voor idempotente GET's bij netwerk-/5xx-fouten;
  niet-idempotente POST's worden **nooit** blind herhaald.
- **Onbekende uitkomst** (time-out na een mutatie) → geen retry, maar de state
  wordt herladen; succes-UI verschijnt uitsluitend na een bevestigde 2xx.
- **401** → één refresh-poging (single-flight); faalt die, dan lokale logout.

Server: alle mutaties zijn idempotent of conflictbewust — unieke sleutels op
sollicitatie, uitnodigingsantwoord (alleen vanuit `sent`), consent-upsert,
pushtoken-upsert en notificatie-dedupeKey geven deterministisch 409/`ok` in
plaats van dubbele records. Verouderde/gesloten resources geven 404/409/410,
waarna de app de lijst herlaadt met een rustige melding.

## 6. Pushnotificaties en deep links

- Push uitsluitend voor **bestaande** notificatie-events; verzending haakt in
  op de bestaande `sendNotification`-laag (`src/server/mobile/push.ts`).
- Expliciete toestemming (opt-in), tokenregistratie + rotatie, verwijdering
  bij uitloggen, deduplicatie via `dedupeKey`.
- Zichtbare pushtekst bevat **nooit** kandidaatdata — alleen een generieke
  titel + deep-linkdata; details staan achter de login.
- Vanuit development/preview wordt **niet** naar echte gebruikers gestuurd
  (verzending alleen wanneer `appEnv === "production"`).
- Deep links (`mondzorgwerkt://`) en `Notification.href`-webpaden worden via
  `resolveDeepLink` naar het juiste scherm gemapt, met veilige fallback naar
  Matches wanneer content niet meer bestaat.

## 7. Ontwerp — "Precision in flow", native

Designtokens één-op-één uit `app/globals.css`/`marketing.css`
(`src/theme/tokens.ts`): cobalt `#0120ec`, cloud `#cddfee`, toegankelijk roze
`#ed6ca5`, inkt op licht oppervlak, glass-kaarten, veel witruimte. De
editorial typografieconventie (één accentwoord in cursieve serif binnen een
sans-kop) is bewaard. **MatchShape** — de visuele signatuur — is 1-op-1 geport
naar SVG met dezelfde deterministische geometrie; de drift-animatie gebruikt
alleen transform/opacity, pauzeert wanneer het scherm niet zichtbaar is en
respecteert "Verminder beweging". De **WeekGrid** toont dag/dagdeel als grid
met symbool + tekst (status nooit alleen kleur). Navigatie is platformconform
iOS (native stack, tabs, safe areas, gestures); geen pixelkopie van de site.

## 8. Schermen (kandidaat-v1)

Splash/sessieherstel · openbare vacaturezoeker (zonder login) · vacaturedetail
· registreren/inloggen · onboarding (6 stappen, hervatbaar) · profiel bekijken
& aanpassen · werkdagen/dagdelen · beschikbaarheid bevestigen · uren/startdatum/
reisafstand · scannerervaring/specialisaties · contractvoorkeur/zzp-
omzetpercentage · persoonlijke matches · uitlegbare matchdetails · reageren/
solliciteren · uitnodigingen · consent · gesprekken/afspraken · notificaties ·
privacy/accountinstellingen · accountverwijdering starten.

Bewust **niet** gebouwd: praktijkdashboard, admin, payroll, chat, nieuwe
matchingfunctionaliteit.

## 9. Tests

Zie `IOS_TEST_PLAN.md`. Kort: TypeScript, lint, unit (jest-expo, 28),
API-contracttests (server-vitest + app-jest, bewijzen identieke payload-
interpretatie), authenticatie- en secure-storagetests, offline/retry-,
dubbele-request-, deep-link- en push-tokenlevenscyclustests, plus een
productieachtige `expo export` (iOS Hermes-bundel) en een end-to-end
web-smoke die alle kernverhalen tegen de echte backend doorloopt (21
screenshots).

## 10. Build & release

Zie `IOS_RELEASE_RUNBOOK.md`. Een echte Expo development build (EAS of lokaal
`expo run:ios`); **geen** App Store-publicatie of TestFlight-distributie aan
externen zonder expliciete toestemming.
