// Analytics-adapter: verbindt de pure analytics-domeinmodule (eventnamen +
// envelope-contract) met de opslag. Nu: AnalyticsEvent-tabel via Prisma; later
// kan een externe leverancier worden aangesloten door een andere
// AnalyticsAdapter te registreren via setAnalyticsAdapter() — zonder dat
// productcode verandert.
//
// Belangrijkste regel: analytics faalt NOOIT hard. Een kapotte tracking-call
// mag geen productflow (sollicitatie, publicatie, betaling) breken.

import { Prisma } from "@prisma/client";
import {
  AnalyticsEnvelopeSchema,
  type AnalyticsEnvelope,
  type AnalyticsEventName,
} from "@/domain/analytics";
import { prisma } from "@/lib/db";

/** Een gevalideerde envelope waarvan de timestamp altijd is ingevuld. */
export type ValidatedEnvelope = Omit<AnalyticsEnvelope, "timestamp"> & {
  timestamp: Date;
};

export interface AnalyticsAdapter {
  track(event: ValidatedEnvelope): Promise<void>;
}

/** Standaardadapter: schrijft events naar de AnalyticsEvent-tabel. */
export class PrismaAnalyticsAdapter implements AnalyticsAdapter {
  async track(event: ValidatedEnvelope): Promise<void> {
    await prisma.analyticsEvent.create({
      data: {
        name: event.name,
        organizationId: event.organizationId ?? null,
        locationId: event.locationId ?? null,
        userId: event.userId ?? null,
        candidateId: event.candidateId ?? null,
        plan: event.plan ?? null,
        acquisitionSource: event.acquisitionSource ?? null,
        context:
          event.context === undefined
            ? undefined
            : (event.context as Prisma.InputJsonValue),
        createdAt: event.timestamp,
      },
    });
  }
}

let adapter: AnalyticsAdapter = new PrismaAnalyticsAdapter();

/**
 * Vervangt de actieve adapter — voor tests (in-memory adapter) of een latere
 * externe leverancier. Geeft de vorige adapter terug zodat tests kunnen
 * herstellen.
 */
export function setAnalyticsAdapter(next: AnalyticsAdapter): AnalyticsAdapter {
  const previous = adapter;
  adapter = next;
  return previous;
}

/**
 * Legt een analytics-event vast. Valideert de envelope via het domeincontract
 * (onbekende namen, persoonsgegevens in context of onbekende velden worden
 * geweigerd), vult de timestamp aan en schrijft via de actieve adapter.
 *
 * Faalt nooit hard: validatie- of schrijffouten worden gelogd met
 * console.error en verder genegeerd.
 */
export async function track(
  name: AnalyticsEventName,
  props?: Omit<AnalyticsEnvelope, "name">,
): Promise<void> {
  try {
    const envelope = AnalyticsEnvelopeSchema.parse({ ...props, name });
    await adapter.track({
      ...envelope,
      timestamp: envelope.timestamp ?? new Date(),
    });
  } catch (error) {
    console.error(`Analytics-event "${name}" niet vastgelegd:`, error);
  }
}
