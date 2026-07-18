# Publieke read models & integratie-API — contract voor Codex

Fase 8 + 9 van Workstream A (Claude). Dit document is het contract waarop
Workstream B (Codex) de publieke vacature- en praktijkpagina's bouwt.

- **Basis-URL:** `/api/public/v1`
- **Broncode:** types en mappers in `src/server/public/read-models.ts`,
  queries in `src/server/public/queries.ts`, routes onder `app/api/public/v1/`.
- **Autorisatie:** de publieke endpoints (§2) vereisen **geen** authenticatie.
  De org-endpoints (§7) vereisen een Bearer-API-sleutel.
- **Privacy:** er is **nooit** kandidaatdata bereikbaar via de publieke
  endpoints — geen namen, e-mailadressen, telefoonnummers, sollicitaties of
  profielvelden. Locaties zijn bewust grof: stad, provincie en alleen de
  eerste vier cijfers van de postcode (PC4).

## 1. Stabiliteitsgaranties

1. **Identifiers wijzigen nooit.** `id` (cuid) en `slug` van een vacature en
   de `slug` van een organisatie zijn permanent. Een vacature-slug wordt bij
   de eerste publicatie toegekend (`titel-stad-hash`, bv.
   `mondhygienist-3-dagen-utrecht-a1b2c3`) en verandert daarna nooit meer —
   ook niet wanneer de titel wijzigt. Bestaande gepubliceerde vacatures
   zonder slug krijgen er lazily één zodra ze via de API worden opgevraagd.
2. **Velden zijn alleen additief.** Bestaande velden veranderen niet van naam,
   type of betekenis; nieuwe velden kunnen erbij komen. Bouw parsers dus
   tolerant voor onbekende velden.
3. **Taxonomiesleutels zijn stabiel** (opslagwaarden); labels zijn Nederlandse
   presentatie en kunnen verbeterd worden.
4. **Alleen gepubliceerde data.** Concepten bestaan publiek niet (404). Een
   ooit gepubliceerde vacature die vervuld/verlopen/gepauzeerd is, blijft
   opvraagbaar met `status: "closed"` (HTTP 410) zodat oude links netjes
   kunnen landen.

## 2. Publieke endpoints

| Endpoint | Beschrijving |
|---|---|
| `GET /api/public/v1/jobs` | Gepubliceerde vacatures, gefilterd + gepagineerd |
| `GET /api/public/v1/jobs/[idOrSlug]` | Eén vacature op slug of ID |
| `GET /api/public/v1/practices/[slug]` | Publieke praktijkweergave |
| `GET /api/public/v1/taxonomies` | Alle taxonomiegroepen (key + label) |
| `GET /api/public/v1/market-insights` | Geaggregeerde, privacyveilige marktcijfers |

### Cachinggedrag (alle publieke endpoints)

- **`Cache-Control: public, s-maxage=300, stale-while-revalidate=600`** —
  CDN-cache van 5 minuten met stale-while-revalidate.
- **`ETag`** — sterke ETag (sha1 van de exacte JSON-payload). Stuur
  `If-None-Match: <etag>` mee; ongewijzigde data geeft **304 Not Modified**
  zonder body.
- Foutresponses zijn `no-store`.

### Rate limiting

Publieke endpoints: **120 verzoeken per minuut per IP** (fixed window).
Daarboven: HTTP 429 met `Retry-After: 60`.

### Foutvorm

Alle fouten hebben dezelfde vorm:

```json
{ "error": { "code": "not_found", "message": "Deze vacature bestaat niet." } }
```

| HTTP | `code` | Betekenis |
|---|---|---|
| 400 | `invalid_request` | Ongeldige queryparameters |
| 401 | `unauthorized` | (org-API) sleutel ontbreekt of is ongeldig |
| 401 | `key_revoked` | (org-API) sleutel is ingetrokken |
| 403 | `insufficient_scope` | (org-API) sleutel mist de vereiste scope |
| 404 | `not_found` | Onbekende resource (of concept-vacature) |
| 410 | — | Gesloten vacature: body is de `PublicJobView` met `status: "closed"` |
| 429 | `rate_limited` | Rate limit overschreden |
| 500 | `internal_error` | Onverwachte fout |

## 3. `GET /jobs` — vacaturelijst

Queryparameters (allemaal optioneel):

| Parameter | Type | Betekenis |
|---|---|---|
| `role` | string | Taxonomie-functiesleutel, bv. `mondhygienist` |
| `city` | string | Plaatsnaam, hoofdletterongevoelig exact, bv. `Utrecht` |
| `region` | string | Provincie (afgeleid van de stad), bv. `Zuid-Holland` |
| `employmentType` | string | Contractvorm: `loondienst` \| `zzp` \| `detachering` \| `stage` |
| `updated_since` | ISO 8601 | Alleen vacatures bijgewerkt op/na dit moment (incrementele sync) |
| `page` | int ≥ 1 | Pagina, standaard 1 |
| `pageSize` | int 1–50 | Paginagrootte, standaard 20, maximum 50 |

Sortering: **`datePosted` aflopend** (nieuwste eerst). Response
(`PublicJobSearchResult`):

```json
{
  "items": [
    {
      "id": "cmd1x…",
      "slug": "mondhygienist-3-dagen-utrecht-a1b2c3",
      "canonicalUrl": "/vacatures/mondhygienist-3-dagen-utrecht-a1b2c3",
      "title": "Mondhygiënist 3 dagen",
      "role": { "key": "mondhygienist", "label": "Mondhygiënist" },
      "organization": { "name": "Praktijk Alfa", "slug": "praktijk-alfa" },
      "location": { "city": "Utrecht", "region": "Utrecht", "postcode4": "3511" },
      "hoursMin": 16,
      "hoursMax": 24,
      "employmentTypes": ["loondienst"],
      "salary": { "minCents": 320000, "maxCents": 400000, "period": "month" },
      "datePosted": "2026-07-01T09:00:00.000Z",
      "updatedAt": "2026-07-10T14:30:00.000Z",
      "status": "published"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

## 4. `GET /jobs/[idOrSlug]` — vacaturedetail

Accepteert de slug **of** het interne ID. Antwoorden:

- **200** — gepubliceerde vacature, volledige `PublicJobView` (hieronder);
- **410** — ooit gepubliceerd, inmiddels gesloten (filled/expired/paused):
  zelfde JSON-vorm met `status: "closed"` — toon een "vacature gesloten"-
  pagina met doorverwijzing;
- **404** — onbekend, concept of nooit gepubliceerd.

### `PublicJobView` — veldbeschrijving

| Veld | Type | Betekenis |
|---|---|---|
| `id` | string | Stabiel intern ID (cuid); wijzigt nooit |
| `slug` | string | Stabiele publieke slug; wijzigt nooit na toekenning |
| `canonicalUrl` | string | Pad op de publieke site: `/vacatures/[slug]` (alleen het pad; de pagina zelf is van Codex) |
| `title` | string | Vacaturetitel |
| `role` | `{key, label}` | Functie als taxonomiewaarde |
| `organization` | `{name, slug}` | Praktijknaam + organisatie-slug (voor `/practices/[slug]`) |
| `location` | `{city, region, postcode4}` | Stad, provincie en PC4 (**alleen 4 cijfers** — privacy); `postcode4` kan `null` zijn |
| `description` | string \| null | Vrije omschrijving |
| `responsibilities` | string[] | Werkzaamheden, afgeleid van de gevraagde behandeltypen (Nederlandse labels) |
| `requirements` | `{label, level}[]` | Eisen/wensen: registraties + minimaal ervaringsniveau; `level`: `required` \| `preferred` \| `informational` |
| `availability` | `{day, dayparts, level}[]` | Gevraagde werkdagen; `day`: `ma`–`zo`, `dayparts`: `ochtend`/`middag`/`avond`, `level`: `required` \| `preferred` |
| `hoursMin` / `hoursMax` | number? | Uren per week (afwezig = niet gespecificeerd) |
| `employmentTypes` | string[] | Contractvormen (taxonomiesleutels) |
| `salary` | `{minCents, maxCents, period}`? | Salarisindicatie bij loondienst; bedragen in **eurocenten**, `period` is altijd `"month"`; afwezig indien niet opgegeven |
| `revenueShare` | `{maxPercent}`? | **Zzp = omzetpercentage!** Maximaal geboden percentage van de omzet (geheel getal 0–100); behandelaren op zzp-basis werken met een omzetdeel, niet met een uurtarief. Afwezig indien niet opgegeven |
| `equipment` | `{key, label}[]` | Apparatuur uit de vacaturecriteria |
| `software` | `{key, label}[]` | Praktijksoftware uit de vacaturecriteria |
| `specializations` | `{key, label}[]` | Specialisaties uit de vacaturecriteria |
| `datePosted` | ISO 8601 | Publicatiedatum |
| `validThrough` | ISO 8601? | Sluitingsdatum; afwezig wanneer geen einddatum is gezet |
| `status` | `"published"` \| `"closed"` | Open of gesloten |
| `directApply` | `true` | Solliciteren gebeurt direct op het platform (JSON-LD `directApply`) |
| `updatedAt` | ISO 8601 | Laatste wijziging (voor incrementele sync) |

## 5. `GET /practices/[slug]` — praktijkweergave

`PublicPracticeView`:

| Veld | Type | Betekenis |
|---|---|---|
| `slug` | string | Stabiele organisatie-slug |
| `name` | string | Praktijknaam |
| `city` | string | Stad van de (hoofd)locatie |
| `region` | string | Provincie (afgeleid van de stad) |
| `treatmentRooms` | number | Aantal behandelkamers van de (hoofd)locatie |
| `traits` | `{key, label}[]` | Praktijkkenmerken (cultuur) |
| `equipment` | `{key, label}[]` | Aanwezige apparatuur |
| `software` | `{key, label}[]` | Gebruikte software |
| `specializations` | `{key, label}[]` | Specialisaties |
| `openJobs` | number | Aantal op dit moment gepubliceerde vacatures |

Geen adres, geen coördinaten, geen volledige postcode, geen leden of
kandidaten. 404 voor onbekende of niet-actieve organisaties.

## 6. `GET /taxonomies` en `GET /market-insights`

**`/taxonomies`** (`PublicTaxonomyView`) geeft alle taxonomiegroepen:

```json
{
  "groups": [
    {
      "key": "roles",
      "label": "Functies",
      "values": [{ "key": "tandarts", "label": "Tandarts" }, …]
    },
    …
  ]
}
```

Groepen: `roles`, `experienceLevels`, `contractTypes`, `registrations`,
`equipment`, `software`, `specializations`, `treatments`,
`patientPopulation`, `culture`, `development`, `practiceSizes`, `workPaces`,
`teamPreferences`, `weekdays`, `dayparts`.

**`/market-insights`** (`PublicMarketInsightView`) geeft uitsluitend
geaggregeerde cijfers met **minimumgroepsgrootte 5** (`minGroupSize`);
kleinere groepen worden nooit getoond. Bron: de `MarketInsightSnapshot`-cache
(fase 6) van de meest recente periode; zolang die leeg is een compacte live
aggregatie (`open_vacatures_per_functie`, `open_vacatures_per_regio`).

```json
{
  "period": "2026-07",
  "generatedAt": "2026-07-18T12:00:00.000Z",
  "minGroupSize": 5,
  "insights": [
    {
      "view": "open_vacatures_per_functie",
      "dimension": "mondhygienist",
      "sampleSize": 12,
      "data": { "openVacancies": 12 }
    }
  ]
}
```

## 7. Private integratie-API (`/api/public/v1/org/*`) — fase 9

Voor praktijken die hun eigen systemen koppelen. **Niet** voor de publieke
site. Vereist een API-sleutel; alle data is gescoped op de organisatie van
de sleutel — data van een andere organisatie is onbereikbaar.

### Authenticatie

```
Authorization: Bearer mzw_live_<40 hex tekens>
```

- Sleutels worden beheerd op `/praktijk/[slug]/integraties` (capability
  `org.manage`, entitlement `api_access`).
- De volledige sleutel wordt **één keer** getoond; opgeslagen wordt alleen
  een sha256-hash. Rotatie maakt een nieuwe sleutel en trekt de oude direct
  in; intrekken blokkeert per direct.
- Rate limit: 300 verzoeken per minuut per sleutel (429 daarboven).
- Aanmaak, rotatie en intrekking worden geauditlogd.

### Scopes en endpoints

| Endpoint | Scope | Inhoud |
|---|---|---|
| `GET /org/vacancies` | `jobs:read` | Alle eigen vacatures (incl. concepten): id, slug, title, role, status, city, uren, contractvormen, publishedAt, updatedAt |
| `GET /org/applications` | `pipeline:read` | Sollicitaties op eigen vacatures; **kandidaatnaam alleen bij actieve consent** (anders `name: null`, wel pseudoniem `candidate.id` + `consent: false`) |
| `GET /org/interviews` | `pipeline:read` | Gesprekken op eigen vacatures (kandidaat alleen als pseudoniem ID) |
| `GET /org/placements` | `pipeline:read` | Aangenomen kandidaten (status hired); naamregel als bij applications |
| `GET /org/capacity-gaps` | `capacity:read` | Dagdelen per locatie waar de gewenste minimale bezetting nu niet wordt gehaald |
| — | `webhooks:manage` | Gereserveerd voor toekomstig webhook-beheer via de API |

Alle org-endpoints zijn read-only en idempotent; responses zijn `no-store`
(nooit gecachet). Alle antwoorden hebben de vorm `{ "items": [...] }`.

## 8. Webhooks

Beheer op `/praktijk/[slug]/integraties`: URL + eventkeuze; het
**signing-secret wordt één keer getoond**.

**Events** (stabiele namen): `vacancy.published`, `application.created`,
`interview.confirmed`, `placement.created`, `staffing_gap.detected`.

**Request** (POST, JSON):

```json
{
  "event": "vacancy.published",
  "idempotencyKey": "<org>:<event>:<payloadhash>:<subscription>",
  "occurredAt": "2026-07-18T12:00:00.000Z",
  "data": { "vacancyId": "…", "slug": "…", "title": "…", "role": "…", "city": "…", "publishedAt": "…" }
}
```

Headers: `X-Mzw-Event`, `X-Mzw-Timestamp` (Unix-seconden),
`X-Mzw-Signature`, `X-Mzw-Idempotency-Key`.

**Signature-verificatie** (ontvangerskant):

1. Neem de **rauwe** request-body als string.
2. Bereken `hex(hmac-sha256(secret, "<X-Mzw-Timestamp>.<body>"))`.
3. Vergelijk timing-safe met `X-Mzw-Signature`.
4. Wijs verzoeken af waarvan de timestamp meer dan 5 minuten afwijkt (replay-
   bescherming).
5. Dedupliceer op `idempotencyKey` — hetzelfde event kan bij retries vaker
   aankomen.

**Bezorging & retries:** antwoord met 2xx binnen 10 seconden. Bij een fout
volgt exponentiële backoff (1m → 5m → 30m → 2u → 12u); na 5 mislukte
pogingen gaat de delivery naar de dead-letter-status `dead` (zichtbaar op de
integratiepagina). In deze release verwerkt een **beheerde server action**
op de integratiepagina de deliveries (`attemptDeliveries()` in
`src/lib/webhooks.ts`); **in productie hoort een cron/queue deze functie
elke minuut aan te roepen.**

## 9. Exports

Op de integratiepagina: type kiezen (`vacatures` | `pipeline` | `bezetting`)
→ `ExportJob` (pending) → synchrone verwerking → CSV onder
`.exports/<orgId>/<jobId>.csv` (gitignored, tijdelijk pad) → download in de
browser. Kandidaatnamen staan alleen in een export bij actieve consent.

## 10. Voor de JSON-LD van Codex

`PublicJobView` is bewust dicht op schema.org/JobPosting gemodelleerd:
`title`, `description`, `datePosted`, `validThrough`, `directApply`,
`employmentTypes`, salaris (`salary`, eurocenten per maand) →
`baseSalary`, `location` → `jobLocation` (stad/provincie/PC4),
`organization` → `hiringOrganization`. Voor zzp-vacatures is er **geen**
uurtarief: gebruik `revenueShare.maxPercent` (omzetpercentage) in de
beschrijvende tekst, niet in `baseSalary`.
