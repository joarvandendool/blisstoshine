// Schaduwmatching (fase 7): draait de actieve engine v1 én de schaduwengine
// v2 over dezelfde kandidatenpool en legt uitsluitend ShadowMatchScore-rijen
// vast. ER VERANDERT NIETS AAN ZICHTBARE SCORES: geen MatchSnapshot, geen
// feed, geen pipeline — de actieve matching blijft volledig v1.
//
// ROLLBACK & PROMOTIE: terugdraaien is niets doen (schaduwrijen zijn
// vrijblijvend en kunnen worden weggegooid). Promotie van v2 naar actief kan
// UITSLUITEND via een expliciete wijziging van de actieve engine
// (src/domain/matching/engine.ts + ALGORITHM_VERSION) — deze module bevat
// bewust geen enkel promotiepad.
//
// AUTORISATIE: deze service is tenant-loos (leest vacatures en kandidaten
// over organisaties heen) en mag daarom ALLEEN worden aangeroepen vanaf
// /intern na requirePlatformAdmin() — dezelfde afspraak als src/server/kpi.ts.
// De afdwinging zit in de pagina/action, zodat de module in tests en scripts
// bruikbaar blijft.

import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  ALGORITHM_VERSION,
  type MatchCategory,
  type MatchResult,
} from "@/domain/matching";
import { ALGORITHM_VERSION_V2, computeMatchV2 } from "@/domain/matching/v2";
import {
  evaluateAlgorithm,
  hardMismatchRegressions,
  type AlgorithmEvaluation,
  type EligibilityPair,
  type EvalOutcome,
  type EvalSnapshot,
  type HardMismatchRegressions,
} from "@/domain/matching-eval";
import { provincieVanStad } from "@/domain/market";
// Mappers hergebruikt via de bestaande matchingservicelaag (alleen import,
// src/server/matching.ts wordt hier niet gewijzigd): poolForMatchVacancy
// levert de v1-resultaten over de actieve pool.
import { poolForMatchVacancy } from "@/server/matching";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { geocodePostcode } from "@/server/geo";

const CATEGORIEEN: MatchCategory[] = [
  "availability",
  "roleAndExperience",
  "travel",
  "employment",
  "equipmentAndSoftware",
  "specializations",
  "workplacePreferences",
];

/** Nederlandse verklaring per categorie waarvan de v2-regels afwijken. */
const CATEGORIE_VERKLARING: Partial<Record<MatchCategory, string>> = {
  travel: "v2 bouwt reistijd zachter af (cosinuscurve tot 160% van het maximum i.p.v. lineair tot 130%).",
  availability: "v2 weegt preferred-dagdelen zwaarder naarmate de vacature meer preferred-slots heeft.",
  equipmentAndSoftware: "v2 telt een leerwens mét begeleiding iets zwaarder (0,85 i.p.v. 0,80).",
  workplacePreferences: "v2 telt cultuur/populatie-onderdelen alleen mee wanneer beide kanten data hebben.",
};

export interface ShadowCategoryDiff {
  base: number;
  shadow: number;
  delta: number;
  /** Alleen gezet voor categorieën met gewijzigde v2-regels én een verschil. */
  verklaring?: string;
}

export type ShadowDiff = Record<MatchCategory, ShadowCategoryDiff> & {
  /** Totaalscoreverschil (shadow − base). */
  totaal: { base: number; shadow: number; delta: number };
};

function alsJson(waarde: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(waarde)) as Prisma.InputJsonValue;
}

function bouwDiff(base: MatchResult, shadow: MatchResult): ShadowDiff {
  const diff = {} as ShadowDiff;
  for (const categorie of CATEGORIEEN) {
    const b = base.categoryScores[categorie];
    const s = shadow.categoryScores[categorie];
    const entry: ShadowCategoryDiff = { base: b, shadow: s, delta: s - b };
    if (entry.delta !== 0 && CATEGORIE_VERKLARING[categorie]) {
      entry.verklaring = CATEGORIE_VERKLARING[categorie];
    }
    diff[categorie] = entry;
  }
  diff.totaal = { base: base.score, shadow: shadow.score, delta: shadow.score - base.score };
  return diff;
}

// ---------------------------------------------------------------------------
// Schaduwruns
// ---------------------------------------------------------------------------

export interface ShadowRunResult {
  vacancyId: string;
  /** Aantal kandidaat-vacatureparen dat is gescoord en vastgelegd. */
  aantal: number;
}

/**
 * Draait v1 én v2 over de actieve kandidatenpool voor één vacature en schrijft
 * ShadowMatchScore-rijen (base/shadow score + eligibility + verklaarde diff).
 * Idempotent-achtig: bestaande rijen voor dezelfde vacature + versiecombinatie
 * worden eerst opgeruimd, zodat een tweede run geen dubbele rijen oplevert.
 * Er wordt NIETS aan zichtbare matchdata (MatchSnapshot e.d.) geschreven.
 */
export async function runShadowForVacancy(vacancyId: string): Promise<ShadowRunResult> {
  const vacature = await prisma.vacancy.findUnique({
    where: { id: vacancyId },
    include: { location: true },
  });
  if (!vacature) throw new Error(`Vacature ${vacancyId} niet gevonden`);

  const matchVacancy = vacancyToMatchVacancy(vacature, vacature.location);
  // v1-resultaten via de bestaande servicelaag (actieve pool + mappers).
  const pool = await poolForMatchVacancy(matchVacancy);

  const rijen = pool.map(({ profile, result: v1 }) => {
    const v2 = computeMatchV2(profileToMatchCandidate(profile), matchVacancy);
    return {
      vacancyId: vacature.id,
      candidateUserId: profile.userId,
      baseVersion: ALGORITHM_VERSION,
      shadowVersion: ALGORITHM_VERSION_V2,
      baseScore: v1.score,
      shadowScore: v2.score,
      baseEligible: v1.eligible,
      shadowEligible: v2.eligible,
      diff: alsJson(bouwDiff(v1, v2)),
    };
  });

  // Opruimen + opnieuw schrijven in één transactie: een tweede run voor
  // dezelfde vacature en versies laat nooit dubbele paren achter.
  await prisma.$transaction([
    prisma.shadowMatchScore.deleteMany({
      where: {
        vacancyId: vacature.id,
        baseVersion: ALGORITHM_VERSION,
        shadowVersion: ALGORITHM_VERSION_V2,
      },
    }),
    prisma.shadowMatchScore.createMany({ data: rijen }),
  ]);

  return { vacancyId: vacature.id, aantal: rijen.length };
}

export interface ShadowBatchResult {
  vacatures: number;
  scores: number;
  shadowVersion: string;
}

/**
 * Schaduwbatch over de gepubliceerde vacatures van actieve organisaties
 * (nieuwste eerst, maximaal `limit`). Sequentieel en deterministisch
 * geordend; raakt uitsluitend ShadowMatchScore.
 */
export async function runShadowBatch(limit = 25): Promise<ShadowBatchResult> {
  const vacatures = await prisma.vacancy.findMany({
    where: { status: "published", organization: { status: "active" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let scores = 0;
  for (const vacature of vacatures) {
    const uitkomst = await runShadowForVacancy(vacature.id);
    scores += uitkomst.aantal;
  }
  return { vacatures: vacatures.length, scores, shadowVersion: ALGORITHM_VERSION_V2 };
}

// ---------------------------------------------------------------------------
// Vergelijking en evaluatie
// ---------------------------------------------------------------------------

export interface CategorieVerschil {
  categorie: MatchCategory;
  gemiddeldDelta: number;
  verklaring: string | null;
}

export interface ShadowMover {
  /** Pseudoniem — nooit een naam of herleidbaar ID in de UI. */
  pseudoniem: string;
  baseScore: number;
  shadowScore: number;
  delta: number;
}

export interface ShadowComparison {
  shadowVersion: string;
  baseVersion: string;
  paren: number;
  vacatures: number;
  gemiddeldScoreDelta: number | null;
  perCategorie: CategorieVerschil[];
  topStijgers: ShadowMover[];
  topDalers: ShadowMover[];
  regressies: HardMismatchRegressions;
  /** Evaluatie van de ACTIEVE versie op echte snapshots + pipeline-uitkomsten. */
  evaluatieActief: AlgorithmEvaluation;
}

/** Pseudoniem voor weergave: hash van het kandidaat-ID, niet omkeerbaar. */
function kandidaatPseudoniem(candidateUserId: string): string {
  const hash = createHash("sha256").update(candidateUserId).digest("hex").slice(0, 8);
  return `kandidaat-${hash}`;
}

/** Uitkomsten per (vacancyId, candidateUserId) uit het pipeline-journaal. */
async function uitkomstenPerTraject(): Promise<Map<string, EvalOutcome>> {
  const [events, feedback] = await Promise.all([
    prisma.pipelineStatusChange.findMany({
      orderBy: { createdAt: "asc" },
      select: { vacancyId: true, candidateUserId: true, toStatus: true, createdAt: true },
    }),
    prisma.matchDecisionFeedback.findMany({
      where: { decision: "declined" },
      select: { vacancyId: true, candidateUserId: true, reasonCode: true },
    }),
  ]);

  const redenen = new Map<string, string>();
  for (const rij of feedback) {
    if (rij.candidateUserId) {
      redenen.set(`${rij.vacancyId}:${rij.candidateUserId}`, rij.reasonCode);
    }
  }

  const MS_PER_DAG = 24 * 60 * 60 * 1000;
  const uitkomsten = new Map<string, EvalOutcome & { start: Date | null }>();
  for (const event of events) {
    const sleutel = `${event.vacancyId}:${event.candidateUserId}`;
    const bestaand =
      uitkomsten.get(sleutel) ??
      ({
        invited: false,
        interested: false,
        declined: false,
        declineReason: redenen.get(sleutel) ?? null,
        interviewed: false,
        offered: false,
        hired: false,
        withdrawn: false,
        daysToInterview: null,
        daysToHire: null,
        start: null,
      } as EvalOutcome & { start: Date | null });

    if (event.toStatus === "invited" || event.toStatus === "applied") {
      bestaand.invited = bestaand.invited || event.toStatus === "invited";
      if (!bestaand.start) bestaand.start = event.createdAt;
    }
    if (event.toStatus === "interested") bestaand.interested = true;
    if (event.toStatus === "declined") bestaand.declined = true;
    if (event.toStatus === "withdrawn") bestaand.withdrawn = true;
    if (event.toStatus === "offer") bestaand.offered = true;
    if (event.toStatus === "interview_scheduled") {
      bestaand.interviewed = true;
      if (bestaand.start && bestaand.daysToInterview === null) {
        bestaand.daysToInterview =
          (event.createdAt.getTime() - bestaand.start.getTime()) / MS_PER_DAG;
      }
    }
    if (event.toStatus === "hired") {
      bestaand.hired = true;
      if (bestaand.start && bestaand.daysToHire === null) {
        bestaand.daysToHire =
          (event.createdAt.getTime() - bestaand.start.getTime()) / MS_PER_DAG;
      }
    }
    uitkomsten.set(sleutel, bestaand);
  }

  const zonderStart = new Map<string, EvalOutcome>();
  for (const [sleutel, metStart] of uitkomsten.entries()) {
    const { start, ...uitkomst } = metStart;
    void start; // interne hulpwaarde — hoort niet in het EvalOutcome-contract
    zonderStart.set(sleutel, uitkomst);
  }
  return zonderStart;
}

/** EvalSnapshots uit echte MatchSnapshots (beslismomenten) + uitkomsten. */
async function evalSnapshots(): Promise<EvalSnapshot[]> {
  const [snapshots, vacatures, uitkomsten] = await Promise.all([
    prisma.matchSnapshot.findMany({
      select: {
        vacancyId: true,
        candidateUserId: true,
        score: true,
        label: true,
        algorithmVersion: true,
        result: true,
      },
    }),
    prisma.vacancy.findMany({
      select: { id: true, role: true, location: { select: { postcode: true } } },
    }),
    uitkomstenPerTraject(),
  ]);
  const perVacature = new Map(vacatures.map((v) => [v.id, v]));

  return snapshots.map((snapshot) => {
    const vacature = perVacature.get(snapshot.vacancyId);
    const resultaat = snapshot.result as {
      eligible?: boolean;
      strengths?: unknown[];
    } | null;
    const strengths = resultaat?.strengths;
    return {
      vacancyId: snapshot.vacancyId,
      candidateId: kandidaatPseudoniem(snapshot.candidateUserId),
      score: snapshot.score,
      label: snapshot.label,
      eligible: resultaat?.eligible ?? snapshot.label !== "ineligible",
      version: snapshot.algorithmVersion,
      role: vacature?.role,
      regio: vacature
        ? provincieVanStad(geocodePostcode(vacature.location.postcode)?.city ?? null)
        : undefined,
      hasStrengthReason: Array.isArray(strengths) && strengths.length > 0,
      outcome: uitkomsten.get(`${snapshot.vacancyId}:${snapshot.candidateUserId}`) ?? null,
    };
  });
}

/**
 * Vergelijkt de schaduwversie met de actieve versie: gemiddelde verschillen
 * per categorie, geanonimiseerde top-stijgers/-dalers, hard-mismatch-
 * regressies (horen leeg te zijn) en de evaluatiemetrics van de actieve
 * versie op echte snapshots en pipeline-uitkomsten.
 * ALLEEN aanroepen na requirePlatformAdmin().
 */
export async function compareShadow(
  shadowVersion: string = ALGORITHM_VERSION_V2,
): Promise<ShadowComparison> {
  const rijen = await prisma.shadowMatchScore.findMany({
    where: { shadowVersion },
    orderBy: [{ vacancyId: "asc" }, { candidateUserId: "asc" }],
  });

  // Gemiddeld verschil per categorie uit de opgeslagen diffs.
  const sommen = new Map<MatchCategory, number>();
  let totaalDelta = 0;
  for (const rij of rijen) {
    const diff = rij.diff as Partial<ShadowDiff> | null;
    for (const categorie of CATEGORIEEN) {
      const entry = diff?.[categorie];
      if (entry && typeof entry.delta === "number") {
        sommen.set(categorie, (sommen.get(categorie) ?? 0) + entry.delta);
      }
    }
    totaalDelta += rij.shadowScore - rij.baseScore;
  }
  const perCategorie: CategorieVerschil[] = CATEGORIEEN.map((categorie) => ({
    categorie,
    gemiddeldDelta:
      rijen.length === 0
        ? 0
        : Math.round(((sommen.get(categorie) ?? 0) / rijen.length) * 10) / 10,
    verklaring: CATEGORIE_VERKLARING[categorie] ?? null,
  }));

  // Geanonimiseerde grootste stijgers en dalers (alleen eligible paren —
  // ineligible scoort in beide versies 0).
  const movers: ShadowMover[] = rijen
    .filter((rij) => rij.baseEligible)
    .map((rij) => ({
      pseudoniem: kandidaatPseudoniem(rij.candidateUserId),
      baseScore: rij.baseScore,
      shadowScore: rij.shadowScore,
      delta: rij.shadowScore - rij.baseScore,
    }));
  const opDelta = [...movers].sort(
    (a, b) => b.delta - a.delta || a.pseudoniem.localeCompare(b.pseudoniem),
  );
  const topStijgers = opDelta.filter((m) => m.delta > 0).slice(0, 5);
  const topDalers = opDelta
    .filter((m) => m.delta < 0)
    .slice(-5)
    .reverse();

  const paren: EligibilityPair[] = rijen.map((rij) => ({
    vacancyId: rij.vacancyId,
    candidateId: kandidaatPseudoniem(rij.candidateUserId),
    baseEligible: rij.baseEligible,
    shadowEligible: rij.shadowEligible,
  }));

  return {
    shadowVersion,
    baseVersion: rijen[0]?.baseVersion ?? ALGORITHM_VERSION,
    paren: rijen.length,
    vacatures: new Set(rijen.map((rij) => rij.vacancyId)).size,
    gemiddeldScoreDelta:
      rijen.length === 0 ? null : Math.round((totaalDelta / rijen.length) * 10) / 10,
    perCategorie,
    topStijgers,
    topDalers,
    regressies: hardMismatchRegressions(paren),
    evaluatieActief: evaluateAlgorithm(await evalSnapshots(), ALGORITHM_VERSION),
  };
}
