# Statusmachine-referentie — pipeline, consent, billing

## Invitation (`InvitationStatus`)

| Huidige | Actie | Actor | Volgende | Side-effects | Afdwinging |
|---|---|---|---|---|---|
| (geen) | `inviteCandidate` | praktijk (`candidate.invite`) | `sent` (upsert, `expiresAt = nu+30d`) | snapshot; journaal `matched→invited` (alleen nieuw); notificatie (dedupe); `recordUsage`; evt. `proposeInterview`; analytics `candidate_invited` | org-scope; profielcheck; maandlimiet |
| `sent` (niet verlopen) | `respondToInvitation(accepted)` | kandidaat (eigenaar) | `accepted` | journaal `interested`; evt. `grantConsent`; notificatie praktijk; analytics | eigenaarscheck; status-guard 409 |
| `sent` (niet verlopen) | `respondToInvitation(!accepted)` | kandidaat | `declined` | journaal `declined`; evt. feedback; analytics | idem |
| `sent` (verlopen) | `respondToInvitation` | kandidaat | `expired` | — (geweigerd, **410**) | `expiresAt < nu` |
| `accepted`/`declined`/`expired` | opnieuw | kandidaat | — (409) | — | status-guard |

`expiresAt` wordt verlengd bij een heruitnodiging. Pipelinelabel: `expired`
(niet langer misleidend `invited`).

## Application (`ApplicationStatus`)

| Huidige | Actie | Actor | Volgende | Side-effects |
|---|---|---|---|---|
| (geen) | `applyToVacancy` | kandidaat (actief profiel) | `submitted` | snapshot; journaal `applied`; analytics; audit |
| niet-eind | `updateApplicationStatus` / `setPipelineStatus` | praktijk (`pipeline.manage`) | doelstatus (**race-veilig**: conditionele update vanuit ingelezen status, anders 409) | journaal (alleen bij echte overgang); `rejected`+feedback → MatchDecisionFeedback; `interview` → analytics; `hired` → `candidate_hired`; audit |
| niet-eind | `withdrawApplication` | kandidaat (eigenaar) | `withdrawn` | journaal; evt. feedback (race-veilig) |
| eind (`hired`/`rejected`/`withdrawn`) | withdraw/wijzig | — | — (409) | — |

`hired` + gepubliceerde vacature → `markFilled` (de énige emitter van
`vacancy_filled`, guard op werkelijke overgang → precies één keer per plaatsing).

## Interview (`InterviewStatus`)

| Huidige | Actie | Actor | Volgende | Side-effects |
|---|---|---|---|---|
| (geen) | `proposeInterview` | praktijk | `proposed` | slot-validatie; journaal `interview_proposed`; notificatie (dedupe) |
| `proposed` | `confirmInterview` | kandidaat (eigenaar) | `confirmed` (+chosenSlot) | journaal `interview_scheduled`; notificatie | status-guard 409 |

Restpunt (P2): tijdzone-weergave en overlapcontrole van gesprekken.

## Consent (`CandidateConsent`)
`grantConsent` bij accepteren (met `shareContact`); `revokeConsent` snijdt
naamweergave direct af op leestijd (queries filteren `revokedAt: null`).
Sollicitanten tonen hun naam bewust altijd. Restpunt (P2): geen consentversie
vastgelegd.

## Subscription (`SubscriptionStatus`)

| Huidige | Gebeurtenis | Volgende | Regels |
|---|---|---|---|
| (geen) | `startSubscription` | `trialing`/`active` | **hooguit één niet-geannuleerd abonnement per org** (partiële unieke index); dubbele checkout → idempotent |
| `trialing` | trial verloopt (lazy) | `trial_expired` (effectief) | entitlements vergrendeld |
| actief | `payment_failed` (nieuwer dan laatste) | `past_due` + `graceUntil` | binnen grace: coulance |
| `past_due` | `payment_succeeded` (nieuwer) | `active` | grace gewist; nieuwe periode |
| elke | ouder event (`occurredAt ≤ lastBillingEventAt`) | **ongewijzigd** | out-of-order genegeerd |
| actief | `changePlan` (upgrade) | `active` nieuw plan | direct |
| actief | `schedulePlanChange` (downgrade) | gepland per periode-einde | `applyScheduledChanges` (idempotent) |
| actief | `cancelSubscription` | `canceled` / `cancelAtPeriodEnd` | — |
| `canceled`/opgezegd | `reactivateSubscription` | actief | idempotent |

Journaal `PipelineStatusChange.toStatus` (vrije tekst, `PIPELINE_STATUSES`):
`matched, invited, interested, applied, interview_proposed, interview_scheduled,
offer, hired, declined, rejected, withdrawn, expired`.
