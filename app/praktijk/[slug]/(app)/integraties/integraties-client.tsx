"use client";

// Clientkant van de integratiepagina (fase 9). Drie blokken:
// 1. API-sleutels: aanmaken met scopekeuze, eenmalige weergave van de
//    plaintext, roteren en intrekken;
// 2. Webhooks: subscription aanmaken (URL + events, secret één keer tonen),
//    (de)activeren, recente deliveries met status en handmatig verwerken;
// 3. Exports: type kiezen → job draait synchroon → CSV downloaden.
// Alle mutaties lopen via de server actions in ./actions.ts; na een mutatie
// ververst router.refresh() de serverdata.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SectionHeading,
  Select,
  type BadgeTone,
} from "@/components/ui";
import {
  downloadExportAction,
  maakSleutelAction,
  maakWebhookAction,
  roteerSleutelAction,
  startExportAction,
  trekSleutelInAction,
  verwerkDeliveriesAction,
  zetWebhookActiefAction,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Serialiseerbare rijen vanaf de server                                */
/* ------------------------------------------------------------------ */

export interface SleutelRij {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface DeliveryRij {
  id: string;
  event: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookRij {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  deliveries: DeliveryRij[];
}

export interface ExportRij {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

// Lokale kopieën van de scope- en eventlijsten: dit is een clientcomponent
// en mag src/lib/api-auth.ts / src/lib/webhooks.ts (server-only, prisma)
// niet importeren. De servervalidatie (Zod-enums in actions.ts) blijft de
// bron van waarheid.
const API_SCOPES = [
  "jobs:read",
  "pipeline:read",
  "capacity:read",
  "webhooks:manage",
] as const;

const WEBHOOK_EVENTS = [
  "vacancy.published",
  "application.created",
  "interview.confirmed",
  "placement.created",
  "staffing_gap.detected",
] as const;

const SCOPE_LABELS: Record<string, string> = {
  "jobs:read": "Vacatures lezen",
  "pipeline:read": "Pipeline lezen",
  "capacity:read": "Bezetting lezen",
  "webhooks:manage": "Webhooks beheren",
};

const EVENT_LABELS: Record<string, string> = {
  "vacancy.published": "Vacature gepubliceerd",
  "application.created": "Sollicitatie ontvangen",
  "interview.confirmed": "Gesprek bevestigd",
  "placement.created": "Kandidaat aangenomen",
  "staffing_gap.detected": "Bezettingsgat gesignaleerd",
};

const EXPORT_LABELS: Record<string, string> = {
  vacatures: "Vacatures",
  pipeline: "Pipeline",
  bezetting: "Bezetting",
};

const DELIVERY_TONEN: Record<string, BadgeTone> = {
  delivered: "blauw",
  pending: "neutraal",
  failed: "roze",
  dead: "roze",
};

function datum(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Eenmalig geheim tonen                                                */
/* ------------------------------------------------------------------ */

function GeheimEenmalig({ label, waarde }: { label: string; waarde: string }) {
  const [gekopieerd, zetGekopieerd] = useState(false);
  return (
    <div className="rounded-kaart border border-blauw-600/30 bg-brand-light/40 p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="mt-1 text-sm text-ink/70">
        Bewaar dit nu — het wordt maar één keer getoond.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white/80 px-2 py-1 font-mono text-sm text-ink">
          {waarde}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(waarde);
              zetGekopieerd(true);
            } catch {
              // Klembord niet beschikbaar — de waarde staat in beeld.
            }
          }}
        >
          {gekopieerd ? "Gekopieerd" : "Kopieer"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hoofdcomponent                                                       */
/* ------------------------------------------------------------------ */

export function IntegratiesClient({
  slug,
  sleutels,
  webhooks,
  exports,
}: {
  slug: string;
  sleutels: SleutelRij[];
  webhooks: WebhookRij[];
  exports: ExportRij[];
}) {
  const router = useRouter();
  const [bezig, startTransition] = useTransition();
  const [fout, zetFout] = useState<string | null>(null);

  // Eenmalig getoonde geheimen (verdwijnen bij de volgende actie/navigatie).
  const [nieuweSleutel, zetNieuweSleutel] = useState<string | null>(null);
  const [nieuwSecret, zetNieuwSecret] = useState<string | null>(null);

  // Formulierstaat
  const [sleutelNaam, zetSleutelNaam] = useState("");
  const [gekozenScopes, zetGekozenScopes] = useState<string[]>(["jobs:read"]);
  const [webhookUrl, zetWebhookUrl] = useState("");
  const [gekozenEvents, zetGekozenEvents] = useState<string[]>([]);
  const [exportKind, zetExportKind] = useState("vacatures");

  function run(actie: () => Promise<void>) {
    zetFout(null);
    startTransition(async () => {
      await actie();
      router.refresh();
    });
  }

  function wissel(lijst: string[], waarde: string): string[] {
    return lijst.includes(waarde)
      ? lijst.filter((v) => v !== waarde)
      : [...lijst, waarde];
  }

  return (
    <div className="flex flex-col gap-8">
      {fout ? (
        <p role="alert" className="rounded-kaart bg-roze-100/70 px-4 py-3 text-sm text-ink">
          {fout}
        </p>
      ) : null}

      {/* ----------------------------- API-sleutels ---------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="API-sleutels"
          description="Geef externe systemen leestoegang tot je eigen data via /api/public/v1/org/*. Een sleutel wordt één keer getoond; daarna is alleen het prefix zichtbaar."
        />
        {nieuweSleutel ? (
          <GeheimEenmalig label="Je nieuwe API-sleutel" waarde={nieuweSleutel} />
        ) : null}

        <Card className="flex flex-col gap-4 p-5">
          <Field label="Naam" hint="Bv. 'Koppeling roostersysteem'">
            <Input
              value={sleutelNaam}
              onChange={(e) => zetSleutelNaam(e.target.value)}
              placeholder="Naam van de sleutel"
              maxLength={80}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-ink">Scopes</legend>
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  checked={gekozenScopes.includes(scope)}
                  onChange={() => zetGekozenScopes((huidig) => wissel(huidig, scope))}
                />
                {SCOPE_LABELS[scope] ?? scope}{" "}
                <code className="font-mono text-xs text-ink/50">{scope}</code>
              </label>
            ))}
          </fieldset>
          <div>
            <Button
              type="button"
              disabled={bezig}
              onClick={() =>
                run(async () => {
                  const resultaat = await maakSleutelAction(slug, {
                    name: sleutelNaam,
                    scopes: gekozenScopes,
                  });
                  if (resultaat.ok) {
                    zetNieuweSleutel(resultaat.plaintext);
                    zetSleutelNaam("");
                  } else {
                    zetFout(resultaat.fout);
                  }
                })
              }
            >
              Sleutel aanmaken
            </Button>
          </div>
        </Card>

        {sleutels.length > 0 ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                  <th className="px-4 py-3">Naam</th>
                  <th className="px-4 py-3">Prefix</th>
                  <th className="px-4 py-3">Scopes</th>
                  <th className="px-4 py-3">Laatst gebruikt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sleutels.map((sleutel) => (
                  <tr key={sleutel.id} className="border-b border-ink/5">
                    <td className="px-4 py-3 font-medium text-ink">{sleutel.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/70">
                      {sleutel.prefix}…
                    </td>
                    <td className="px-4 py-3 text-ink/70">{sleutel.scopes.join(", ")}</td>
                    <td className="px-4 py-3 text-ink/70">{datum(sleutel.lastUsedAt)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={sleutel.revokedAt ? "roze" : "blauw"}>
                        {sleutel.revokedAt ? "Ingetrokken" : "Actief"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {!sleutel.revokedAt ? (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={bezig}
                            onClick={() =>
                              run(async () => {
                                const resultaat = await roteerSleutelAction(slug, sleutel.id);
                                if (resultaat.ok) zetNieuweSleutel(resultaat.plaintext);
                                else zetFout(resultaat.fout);
                              })
                            }
                          >
                            Roteren
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={bezig}
                            onClick={() =>
                              run(async () => {
                                const resultaat = await trekSleutelInAction(slug, sleutel.id);
                                if (!resultaat.ok) zetFout(resultaat.fout);
                              })
                            }
                          >
                            Intrekken
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </section>

      {/* ------------------------------- Webhooks ------------------------ */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Webhooks"
          description="Ontvang een ondertekende HTTP-aanroep bij belangrijke gebeurtenissen. Het signing-secret wordt één keer getoond; verifieer elke aanroep via de X-Mzw-Signature-header."
        />
        {nieuwSecret ? (
          <GeheimEenmalig label="Signing-secret van je nieuwe webhook" waarde={nieuwSecret} />
        ) : null}

        <Card className="flex flex-col gap-4 p-5">
          <Field label="Endpoint-URL" hint="Wij sturen een POST met JSON-body naar deze URL">
            <Input
              value={webhookUrl}
              onChange={(e) => zetWebhookUrl(e.target.value)}
              placeholder="https://voorbeeld.nl/webhooks/mondzorgwerkt"
              maxLength={500}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-ink">Events</legend>
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  checked={gekozenEvents.includes(event)}
                  onChange={() => zetGekozenEvents((huidig) => wissel(huidig, event))}
                />
                {EVENT_LABELS[event] ?? event}{" "}
                <code className="font-mono text-xs text-ink/50">{event}</code>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={bezig}
              onClick={() =>
                run(async () => {
                  const resultaat = await maakWebhookAction(slug, {
                    url: webhookUrl,
                    events: gekozenEvents,
                  });
                  if (resultaat.ok) {
                    zetNieuwSecret(resultaat.secret);
                    zetWebhookUrl("");
                    zetGekozenEvents([]);
                  } else {
                    zetFout(resultaat.fout);
                  }
                })
              }
            >
              Webhook toevoegen
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={bezig}
              onClick={() =>
                run(async () => {
                  const resultaat = await verwerkDeliveriesAction(slug);
                  if (!resultaat.ok) zetFout(resultaat.fout);
                })
              }
            >
              Openstaande deliveries nu verwerken
            </Button>
          </div>
          <p className="text-xs text-ink/50">
            In productie verwerkt een geplande taak (cron) de deliveries elke minuut;
            deze knop is de handmatige variant en probeert ook mislukte deliveries opnieuw.
          </p>
        </Card>

        {webhooks.map((webhook) => (
          <Card key={webhook.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-mono text-sm text-ink">{webhook.url}</p>
                <p className="text-xs text-ink/60">
                  {webhook.events.map((e) => EVENT_LABELS[e] ?? e).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={webhook.active ? "blauw" : "neutraal"}>
                  {webhook.active ? "Actief" : "Uit"}
                </Badge>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={bezig}
                  onClick={() =>
                    run(async () => {
                      const resultaat = await zetWebhookActiefAction(
                        slug,
                        webhook.id,
                        !webhook.active,
                      );
                      if (!resultaat.ok) zetFout(resultaat.fout);
                    })
                  }
                >
                  {webhook.active ? "Deactiveren" : "Activeren"}
                </Button>
              </div>
            </div>

            {webhook.deliveries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                      <th className="px-2 py-2">Event</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Pogingen</th>
                      <th className="px-2 py-2">Aangemaakt</th>
                      <th className="px-2 py-2">Laatste fout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhook.deliveries.map((delivery) => (
                      <tr key={delivery.id} className="border-b border-ink/5">
                        <td className="px-2 py-2 font-mono text-xs">{delivery.event}</td>
                        <td className="px-2 py-2">
                          <Badge tone={DELIVERY_TONEN[delivery.status] ?? "neutraal"}>
                            {delivery.status}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-ink/70">{delivery.attempts}</td>
                        <td className="px-2 py-2 text-ink/70">{datum(delivery.createdAt)}</td>
                        <td className="max-w-[220px] truncate px-2 py-2 text-ink/60">
                          {delivery.lastError ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink/50">Nog geen deliveries.</p>
            )}
          </Card>
        ))}
      </section>

      {/* -------------------------------- Exports ------------------------ */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Exports"
          description="Exporteer je eigen data als CSV. Kandidaatnamen staan alleen in een export wanneer de kandidaat daar toestemming voor heeft gegeven."
        />
        <Card className="flex flex-wrap items-end gap-4 p-5">
          <Field label="Type export">
            <Select value={exportKind} onChange={(e) => zetExportKind(e.target.value)}>
              {Object.entries(EXPORT_LABELS).map(([kind, tekst]) => (
                <option key={kind} value={kind}>
                  {tekst}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="button"
            disabled={bezig}
            onClick={() =>
              run(async () => {
                const resultaat = await startExportAction(slug, exportKind);
                if (!resultaat.ok) zetFout(resultaat.fout);
              })
            }
          >
            Export starten
          </Button>
        </Card>

        {exports.length > 0 ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/50">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aangevraagd</th>
                  <th className="px-4 py-3">Klaar</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {exports.map((job) => (
                  <tr key={job.id} className="border-b border-ink/5">
                    <td className="px-4 py-3 font-medium text-ink">
                      {EXPORT_LABELS[job.kind] ?? job.kind}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={job.status === "done" ? "blauw" : job.status === "failed" ? "roze" : "neutraal"}>
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-ink/70">{datum(job.createdAt)}</td>
                    <td className="px-4 py-3 text-ink/70">{datum(job.completedAt)}</td>
                    <td className="px-4 py-3">
                      {job.status === "done" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={bezig}
                          onClick={() =>
                            run(async () => {
                              const resultaat = await downloadExportAction(slug, job.id);
                              if (!resultaat.ok) {
                                zetFout(resultaat.fout);
                                return;
                              }
                              // CSV als download aanbieden vanuit de browser.
                              const blob = new Blob([resultaat.content], {
                                type: "text/csv;charset=utf-8",
                              });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = resultaat.filename;
                              a.click();
                              URL.revokeObjectURL(url);
                            })
                          }
                        >
                          Download
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
