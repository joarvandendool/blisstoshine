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
- [ ] Fase 1: audit (`SCALE_AUDIT.md`)
- [ ] Fase 2: bezettingsplanner voor wekelijks gebruik
- [ ] Fase 3: multi-location
- [ ] Fase 4: subscriptions en expansion revenue
- [ ] Fase 5: account health
- [ ] Fase 6: Arbeidsmarkt Monitor
- [ ] Fase 7: matching v2 shadow mode
- [ ] Fase 8: publieke read models
- [ ] Fase 9: integratiearchitectuur
- [ ] Fase 10: productiehardening
- [ ] Fase 11: financiële meetbaarheid
- [ ] Fase 12: due-diligencedocumentatie

## Eind-SHA, migraties, envs, testresultaten, risico's

Wordt ingevuld bij afronding van de werkstroom.
