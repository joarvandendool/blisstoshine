# MOBILE_API_CONTRACT.md — kandidaat-app ↔ Mondzorgwerkt-platform

**Status:** vastgesteld vóór implementatie van de iOS-kandidaat-app.
**Bronwaarheid:** de bestaande webapp en server. De mobiele app volgt dit contract; de server beslist.
**Versie-strategie:** alle mobiele endpoints leven onder `/api/mobile/v1/`. Breaking changes → `/api/mobile/v2/`. De bestaande publieke read-API (`/api/public/v1/*`) blijft ongewijzigd en wordt door de app hergebruikt voor anonieme vacaturedata.

---

## 1. Uitgangspunten

1. **Geen duplicatie van businesslogica.** Matching, consent, uitnodigingen, plaatsingen, entitlements en limieten worden uitsluitend op de server beslist. De app toont de serveruitkomst (`MatchResult` incl. `summary`, `strengths`, `attentionPoints`, `opportunities`) en rekent nooit zelf scores uit.
2. **Bestaande servicelaag als enige toegang.** Elke mobiele route is een dunne wrapper over de bestaande services in `src/server/*` en `src/lib/*` (dezelfde code als de webapp): `saveProfileStep`, `activateProfile`, `matchesForCandidate`, `applyToVacancy`, `withdrawApplication`, `listInvitationsForCandidate`, `respondToInvitation`, `confirmInterview`, `listActiveConsents`, `revokeConsent`, `sendNotification`-voorkeuren, `gegevensOverzicht`, `verwijderAccount`.
3. **Canonieke waarden** komen uit `src/domain/taxonomy` en worden gedeeld via het pure TypeScript-pakket `packages/api-contract` (geen Prisma, geen server-imports). Web en mobiel importeren dezelfde literalen; contracttests bewijzen pariteit.
4. **Nooit in de app:** Prisma, databaseclients, server-only modules, Next.js Server Actions, service-rolecredentials, `SESSION_SECRET` of andere geheime environmentvariabelen.

## 2. Authenticatie (mobiel sessiemodel)

De webapp gebruikt een HttpOnly-cookie (`mz_session`, HMAC-getekend, stateless). Voor mobiel is een **intrekbaar** bearer-tokenmodel toegevoegd dat de webbeveiliging niet wijzigt:

- **Nieuw Prisma-model `MobileSession`**: per apparaat één sessie met `accessTokenHash`, `refreshTokenHash`, `previousRefreshTokenHash`, vervaltijden, `revokedAt`, apparaatnaam/platform.
- **Access-token** `mzm_at_<64 hex>`: opaak, alleen als sha256-hash opgeslagen, geldig **30 minuten**. Elk verzoek doet een DB-lookup → intrekking werkt per direct.
- **Refresh-token** `mzm_rt_<64 hex>`: opaak, gehasht opgeslagen, geldig **30 dagen**, **single-use met rotatie**. Hergebruik van een al geroteerd refresh-token (replay/diefstal-signaal) trekt de hele sessie in.
- **Opslag in de app:** uitsluitend `expo-secure-store` (iOS Keychain). **Nooit** AsyncStorage.
- **Transport:** `Authorization: Bearer mzm_at_…`. Geen cookies → geen CSRF-oppervlak; de bestaande `assertSameOrigin`-bescherming van cookie-endpoints blijft onaangetast.
- **Serverbrug:** `getSessionUser()` in `src/lib/auth.ts` accepteert naast de cookie ook een geldige mobiele access-token uit de `Authorization`-header. Daardoor werken `requireUser()`/`requireCandidate()` en álle bestaande services ongewijzigd; tenant- en eigendomscontroles blijven server-side afgedwongen.
- **Uitloggen:** trekt de sessie in (`revokedAt`) én verwijdert de pushtokens van die sessie. De app wist daarnaast alle lokale caches en SecureStore-items.
- **Rate limiting:** hergebruik van `src/lib/rate-limit.ts` met dezelfde sleutels als de webflows (`login:<email>`, `login-ip:<ip>`, `login-fail:<email>`, `register:<ip>`) plus `mobile-refresh:<sessionId>`.

### Endpoints

| Endpoint | Methode | Auth | Request | Response (200) |
|---|---|---|---|---|
| `/api/mobile/v1/auth/register` | POST | — (rate-limited) | `{ name, email, password, deviceName?, platform? }` | `{ user, tokens }` |
| `/api/mobile/v1/auth/login` | POST | — (rate-limited, lockout) | `{ email, password, deviceName?, platform? }` | `{ user, tokens }` |
| `/api/mobile/v1/auth/refresh` | POST | — | `{ refreshToken }` | `{ tokens }` — roteert beide tokens; replay → 401 + sessie ingetrokken |
| `/api/mobile/v1/auth/logout` | POST | Bearer | — | `{ ok: true }` — sessie ingetrokken, pushtokens van deze sessie verwijderd |
| `/api/mobile/v1/auth/sessions` | GET | Bearer | — | `{ sessions: [{ id, deviceName, platform, createdAt, lastSeenAt, current }] }` |
| `/api/mobile/v1/auth/sessions/:id` | DELETE | Bearer | — | `{ ok: true }` — andere eigen sessie intrekken |

`tokens` = `{ accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }` (ISO-tijden). `user` = `{ id, email, name }` (`isPlatformAdmin` wordt bewust niet naar mobiel gelekt).

Registratie gebeurt met `accountType: "kandidaat"`-semantiek (de mobiele app is uitsluitend kandidaatgericht; er wordt geen organisatie/membership aangemaakt).

## 3. Fout-envelope

Alle mobiele endpoints antwoorden bij fouten met:

```json
{ "error": { "code": "unauthorized|forbidden|not_found|conflict|rate_limited|invalid|revoked|gone|server_error", "message": "Nederlandstalige melding" } }
```

HTTP-status volgt de bestaande servicelaag (`AuthzError.status`): 400/401/403/404/409/410/429/500. `429` draagt `Retry-After` (seconden). De app toont `message` letterlijk en gebruikt `code` voor flowbeslissingen.

## 4. Openbare vacaturedata (zonder login)

Hergebruik van de bestaande publieke read-API — ongewijzigd contract (`src/server/public/read-models.ts`):

| Endpoint | Gebruik in app |
|---|---|
| `GET /api/public/v1/jobs?role&city&region&employmentType&page&pageSize` | Openbare vacaturezoeker. `PublicJobSearchResult { items, total, page, pageSize }` |
| `GET /api/public/v1/jobs/{idOrSlug}` | Vacaturedetail. 200 published · 410 closed (toon "niet meer beschikbaar") · 404 onbekend |
| `GET /api/public/v1/taxonomies` | Labels/sleutels voor filters (fallback; app bundelt dezelfde taxonomie) |

Rate limiting: 120/min per IP; ETag/304 en `Cache-Control: public, s-maxage=300` worden door de app gerespecteerd.

## 5. Kandidaat-endpoints (Bearer)

Alle onderstaande routes vereisen een geldige mobiele access-token; `userId` komt **uitsluitend** uit de sessie. `Cache-Control: no-store`.

### 5.1 Sessieherstel & profiel

| Endpoint | Methode | Service | Response |
|---|---|---|---|
| `/api/mobile/v1/me` | GET | `getOwnProfile()` | `{ user, profile: ProfileView \| null }` — `profile.status` stuurt de routering (draft → onboarding, active → app) |
| `/api/mobile/v1/profile` | GET | `getOwnProfile()` | `{ profile: ProfileView \| null }` |
| `/api/mobile/v1/profile/step` | PUT | `saveProfileStep(input)` | `{ profile: ProfileView }` — gedeeltelijke update; zelfde stapsemantiek als web-onboarding (`stepName`, alleen meegegeven velden overschrijven, arrays vervangen volledig) |
| `/api/mobile/v1/profile/activate` | POST | `activateProfile()` | `{ profile: ProfileView }` — zet status op `active` |

`ProfileView` = alle profielvelden zoals `CandidateProfile` (zonder `latitude/longitude`-precisie-afronding; datums als ISO-strings): `role`, `experienceLevel`, `postcode`, `maxTravelMinutes`, `hoursMin`, `hoursMax`, `contractTypes[]`, `availableFrom`, `salaryMin`, `salaryMax`, `revenueShareMin` (zzp-omzetpercentage, geheel getal 0–100), `availability` (7×3-matrix), `equipmentExperience[]` (scannerervaring), `equipmentWantsToWork[]`, `techniquesWantsToLearn[]`, `softwareSkills[]`, `specializations[]`, `treatmentInterests[]`, `preferredPopulation[]`, `mentorshipNeeded`, `developmentGoals[]`, `preferredPracticeSize`, `workPace`, `teamPreferences[]`, `visibility`, `completenessScore`, `status`.

Validatie server-side (zod): waarden moeten uit de canonieke lijsten komen (§8); `hoursMax >= hoursMin`; `revenueShareMin` 0–100; `postcode` NL-formaat.

### 5.2 Matches

| Endpoint | Methode | Service | Response |
|---|---|---|---|
| `/api/mobile/v1/matches` | GET | `matchesForCandidate(profile)` | `{ matches: MatchListItem[] }` — gesorteerd: eligible eerst, dan score aflopend |
| `/api/mobile/v1/matches/{vacancyId}` | GET | `computeMatchWithOpportunities` op één gepubliceerde vacature + bestaande sollicitatie/uitnodiging | `{ match: MatchDetail }` |

`MatchListItem` = `{ vacancyId, slug, title, role, organizationName, city, hoursMin, hoursMax, contractTypes, schedule, result }` waarbij `result` het **volledige** server-`MatchResult` is: `{ eligible, score, label, summary, hardMismatchReasons[], strengths[], attentionPoints[], categoryScores{availability, roleAndExperience, travel, employment, equipmentAndSoftware, specializations, workplacePreferences}, opportunities[], algorithmVersion }`. Elke reden: `{ code, category, message }` (Nederlandstalige uitleg door de server geformuleerd — de app toont die letterlijk; **uitlegbaarheid komt van de server**).

`MatchDetail` = `MatchListItem` + `{ description, culture[], mentorship, development[], flexibilityNote, salaryMin, salaryMax, revenueShareMax, startBy, startByHard, experienceLevel, criteria, location: { city, postcode }, application: { id, status, createdAt } | null, invitation: { id, status } | null }`.

### 5.3 Solliciteren & intrekken

| Endpoint | Methode | Service | Semantiek |
|---|---|---|---|
| `/api/mobile/v1/applications` | GET | `listApplicationsForCandidate()` | `{ applications: [{ id, status, motivation, createdAt, vacancy: { id, slug, title, city, organizationName, status }, snapshotScore, snapshotLabel }] }` |
| `/api/mobile/v1/applications` | POST | `applyToVacancy(vacancyId, motivation?)` | Body `{ vacancyId, motivation? (≤2000) }`. **Idempotentie:** dubbele sollicitatie → 409 `conflict` (bestaande unieke sleutel + P2002-vangnet); de app behandelt 409 na een time-out als "al gelukt" en herlaadt de lijst. Gesloten vacature → 404. Profiel niet actief → 403. Succes wordt **pas getoond na 201 van de server**. |
| `/api/mobile/v1/applications/{id}/withdraw` | POST | `withdrawApplication(id, feedback?)` | Body `{ reasonCode?, note? (≤500) }`. Afgeronde sollicitatie → 409. |

### 5.4 Uitnodigingen

| Endpoint | Methode | Service | Semantiek |
|---|---|---|---|
| `/api/mobile/v1/invitations` | GET | `listInvitationsForCandidate()` | `{ invitations: [{ id, status, message, createdAt, vacancy {…}, snapshotScore, snapshotLabel }] }` |
| `/api/mobile/v1/invitations/viewed` | POST | `markInvitationsViewed()` | `{ ok }` — idempotent |
| `/api/mobile/v1/invitations/{id}/respond` | POST | `respondToInvitation(id, …)` | Body `{ accepted: boolean, shareContact?: boolean, reasonCode?, note? }`. Alleen status `sent` kan beantwoord → anders 409 (`conflict`; verlopen/al beantwoord — ook bij twee apparaten tegelijk wint de eerste, de tweede krijgt 409). `shareContact: true` → server legt consent vast (`grantConsent`). |

### 5.5 Consent

| Endpoint | Methode | Service |
|---|---|---|
| `/api/mobile/v1/consents` | GET | `listActiveConsents(userId)` → `{ consents: [{ id, organizationId, organizationName, vacancyId, vacancyTitle, grantedAt }] }` |
| `/api/mobile/v1/consents/revoke` | POST | `revokeConsent(organizationId, vacancyId?)` → `{ ok }` (idempotent) |

### 5.6 Gesprekken (interviews)

| Endpoint | Methode | Service |
|---|---|---|
| `/api/mobile/v1/interviews` | GET | `listInterviewsForCandidate()` → `{ interviews: [{ id, status, slots: [{ startsAt, durationMinutes }], chosenSlot, message, vacancyId, vacancyTitle, organizationName, city }] }` |
| `/api/mobile/v1/interviews/{id}/confirm` | POST | `confirmInterview(id, chosenSlot)` — body `{ chosenSlot: ISO }`; ongeldig slot of al bevestigd/geannuleerd → 409/400 |

### 5.7 Notificaties

| Endpoint | Methode | Service |
|---|---|---|
| `/api/mobile/v1/notifications` | GET | `unreadCount` + `listNotifications` → `{ unreadCount, notifications: [{ id, type, title, body, href, readAt, createdAt }] }` — `href` is een webpad; de app mapt dit naar een intern scherm (§7) |
| `/api/mobile/v1/notifications/read-all` | POST | `markAllRead` → `{ ok }` |
| `/api/mobile/v1/notifications/preferences` | GET | `getPreferences` → `{ preferences: [{ type, inApp, email, push }] }` (typen: §8 `NOTIFICATION_TYPES` + `"all"`) |
| `/api/mobile/v1/notifications/preferences` | PUT | `setPreference` per type: body `{ type, inApp, email, push }` → `{ ok }` |

### 5.8 Push-tokens

Nieuw Prisma-model `MobilePushToken` `{ userId, sessionId, token @unique, platform, createdAt, updatedAt }`.

| Endpoint | Methode | Semantiek |
|---|---|---|
| `/api/mobile/v1/push-tokens` | POST | Body `{ token: ExpoPushToken, platform: "ios" }`. Upsert op token (rotatie: zelfde apparaat, nieuw token → oud token vervalt via sessionId-koppeling). Idempotent. |
| `/api/mobile/v1/push-tokens` | DELETE | Body `{ token }` — verwijdert het token (bij uitloggen roept de server dit ook zelf aan voor de sessie). |

Pushverzending zelf gebeurt server-side op de **bestaande** notificatie-events (`sendNotification`-laag; typen §8) en bevat **nooit** persoonsgegevens of kandidaatdata in de zichtbare tekst — alleen generieke titels ("Nieuwe uitnodiging") + deep-linkdata. Notificatievoorkeur `push` per type wordt gerespecteerd. Vanuit development/preview wordt niet naar echte gebruikers gestuurd (alleen `test`-omgevingstokens).

### 5.9 Privacy & account

| Endpoint | Methode | Service |
|---|---|---|
| `/api/mobile/v1/privacy/overview` | GET | `gegevensOverzicht(userId)` → `{ categories: [{ categorie, omschrijving, aantal }] }` |
| `/api/mobile/v1/account` | DELETE | Body `{ confirm: "verwijderen" }` → `verwijderAccount(userId)` (anonimisering in één transactie, `PrivacyRequest kind="verwijdering"`), alle mobiele sessies ingetrokken, pushtokens verwijderd → `{ ok }`. Zelfde semantiek als web (typwoord verplicht). |

## 6. Concurrency, offline en dubbele verzoeken

- **Server is idempotent of conflictbewust** op alle mutaties: unieke sleutels (sollicitatie, uitnodiging-antwoord alleen vanuit `sent`, consent-upsert, pushtoken-upsert, notificatie-dedupeKey) geven deterministisch 409/`ok` in plaats van dubbele records.
- **De app**: disable-on-tap, single-flight per mutatie, exponentiële retry **alleen** voor idempotente GET's en netwerk-/5xx-fouten, nooit automatische retry van niet-idempotente POST's na een onduidelijke uitkomst — dan eerst state herladen. Succes-UI uitsluitend na bevestigde 2xx.
- **Verouderde data:** 404/409/410 → app herlaadt de betreffende lijst en toont een rustige melding ("Deze vacature is niet meer beschikbaar").
- **Verlopen sessie:** 401 met code `unauthorized` → één refresh-poging; faalt die → lokale logout (tokens + caches wissen) en naar inlogscherm.

## 7. Deep links

Schema: `mondzorgwerkt://` (+ universal links later). Mapping van `Notification.href`-webpaden:

| Webpad (`href`) | App-scherm |
|---|---|
| `/kandidaat/uitnodigingen` | Uitnodigingen-tab |
| `/kandidaat/matches/{vacancyId}` | Matchdetail |
| `/kandidaat` | Matches-tab |
| overige/onbekend of content bestaat niet meer | veilige fallback: Matches-tab + melding |

## 8. Canonieke waarden (identiek aan `src/domain/taxonomy` en `src/server/pipeline.ts` — gedeeld via `packages/api-contract`)

- **Werkdagen** `WEEKDAYS`: `ma, di, wo, do, vr, za, zo`
- **Dagdelen** `DAYPARTS`: `ochtend, middag, avond`
- **Beschikbaarheidsniveau**: `preferred, available, unavailable`; vacatureroostereis: `required, preferred, null`
- **Functies** `ROLES`: `tandarts, mondhygienist, tandartsassistent, preventieassistent, orthodontieassistent, praktijkmanager`
- **Ervaring**: `starter, medior, senior`
- **Contractvormen** `CONTRACT_TYPES`: `loondienst, zzp, detachering, stage`
- **Scannerervaring/apparatuur** `EQUIPMENT`: `trios, cerec, primescan, itero, opg, cbct, microscoop, laser, airflow`
- **Software**: `exquise, simplex, evolution, oase, novadent, curve`
- **Specialisaties**: `parodontologie, endodontologie, implantologie, orthodontie, kindertandheelkunde, angstbegeleiding, esthetiek, prothetiek, gnathologie`
- **Behandelingen**: `periodieke_controle, restauratief, wortelkanaalbehandeling, extracties, gebitsreiniging, facings, kronen_bruggen, implantaten, beugelbehandeling`
- **Patiëntpopulatie**: `kinderen, volwassenen, ouderen, angstpatienten, medisch_gecompromitteerd`
- **Praktijkgrootte**: `klein, middel, groot, geen_voorkeur`; **werktempo**: `rustig, gemiddeld, hoog, geen_voorkeur`
- **Teamvoorkeuren**: `klein_team, groot_team, veel_overleg, zelfstandig_werken, jong_team, ervaren_team`
- **Uren**: `hoursMin`/`hoursMax` gehele uren per week; **reisafstand**: `maxTravelMinutes` (minuten); **startdatum**: `availableFrom` (ISO-datum of null); **zzp-omzetpercentage**: `revenueShareMin` (geheel %, 0–100); salaris in **eurocenten per maand**
- **Vacaturestatus** `VacancyStatus`: `draft, published, paused, filled, expired`
- **Sollicitatiestatus** `ApplicationStatus`: `submitted, in_review, interview, offered, hired, rejected, withdrawn`
- **Uitnodigingsstatus** `InvitationStatus`: `sent, accepted, declined, expired`
- **Gespreksstatus** `InterviewStatus`: `proposed, confirmed, declined, cancelled`
- **Consent**: scope `contact_details`; org-breed (`vacancyId null`) of per vacature; ingetrokken = `revokedAt` gezet
- **Pipeline** `PIPELINE_STATUSES`: `matched, invited, interested, applied, interview_proposed, interview_scheduled, offer, hired, declined, rejected, withdrawn`
- **Redencodes feedback** `FEEDBACK_REASON_CODES`: `dagen, reisafstand, uren, salaris_tarief, ervaring, apparatuur, specialisatie, cultuur, niet_beschikbaar, vacature_gewijzigd, anders`
- **Matchlabel**: `excellent (≥85), good (≥70), partial (≥50), low, ineligible`; categoriescores: `availability, roleAndExperience, travel, employment, equipmentAndSoftware, specializations, workplacePreferences`; `algorithmVersion` huidige actieve versie `"1.0.0"`
- **Notificatietypen** `NOTIFICATION_TYPES`: `invitation_received, invitation_interested, interview_proposed, interview_confirmed, no_response_reminder, vacancy_expiring, strong_match_found` (kandidaat-relevant: `invitation_received, interview_proposed, interview_confirmed, strong_match_found`)

## 9. Contracttests

- `tests/domain/mobile-contract.test.ts` (server-vitest): bewijst dat `packages/api-contract` letterlijk dezelfde canonieke waarden bevat als `src/domain/taxonomy`, `src/lib/notifications.ts` en `src/server/pipeline.ts`, en dat de mobiele response-mappers (`src/server/mobile/views.ts`) een payload opleveren die aan het gedeelde contract-type voldoet.
- `apps/mobile/src/__tests__/contract.test.ts` (jest-expo): parseert voorbeeldpayloads (fixtures gedeeld met de servertests) met de mobiele decoders en bewijst identieke interpretatie van datums, enums en de 7×3-beschikbaarheidsmatrix.
