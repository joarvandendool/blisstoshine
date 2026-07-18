// Stabiele analytics-eventnamen en het payloadcontract (envelope).
// Pure domeinmodule: geen imports van buiten src/domain/** (Zod is een
// pure validatiebibliotheek en daarom toegestaan).
//
// Privacyregel: events bevatten uitsluitend pseudoniemen (cuid's) en
// categorische context — nooit namen, e-mailadressen of telefoonnummers.
// De envelope dwingt dit af.

import { z } from "zod";

// ---------- eventnamen ----------

/** Kandidaatfunnel: van onboarding tot aangenomen. */
export const CANDIDATE_FUNNEL_EVENTS = [
  "onboarding_started",
  "onboarding_step_completed",
  "candidate_profile_completed",
  "candidate_profile_activated",
  "match_viewed",
  "application_started",
  "application_submitted",
  "interview_scheduled",
  "candidate_hired",
] as const;

/** Praktijkfunnel: van organisatie-aanmaak tot vervulde vacature en abonnement. */
export const PRACTICE_FUNNEL_EVENTS = [
  "organization_created",
  "location_created",
  "vacancy_started",
  "vacancy_published",
  "talent_radar_viewed",
  "match_simulation_run",
  "opportunity_viewed",
  "candidate_invited",
  "interview_scheduled",
  "vacancy_filled",
  "subscription_started",
  "subscription_upgraded",
  "subscription_downgraded",
  "subscription_cancelled",
] as const;

export type CandidateFunnelEvent = (typeof CANDIDATE_FUNNEL_EVENTS)[number];
export type PracticeFunnelEvent = (typeof PRACTICE_FUNNEL_EVENTS)[number];

/** Alle geldige eventnamen (union van beide funnels). */
export type AnalyticsEventName = CandidateFunnelEvent | PracticeFunnelEvent;

/**
 * Alle eventnamen, gededupliceerd (interview_scheduled komt in beide funnels
 * voor en telt één keer). Volgorde: kandidaatfunnel, dan praktijkfunnel.
 */
export const ANALYTICS_EVENTS: readonly AnalyticsEventName[] = Object.freeze(
  Array.from(
    new Set<AnalyticsEventName>([
      ...CANDIDATE_FUNNEL_EVENTS,
      ...PRACTICE_FUNNEL_EVENTS,
    ]),
  ),
);

const EVENT_NAME_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENTS);

/** Type guard: is deze waarde een geldige, bekende eventnaam? */
export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && EVENT_NAME_SET.has(value);
}

// ---------- envelope ----------

const eventNameSchema = z.enum(
  [...ANALYTICS_EVENTS] as [AnalyticsEventName, ...AnalyticsEventName[]],
  { errorMap: () => ({ message: "Onbekende analytics-eventnaam" }) },
);

/**
 * Contextwaarden zijn uitsluitend primitief — daarmee is de context maximaal
 * één niveau diep (geen geneste objecten of arrays).
 */
const contextValueSchema = z.union(
  [z.string(), z.number(), z.boolean(), z.null()],
  {
    errorMap: () => ({
      message:
        "Contextwaarden mogen alleen primitief zijn (string, getal, boolean of null) — context is maximaal één niveau diep",
    }),
  },
);

/**
 * Sleutels die op persoonsgegevens lijken (e-mail, naam, telefoon — inclusief
 * Engelse varianten en samenstellingen als userEmail of achternaam) worden
 * geweigerd: analytics-context is nooit de plek voor persoonsgegevens.
 */
const FORBIDDEN_CONTEXT_KEY_PATTERN = /(e[-_]?mail|naam|name|telefoon|phone)/i;

const contextSchema = z.record(contextValueSchema).refine(
  (context) =>
    Object.keys(context).every(
      (key) => !FORBIDDEN_CONTEXT_KEY_PATTERN.test(key),
    ),
  {
    message:
      "Context mag geen persoonsgegevens bevatten: sleutels die op e-mail, naam of telefoon duiden zijn niet toegestaan",
  },
);

/**
 * De envelope waarin elk analytics-event wordt vastgelegd. Strikt: onbekende
 * velden worden geweigerd zodat er nooit ongecontroleerde (persoons)gegevens
 * meeliften. `candidateId` is een pseudoniem (profiel-cuid), geen naam of
 * e-mailadres.
 */
export const AnalyticsEnvelopeSchema = z
  .object({
    name: eventNameSchema,
    organizationId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    plan: z.string().min(1).optional(),
    acquisitionSource: z.string().min(1).optional(),
    context: contextSchema.optional(),
    timestamp: z.coerce.date({
      errorMap: () => ({ message: "Ongeldige timestamp" }),
    }).optional(),
  })
  .strict();

export type AnalyticsEnvelope = z.infer<typeof AnalyticsEnvelopeSchema>;
