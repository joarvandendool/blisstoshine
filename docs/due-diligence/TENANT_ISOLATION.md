# Tenantisolatie

Mondzorgwerkt is multi-tenant: elke praktijkorganisatie (`Organization`) is
een tenant in één gedeelde database. Isolatie wordt **server-side in de
servicelaag** afgedwongen, niet in de database (geen row-level security) en
nooit op basis van client-input.

## Het OrgContext-patroon

Kern: `src/lib/authz.ts`.

1. Een route of server action roept `requireMembership(organizationId,
   capability?, locationId?)` aan. Die verifieert dat de ingelogde gebruiker
   (uit de sessiecookie, nooit uit de request-body) een **actief membership**
   bij die organisatie heeft, en optioneel de gevraagde capability bezit
   (`src/lib/authz.ts:90-110`).
2. Het resultaat is een `OrgContext` — `{ user, organizationId, role,
   locationIds }` (`src/lib/authz.ts:22-32`). Alle organisatieservices in
   `src/server/**` accepteren **uitsluitend** dit object; er bestaat geen
   servicepad dat een organisatie-ID rechtstreeks van de client accepteert.
3. Elke query filtert op `ctx.organizationId`. Entiteiten van een andere
   organisatie zijn daardoor onvindbaar en geven een 404/AuthzError — bv. de
   org-gescopede vacature-lookup in `src/server/matching.ts` (`eigenVacature`)
   en locatie-lookup in `src/server/vacancies.ts`.

IDOR-bescherming volgt uit hetzelfde patroon: `locationId`/`vacancyId` uit de
client worden altijd opgezocht bínnen de organisatiescope van de context; de
audit vond geen endpoint dat client-input als organisatie-ID vertrouwt
(`SCALE_AUDIT.md` §4.8).

## Locatiegebonden rechten

Sinds de multi-location-fase kan een membership beperkt zijn tot specifieke
locaties: `Membership.locationIds` (leeg = alle locaties van de organisatie,
`prisma/schema.prisma:113`).

- `requireMembership(…, locationId)` weigert (403) wanneer het membership de
  locatie niet dekt (`src/lib/authz.ts:106`).
- Services filteren lijstqueries op `allowedLocationIds(ctx)` en controleren
  losse locaties met `assertLocationAllowed(ctx, locationId)`
  (`src/lib/authz.ts:117-127`); voorbeeld: de vacature-lookup in
  `src/server/matching.ts:103`.
- Cross-locatiematching (één kandidatenpool over locaties heen) is bovendien
  een **entitlement**: `enforceEntitlement(ctx.organizationId,
  "cross_location_matching")` (`src/server/matching.ts:268`), alleen aan in
  het multi-locatieplan (`src/domain/entitlements/catalog.ts`).

## Platformlaag

Modules die per definitie over tenants heen kijken (intern KPI-dashboard,
account health, marktmonitor, schaduwmatching, feedbackinzichten) zijn
afgeschermd met `requirePlatformAdmin()` — afgedwongen in de `/intern`-layout
én per pagina (defense-in-depth), en als expliciete afspraak vastgelegd in de
modulekoppen (bv. `src/server/shadow-matching.ts:12-16`,
`src/server/account-health.ts:9-12`).

## Kandidaten als aparte scope

Kandidaten zijn geen tenantleden: `requireCandidate()` levert uitsluitend het
eigen profiel (`src/lib/authz.ts:145`). Wat praktijken van kandidaten zien
loopt via het privacymodel (zichtbaarheid + consent, zie PRIVACY.md), nooit
via direct profieltoegang.

## Welke tests bewijzen dit

| Testbestand | Relevante tests |
|---|---|
| `tests/integration/authz.test.ts` | "gebruiker van organisatie A krijgt geen toegang tot organisatie B"; "vacatures van organisatie B zijn niet leesbaar met een A-context"; "kandidatenpool van een B-vacature is niet opvraagbaar met een A-context"; "zonder ingelogde sessie is er geen toegang"; rolbeperkingen ("viewer kan geen vacature publiceren", "recruiter kan geen billing wijzigen", "owner mag billing wél beheren"); kandidaatprivacy ("anonieme kandidaten tonen geen naam; verborgen kandidaten ontbreken") |
| `tests/integration/multilocation.test.ts` | "een lokale gebruiker (locationIds=[A]) ziet locatie B niet — bezetting én team"; "een centrale gebruiker ziet alles binnen de eigen org, maar niets van een andere org"; "billing_manager heeft billing.manage maar geen kandidaatgerelateerde capabilities"; cross-locatiematching "werkt met de entitlement (multi_location-plan)" / "wordt geweigerd zonder entitlement (trialplan, EntitlementError 402)"; "consent voor vacature A geeft geen naam bij vacature B (andere locatie)" |
| `tests/integration/capacity.test.ts` | eigen "tenantisolatie"-blok voor de bezettingsplanner |
| `tests/integration/pipeline.test.ts` | "(e) tenantisolatie" voor pipeline-acties |
| `tests/integration/public-api.test.ts` | org-endpoints zijn alleen met een sleutel van de juiste organisatie leesbaar ("org-endpoints (API-sleutels en scopes)") |

## Beperkingen

- Isolatie is applicatief: een bug in een service zou hem kunnen omzeilen.
  Er is geen Postgres row-level security als tweede verdedigingslinie; de
  compenserende maatregel is de brede integratietestdekking hierboven plus
  het vaste patroon (services zonder `ctx` bestaan niet voor tenantdata).
- De integratie-API isoleert per API-sleutel op organisatieniveau
  (`ApiKey.organizationId`, `src/lib/api-auth.ts:154`); scopes verfijnen dat
  per datasoort, niet per locatie.
