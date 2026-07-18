// Integratietests voor webhooks en API-sleutels (fase 9):
// (a) HMAC-signing is verifieerbaar (helper én daadwerkelijk verzonden headers);
// (b) dispatchEvent dedupliceert op idempotencyKey (org + event + payloadhash);
// (c) mislukte bezorgingen verhogen attempts met exponentiële backoff en gaan
//     na 5 pogingen naar status "dead" (dead-letter);
// (d) een ingetrokken API-sleutel wordt per direct geweigerd.

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { sessieHouder, createTestSessionToken } = await import("./helpers");
  return {
    cookies: async () => ({
      get: (naam: string) =>
        naam === "mz_session" && sessieHouder.userId
          ? { value: createTestSessionToken(sessieHouder.userId) }
          : undefined,
      set: () => {},
      delete: () => {},
    }),
  };
});

import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing";
import { ApiAuthError, verifyApiKey } from "@/lib/api-auth";
import {
  attemptDeliveries,
  dispatchEvent,
  signWebhookBody,
  subscribeWebhook,
  verifyWebhookSignature,
  MAX_DELIVERY_ATTEMPTS,
} from "@/lib/webhooks";
import { createOrganizationWithLocation } from "@/server/organizations";
import { createApiKeyForOrg, revokeApiKey } from "@/server/integrations";
import { alsGebruiker, maakGebruiker, prepareTestDb } from "./helpers";

let owner: Awaited<ReturnType<typeof maakGebruiker>>;
let org: { id: string; slug: string };

async function ctxOwner() {
  alsGebruiker(owner.id);
  return requireMembership(org.id);
}

/** fetch-mock die requests vastlegt en een vast antwoord geeft. */
function fetchMock(status: number) {
  const requests: Array<{ url: string; headers: Headers; body: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });
    return new Response(status < 400 ? "ok" : "nee", { status });
  }) as typeof fetch;
  return { impl, requests };
}

beforeAll(async () => {
  await prepareTestDb();

  owner = await maakGebruiker("owner-w@test.nl", "Owner Webhooks");
  alsGebruiker(owner.id);
  const aangemaakt = await createOrganizationWithLocation({
    name: "Praktijk Webhook",
    location: { name: "Hoofdlocatie", city: "Utrecht", postcode: "3511 AB", treatmentRooms: 2 },
  });
  org = { id: aangemaakt.organization.id, slug: aangemaakt.organization.slug };
  // multi_location: api_access aan (nodig voor sleutelbeheer).
  await getBillingProvider().changePlan(org.id, "multi_location");
});

describe("HMAC-signing", () => {
  it("is verifieerbaar met het subscription-secret en faalt bij manipulatie", async () => {
    const { subscription, secret } = await subscribeWebhook(
      org.id,
      "https://ontvanger.test/hook",
      ["vacancy.published"],
    );
    expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    // Het secret staat wel opgeslagen, maar komt in beheer-overzichten nooit terug.
    expect(subscription.organizationId).toBe(org.id);

    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: "vacancy.published", data: { vacancyId: "v1" } });
    const signature = signWebhookBody(secret, timestamp, body);

    expect(verifyWebhookSignature(secret, timestamp, body, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, timestamp, body + "x", signature)).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp + 1, body, signature)).toBe(false);
    expect(verifyWebhookSignature("whsec_anders", timestamp, body, signature)).toBe(false);
  });

  it("ondertekent daadwerkelijk verzonden deliveries correct", async () => {
    const { subscription, secret } = await subscribeWebhook(
      org.id,
      "https://ontvanger.test/signing",
      ["application.created"],
    );
    await dispatchEvent(org.id, "application.created", { applicationId: "app-1" });

    const { impl, requests } = fetchMock(200);
    await attemptDeliveries({ fetchImpl: impl });

    const request = requests.find((r) => r.url === "https://ontvanger.test/signing");
    expect(request).toBeDefined();
    const timestamp = Number(request!.headers.get("x-mzw-timestamp"));
    const signature = request!.headers.get("x-mzw-signature")!;
    expect(verifyWebhookSignature(secret, timestamp, request!.body, signature)).toBe(true);

    const delivery = await prisma.webhookDelivery.findFirst({
      where: { subscriptionId: subscription.id },
    });
    expect(delivery?.status).toBe("delivered");
    expect(delivery?.deliveredAt).not.toBeNull();
  });
});

describe("idempotente dispatch", () => {
  it("dedupliceert op idempotencyKey: zelfde event + payload → één delivery", async () => {
    const { subscription } = await subscribeWebhook(
      org.id,
      "https://ontvanger.test/dedupe",
      ["placement.created"],
    );

    const payload = { placementId: "pl-1", vacancyId: "v-9" };
    expect(await dispatchEvent(org.id, "placement.created", payload)).toBe(1);
    expect(await dispatchEvent(org.id, "placement.created", payload)).toBe(0);

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { subscriptionId: subscription.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].idempotencyKey).toContain(org.id);
    expect(deliveries[0].idempotencyKey).toContain("placement.created");

    // Een andere payload is een nieuw event en levert wél een delivery op.
    expect(
      await dispatchEvent(org.id, "placement.created", { ...payload, placementId: "pl-2" }),
    ).toBe(1);

    // Opruimen zodat de retry-test alleen zijn eigen delivery verwerkt.
    await prisma.webhookDelivery.updateMany({
      where: { subscriptionId: subscription.id },
      data: { status: "delivered", deliveredAt: new Date() },
    });
  });
});

describe("retries en dead-letter", () => {
  it("verhoogt attempts met backoff en zet de delivery na 5 pogingen op dead", async () => {
    const { subscription } = await subscribeWebhook(
      org.id,
      "https://ontvanger.test/faalt",
      ["staffing_gap.detected"],
    );
    await dispatchEvent(org.id, "staffing_gap.detected", { locationId: "loc-1" });

    const delivery = () =>
      prisma.webhookDelivery.findFirstOrThrow({
        where: { subscriptionId: subscription.id },
      });

    // Verwachte backoff-reeks: 1m, 5m, 30m, 2u en daarna dead.
    const verwachteBackoffMs = [60_000, 300_000, 1_800_000, 7_200_000];

    let nu = new Date();
    for (let poging = 1; poging <= MAX_DELIVERY_ATTEMPTS; poging += 1) {
      const { impl } = fetchMock(500);
      const resultaat = await attemptDeliveries({ fetchImpl: impl, now: nu });
      expect(resultaat.processed).toBe(1);

      const rij = await delivery();
      expect(rij.attempts).toBe(poging);
      if (poging < MAX_DELIVERY_ATTEMPTS) {
        expect(rij.status).toBe("failed");
        expect(rij.lastError).toBe("HTTP 500");
        // nextAttemptAt schuift exponentieel op t.o.v. "nu".
        expect(rij.nextAttemptAt!.getTime() - nu.getTime()).toBe(
          verwachteBackoffMs[poging - 1],
        );
        nu = rij.nextAttemptAt!;
      } else {
        expect(rij.status).toBe("dead");
        expect(rij.nextAttemptAt).toBeNull();
      }
    }

    // Dead-letter: een volgende run raakt de delivery niet meer aan.
    const { impl } = fetchMock(200);
    const laatste = await attemptDeliveries({ fetchImpl: impl, now: new Date(nu.getTime() + 86_400_000) });
    expect(laatste.processed).toBe(0);
    expect((await delivery()).status).toBe("dead");
    expect((await delivery()).attempts).toBe(MAX_DELIVERY_ATTEMPTS);
  });
});

describe("API-sleutel intrekken", () => {
  it("blokkeert een ingetrokken sleutel per direct", async () => {
    const ctx = await ctxOwner();
    const { apiKey, plaintext } = await createApiKeyForOrg(ctx, "Tijdelijke sleutel", [
      "jobs:read",
    ]);

    // Vóór intrekken: geldig, juiste organisatie en scopes.
    const auth = await verifyApiKey(`Bearer ${plaintext}`);
    expect(auth.organizationId).toBe(org.id);
    expect(auth.scopes).toEqual(["jobs:read"]);

    await revokeApiKey(ctx, apiKey.id);

    await expect(verifyApiKey(`Bearer ${plaintext}`)).rejects.toMatchObject({
      status: 401,
      code: "key_revoked",
    });
    // Ook een volstrekt onbekende sleutel wordt geweigerd.
    await expect(
      verifyApiKey("Bearer mzw_test_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"),
    ).rejects.toBeInstanceOf(ApiAuthError);
  });
});
