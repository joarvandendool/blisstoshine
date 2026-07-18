// Responsstatistieken per organisatie, berekend uit het PipelineStatusChange-
// journaal: hoe snel reageert een praktijk op sollicitaties en getoonde
// interesse van kandidaten?
//
// Definities:
// - Een "geval" is een kandidaat-vacaturetraject van de organisatie waarin de
//   kandidaat het initiatief nam (eerste kandidaat-statuswijziging naar
//   "applied" of "interested").
// - Een geval is "beantwoord" wanneer er daarna een statuswijziging door de
//   praktijk (actorType "practice") volgt, ongeacht de uitkomst — ook een
//   nette afwijzing telt als antwoord.
// - Percentages zijn fracties (0–1); de reactietijd is de mediaan in uren.
//
// AUTORISATIE: deze module scopet zelf op orgId maar verifieert geen
// membership — de aanroepende pagina/route bepaalt de orgId uitsluitend via
// requireMembership/getOrgForUserBySlug, nooit uit client-input.

import { prisma } from "@/lib/db";

/** KpiValue-achtige vorm: waarde of expliciet "onvoldoende data". */
export interface ResponseStatValue {
  /** De berekende waarde; null wanneer er onvoldoende data is. */
  value: number | null;
  /** true → de UI toont "onvoldoende data" in plaats van de waarde. */
  insufficientData: boolean;
}

export interface ResponseStats {
  /** Mediane reactietijd van de praktijk in uren (over beantwoorde gevallen). */
  medianResponseHours: ResponseStatValue;
  /** Fractie kandidaten die (ooit) antwoord kregen. */
  responseRate: ResponseStatValue;
  /** Fractie kandidaten die binnen 24 uur antwoord kregen. */
  respondedWithin24hRate: ResponseStatValue;
  /** Aantal gevallen waarin een kandidaat initiatief nam. */
  totalCases: number;
  /** Aantal beantwoorde gevallen. */
  answeredCases: number;
}

/** Statussen waarmee de kandidaat het initiatief neemt. */
const KANDIDAAT_INITIATIEF = new Set(["applied", "interested"]);

/** Onder dit aantal gevallen zijn de cijfers te ruisgevoelig. */
const MINIMUM_GEVALLEN = 3;

const MS_PER_UUR = 60 * 60 * 1000;

/** Mediaan van een niet-lege reeks getallen. */
function mediaan(waarden: number[]): number {
  const gesorteerd = [...waarden].sort((a, b) => a - b);
  const midden = Math.floor(gesorteerd.length / 2);
  return gesorteerd.length % 2 === 1
    ? gesorteerd[midden]
    : (gesorteerd[midden - 1] + gesorteerd[midden]) / 2;
}

function waarde(value: number): ResponseStatValue {
  return { value, insufficientData: false };
}

const ONVOLDOENDE_DATA: ResponseStatValue = {
  value: null,
  insufficientData: true,
};

/**
 * Responsstatistieken van één organisatie over alle vacatures heen.
 * Bij te weinig data (jonge praktijk, weinig sollicitaties) leveren de
 * metrics netjes insufficientData in plaats van misleidende cijfers.
 */
export async function responseStatsForOrg(orgId: string): Promise<ResponseStats> {
  const vacatures = await prisma.vacancy.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const vacatureIds = vacatures.map((v) => v.id);

  const wijzigingen =
    vacatureIds.length === 0
      ? []
      : await prisma.pipelineStatusChange.findMany({
          where: { vacancyId: { in: vacatureIds } },
          orderBy: { createdAt: "asc" },
          select: {
            vacancyId: true,
            candidateUserId: true,
            toStatus: true,
            actorType: true,
            createdAt: true,
          },
        });

  // Per traject (vacature + kandidaat): eerste kandidaat-initiatief en de
  // eerste praktijkreactie daarná.
  const perTraject = new Map<string, { start: Date; reactie: Date | null }>();
  for (const wijziging of wijzigingen) {
    const sleutel = `${wijziging.vacancyId}:${wijziging.candidateUserId}`;
    const bestaand = perTraject.get(sleutel);
    if (!bestaand) {
      if (
        wijziging.actorType === "candidate" &&
        KANDIDAAT_INITIATIEF.has(wijziging.toStatus)
      ) {
        perTraject.set(sleutel, { start: wijziging.createdAt, reactie: null });
      }
      continue;
    }
    if (
      bestaand.reactie === null &&
      wijziging.actorType === "practice" &&
      wijziging.createdAt.getTime() >= bestaand.start.getTime()
    ) {
      bestaand.reactie = wijziging.createdAt;
    }
  }

  const gevallen = Array.from(perTraject.values());
  const beantwoord = gevallen.filter((g) => g.reactie !== null);
  const reactieUren = beantwoord.map(
    (g) => ((g.reactie as Date).getTime() - g.start.getTime()) / MS_PER_UUR,
  );
  const binnen24 = reactieUren.filter((uren) => uren <= 24).length;

  const genoegGevallen = gevallen.length >= MINIMUM_GEVALLEN;
  const genoegBeantwoord = beantwoord.length >= MINIMUM_GEVALLEN;

  return {
    medianResponseHours: genoegBeantwoord
      ? waarde(mediaan(reactieUren))
      : ONVOLDOENDE_DATA,
    responseRate: genoegGevallen
      ? waarde(beantwoord.length / gevallen.length)
      : ONVOLDOENDE_DATA,
    respondedWithin24hRate: genoegGevallen
      ? waarde(binnen24 / gevallen.length)
      : ONVOLDOENDE_DATA,
    totalCases: gevallen.length,
    answeredCases: beantwoord.length,
  };
}

/**
 * "Snelle reageerder"-badge: alleen bij minimaal 5 beantwoorde gevallen én
 * minstens 80% van de kandidaten binnen 24 uur beantwoord. Bewust streng —
 * de badge moet iets betekenen voor kandidaten.
 */
export function fastResponderBadge(stats: ResponseStats): boolean {
  return (
    stats.answeredCases >= 5 &&
    !stats.respondedWithin24hRate.insufficientData &&
    stats.respondedWithin24hRate.value !== null &&
    stats.respondedWithin24hRate.value >= 0.8
  );
}
