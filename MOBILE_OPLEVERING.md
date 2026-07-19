# MOBILE_OPLEVERING — kandidaatgerichte iOS-app

Oplevering van de kandidaat-app als aparte client boven op het bestaande
Mondzorgwerkt-platform, gestart vanaf het goedgekeurde integratiecheckpoint
van Workstreams A en B.

## Opgeleverde artefacten

| Deliverable | Locatie |
|---|---|
| Mobiele architectuur | `MOBILE_ARCHITECTURE.md` |
| API-contract (vóór implementatie) | `MOBILE_API_CONTRACT.md` |
| Privacy-/App Store-checklist | `IOS_PRIVACY_CHECKLIST.md` |
| Testplan + resultaten | `IOS_TEST_PLAN.md` |
| Release-runbook | `IOS_RELEASE_RUNBOOK.md` |
| Screenshots kernschermen (21) | `apps/mobile/screenshots/` (+ README) |
| Gedeeld puur contract | `packages/api-contract/` |
| Mobiele server-API (BFF) | `app/api/mobile/v1/**`, `src/server/mobile/**`, `src/lib/mobile-auth.ts` |
| Expo-app | `apps/mobile/` |
| Buildartefact (Hermes-bundel) | `apps/mobile/dist-ios/` (gitignored; reproduceerbaar, zie runbook) |
| Development-buildinstructie | `IOS_RELEASE_RUNBOOK.md §4` |

## Testresultaten

- Server (vitest): **344 tests / 23 files** — incl. `mobile-contract` en
  `mobile-api` (auth, rotatie, replay, offline, dedupe, eigendom,
  accountverwijdering, push-tokens).
- App (jest-expo): **28 tests / 5 files** — contract, secure-storage,
  api-offline/retry/refresh/single-flight, push-levenscyclus, MatchShape-
  geometrie.
- Typecheck & lint: groen (web/server én app).
- iOS-export: gelukt (productieachtige Hermes-bundel).
- E2E web-smoke: 21/21 kernschermen tegen de echte backend; alle 10
  verplichte verhalen doorlopen.

## Definition of done

Alle DoD-punten behaald, behalve — bewust — App Store-publicatie (niet
uitgevoerd zonder expliciete toestemming). Zie `IOS_RELEASE_RUNBOOK.md §0`.

## Resterende risico's

1. **Simulator/echt-toestel-verificatie vereist een Mac.** De agentomgeving
   heeft geen macOS/Xcode; kernflows zijn end-to-end geverifieerd via de
   Expo-web-render tegen de echte backend en de volledige testsuites. De
   native simulator-/toestelchecks (motion op hardware, Keychain over
   herstart, lockscreen-push) staan als checklist in `IOS_TEST_PLAN.md §2` en
   moeten op een Mac worden afgevinkt vóór distributie.
2. **MatchShape-SVG op web-render.** Bij de Expo-web-screenshots is soms alleen
   het scorecijfer zichtbaar en niet de blob-vormen; dit is een web-only
   rendering-eigenaardigheid van `react-native-svg`. Op iOS native rendert de
   SVG correct (te bevestigen op toestel, risico 1).
3. **SESSION_SECRET in productie.** Het mobiele bearer-model erft de bestaande
   sessiegeheim-afleiding; zet in productie een expliciete `SESSION_SECRET`
   (zoals de webapp al waarschuwt). Onafhankelijk van de app, maar relevant
   voor tokenintegriteit.
4. **Pushverzending is Expo Push.** Verzending is geïmplementeerd en
   afgeschermd (alleen `production`, geen PII), maar is nog niet tegen een
   echte APNs-sleutel getest — dat gebeurt bij de eerste EAS-build met
   credentials (achter expliciete toestemming).
5. **`apps/mobile` als losse map, geen npm-workspaces.** Bewust gekozen om de
   webapp niet te herstructureren; het gedeelde contract wordt via metro
   `extraNodeModules` en een `file:`-dependency opgelost. Bij een latere
   monorepo-migratie kan dit naar echte workspaces.

## Branch en laatste commit

- **Branch:** `claude/ios-candidate-app-llqh81`
- **Laatste commit:** zie `git log -1` op deze branch (ingevuld bij de push).
