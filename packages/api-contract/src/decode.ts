// Zuivere, afhankelijkheidsloze decoders. Web en mobiel interpreteren
// payloads hiermee identiek — dit is bewust géén zod (de app bundelt geen
// extra runtime) maar deterministische, defensieve casting zoals de server
// die ook toepast (castAvailability in src/server/candidates.ts).

import {
  DAYPARTS,
  WEEKDAYS,
  emptyAvailability,
  emptySchedule,
  type CandidateAvailability,
  type VacancySchedule,
} from "./taxonomy";

/** Onbekende Json → CandidateAvailability; ontbrekend/ongeldig = unavailable. */
export function decodeAvailability(waarde: unknown): CandidateAvailability {
  const basis = emptyAvailability();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        const niveau = (rij as Record<string, unknown>)[dagdeel];
        if (niveau === "preferred" || niveau === "available" || niveau === "unavailable") {
          basis[dag][dagdeel] = niveau;
        }
      }
    }
  }
  return basis;
}

/** Onbekende Json → VacancySchedule; ontbrekend/ongeldig = null (niet gevraagd). */
export function decodeSchedule(waarde: unknown): VacancySchedule {
  const basis = emptySchedule();
  if (waarde && typeof waarde === "object" && !Array.isArray(waarde)) {
    for (const dag of WEEKDAYS) {
      const rij = (waarde as Record<string, unknown>)[dag];
      if (!rij || typeof rij !== "object" || Array.isArray(rij)) continue;
      for (const dagdeel of DAYPARTS) {
        const eis = (rij as Record<string, unknown>)[dagdeel];
        if (eis === "required" || eis === "preferred") {
          basis[dag][dagdeel] = eis;
        }
      }
    }
  }
  return basis;
}

/** ISO-string → Date, of null bij ongeldig/afwezig. */
export function decodeIsoDate(waarde: unknown): Date | null {
  if (typeof waarde !== "string" || waarde.length === 0) return null;
  const datum = new Date(waarde);
  return Number.isNaN(datum.getTime()) ? null : datum;
}

/** Beperkt een string tot een canonieke lijst; anders null. */
export function decodeEnum<T extends string>(
  waarde: unknown,
  toegestaan: readonly T[],
): T | null {
  return typeof waarde === "string" && (toegestaan as readonly string[]).includes(waarde)
    ? (waarde as T)
    : null;
}

/** Onbekende Json → string[] met uitsluitend canonieke waarden. */
export function decodeKeyList(
  waarde: unknown,
  toegestaan: readonly string[],
): string[] {
  if (!Array.isArray(waarde)) return [];
  return waarde.filter(
    (item): item is string => typeof item === "string" && toegestaan.includes(item),
  );
}

/** Geheel getal binnen [min, max], anders null. */
export function decodeIntInRange(
  waarde: unknown,
  min: number,
  max: number,
): number | null {
  if (typeof waarde !== "number" || !Number.isInteger(waarde)) return null;
  return waarde >= min && waarde <= max ? waarde : null;
}
