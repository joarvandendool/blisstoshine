// Contracten van de Mondzorg Arbeidsmarkt Monitor (fase 6). Pure types —
// geen React, routes of database.
//
// PRIVACY BY DESIGN: de invoerrijen ("feiten") bevatten uitsluitend
// taxonomiesleutels, regio's, aantallen en datums. Geen namen, geen
// e-mailadressen, geen vrije tekst, geen kandidaat- of organisatie-ID's.
// Het enige sleutelveld is een pseudoniem trajectnummer voor het koppelen
// van pipeline-events aan hetzelfde traject — niet herleidbaar tot een
// persoon zonder toegang tot de brontabellen.

import type { Weekday } from "../taxonomy";

/** Standaard minimumgroepsgrootte: onder deze drempel worden cellen onderdrukt. */
export const MARKET_MIN_GROUP = 5;

/**
 * Uitkomstwaarde van de monitor, KpiValue-achtig maar met verplichte periode
 * en steekproefomvang zodat elke uitkomst controleerbaar en uitlegbaar is.
 */
export interface MarketValue {
  /** Berekende waarde; null bij onvoldoende data (onder de drempel). */
  value: number | null;
  /** Aantal onderliggende rijen waarop de waarde is gebaseerd. */
  sampleSize: number;
  /** Periode van de meting, bv. "2026-07". */
  period: string;
  /** Korte Nederlandse definitietekst voor de UI. */
  definition: string;
  /** true → de UI toont "onvoldoende data" in plaats van de waarde. */
  insufficientData: boolean;
}

/** Eén cel van een verdeling; count is null onder de minimumgroepsgrootte. */
export interface DistributionEntry {
  key: string;
  count: number | null;
}

/** Verdeling over één dimensie (of maximaal twee, zie kruisVerdeling). */
export interface MarketDistribution {
  period: string;
  definition: string;
  /** Aantal onderliggende rijen (niet de som van de cellen bij meerwaardige velden). */
  sampleSize: number;
  entries: DistributionEntry[];
  /** true wanneer de hele verdeling onder de drempel valt. */
  insufficientData: boolean;
}

// ---------------------------------------------------------------------------
// Feiten (geanonimiseerde invoerrijen)
// ---------------------------------------------------------------------------

/** Geanonimiseerd kandidaatfeit: alleen taxonomiesleutels, regio en aantallen. */
export interface KandidaatFeit {
  role: string;
  /** Regio (provincie) afgeleid van de postcode; "onbekend" bij geen match. */
  regio: string;
  maxTravelMinutes: number;
  /** Dagen waarop de kandidaat op minstens één dagdeel kan werken. */
  werkdagen: Weekday[];
  /** Totaal aantal beschikbare dagdelen (0–21) — maat voor flexibiliteit. */
  beschikbareDagdelen: number;
  contractTypes: string[];
  hoursMin: number;
  hoursMax: number;
  /** Gewenst omzetpercentage bij zzp; null wanneer niet van toepassing. */
  revenueShareMin: number | null;
  equipment: string[];
  software: string[];
  specializations: string[];
  /** Ontwikkelinteresses (technieken die de kandidaat wil leren). */
  ontwikkelInteresses: string[];
}

/** Geanonimiseerd vacaturefeit. */
export interface VacatureFeit {
  role: string;
  regio: string;
  /** VacancyStatus uit opslag: draft | published | paused | filled | expired. */
  status: string;
  contractTypes: string[];
  hoursMin: number;
  hoursMax: number;
  /** Maximaal geboden omzetpercentage bij zzp; null wanneer niet van toepassing. */
  revenueShareMax: number | null;
  /** Dagen waarop minstens één dagdeel gevraagd wordt (required of preferred). */
  gevraagdeDagen: Weekday[];
  /** Dagen met minstens één verplicht dagdeel. */
  verplichteDagen: Weekday[];
  equipment: string[];
  software: string[];
  specializations: string[];
  /** Publicatiemaand "JJJJ-MM"; null zolang niet gepubliceerd. */
  publicatieMaand: string | null;
}

/**
 * Eén pipeline-event van een kandidaat-vacaturetraject, geanonimiseerd.
 * trajectId is een pseudoniem (hash) — nodig om events van hetzelfde traject
 * te kunnen koppelen voor doorlooptijden, zonder identiteit te dragen.
 */
export interface TrajectEventFeit {
  trajectId: string;
  role: string;
  regio: string;
  /** toStatus uit het pipeline-journaal: invited|interested|applied|interview_scheduled|offer|hired|declined|rejected|withdrawn|… */
  toStatus: string;
  createdAt: Date;
}
