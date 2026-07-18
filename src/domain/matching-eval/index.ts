// Matching-evaluatie (fase 7) — pure domeinmodule. Meet hoe goed een
// algoritmeversie het doet op basis van echte snapshots en pipeline-uitkomsten
// (invited/interested/declined/interview/offer/hired/withdrawn). Geen database,
// geen React, geen Date.now(): identieke invoer geeft identieke uitvoer.
//
// Alle metrics zijn KpiValue-achtig (EvalValue): value is null met
// insufficientData=true wanneer de steekproef onder de drempel ligt — nooit
// schijnprecisie op kleine aantallen.

// ---------------------------------------------------------------------------
// Contracten
// ---------------------------------------------------------------------------

/** Standaard minimumsteekproef voor evaluatiemetrics. */
export const EVAL_MIN_SAMPLE = 5;

/** KpiValue-achtige uitkomst met steekproefomvang en Nederlandse definitie. */
export interface EvalValue {
  value: number | null;
  sampleSize: number;
  definition: string;
  insufficientData: boolean;
}

/** Uitkomst van een traject, afgeleid uit pipeline-events (journaal). */
export interface EvalOutcome {
  invited: boolean;
  /** Kandidaat toonde interesse (uitnodiging geaccepteerd). */
  interested: boolean;
  declined: boolean;
  /** Redencode bij declined (MatchDecisionFeedback), bv. "reisafstand". */
  declineReason?: string | null;
  interviewed: boolean;
  offered: boolean;
  hired: boolean;
  withdrawn: boolean;
  /** Dagen van eerste contact tot gesprek; null wanneer geen gesprek. */
  daysToInterview: number | null;
  /** Dagen van eerste contact tot plaatsing; null wanneer geen plaatsing. */
  daysToHire: number | null;
}

/** Eén geëvalueerde match-momentopname (bv. uit MatchSnapshot). */
export interface EvalSnapshot {
  vacancyId: string;
  /** Pseudoniem van de kandidaat (geen naam of e-mail). */
  candidateId: string;
  score: number;
  label: string;
  eligible: boolean;
  version: string;
  /** Functie van de vacature — voor verschillen per functie. */
  role?: string;
  /** Regio van de vacature — voor verschillen per regio. */
  regio?: string;
  /** Heeft het matchresultaat minstens één strength-reden (uitlegbaarheid)? */
  hasStrengthReason: boolean;
  /** Uitkomst uit pipeline-events; null wanneer er (nog) geen traject is. */
  outcome: EvalOutcome | null;
}

/** Eligibility-paar van basis- en schaduwversie voor regressiedetectie. */
export interface EligibilityPair {
  vacancyId: string;
  candidateId: string;
  baseEligible: boolean;
  shadowEligible: boolean;
}

export interface HardMismatchRegressions {
  /** Eligible in de basisversie maar hard-ineligible in de schaduwversie. */
  eligibleInBaseOnly: EligibilityPair[];
  /** Hard-ineligible in de basisversie maar eligible in de schaduwversie. */
  eligibleInShadowOnly: EligibilityPair[];
  /** Totaal vergeleken paren. */
  totalPairs: number;
}

export interface SegmentEvaluation {
  segment: string;
  precisionAtTop5: EvalValue;
  interviewRate: EvalValue;
  sampleSize: number;
}

export interface AlgorithmEvaluation {
  version: string;
  /** Aantal snapshots (van deze versie) in de evaluatie. */
  snapshotCount: number;
  precisionAtTop5: EvalValue;
  invitationAcceptanceTop5: EvalValue;
  interviewRate: EvalValue;
  placementRate: EvalValue;
  timeToInterviewMedianDays: EvalValue;
  timeToHireMedianDays: EvalValue;
  /** Aandeel eligible matches met ≥ 1 strength-reden (uitlegbaarheid). */
  explainableShare: EvalValue;
  perRole: SegmentEvaluation[];
  perRegio: SegmentEvaluation[];
}

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function mediaan(values: number[]): number {
  const gesorteerd = [...values].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 1
    ? gesorteerd[midden]
    : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
}

function evalValue(
  value: number | null,
  sampleSize: number,
  definition: string,
  minSample: number,
): EvalValue {
  const onvoldoende = sampleSize < minSample || value === null;
  return {
    value: onvoldoende ? null : Math.round(value * 1000) / 1000,
    sampleSize,
    definition,
    insufficientData: onvoldoende,
  };
}

function onvoldoende(definition: string, sampleSize = 0): EvalValue {
  return { value: null, sampleSize, definition, insufficientData: true };
}

/** Positieve uitkomst: interesse of verder (gesprek, aanbod, plaatsing). */
function positieveUitkomst(outcome: EvalOutcome | null): boolean {
  if (!outcome) return false;
  return outcome.interested || outcome.interviewed || outcome.offered || outcome.hired;
}

/** Top-5 eligible snapshots per vacature, score aflopend (deterministisch). */
function top5PerVacature(snapshots: EvalSnapshot[]): EvalSnapshot[] {
  const perVacature = new Map<string, EvalSnapshot[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.eligible) continue;
    const lijst = perVacature.get(snapshot.vacancyId) ?? [];
    lijst.push(snapshot);
    perVacature.set(snapshot.vacancyId, lijst);
  }
  const top: EvalSnapshot[] = [];
  for (const lijst of perVacature.values()) {
    const gesorteerd = [...lijst].sort(
      (a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId),
    );
    top.push(...gesorteerd.slice(0, 5));
  }
  return top;
}

// ---------------------------------------------------------------------------
// Losse metrics (ook los bruikbaar en testbaar)
// ---------------------------------------------------------------------------

const DEF_PRECISION_TOP5 =
  "Aandeel van de top-5-matches per vacature dat tot interesse of een gesprek leidde.";
const DEF_ACCEPTANCE_TOP5 =
  "Aandeel uitgenodigde top-5-matches dat de uitnodiging accepteerde.";
const DEF_INTERVIEW_RATE =
  "Aandeel eligible matches met een traject dat tot een gesprek kwam.";
const DEF_PLACEMENT_RATE =
  "Aandeel eligible matches met een traject dat tot een plaatsing kwam.";
const DEF_TIME_TO_INTERVIEW = "Mediane dagen van eerste contact tot gesprek.";
const DEF_TIME_TO_HIRE = "Mediane dagen van eerste contact tot plaatsing.";
const DEF_EXPLAINABLE =
  "Aandeel eligible matches met minstens één concrete sterkte in de uitleg.";

/** Precision@Top5: positieve uitkomst binnen de top-5 per vacature. */
export function precisionAtTop5(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  const top = top5PerVacature(snapshots).filter((s) => s.outcome !== null);
  if (top.length === 0) return onvoldoende(DEF_PRECISION_TOP5);
  const positief = top.filter((s) => positieveUitkomst(s.outcome)).length;
  return evalValue(positief / top.length, top.length, DEF_PRECISION_TOP5, minSample);
}

/** Acceptatie van uitnodigingen binnen de top-5 per vacature. */
export function invitationAcceptanceTop5(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  const uitgenodigd = top5PerVacature(snapshots).filter((s) => s.outcome?.invited);
  if (uitgenodigd.length === 0) return onvoldoende(DEF_ACCEPTANCE_TOP5);
  const geaccepteerd = uitgenodigd.filter((s) => s.outcome?.interested).length;
  return evalValue(
    geaccepteerd / uitgenodigd.length,
    uitgenodigd.length,
    DEF_ACCEPTANCE_TOP5,
    minSample,
  );
}

/** Gespreksratio over eligible matches met een traject. */
export function interviewRate(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  const metTraject = snapshots.filter((s) => s.eligible && s.outcome !== null);
  if (metTraject.length === 0) return onvoldoende(DEF_INTERVIEW_RATE);
  const gesprekken = metTraject.filter((s) => s.outcome?.interviewed).length;
  return evalValue(
    gesprekken / metTraject.length,
    metTraject.length,
    DEF_INTERVIEW_RATE,
    minSample,
  );
}

/** Plaatsingsratio over eligible matches met een traject. */
export function placementRate(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  const metTraject = snapshots.filter((s) => s.eligible && s.outcome !== null);
  if (metTraject.length === 0) return onvoldoende(DEF_PLACEMENT_RATE);
  const plaatsingen = metTraject.filter((s) => s.outcome?.hired).length;
  return evalValue(
    plaatsingen / metTraject.length,
    metTraject.length,
    DEF_PLACEMENT_RATE,
    minSample,
  );
}

/** Mediane doorlooptijd (dagen) uit de outcome-velden. */
function tijdMediaan(
  snapshots: EvalSnapshot[],
  veld: "daysToInterview" | "daysToHire",
  definition: string,
  minSample: number,
): EvalValue {
  const dagen = snapshots
    .map((s) => s.outcome?.[veld])
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (dagen.length === 0) return onvoldoende(definition);
  return evalValue(mediaan(dagen), dagen.length, definition, minSample);
}

export function timeToInterviewMedian(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  return tijdMediaan(snapshots, "daysToInterview", DEF_TIME_TO_INTERVIEW, minSample);
}

export function timeToHireMedian(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  return tijdMediaan(snapshots, "daysToHire", DEF_TIME_TO_HIRE, minSample);
}

/** Uitlegbaarheid: aandeel eligible matches met ≥ 1 strength-reden. */
export function explainableShare(
  snapshots: EvalSnapshot[],
  minSample = EVAL_MIN_SAMPLE,
): EvalValue {
  const eligible = snapshots.filter((s) => s.eligible);
  if (eligible.length === 0) return onvoldoende(DEF_EXPLAINABLE);
  const uitlegbaar = eligible.filter((s) => s.hasStrengthReason).length;
  return evalValue(uitlegbaar / eligible.length, eligible.length, DEF_EXPLAINABLE, minSample);
}

/**
 * Hard-mismatch-regressiedetectie in BEIDE richtingen: kandidaten die in de
 * basisversie eligible waren maar in de schaduwversie hard-ineligible, en
 * andersom. Elke afwijking is per definitie een regressie op het contract
 * "zelfde harde mismatches als v1" en hoort leeg te zijn.
 */
export function hardMismatchRegressions(pairs: EligibilityPair[]): HardMismatchRegressions {
  return {
    eligibleInBaseOnly: pairs.filter((p) => p.baseEligible && !p.shadowEligible),
    eligibleInShadowOnly: pairs.filter((p) => !p.baseEligible && p.shadowEligible),
    totalPairs: pairs.length,
  };
}

// ---------------------------------------------------------------------------
// Totale evaluatie
// ---------------------------------------------------------------------------

function segmentEvaluaties(
  snapshots: EvalSnapshot[],
  sleutel: (s: EvalSnapshot) => string | undefined,
  minSample: number,
): SegmentEvaluation[] {
  const perSegment = new Map<string, EvalSnapshot[]>();
  for (const snapshot of snapshots) {
    const segment = sleutel(snapshot);
    if (!segment) continue;
    const lijst = perSegment.get(segment) ?? [];
    lijst.push(snapshot);
    perSegment.set(segment, lijst);
  }
  return Array.from(perSegment.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([segment, lijst]) => ({
      segment,
      precisionAtTop5: precisionAtTop5(lijst, minSample),
      interviewRate: interviewRate(lijst, minSample),
      sampleSize: lijst.length,
    }));
}

/**
 * Volledige evaluatie van één algoritmeversie: alleen snapshots van die
 * versie tellen mee. Elke metric respecteert de minimumsteekproef
 * (insufficientData), inclusief de uitsplitsingen per functie en regio.
 */
export function evaluateAlgorithm(
  snapshots: EvalSnapshot[],
  version: string,
  minSample = EVAL_MIN_SAMPLE,
): AlgorithmEvaluation {
  const eigen = snapshots.filter((s) => s.version === version);
  return {
    version,
    snapshotCount: eigen.length,
    precisionAtTop5: precisionAtTop5(eigen, minSample),
    invitationAcceptanceTop5: invitationAcceptanceTop5(eigen, minSample),
    interviewRate: interviewRate(eigen, minSample),
    placementRate: placementRate(eigen, minSample),
    timeToInterviewMedianDays: timeToInterviewMedian(eigen, minSample),
    timeToHireMedianDays: timeToHireMedian(eigen, minSample),
    explainableShare: explainableShare(eigen, minSample),
    perRole: segmentEvaluaties(eigen, (s) => s.role, minSample),
    perRegio: segmentEvaluaties(eigen, (s) => s.regio, minSample),
  };
}
