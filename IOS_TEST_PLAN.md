# IOS_TEST_PLAN.md — Mondzorgwerkt kandidaat-app

Testplan en -resultaten voor de kandidaatgerichte iOS-app. Alle
geautomatiseerde suites zijn groen; de handmatige/toestel-checks staan met
hun status.

## 1. Geautomatiseerde suites (uitgevoerd)

| Categorie | Commando | Resultaat |
|---|---|---|
| TypeScript (web/server) | `npm run typecheck` (root) | ✅ groen |
| TypeScript (app) | `apps/mobile` → `tsc --noEmit` | ✅ groen |
| Lint (web/server) | `npm run lint` | ✅ 0 fouten |
| Lint (app) | `apps/mobile` → `expo lint` | ✅ 0 fouten |
| Unit + contract + auth (server) | `npm test` (vitest) | ✅ **344 tests, 23 files** |
| Unit + contract (app) | `apps/mobile` → `jest` | ✅ **28 tests, 5 files** |
| Productieachtige build | `apps/mobile` → `expo export --platform ios` | ✅ Hermes-bundel (~3.8 MB) |

### Wat de suites specifiek dekken (per opdrachteis)

- **API-contracttests** — `tests/domain/mobile-contract.test.ts` (server) en
  `apps/mobile/src/__tests__/contract.test.ts` (app) bewijzen dat web en
  mobiel exact dezelfde canonieke waarden en enums delen (werkdagen, dagdelen,
  functies, contractvormen, apparatuur, specialisaties, statussen, pipeline,
  redencodes, notificatietypen, matchcategorieën) en dezelfde payloads
  identiek interpreteren (beschikbaarheidsmatrix, rooster, datums).
- **Authenticatietests** — `tests/integration/mobile-api.test.ts`: register,
  login, tokenrotatie, **replay-detectie** (geroteerd refresh-token → sessie
  ingetrokken), verlopen access-token, logout trekt sessie in en verwijdert
  pushtokens, brute-force-lockout, registratie-rate-limit.
- **Secure-storagetests** — `secure-tokens.test.ts`: tokens gaan uitsluitend
  naar de Keychain (`AFTER_FIRST_UNLOCK`), round-trip, corrupte inhoud wordt
  gewist. Nooit AsyncStorage.
- **Offline- en retrytests** — `api.test.ts`: GET's retryen met backoff bij
  netwerk-/5xx-fouten; mutaties nooit; `NetwerkFout` na uitputting.
- **Dubbele-requesttests** — `api.test.ts` (`enkeleVlucht` bundelt dubbel
  tikken) én `mobile-api.test.ts` (dubbel solliciteren → 409, dubbel
  uitnodiging-antwoord → 409).
- **Deep-linktests** — `contract.test.ts` + `mobile-contract.test.ts`:
  web-href's en app-schema-URL's → juiste scherm, onbekende/verdwenen content
  → veilige fallback.
- **Push-tokenlevenscyclus** — `push.test.ts`: expliciete toestemming,
  registratie bij de server, rotatie via de tokenlistener, afmelden bij
  uitloggen; pushdata → juist scherm met fallback.
- **Eigendom/tenantisolatie** — `mobile-api.test.ts`: gebruiker B kan geen
  data van gebruiker A lezen of muteren (404); zonder token overal 401.
- **Toegankelijkheid** — componenten dragen VoiceOver-labels, statussen worden
  nooit alleen met kleur weergegeven (WeekGrid symbool+tekst+legenda),
  tikdoelen ≥44–48pt, `accessibilityRole`/`accessibilityState` op knoppen,
  chips, badges en voortgang; reduced motion via `useReducedMotion`.

## 2. iOS-simulator & echt toestel (uit te voeren op een Mac)

De volgende checks vereisen een macOS-buildomgeving (niet beschikbaar in de
CI-/agentomgeving). Draai ze met de development build (zie
`IOS_RELEASE_RUNBOOK.md`):

- [ ] iOS-simulator (iPhone 15/16, iOS 18): alle 10 verhalen (§4) doorlopen.
- [ ] Ten minste één echt toestel: MatchShape-motion vloeiend; reduced motion
      respecteert de systeeminstelling; Keychain-persistentie over herstart.
- [ ] VoiceOver-doorloop van onboarding, matchdetail en accountverwijdering.
- [ ] Pushnotificatie op lockscreen bevat geen kandidaatdata; deep link opent
      het juiste scherm.

## 3. End-to-end web-smoke (uitgevoerd, als vervanging bij ontbrekende Mac)

`apps/mobile/e2e/web-smoke.mjs` rendert de app via Expo-web tegen de **echte**
lokale backend (Next dev + Postgres, geseede data) op een iPhone-viewport en
legt 21 screenshots vast van alle kernschermen. Deze run bewees end-to-end:
openbaar zoeken → vacaturedetail → registreren → onboarding (6 stappen) →
matchfeed → uitlegbaar matchdetail (91% match) → solliciteren (succes pas na
serverbevestiging) → uitnodiging (met consent) → gesprek kiezen en bevestigen
→ profiel → beschikbaarheid aanpassen → notificatievoorkeuren → privacy →
accountverwijdering. Tijdens deze run is een **echte bug** (dubbele React-key
op match-opportunities) gevonden en verholpen.

## 4. Verplichte verhalen — status

| # | Verhaal | Auto-bewijs | E2E-screenshot |
|---|---|---|---|
| 1 | Openbaar zoeken en vacature openen | public-api tests | 01, 02 |
| 2 | Registreren en onboarding hervatten | mobile-api (register+step+activate) | 03–09 |
| 3 | Beschikbaarheid aanpassen en na herstart terugzien | mobile-api (profiel step) | 18 (herstart: Keychain-test) |
| 4 | Match bekijken en reageren | mobile-api (matches, apply, 409) | 10, 11, 12 |
| 5 | Uitnodiging accepteren en consent geven | mobile-api (respond+consent) | 13, 14 |
| 6 | Gesprek openen via deep link | contract deeplink-tests | 15, 16 |
| 7 | Notificaties uitzetten | preferences-endpoint | 19 |
| 8 | Uitloggen en lokale data wissen | session `uitloggen`, logout-test | (wisCache+wisTokens) |
| 9 | Accountverwijdering starten | mobile-api delete-account test | 21 |
| 10 | Gebruiker A geen data van gebruiker B | mobile-api eigendomstest | (401/404) |

## 5. Testresultaten (samenvatting)

```
Server (vitest):   344 passed / 23 files
App (jest-expo):    28 passed / 5 files
Typecheck:          groen (web/server + app)
Lint:               0 fouten (web/server + app)
iOS export:         gelukt (Hermes-bundel)
E2E web-smoke:      21/21 kernschermen, alle verhalen doorlopen
```
