"use server";

// Server actions van de integratiepagina (fase 9): API-sleutels, webhook-
// subscriptions, het handmatig verwerken van webhook-deliveries en CSV-
// exports. Elke actie begint bij getOrgForUserBySlug met capability
// org.manage; het entitlement api_access wordt in de servicelaag
// (src/server/integrations.ts) afgedwongen en levert hier een nette
// upgrade-melding op.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { API_SCOPES, type ApiScope } from "@/lib/api-auth";
import { AuthzError } from "@/lib/authz";
import { EntitlementError, enforceEntitlement } from "@/lib/billing";
import { WEBHOOK_EVENTS, attemptDeliveries, type WebhookEvent } from "@/lib/webhooks";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  EXPORT_KINDS,
  createAndRunExportJob,
  createApiKeyForOrg,
  createWebhookSubscriptionForOrg,
  readExportContent,
  revokeApiKey,
  rotateApiKey,
  setWebhookSubscriptionActive,
} from "@/server/integrations";

/* ------------------------------------------------------------------ */
/* Resultaattypes richting de client                                   */
/* ------------------------------------------------------------------ */

export type ActieResultaat = { ok: true } | { ok: false; fout: string };

export type SleutelResultaat =
  | { ok: true; plaintext: string; prefix: string }
  | { ok: false; fout: string };

export type WebhookResultaat =
  | { ok: true; secret: string; url: string }
  | { ok: false; fout: string };

export type VerwerkResultaat =
  | { ok: true; processed: number; delivered: number; failed: number; dead: number }
  | { ok: false; fout: string };

export type ExportResultaat =
  | { ok: true; jobId: string; status: string }
  | { ok: false; fout: string };

export type DownloadResultaat =
  | { ok: true; filename: string; content: string }
  | { ok: false; fout: string };

/* ------------------------------------------------------------------ */
/* Zod-schema's                                                        */
/* ------------------------------------------------------------------ */

const sleutelSchema = z.object({
  name: z.string().trim().min(2, "Geef de sleutel een naam").max(80, "De naam is te lang"),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Kies minstens één scope"),
});

const webhookSchema = z.object({
  url: z.string().trim().url("Vul een geldige URL in").max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Kies minstens één event"),
});

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function foutmelding(fout: unknown, standaard: string): string {
  if (fout instanceof EntitlementError) return `${fout.message} ${fout.upgradeHint}`;
  if (fout instanceof AuthzError) return fout.message;
  return standaard;
}

function logTenzijBekend(fout: unknown, context: string): void {
  if (!(fout instanceof AuthzError) && !(fout instanceof EntitlementError)) {
    console.error(`${context}:`, fout);
  }
}

/* ------------------------------------------------------------------ */
/* API-sleutels                                                        */
/* ------------------------------------------------------------------ */

/** Nieuwe API-sleutel; de plaintext wordt één keer aan de client getoond. */
export async function maakSleutelAction(
  slug: string,
  invoer: unknown,
): Promise<SleutelResultaat> {
  const parsed = sleutelSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    const { apiKey, plaintext } = await createApiKeyForOrg(
      ctx,
      parsed.data.name,
      parsed.data.scopes as ApiScope[],
    );
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true, plaintext, prefix: apiKey.prefix };
  } catch (fout) {
    logTenzijBekend(fout, "API-sleutel aanmaken mislukt");
    return { ok: false, fout: foutmelding(fout, "Aanmaken is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Rotatie: nieuwe sleutel met dezelfde scopes, oude direct ingetrokken. */
export async function roteerSleutelAction(
  slug: string,
  apiKeyId: string,
): Promise<SleutelResultaat> {
  if (!apiKeyId) return { ok: false, fout: "Sleutel onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    const { apiKey, plaintext } = await rotateApiKey(ctx, apiKeyId);
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true, plaintext, prefix: apiKey.prefix };
  } catch (fout) {
    logTenzijBekend(fout, "API-sleutel roteren mislukt");
    return { ok: false, fout: foutmelding(fout, "Roteren is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Intrekken: de sleutel werkt per direct niet meer. */
export async function trekSleutelInAction(
  slug: string,
  apiKeyId: string,
): Promise<ActieResultaat> {
  if (!apiKeyId) return { ok: false, fout: "Sleutel onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    await revokeApiKey(ctx, apiKeyId);
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true };
  } catch (fout) {
    logTenzijBekend(fout, "API-sleutel intrekken mislukt");
    return { ok: false, fout: foutmelding(fout, "Intrekken is niet gelukt. Probeer het opnieuw.") };
  }
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/** Nieuwe webhook-subscription; het signing-secret wordt één keer getoond. */
export async function maakWebhookAction(
  slug: string,
  invoer: unknown,
): Promise<WebhookResultaat> {
  const parsed = webhookSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    const resultaat = await createWebhookSubscriptionForOrg(
      ctx,
      parsed.data.url,
      parsed.data.events as WebhookEvent[],
    );
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true, secret: resultaat.secret, url: resultaat.url };
  } catch (fout) {
    logTenzijBekend(fout, "Webhook aanmaken mislukt");
    return { ok: false, fout: foutmelding(fout, "Aanmaken is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Subscription aan- of uitzetten. */
export async function zetWebhookActiefAction(
  slug: string,
  subscriptionId: string,
  active: boolean,
): Promise<ActieResultaat> {
  if (!subscriptionId) return { ok: false, fout: "Webhook onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    await setWebhookSubscriptionActive(ctx, subscriptionId, active);
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true };
  } catch (fout) {
    logTenzijBekend(fout, "Webhook bijwerken mislukt");
    return { ok: false, fout: foutmelding(fout, "Bijwerken is niet gelukt. Probeer het opnieuw.") };
  }
}

/**
 * Beheerde verwerking van openstaande webhook-deliveries (pending/failed met
 * verstreken backoff). In productie roept een cron/queue attemptDeliveries()
 * elke minuut aan; deze action is de beheerde handmatige variant voor de
 * beta en voor het opnieuw proberen van mislukte deliveries.
 */
export async function verwerkDeliveriesAction(slug: string): Promise<VerwerkResultaat> {
  try {
    // org.manage + api_access borgen dat alleen integratiebeheerders dit doen.
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    await enforceEntitlement(ctx.organizationId, "api_access");
    const resultaat = await attemptDeliveries();
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true, ...resultaat };
  } catch (fout) {
    logTenzijBekend(fout, "Deliveries verwerken mislukt");
    return { ok: false, fout: foutmelding(fout, "Verwerken is niet gelukt. Probeer het opnieuw.") };
  }
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

/** ExportJob aanmaken en direct synchroon verwerken (CSV onder .exports/). */
export async function startExportAction(
  slug: string,
  kind: unknown,
): Promise<ExportResultaat> {
  const parsed = z.enum(EXPORT_KINDS).safeParse(kind);
  if (!parsed.success) return { ok: false, fout: "Kies een geldig exporttype" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    const job = await createAndRunExportJob(ctx, parsed.data);
    revalidatePath(`/praktijk/${slug}/integraties`);
    return { ok: true, jobId: job.id, status: job.status };
  } catch (fout) {
    logTenzijBekend(fout, "Export starten mislukt");
    return { ok: false, fout: foutmelding(fout, "De export is niet gelukt. Probeer het opnieuw.") };
  }
}

/** Inhoud van een afgeronde export ophalen voor download in de browser. */
export async function downloadExportAction(
  slug: string,
  jobId: string,
): Promise<DownloadResultaat> {
  if (!jobId) return { ok: false, fout: "Export onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "org.manage");
    const { filename, content } = await readExportContent(ctx, jobId);
    return { ok: true, filename, content };
  } catch (fout) {
    logTenzijBekend(fout, "Export downloaden mislukt");
    return { ok: false, fout: foutmelding(fout, "Downloaden is niet gelukt. Probeer het opnieuw.") };
  }
}
