# User journey contracts — Mondzorgwerkt

Per kernflow: beginpunt → objectief eindresultaat (datamutatie) → herstelpad →
bewijs. "Bewijs" verwijst naar de tests die de flow raken (`tests/**`, `e2e/**`).

## Kandidaatreizen

| Flow | Beginpunt | Eindresultaat (mutatie) | Herstel | Bewijs |
|---|---|---|---|---|
| Publieke vacatures bekijken/zoeken/filteren | `/vacatures` (GET-filters, werkt zonder JS) | — (leesflow, echte data) | refresh; lege staat behoudt filters | `public-api.test`, `visueel-publiek` |
| Vacaturedetail | `/vacatures/[slug]` | — (gesloten = vervuld-staat, geen JobPosting) | 404 → not-found | `public-api.test` |
| Registreren/inloggen | `/registreren`, `/inloggen` | User (+profiel/org), sessie-cookie | form-fout behoudt invoer; rate-limit | `kritieke-flow`, `security.test` |
| Onboarding (hervatten) | `/kandidaat/onboarding` | CandidateProfile draft→active, per stap opgeslagen | data uit DB na refresh (positie P3) | `kritieke-flow` |
| Profiel invullen (werkdagen/dagdelen, uren, startdatum, reisafstand, scanner, specialisaties, contractvoorkeur, beschikbaarheid) | `/kandidaat/profiel` | CandidateProfile-velden + completenessScore | per sectie opslaan | `kritieke-flow` |
| Matches bekijken + uitleg | `/kandidaat` | — (score + strengths/attention uit dezelfde berekening) | empty-state | `matching.test` |
| Uitnodiging ontvangen → interesse/afwijzen → consent | `/kandidaat/uitnodigingen` | Invitation accepted/declined, CandidateConsent, journaal | verlopen → 410; race-veilig | `pipeline.test` |
| Gesprek plannen/bevestigen | `/kandidaat/uitnodigingen` (GesprekBlok) | Interview confirmed + gekozen slot | status-guard 409 | `pipeline.test` |
| Status volgen | `/kandidaat/uitnodigingen` | — | — | `pipeline.test` |
| Notificatievoorkeuren | `/instellingen/notificaties` | NotificationPreference | `?opgeslagen=1` na server | `notificaties.test` |

## Praktijkreizen

| Flow | Beginpunt | Eindresultaat (mutatie) | Herstel | Bewijs |
|---|---|---|---|---|
| Registratie + praktijk aanmaken/aansluiten | `/praktijk/start`, `/praktijk/nieuw` | Organization + PracticeLocation + Subscription (trial) | onboardingState hervat | `commercieel.test`, `multilocation.test` |
| Praktijkgegevens/bezettingsbehoefte | `/praktijk/[slug]/bezetting` | TeamMember/TeamAbsence, StaffingScenario | simulatie vs bevestigd | `capacity.test` |
| Vacature als concept → publiceren | `/praktijk/[slug]/vacatures/nieuw` | Vacancy draft→published; **wizardstand overleeft refresh (sessionStorage), geen dubbele concepten** | concept blijft; paywall bij limiet | `kritieke-flow` |
| Matchbaarheidsinzichten (radar-preview) | wizard stap 4 | — (teaser + rapport) | opnieuw laden per stap | `kritieke-flow` |
| Gekwalificeerde matches / Match Studio (simulatie) | `/praktijk/[slug]/vacatures/[id]/studio` | simulatie is efemeer (nooit stil opgeslagen); criteria opslaan expliciet | herstelOrigineel; race-safe volgnummer | `kritieke-flow`, `matching.test` |
| Talent Radar | `/praktijk/[slug]/radar` | — (entitlement-gated, paywall) | link naar abonnement | `market.test` |
| Kandidaat uitnodigen → consent afwachten | dashboard/studio | Invitation (expiresAt +30d), maandlimiet geteld | limiet 402 | `pipeline.test`, `commercieel.test` |
| Pipelinefase wijzigen / afwijzen met reden / plaatsing | `/praktijk/[slug]/pipeline` | Application-status (race-veilig), journaal, MatchDecisionFeedback, `candidate_hired`/`vacancy_filled` (één keer) | 409 bij gelijktijdige wijziging | `pipeline.test`, `hired-events.test` |
| Bezettingsplanner bijwerken | `/praktijk/[slug]/bezetting` | StaffingScenario → conceptvacature/uitnodigingenlijst | verwerp/bevestig | `capacity.test` |
| Trial / paywall / checkout (upgrade/downgrade/opzeggen/heractiveren, add-ons) | `/praktijk/[slug]/abonnement` | Subscription/SubscriptionItem (checkout idempotent, webhook-volgorde bewaakt) | bevestigingsstap; heractiveren | `commercieel.test`, `entitlements.test` |
| Team & locaties (binnen entitlements) | `/praktijk/[slug]/team` | Membership/PracticeLocation (limiet-gated) | {ok/fout} + upgradeHint | `multilocation.test`, `authz.test` |

## Beheer (platform-admin)

| Flow | Beginpunt | Eindresultaat | Bewijs |
|---|---|---|---|
| KPI/health/monitor/matching (schaduw) | `/intern/**` | leesflows; "onvoldoende data" i.p.v. nepgetal; `runShadowBatch` schrijft alleen ShadowMatchScore | `kpi*.test`, `health.test`, `shadow-matching.test` |
| Outbox | `/intern/outbox` | — (dev-outbox van e-mails) | `notificaties.test` |

## Publiek/AVG

| Flow | Beginpunt | Eindresultaat | Bewijs |
|---|---|---|---|
| Inzage/export/verwijderen | `/instellingen/privacy` (+ `/export`) | JSON-export eigen data; tweestaps verwijdering met anonimisering (transactie) | `privacy.test` |
| Consent intrekken | `/instellingen/privacy` | CandidateConsent revoked; naamweergave direct afgesneden op leestijd | `privacy.test` |

## Contractregels die overal gelden
- Publieke laag: alleen gepubliceerde vacatures in lijsten; gesloten wél per slug; praktijken alleen mét consent; locaties nooit exacter dan stad + PC4; nooit kandidaatdata.
- Tenantisolatie: elke org-actie via `getOrgForUserBySlug(slug, capability)`; API-key-verzoeken gescoped op de org van de sleutel + `api_access`-entitlement.
- Determinisme: dezelfde invoer geeft dezelfde geschiktheid/score/uitleg (engine puur, geen `Date.now()`/`Math.random()`).
