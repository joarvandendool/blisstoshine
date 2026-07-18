// Integratiepagina (fase 9): API-sleutels, webhook-subscriptions (met
// recente deliveries) en CSV-exports beheren. Alleen voor leden met
// capability org.manage; zonder het entitlement api_access toont de pagina
// de vergrendelkaart met upgradepad (afdwinging zit óók in de servicelaag).

import { notFound } from "next/navigation";
import { AuthzError } from "@/lib/authz";
import { effectiveEntitlements } from "@/lib/billing";
import { can } from "@/domain/entitlements";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  listApiKeys,
  listExportJobs,
  listWebhookSubscriptions,
} from "@/server/integrations";
import { PageHeader } from "@/components/ui";
import PaywallNotice from "@/components/PaywallNotice";
import {
  IntegratiesClient,
  type DeliveryRij,
  type ExportRij,
  type SleutelRij,
  type WebhookRij,
} from "./integraties-client";

export const dynamic = "force-dynamic";

export default async function IntegratiesPagina({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let toegang: Awaited<ReturnType<typeof getOrgForUserBySlug>>;
  try {
    toegang = await getOrgForUserBySlug(slug, "org.manage");
  } catch (fout) {
    if (fout instanceof AuthzError) notFound();
    throw fout;
  }
  const { org, ctx } = toegang;

  const entitlements = await effectiveEntitlements(ctx.organizationId);
  if (!can(entitlements.entitlements, "api_access")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Integraties"
          description="API-sleutels, webhooks en exports voor koppelingen met je eigen systemen."
        />
        <PaywallNotice
          slug={org.slug}
          benodigd="api_access"
          organizationId={ctx.organizationId}
          uitkomst="Koppel je eigen systemen: lees vacatures, pipeline en bezetting via de API, ontvang webhooks bij belangrijke gebeurtenissen en exporteer je data als CSV."
        />
      </div>
    );
  }

  const [sleutels, webhooks, exports] = await Promise.all([
    listApiKeys(ctx),
    listWebhookSubscriptions(ctx),
    listExportJobs(ctx),
  ]);

  // Alleen serialiseerbare, publiek-veilige velden richting de client
  // (nooit hashedKey of webhook-secret).
  const sleutelRijen: SleutelRij[] = sleutels.map((sleutel) => ({
    id: sleutel.id,
    name: sleutel.name,
    prefix: sleutel.prefix,
    scopes: sleutel.scopes,
    lastUsedAt: sleutel.lastUsedAt?.toISOString() ?? null,
    revokedAt: sleutel.revokedAt?.toISOString() ?? null,
    createdAt: sleutel.createdAt.toISOString(),
  }));

  const webhookRijen: WebhookRij[] = webhooks.map((abonnement) => ({
    id: abonnement.id,
    url: abonnement.url,
    events: abonnement.events,
    active: abonnement.active,
    createdAt: abonnement.createdAt.toISOString(),
    deliveries: abonnement.deliveries.map(
      (delivery): DeliveryRij => ({
        id: delivery.id,
        event: delivery.event,
        status: delivery.status,
        attempts: delivery.attempts,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt.toISOString(),
        deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      }),
    ),
  }));

  const exportRijen: ExportRij[] = exports.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integraties"
        description="API-sleutels, webhooks en exports voor koppelingen met je eigen systemen."
      />
      <IntegratiesClient
        slug={org.slug}
        sleutels={sleutelRijen}
        webhooks={webhookRijen}
        exports={exportRijen}
      />
    </div>
  );
}
