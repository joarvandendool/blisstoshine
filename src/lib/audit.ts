// Auditlog voor gevoelige acties (publiceren, uitnodigen, abonnementswijzigingen).
// Schrijft een AuditLog-rij en faalt zacht: een kapotte auditlog mag nooit een
// productflow breken. Voor harde garanties (bv. compliance) hoort de schrijf-
// actie in dezelfde transactie als de actie zelf — dat is hier bewust niet zo.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface AuditOptions {
  organizationId?: string;
  userId?: string;
  /** Vrije context; geen persoonsgegevens die niet strikt nodig zijn. */
  meta?: Record<string, unknown>;
}

/**
 * Legt een auditregel vast, bv. `audit("vacancy.publish", "Vacancy", id, {
 * organizationId, userId })`. Fouten worden gelogd maar nooit doorgegooid.
 */
export async function audit(
  action: string,
  entity: string,
  entityId: string,
  opts?: AuditOptions,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId,
        organizationId: opts?.organizationId ?? null,
        userId: opts?.userId ?? null,
        meta:
          opts?.meta === undefined
            ? undefined
            : (opts.meta as Prisma.InputJsonValue),
      },
    });
  } catch (error) {
    console.error(
      `Auditlog schrijven mislukt (${action} ${entity}/${entityId}):`,
      error,
    );
  }
}
