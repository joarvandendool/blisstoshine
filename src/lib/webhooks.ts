// Uitgaande webhooks (fase 9): subscriptions per organisatie, HMAC-signing,
// idempotente deliveries en bezorging met exponentiële backoff.
//
// Bezorgmodel:
// - dispatchEvent() schrijft per actieve subscription één WebhookDelivery-rij
//   (status pending) met een idempotencyKey van organisatie + event +
//   payload-hash (+ subscription) — hetzelfde event met dezelfde payload
//   levert dus nooit een tweede rij op;
// - attemptDeliveries() verwerkt pending/failed rijen waarvan nextAttemptAt
//   is verstreken. Mislukt een poging, dan schuift de volgende poging op
//   volgens BACKOFF_MINUTEN (1m → 5m → 30m → 2u → 12u); na MAX_ATTEMPTS
//   pogingen gaat de delivery naar status "dead" (dead-letter).
// - In deze release wordt attemptDeliveries() aangeroepen via een beheerde
//   server action op de integratiepagina; in productie hoort dit in een
//   cron/queue (bv. elke minuut). Zie docs/parallel/PUBLIC_READ_MODEL.md.
//
// Signing (documentatie voor ontvangers):
//   X-Mzw-Timestamp: Unix-seconden van het verzendmoment
//   X-Mzw-Signature: hex(hmac-sha256(secret, `${timestamp}.${body}`))
// Verificatie: bereken dezelfde HMAC over `${X-Mzw-Timestamp}.${rauwe body}`
// met het subscription-secret en vergelijk timing-safe met X-Mzw-Signature.
// Wijs verzoeken af waarvan de timestamp meer dan 5 minuten afwijkt (replay).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type WebhookDelivery, type WebhookSubscription } from "@prisma/client";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Alle uitgaande webhook-events. Namen zijn stabiel (contract). */
export const WEBHOOK_EVENTS = [
  "vacancy.published",
  "application.created",
  "interview.confirmed",
  "placement.created",
  "staffing_gap.detected",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(waarde: unknown): waarde is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(waarde as string);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface CreatedWebhookSubscription {
  subscription: WebhookSubscription;
  /** Het signing-secret — alleen op dit moment beschikbaar, daarna nooit meer. */
  secret: string;
}

/**
 * Maakt een webhook-subscription voor een organisatie aan. Het secret wordt
 * hier gegenereerd en één keer teruggegeven; bewaar het aan de ontvangende
 * kant. Autorisatie (capability/entitlement) hoort bij de aanroeper
 * (src/server/integrations.ts) — dit is de infrastructuurlaag.
 */
export async function subscribeWebhook(
  organizationId: string,
  url: string,
  events: WebhookEvent[],
): Promise<CreatedWebhookSubscription> {
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const subscription = await prisma.webhookSubscription.create({
    data: { organizationId, url, secret, events },
  });
  return { subscription, secret };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/** hex(hmac-sha256(secret, `${timestamp}.${body}`)) — inhoud van X-Mzw-Signature. */
export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Timing-safe verificatie van een ontvangen signature (voor ontvangers/tests). */
export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
): boolean {
  const verwacht = Buffer.from(signWebhookBody(secret, timestamp, body), "hex");
  let gekregen: Buffer;
  try {
    gekregen = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return verwacht.length === gekregen.length && timingSafeEqual(verwacht, gekregen);
}

// ---------------------------------------------------------------------------
// Dispatch (deliveries aanmaken)
// ---------------------------------------------------------------------------

/** Deterministische hash van de payload voor de idempotencyKey. */
function payloadHash(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

/**
 * Schrijft voor elke actieve subscription van de organisatie die op dit event
 * is geabonneerd een pending WebhookDelivery. Idempotent: de unieke
 * idempotencyKey (org + event + payload-hash + subscription) voorkomt dubbele
 * rijen bij herhaalde dispatch met dezelfde payload. Faalt zacht (geeft 0
 * terug bij databasefouten): een kapotte webhook mag nooit een productflow
 * breken. Geeft het aantal nieuw aangemaakte deliveries terug.
 */
export async function dispatchEvent(
  organizationId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<number> {
  try {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { organizationId, active: true, events: { has: event } },
    });
    const hash = payloadHash(payload);

    let aangemaakt = 0;
    for (const subscription of subscriptions) {
      const idempotencyKey = `${organizationId}:${event}:${hash}:${subscription.id}`;
      try {
        await prisma.webhookDelivery.create({
          data: {
            subscriptionId: subscription.id,
            event,
            payload: payload as Prisma.InputJsonValue,
            idempotencyKey,
            status: "pending",
            nextAttemptAt: new Date(),
          },
        });
        aangemaakt += 1;
      } catch (fout) {
        if (
          fout instanceof Prisma.PrismaClientKnownRequestError &&
          fout.code === "P2002"
        ) {
          continue; // al eerder gedispatcht onder deze idempotencyKey
        }
        throw fout;
      }
    }
    return aangemaakt;
  } catch (fout) {
    console.error(`Webhook-dispatch mislukt (${event}):`, fout);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Bezorging met backoff
// ---------------------------------------------------------------------------

/** Wachttijd vóór poging n+1, geïndexeerd op het aantal gedane pogingen. */
const BACKOFF_MINUTEN = [1, 5, 30, 120, 720] as const; // 1m, 5m, 30m, 2u, 12u

/** Na dit aantal mislukte pogingen gaat een delivery naar "dead". */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface AttemptDeliveriesOptions {
  /** "Nu" voor venster- en backoff-berekening (tests). */
  now?: Date;
  /** Alternatieve fetch-implementatie (tests); standaard globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Maximaal aantal deliveries per run. */
  batchSize?: number;
}

export interface AttemptDeliveriesResult {
  processed: number;
  delivered: number;
  failed: number;
  dead: number;
}

/**
 * Verwerkt bezorgbare deliveries (status pending/failed met verstreken
 * nextAttemptAt): POST naar de subscription-URL met JSON-body
 * `{ event, idempotencyKey, occurredAt, data }` en de signing-headers
 * X-Mzw-Timestamp / X-Mzw-Signature (zie boven). 2xx → delivered; anders
 * attempts+1 en failed met backoff, of dead na MAX_DELIVERY_ATTEMPTS.
 *
 * Aan te roepen via de beheerde server action op de integratiepagina; in
 * productie via cron/queue (bv. elke minuut).
 */
export async function attemptDeliveries(
  opts: AttemptDeliveriesOptions = {},
): Promise<AttemptDeliveriesResult> {
  const nu = opts.now ?? new Date();
  const doFetch = opts.fetchImpl ?? fetch;

  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ["pending", "failed"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: nu } }],
    },
    include: { subscription: true },
    orderBy: { createdAt: "asc" },
    take: opts.batchSize ?? 50,
  });

  const resultaat: AttemptDeliveriesResult = {
    processed: deliveries.length,
    delivered: 0,
    failed: 0,
    dead: 0,
  };

  for (const delivery of deliveries) {
    // Gedeactiveerde subscription: direct dead-letter, niet blijven proberen.
    if (!delivery.subscription.active) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "dead", lastError: "Subscription is gedeactiveerd" },
      });
      resultaat.dead += 1;
      continue;
    }

    const uitkomst = await bezorg(delivery, delivery.subscription, doFetch);
    if (uitkomst.ok) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "delivered",
          attempts: delivery.attempts + 1,
          deliveredAt: new Date(),
          lastError: null,
          nextAttemptAt: null,
        },
      });
      resultaat.delivered += 1;
      continue;
    }

    const attempts = delivery.attempts + 1;
    const isDead = attempts >= MAX_DELIVERY_ATTEMPTS;
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: isDead ? "dead" : "failed",
        attempts,
        lastError: uitkomst.fout.slice(0, 500),
        nextAttemptAt: isDead
          ? null
          : new Date(
              nu.getTime() +
                BACKOFF_MINUTEN[Math.min(attempts - 1, BACKOFF_MINUTEN.length - 1)] *
                  60_000,
            ),
      },
    });
    if (isDead) resultaat.dead += 1;
    else resultaat.failed += 1;
  }

  return resultaat;
}

/** Eén bezorgpoging: ondertekende POST met een timeout van 10 seconden. */
async function bezorg(
  delivery: WebhookDelivery,
  subscription: WebhookSubscription,
  doFetch: typeof fetch,
): Promise<{ ok: true } | { ok: false; fout: string }> {
  const body = JSON.stringify({
    event: delivery.event,
    idempotencyKey: delivery.idempotencyKey,
    occurredAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await doFetch(subscription.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Mzw-Event": delivery.event,
          "X-Mzw-Timestamp": String(timestamp),
          "X-Mzw-Signature": signWebhookBody(subscription.secret, timestamp, body),
          "X-Mzw-Idempotency-Key": delivery.idempotencyKey,
        },
        body,
        signal: controller.signal,
      });
      if (response.ok) return { ok: true };
      return { ok: false, fout: `HTTP ${response.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (fout) {
    return { ok: false, fout: fout instanceof Error ? fout.message : String(fout) };
  }
}
