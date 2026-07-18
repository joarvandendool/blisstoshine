# Privacy

Mondzorgwerkt verwerkt persoonsgegevens van kandidaten (zorgprofessionals) en
praktijkgebruikers. Dit document beschrijft het consentmodel, de
anonimisering, de privacydrempels bij aggregaties, de stand van de AVG-flows
en — expliciet — wat er bewust niet wordt verzameld en wat er nog ontbreekt.

## Consentmodel

Kern: **zonder expliciete toestemming ziet een praktijk nooit naam of
contactgegevens van een kandidaat.**

- Zichtbaarheid per profiel: `visible` (naam zichtbaar bij match),
  `anonymous` (standaard: alleen geanonimiseerd profiel) of `hidden`
  (onvindbaar; alleen zelf solliciteren) — `prisma/schema.prisma`
  (`ProfileVisibility`), toegepast in `src/server/matching.ts:45-60`.
- **CandidateConsent**: expliciete, vastgelegde toestemming per organisatie,
  optioneel beperkt tot één vacature, scope `contact_details`
  (`prisma/schema.prisma:509`). Verlenen gebeurt bij "interesse tonen" op een
  uitnodiging met een expliciete keuze in de UI
  (`app/kandidaat/(app)/uitnodigingen/actions.ts`); een sollicitatie geldt als
  bewust delen. Herverlenen na intrekking activeert de bestaande rij opnieuw
  (`grantConsent`, `src/server/pipeline.ts:294`).
- Consent is vacature-/organisatiegebonden: toestemming bij vacature A geeft
  géén naam bij vacature B van een andere locatie — getest in
  `tests/integration/multilocation.test.ts` ("consent voor vacature A geeft
  geen naam bij vacature B").
- Intrekken bestaat in de servicelaag (`revokeConsent`,
  `src/server/pipeline.ts:333`, met audit- en analyticsregel). Een
  kandidaat-UI om verleende consents in te zien of in te trekken is op het
  moment van schrijven **niet aanwezig in `app/**`** (geen aanroep van
  `revokeConsent` buiten de servicelaag); `docs/OPERATIONS.md` §3 kondigt
  deze aan op de uitnodigingenpagina — verifieer bij oplevering van de
  hardening-fase.

## Anonimisering in het product

- Anonieme kandidaten krijgen een functionele omschrijving in plaats van hun
  naam ("Mondhygiënist uit Utrecht") — `src/server/matching.ts:5-7,45`.
- Pipeline-notities worden geschoond van e-mailadressen en telefoonnummers
  vóór opslag (`src/server/pipeline.ts:135`); getest in
  `tests/integration/pipeline.test.ts` ("afwijzen met redencode en
  opgeschoonde note"). Kanttekening: `Application.motivation`,
  `Invitation.message` en `Interview.message` worden **niet** geschoond
  (`SCALE_AUDIT.md` §5.5).
- Analytics: de envelope accepteert alleen platte, primitieve context en
  weigert sleutels die op persoonsgegevens duiden (e-mail/naam/telefoon,
  regex in `src/domain/analytics/events.ts`, `FORBIDDEN_CONTEXT_KEY_PATTERN`);
  `candidateId` is een pseudoniem (profiel-cuid), nooit naam of e-mail.

## Privacydrempels bij aggregaties

Overal waar over kandidaten wordt geaggregeerd geldt een minimumgroepsgrootte
van **5**, hard afgedwongen in domeinlogica (niet alleen in de UI):

| Plek | Drempel | Bron |
|---|---|---|
| Talent Radar en bezetting | `TALENT_RADAR_MIN_GROUP = 5` | `src/lib/config.ts:45` |
| Arbeidsmarkt Monitor | celonderdrukking (< 5 → null), weigering van kruistabellen > 2 dimensies (throw), geen vrije tekst in feiten, afronding tegen schijnprecisie | `src/domain/market/aggregate.ts` |
| Feedbackinzichten | groepen < 5 weggelaten | `src/server/feedback-insights.ts:14` |
| Matching-evaluatie | `EVAL_MIN_SAMPLE = 5`, anders "onvoldoende data" | `src/domain/matching-eval/index.ts:15` |

Getest in `tests/domain/market.test.ts` ("celonderdrukking
(minimumgroepsgrootte)", "weigering van risicovolle combinaties") en
`tests/integration/authz.test.ts` ("Talent Radar maskeert aantallen onder de
privacydrempel"). De publieke API bevat nooit kandidaatdata en toont locaties
grof (stad/provincie/PC4) — `docs/parallel/PUBLIC_READ_MODEL.md`,
getest in `tests/integration/public-api.test.ts`.

## Wat er bewust NIET wordt verzameld

- Geen bijzondere of gevoelige persoonsgegevens (gezondheid, afkomst,
  leeftijd, geslacht) — de matching-invoertypen en de berekening bevatten
  uitsluitend werkgerelateerde gegevens; expliciet vastgelegd in
  `src/domain/matching/v2.ts:15-19` en geldend voor v1.
- Geen tracking-cookies of externe analytics: events gaan server-side naar de
  eigen `AnalyticsEvent`-tabel via een allowlist (`/api/events` accepteert
  alleen bekende eventnamen; `SCALE_AUDIT.md` §1).
- Geen cv-uploads of vrije-tekstprofielen: profielen bestaan uit
  taxonomiesleutels en gestructureerde velden (`prisma/schema.prisma`,
  `CandidateProfile`).
- Geen persoonsgegevens in analytics-context (afgedwongen door schema, zie
  hierboven).

## AVG-flows: huidige stand

De hardening-fase (fase 10) heeft de AVG-zelfbediening toegevoegd:
`/instellingen/privacy` (UI: `app/instellingen/privacy/page.tsx`,
export-download: `app/instellingen/privacy/export/route.ts`) op de
servicelaag `src/server/privacy.ts`. Elke privacy-actie wordt vastgelegd in
`PrivacyRequest` én `AuditLog`.

| Recht (AVG) | Stand |
|---|---|
| Inzage (art. 15) | **Geïmplementeerd**: categorie-overzicht van eigen gegevens (`gegevensOverzicht`, `src/server/privacy.ts:61`). |
| Export/dataportabiliteit (art. 15/20) | **Geïmplementeerd**: JSON-download met uitsluitend eigen gegevens — nooit gegevens van derden (`exporteerEigenGegevens`, `src/server/privacy.ts:124`). Organisaties hebben daarnaast CSV-export via `ExportJob` (`src/server/integrations.ts:318`). |
| Verwijdering (art. 17) | **Geïmplementeerd als directe anonimisering** in één transactie (`verwijderAccount`, `src/server/privacy.ts:278`): naam/e-mail geanonimiseerd, wachtwoordhash onbruikbaar geroteerd, kandidaatprofiel hard verwijderd, consents en memberships ingetrokken, notificaties en outbox-mail gewist, sessie uitgelogd. **Bewuste afweging**: `MatchSnapshot`, `PipelineStatusChange`, `MatchDecisionFeedback` en `AuditLog` blijven bestaan als geanonimiseerde bedrijfsadministratie (geschillen, misbruikdetectie, KPI-integriteit) — na anonimisering verwijzen ze alleen naar een user-id zonder naam/e-mail/profiel. Kanttekening: `MatchSnapshot.profileData` behoudt profielgegevens van het matchmoment (geen naam/e-mail, wel bv. postcode/beschikbaarheid); een striktere scrub-stap is een benoemde vervolgkeuze (`docs/OPERATIONS.md` §3). |
| Intrekken toestemming (art. 7) | Servicelaag klaar (`revokeConsent`); kandidaat-UI op moment van schrijven niet gevonden in `app/**` (zie consentmodel hierboven). |
| Verwerkingsregister / DPA's | Niet in de codebase; procespunt buiten scope van deze repo. |

## Bewaartermijnen

Bewaartermijnen zijn gedefinieerd als geëxporteerde constanten in
`src/server/privacy.ts` (één bron van waarheid) en uitvoerbaar via
`scripts/retention.mjs` (droogloop standaard; `--apply` ruimt echt op, met
auditregel):

| Data | Termijn |
|---|---|
| `AnalyticsEvent` | 24 maanden |
| `Notification` | 6 maanden |
| `OutboxEmail` (verzonden) | 3 maanden |
| `RateLimitCounter` | 7 dagen |
| Inactieve draft-kandidaatprofielen | 18 maanden (anonimisering) |

Kanttekeningen: er is **geen scheduler** die het retentiescript periodiek
draait (aanbevolen: dagelijkse cron, `docs/OPERATIONS.md` §7), en
`AuditLog`, `MatchSnapshot` en `PipelineStatusChange` hebben bewust géén
termijn (bedrijfsadministratie, zie hierboven). De outbox toont e-mailinhoud
aan platform-admins (`/intern/outbox`); verzonden mail wordt na 3 maanden
opgeruimd, niet-verzonden (pending) mail heeft geen termijn.

## Datalek

Zie DISASTER_RECOVERY.md voor de procedure inclusief het 72-uurs-meldpunt
(meldplicht datalekken, Autoriteit Persoonsgegevens).
