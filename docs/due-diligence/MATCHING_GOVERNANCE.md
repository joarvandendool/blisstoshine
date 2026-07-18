# Matching-governance

De matching-engine is het kernactief van het platform. Governance-principes:
deterministisch, geversioneerd, uitlegbaar, en géén stille wijzigingen —
elke beslissing is achteraf herleidbaar tot algoritmeversie + invoer.

## Actieve versie: v1 (1.0.0)

Engine: `src/domain/matching/engine.ts` (pure domeinmodule, geen DB/React,
geen `Date.now()`/`Math.random()` — determinisme getest in
`tests/domain/matching.test.ts`, "robuustheid en determinisme").

### Gewichten (sommeren tot 1) — `src/domain/matching/config.ts`

| Categorie | Gewicht |
|---|---|
| Beschikbaarheid (dagen/dagdelen) | 0,35 |
| Functie en ervaring | 0,15 |
| Reistijd | 0,15 |
| Dienstverband (uren 60% / contractvorm 40%) | 0,10 |
| Apparatuur en software (incl. ontwikkelmatch) | 0,10 |
| Specialisaties | 0,10 |
| Werkplekvoorkeuren | 0,05 |

Labelgrenzen: excellent ≥ 85, good ≥ 70, partial ≥ 50, anders low. Ontbrekende
gegevens geven de neutrale score 60 — de engine crasht nooit op onvolledige
profielen.

### Harde regels (ineligible, ongeacht score)

`verzamelHardeMismatches()` (`src/domain/matching/engine.ts:509`):

1. verkeerde functie (`functie_ongelijk`);
2. ontbrekende verplichte registratie/bevoegdheid
   (`verplichte_registratie_ontbreekt`);
3. geen overlap met een verplicht dagdeel
   (`verplicht_dagdeel_geen_overlap`);
4. geen gemeenschappelijke contractvorm
   (`geen_gemeenschappelijke_contractvorm`);
5. kandidaat pas beschikbaar ná een harde uiterste startdatum
   (`startdatum_te_laat`).

Elke harde mismatch heeft een stabiele code en Nederlandse uitleg; getest in
`tests/domain/matching.test.ts` ("harde mismatches").

## Versionering en herleidbaarheid

- `ALGORITHM_VERSION` (semver, nu "1.0.0") wijzigt mee met elke inhoudelijke
  aanpassing; de volledige configuratie is als één object (`MATCHING_CONFIG`)
  exporteerbaar en wordt geversioneerd opgeslagen in de tabel
  `MatchingConfigVersion` (`prisma/schema.prisma:456`; geschreven door de
  seed).
- **MatchSnapshot** (`prisma/schema.prisma:251`): op elk beslismoment
  (uitnodiging, sollicitatie, simulatie) wordt score, label,
  `algorithmVersion`, het volledige `MatchResult` én de bepalende profiel- en
  vacaturegegevens vastgelegd (`saveMatchSnapshot`,
  `src/server/matching.ts:421`). Een score van vorig jaar is daarmee exact
  reconstrueerbaar, ook na profiel- of algoritmwijzigingen.

## v2-schaduwproces

- **v2 (2.0.0-shadow)** staat in `src/domain/matching/v2.ts` en draait
  uitsluitend náást v1; geen enkele zichtbare score komt uit v2. De vier
  afwijkingen (zachtere reistijdcurve tot 160%, zwaardere weging van
  preferred-dagdelen, ontwikkelmatch-met-begeleiding 0,85 i.p.v. 0,80,
  werkplekvoorkeuren alleen bij data aan beide kanten) zijn in de bestandskop
  onderbouwd op feedbackpraktijk.
- **Eligibility-garantie per constructie:** v2 hergebruikt letterlijk de
  hard-mismatch-uitkomst van v1 (`src/domain/matching/v2.ts:10-13`) — een
  kandidaat is in v2 eligible dan en slechts dan als in v1. Regressiedetectie
  in beide richtingen bestaat desondanks als vangnet
  (`hardMismatchRegressions`, `src/domain/matching-eval/index.ts`; getest in
  `tests/domain/matching-eval.test.ts`).
- **Schaduwruns** (`src/server/shadow-matching.ts`) scoren v1 én v2 over
  dezelfde pool en schrijven alleen `ShadowMatchScore`-rijen met een
  verklaard verschil per categorie; herhaalde runs zijn idempotent-achtig.
  Alleen bereikbaar via `/intern` na `requirePlatformAdmin()`. Getest in
  `tests/integration/shadow-matching.test.ts` ("schaduwrun schrijft scores
  zonder zichtbare data te wijzigen", "tweede run is idempotent-achtig",
  "vergelijking en regressierapportage").
- **Evaluatie**: `src/domain/matching-eval` berekent precision@top-5,
  acceptatie-, gespreks- en plaatsingsratio's en uitlegbaarheid per versie,
  segmenteerbaar per functie en regio, met minimumsteekproef 5 (geen
  schijnprecisie).

## Promotie- en rollbackbeleid

- **Promotie** van v2 naar actief kan uitsluitend via een expliciete
  codewijziging van de actieve engine (`src/domain/matching/engine.ts` +
  ophogen `ALGORITHM_VERSION`) en de servicelaag; de schaduwmodule bevat
  bewust géén promotiepad (`src/server/shadow-matching.ts:6-10`). Een
  promotie is daarmee altijd een reviewbare, geversioneerde deploy —
  bestaande snapshots behouden hun oude versienummer.
- **Rollback** van het schaduwproces is niets doen: schaduwrijen zijn
  vrijblijvend en kunnen worden weggegooid. Rollback van een gepromoveerde
  versie = de vorige engineversie terugzetten via een nieuwe deploy; oude
  resultaten blijven verklaarbaar dankzij MatchSnapshot + versienummer.

## Feedbackdata-governance

`MatchDecisionFeedback` (`prisma/schema.prisma:524`) legt gestructureerde
redenen vast bij afwijzingen/intrekkingen (vaste redencodes: dagen,
reisafstand, uren, salaris_tarief, ervaring, apparatuur, specialisatie,
cultuur, niet_beschikbaar, vacature_gewijzigd, anders). Het schema zegt het
expliciet: **"Verandert nooit automatisch individuele scores."** Feedback
voedt uitsluitend (1) geaggregeerde inzichten met minimumgroepsgrootte 5
(`src/server/feedback-insights.ts`) en (2) de menselijke onderbouwing van
v2-regelwijzigingen (`src/domain/matching/v2.ts:21`). Er is geen online
learning, geen automatische hertraining en geen per-kandidaat-aanpassing —
elke gedragswijziging van de matching loopt via een geversioneerde
codewijziging.
