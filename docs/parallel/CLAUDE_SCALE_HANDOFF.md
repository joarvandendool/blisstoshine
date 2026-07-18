# Workstream A — Claude scale-core: handoff

Levend document voor de parallelle samenwerking met Codex (Workstream B:
visuele identiteit, publieke pagina's, SEO). Wordt bijgewerkt gedurende de
werkstroom en afgerond bij oplevering.

## Basis

- **Basis-SHA (checkpoint private beta):** `e5aa19de1c99ee69306ac5a545b723eb0681e4ba`
  (branch `claude/repo-cleanup-repurpose-rqbb60`, Vercel-preview READY,
  lint/typecheck/157 unit- en integratietests/12 e2e-tests/build groen)
- **Werkbranch:** `claude/scale-core` (vanaf de basis-SHA)
- **Geen merge naar `main`, geen productiepromotie** vanuit deze werkstroom.

## Eigendomsverdeling

Claude (deze werkstroom): Prisma-schema en migraties, Postgres/Supabase-logica,
domeinservices, matching- en opportunity-engine, billing/abonnementen/
entitlements, organisaties en multi-location, account health, bezettingslogica,
private API's, autorisatie, privacy/consent, analyticsberekeningen, publieke
read-model-API's (`/api/public/v1/*`), webhooks/integratie, productiehardening,
due-diligencedocumentatie.

Codex (niet aanraken vanuit deze werkstroom): publieke marketingpagina's,
visuele brandcomponents, globale art direction, MatchShape-visuals,
moodboardassets, publieke vacaturelayout, robots.txt, sitemap-UI,
JSON-LD-presentatie, visuele regressietests.

## Gedeelde bestanden — wijzigingslog

| Bestand | Wijziging | Reden | Integratie-impact |
|---------|-----------|-------|-------------------|
| `.gitignore` | `.exports/` toegevoegd | CSV-exportjobs (fase 9) schrijven tijdelijke bestanden naar `.exports/<orgId>/<jobId>.csv` | Geen — alleen ignore-regel; geen code geraakt |
| `next.config.mjs` | `headers()` toegevoegd met security headers (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS, pragmatische CSP met `script-src 'self' 'unsafe-inline'`) | Productiehardening fase 10: clickjacking/MIME-sniffing/externe scriptinjectie weren | Headers gelden voor ÁLLE routes, ook Codex' publieke pagina's. Externe scripts/styles/fonts/afbeeldingen worden door de CSP geblokkeerd — externe assets moeten self-hosted of als data-URI; inline scripts en styles blijven werken |

## Publieke API-contracten voor Codex

Worden gedocumenteerd in `docs/parallel/PUBLIC_READ_MODEL.md` (fase 8).

## Status

- [x] Branch aangemaakt vanaf basis-SHA
- [x] Fase 1: audit (`SCALE_AUDIT.md`)
- [x] Fase 2: bezettingsplanner voor wekelijks gebruik
- [x] Fase 3: multi-location
- [x] Fase 4: subscriptions en expansion revenue
- [x] Fase 5: account health
- [x] Fase 6: Arbeidsmarkt Monitor
- [x] Fase 7: matching v2 shadow mode
- [x] Fase 8: publieke read models
- [x] Fase 9: integratiearchitectuur
- [x] Fase 10: productiehardening
- [x] Fase 11: financiële meetbaarheid
- [x] Fase 12: due-diligencedocumentatie
- [x] Slotronde: consent-intrekken-UI op `/instellingen/privacy` (sectie
  "Gedeelde gegevens", server action → `revokeConsent`) + volledige
  eindverificatie (zie hieronder)

## Eind-SHA, migraties, envs, testresultaten, risico's

### Eind-SHA

- **Eind-SHA (laatste inhoudelijke commit):**
  `4f84499c9869d064a38ec5120e6aa1e0d02d1e3c`
  ("Fase 12: due-diligencedocumentatie"). De slotcommit van de
  eindverificatieronde (consent-UI + documentbijwerkingen, dit document
  incluis) volgt daar direct op als bovenste commit van `claude/scale-core`.

### Commits (basis `e5aa19d` → eind, oudste eerst)

```
e0405d0 Workstream A: branch scale-core met handoff-document (basis-SHA vastgelegd)
1cba0ab Fase 1: SCALE_AUDIT.md — auditbevindingen en 15 geprioriteerde verbeteringen
d399ceb Schemabasis Workstream A: scenario's, health, monitor, shadow scores, API-sleutels, webhooks, privacy, rate limiting
4bd5893 Kritieke security-fixes uit de audit (top 3)
30befe1 Fase 4+5: uitbreidbare subscriptions en uitlegbaar account health
4ba5ce9 Fase 6+7: Arbeidsmarkt Monitor en matching v2 in schaduwmodus
0ff539d Fase 8+9: publieke read models voor Codex en integratiearchitectuur
389bd63 Fase 2+3: bezetting voor wekelijks gebruik en volwaardig multi-location
c8dcee2 Navigatie voor team/inzichten/integraties en interne secties + lintfix
a111121 Fase 11: financiële SaaS-metrics centraal, getest en eerlijk
0d553c5 Fase 10: productiehardening — headers, CSRF, AVG-flows, retentie, indexen
4f84499 Fase 12: due-diligencedocumentatie (11 documenten, conform de code)
(+ slotcommit eindverificatie, direct hierop volgend)
```

### Migraties (`prisma/migrations/`)

1. `20260718164248_init`
2. `20260718201800_private_beta`
3. `20260718210000_zzp_omzetpercentage`
4. `20260718230000_scale_core`
5. `20260719000000_hardening_indexes`

### Environmentvariabelen (zie `DEPLOYMENT.md`)

| Variabele | Status | Doel |
|---|---|---|
| `SESSION_SECRET` | **Verplicht vóór echte livegang** (≥ 32 tekens, `openssl rand -hex 32`); zonder valt de app terug op een van de database-URL afgeleid geheim + waarschuwing | HMAC-sessietokens |
| `PLATFORM_ADMIN_EMAIL` | **Verplicht** voor de platformbeheerder (eenmalige bootstrap bij registratie met exact dit adres) | Admin-bootstrap |
| `SESSION_PEPPER` | Optioneel | Verzwaart de terugvalmodus van het sessiegeheim |
| `ADMIN_PASSWORD` | Optioneel (alleen bij bewust seeden van demo-data) | Wachtwoord beheerdersaccount in de seed |
| `SEED_FORCE` | Optioneel (`=1` als bewuste override) | Seed-guard: `db:seed` weigert op `APP_ENV=production` |
| `APP_ENV` | Optioneel (`dev`/`test`/`production`; lokaal `dev` in `.env`) | Omgevingsgedrag en seed-guard |

### Testresultaten eindverificatie (18 juli 2026, lokaal)

| Check | Resultaat |
|---|---|
| `npm run lint` | groen (0 warnings/errors) |
| `npm run typecheck` | groen |
| `npx vitest run` | **311/311** tests groen (21 bestanden) |
| `npm run db:seed` 2× | groen, idempotent (identieke uitkomst) |
| `npm run build` | groen (prisma generate + migrate deploy + next build) |
| `npx playwright test --project=desktop` | **12/12** e2e-tests groen (productieserver op poort 3100, incl. CSP/security headers) |

Aanvullend runtime geverifieerd: de nieuwe consent-intrekken-flow op
`/instellingen/privacy` (inloggen → rij zichtbaar met organisatienaam +
vacaturetitel + datum → bevestigingsstap → intrekken → `revokedAt` gezet +
`consent.revoke`-auditregel + nette lege staat).

### Bekende risico's

Volledige, eerlijke lijst: `docs/due-diligence/KNOWN_RISKS.md`. Top 3:

1. **Gesimuleerde betalingen** — alleen `LocalTestBillingProvider`; Stripe is
   een gedocumenteerd aansluitpunt, geen implementatie.
2. **E-mail-outbox zonder verzending** — alles blijft als `OutboxEmail`-rij
   staan; wie niet inlogt mist uitnodigingen (grootste retentierisico).
3. **Sessiegeheim-terugval** — zonder `SESSION_SECRET` wordt het HMAC-geheim
   afgeleid van de database-URL; zet deze vóór livegang.

### Integratie-instructies voor Codex

- **Contract:** bouw publieke pagina's uitsluitend op
  `docs/parallel/PUBLIC_READ_MODEL.md` (`/api/public/v1/*`; id's/slugs
  permanent, velden alleen additief, nooit kandidaatdata).
- **CSP-waarschuwing:** de security headers in `next.config.mjs` gelden voor
  álle routes. Externe scripts/styles/fonts/afbeeldingen worden geblokkeerd —
  assets self-hosted opnemen of als data-URI; inline scripts/styles werken.
- **Eigendomsgrenzen:** Codex raakt geen Prisma-schema, domeinservices,
  private API's, authz of billing aan; Claude raakt geen publieke
  marketingpagina's, brandcomponents, robots.txt/sitemap-UI of
  JSON-LD-presentatie aan (zie "Eigendomsverdeling" hierboven).

### Vercel-preview

De branchalias voor `claude/scale-core` wordt na push zichtbaar; de preview
wordt door het hoofdproces geverifieerd.

### Bewust uitgesteld (geen omissies)

- Stripe-productie-integratie (incl. webhooks/dunning)
- E-mailprovider (outbox → daadwerkelijke verzending)
- Cron-scheduler (retentie, downgrades, webhook-bezorging, expiry, reminders)
- Nonce-gebaseerde CSP (nu pragmatisch `script-src 'self' 'unsafe-inline'`)
- WebKit/mobiel-e2e (Playwright-project "mobiel"; alleen Chromium-desktop
  draait in deze omgeving)
