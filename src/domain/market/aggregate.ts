// Pure aggregatiefuncties van de Mondzorg Arbeidsmarkt Monitor (fase 6).
// Geen database, geen React, geen Date.now() — identieke invoer geeft
// identieke uitvoer.
//
// PRIVACY — hard afgedwongen in dit domein, niet alleen in de UI:
// 1. Minimumgroepsgrootte (parameter, standaard MARKET_MIN_GROUP = 5):
//    elke cel of waarde onder de drempel wordt null ("onvoldoende data").
// 2. Kruistabellen over meer dan 2 dimensies worden GEWEIGERD (throw) —
//    fijnmazige combinaties maken individuen herleidbaar.
// 3. Geen vrije tekst: de feittypen (types.ts) bevatten uitsluitend
//    taxonomiesleutels, regio's, aantallen en datums.
// 4. Geen schijnprecisie: waarden op kleine steekproeven worden op hele
//    getallen afgerond (zie afgerond()); pas vanaf PRECISIE_DREMPEL rijen
//    tonen we één decimaal.
// Elke uitkomst draagt period + sampleSize + Nederlandse definitie mee.

import {
  MARKET_MIN_GROUP,
  type DistributionEntry,
  type MarketDistribution,
  type MarketValue,
  type TrajectEventFeit,
} from "./types";

/** Vanaf deze steekproefomvang is één decimaal verantwoord; eronder hele getallen. */
export const PRECISIE_DREMPEL = 30;

const MS_PER_DAG = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Bouwstenen
// ---------------------------------------------------------------------------

/** Teller onder de minimumgroepsgrootte → null (celonderdrukking). */
export function maskeerCel(aantal: number, minGroupSize = MARKET_MIN_GROUP): number | null {
  return aantal >= minGroupSize ? aantal : null;
}

/**
 * Afronding zonder schijnprecisie: hele getallen bij een kleine steekproef
 * (< PRECISIE_DREMPEL), anders maximaal één decimaal.
 */
export function afgerond(waarde: number, sampleSize: number): number {
  if (sampleSize < PRECISIE_DREMPEL) return Math.round(waarde);
  return Math.round(waarde * 10) / 10;
}

/** Mediaan van een reeks; bij een even aantal het gemiddelde van de middelste twee. */
function mediaan(values: number[]): number {
  const gesorteerd = [...values].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 1
    ? gesorteerd[midden]
    : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
}

export interface AggregatieOpties {
  period: string;
  definition: string;
  minGroupSize?: number;
}

// ---------------------------------------------------------------------------
// Verdelingen
// ---------------------------------------------------------------------------

/**
 * Verdeling over één dimensie. Elke rij levert één of meer sleutels
 * (bv. contractvormen van één kandidaat); sampleSize is het aantal RIJEN.
 * Cellen onder de drempel worden onderdrukt (null); de sortering is
 * deterministisch (aantal aflopend, daarna alfabetisch).
 */
export function verdeling(
  rijen: ReadonlyArray<string | readonly string[]>,
  opties: AggregatieOpties,
): MarketDistribution {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  const tellers = new Map<string, number>();
  for (const rij of rijen) {
    const sleutels = typeof rij === "string" ? [rij] : rij;
    for (const sleutel of new Set(sleutels)) {
      if (typeof sleutel !== "string" || sleutel.length === 0) continue;
      tellers.set(sleutel, (tellers.get(sleutel) ?? 0) + 1);
    }
  }

  const entries: DistributionEntry[] = Array.from(tellers.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, aantal]) => ({ key, count: maskeerCel(aantal, minGroup) }));

  return {
    period: opties.period,
    definition: opties.definition,
    sampleSize: rijen.length,
    entries,
    insufficientData: rijen.length < minGroup,
  };
}

/**
 * Kruistabel over maximaal TWEE dimensies (bv. functie × regio). Meer dan
 * twee dimensies tegelijk wordt geweigerd: zulke combinaties maken cellen zo
 * klein dat individuele kandidaten herleidbaar worden — dat is een
 * privacyregel van het domein, geen presentatiekeuze.
 */
export function kruisVerdeling(
  rijen: ReadonlyArray<Record<string, string>>,
  dimensies: readonly string[],
  opties: AggregatieOpties,
): MarketDistribution {
  if (dimensies.length > 2) {
    throw new Error(
      `Privacy: combinaties van meer dan 2 dimensies zijn niet toegestaan (gevraagd: ${dimensies.length}).`,
    );
  }
  if (dimensies.length === 0) {
    throw new Error("Minstens één dimensie is vereist.");
  }
  const samengesteld = rijen.map((rij) =>
    dimensies.map((dim) => rij[dim] ?? "onbekend").join(":"),
  );
  return verdeling(samengesteld, opties);
}

// ---------------------------------------------------------------------------
// Numerieke samenvattingen
// ---------------------------------------------------------------------------

/**
 * Mediaan van een numerieke reeks als MarketValue: onder de drempel
 * "onvoldoende data" (value null), en afgerond zonder schijnprecisie.
 */
export function mediaanWaarde(
  values: readonly number[],
  opties: AggregatieOpties,
): MarketValue {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  const bruikbaar = values.filter((v) => Number.isFinite(v));
  const onvoldoende = bruikbaar.length < minGroup;
  return {
    value: onvoldoende ? null : afgerond(mediaan(bruikbaar), bruikbaar.length),
    sampleSize: bruikbaar.length,
    period: opties.period,
    definition: opties.definition,
    insufficientData: onvoldoende,
  };
}

/**
 * Aandeel (0–1) van rijen dat aan een voorwaarde voldoet. Onder de drempel
 * "onvoldoende data". Het aandeel wordt op twee decimalen afgekapt bij kleine
 * steekproeven (hele procenten) en op drie decimalen daarboven.
 */
export function aandeelWaarde(
  totaal: number,
  passend: number,
  opties: AggregatieOpties,
): MarketValue {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  const onvoldoende = totaal < minGroup;
  let value: number | null = null;
  if (!onvoldoende && totaal > 0) {
    const fractie = passend / totaal;
    // hele procenten bij kleine steekproef, anders één decimaal in procenten
    value =
      totaal < PRECISIE_DREMPEL
        ? Math.round(fractie * 100) / 100
        : Math.round(fractie * 1000) / 1000;
  }
  return {
    value,
    sampleSize: totaal,
    period: opties.period,
    definition: opties.definition,
    insufficientData: onvoldoende,
  };
}

/** Teller als MarketValue, met celonderdrukking onder de drempel. */
export function telWaarde(aantal: number, opties: AggregatieOpties): MarketValue {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  return {
    value: maskeerCel(aantal, minGroup),
    sampleSize: aantal,
    period: opties.period,
    definition: opties.definition,
    insufficientData: aantal < minGroup,
  };
}

// ---------------------------------------------------------------------------
// Uitkomsten uit pipeline-events
// ---------------------------------------------------------------------------

/** Statussen die als "reactie van de kandidaat/praktijk" tellen. */
const REACTIE_STATUSSEN = new Set([
  "interested",
  "declined",
  "applied",
  "interview_scheduled",
  "rejected",
]);

/**
 * Doorlooptijd in dagen per traject: van het eerste event in `vanStatussen`
 * naar het eerste latere event in `naarStatussen`. Trajecten zonder beide
 * events tellen niet mee. Puur en deterministisch.
 */
export function doorlooptijdenDagen(
  events: readonly TrajectEventFeit[],
  vanStatussen: readonly string[],
  naarStatussen: readonly string[],
): number[] {
  const perTraject = new Map<string, TrajectEventFeit[]>();
  for (const event of events) {
    const lijst = perTraject.get(event.trajectId) ?? [];
    lijst.push(event);
    perTraject.set(event.trajectId, lijst);
  }

  const van = new Set(vanStatussen);
  const naar = new Set(naarStatussen);
  const dagen: number[] = [];
  for (const lijst of perTraject.values()) {
    const gesorteerd = [...lijst].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const start = gesorteerd.find((e) => van.has(e.toStatus));
    if (!start) continue;
    const einde = gesorteerd.find(
      (e) => naar.has(e.toStatus) && e.createdAt.getTime() >= start.createdAt.getTime(),
    );
    if (!einde) continue;
    dagen.push((einde.createdAt.getTime() - start.createdAt.getTime()) / MS_PER_DAG);
  }
  return dagen;
}

/** Mediane time-to-response: eerste reactie na een uitnodiging of sollicitatie. */
export function timeToResponse(
  events: readonly TrajectEventFeit[],
  opties: Omit<AggregatieOpties, "definition"> & { definition?: string },
): MarketValue {
  return mediaanWaarde(
    doorlooptijdenDagen(events, ["invited", "applied"], [...REACTIE_STATUSSEN]),
    {
      ...opties,
      definition:
        opties.definition ??
        "Mediane dagen tussen uitnodiging of sollicitatie en de eerste reactie.",
    },
  );
}

/** Mediane time-to-interview: van eerste contact tot ingepland gesprek. */
export function timeToInterview(
  events: readonly TrajectEventFeit[],
  opties: Omit<AggregatieOpties, "definition"> & { definition?: string },
): MarketValue {
  return mediaanWaarde(
    doorlooptijdenDagen(events, ["invited", "applied"], ["interview_scheduled"]),
    {
      ...opties,
      definition:
        opties.definition ??
        "Mediane dagen tussen eerste contact en een ingepland gesprek.",
    },
  );
}

/** Mediane time-to-hire: van eerste contact tot plaatsing. */
export function timeToHire(
  events: readonly TrajectEventFeit[],
  opties: Omit<AggregatieOpties, "definition"> & { definition?: string },
): MarketValue {
  return mediaanWaarde(doorlooptijdenDagen(events, ["invited", "applied"], ["hired"]), {
    ...opties,
    definition:
      opties.definition ?? "Mediane dagen tussen eerste contact en plaatsing.",
  });
}

/**
 * Fill rate: aandeel afgeronde vacatures (niet-concept) dat vervuld is.
 * Alleen vacatures die een eindtoestand kunnen hebben tellen mee.
 */
export function fillRate(
  vacatureStatussen: readonly string[],
  opties: Omit<AggregatieOpties, "definition"> & { definition?: string },
): MarketValue {
  const relevant = vacatureStatussen.filter((s) => s !== "draft");
  const vervuld = relevant.filter((s) => s === "filled").length;
  return aandeelWaarde(relevant.length, vervuld, {
    ...opties,
    definition:
      opties.definition ??
      "Aandeel gepubliceerde vacatures dat vervuld is (concepten tellen niet mee).",
  });
}

// ---------------------------------------------------------------------------
// Flexibiliteit → kandidatenbereik
// ---------------------------------------------------------------------------

export interface FlexibiliteitRij {
  /** Aantal beschikbare/gevraagde dagdelen (0–21). */
  dagdelen: number;
  /** Bereik: aantal matches binnen criteria (kandidaat- of vacaturekant). */
  bereik: number;
}

export interface FlexibiliteitBand {
  band: "beperkt" | "gemiddeld" | "ruim";
  /** Mediane bereik binnen de band; null onder de drempel. */
  medianBereik: number | null;
  sampleSize: number;
  insufficientData: boolean;
}

export interface FlexibiliteitInvloed {
  period: string;
  definition: string;
  sampleSize: number;
  banden: FlexibiliteitBand[];
}

/**
 * Invloed van flexibiliteit: mediane bereik per flexibiliteitsband
 * (beperkt ≤ 4 dagdelen, gemiddeld 5–8, ruim ≥ 9). Laat zien hoeveel groter
 * het bereik wordt naarmate er meer dagdelen beschikbaar/gevraagd zijn —
 * zonder individuele rijen te tonen.
 */
export function flexibiliteitInvloed(
  rijen: readonly FlexibiliteitRij[],
  opties: Omit<AggregatieOpties, "definition"> & { definition?: string },
): FlexibiliteitInvloed {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  const banden: Array<{ band: FlexibiliteitBand["band"]; filter: (d: number) => boolean }> = [
    { band: "beperkt", filter: (d) => d <= 4 },
    { band: "gemiddeld", filter: (d) => d >= 5 && d <= 8 },
    { band: "ruim", filter: (d) => d >= 9 },
  ];
  return {
    period: opties.period,
    definition:
      opties.definition ??
      "Mediane aantal passende matches per flexibiliteitsband (aantal beschikbare dagdelen).",
    sampleSize: rijen.length,
    banden: banden.map(({ band, filter }) => {
      const groep = rijen.filter((rij) => filter(rij.dagdelen));
      const onvoldoende = groep.length < minGroup;
      return {
        band,
        medianBereik: onvoldoende
          ? null
          : afgerond(mediaan(groep.map((rij) => rij.bereik)), groep.length),
        sampleSize: groep.length,
        insufficientData: onvoldoende,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Trends door de tijd
// ---------------------------------------------------------------------------

export interface TrendPunt {
  /** Maand "JJJJ-MM". */
  maand: string;
  /** Aantal in die maand; null onder de drempel. */
  count: number | null;
}

export interface MaandTrend {
  definition: string;
  sampleSize: number;
  punten: TrendPunt[];
}

/**
 * Trend per maand: aantal rijen per "JJJJ-MM", chronologisch gesorteerd, met
 * celonderdrukking per maand. Rijen zonder maand tellen niet mee.
 */
export function maandTrend(
  maanden: ReadonlyArray<string | null>,
  opties: Omit<AggregatieOpties, "period" | "definition"> & { definition: string },
): MaandTrend {
  const minGroup = opties.minGroupSize ?? MARKET_MIN_GROUP;
  const tellers = new Map<string, number>();
  let totaal = 0;
  for (const maand of maanden) {
    if (!maand || !/^\d{4}-\d{2}$/.test(maand)) continue;
    tellers.set(maand, (tellers.get(maand) ?? 0) + 1);
    totaal += 1;
  }
  const punten: TrendPunt[] = Array.from(tellers.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([maand, aantal]) => ({ maand, count: maskeerCel(aantal, minGroup) }));
  return { definition: opties.definition, sampleSize: totaal, punten };
}

/** Maand "JJJJ-MM" (UTC) van een datum — deterministische hulpfunctie. */
export function maandVan(datum: Date): string {
  return `${datum.getUTCFullYear()}-${String(datum.getUTCMonth() + 1).padStart(2, "0")}`;
}
