// Unit tests voor de matching-evaluatiemodule (fase 7) — puur domein.
// Kern: precision@top5 en acceptatie worden correct berekend, regressie-
// detectie werkt in beide richtingen en te kleine steekproeven geven
// insufficientData in plaats van schijnprecisie.

import { describe, expect, it } from "vitest";

import {
  evaluateAlgorithm,
  explainableShare,
  hardMismatchRegressions,
  interviewRate,
  invitationAcceptanceTop5,
  placementRate,
  precisionAtTop5,
  timeToHireMedian,
  timeToInterviewMedian,
  type EvalOutcome,
  type EvalSnapshot,
} from "@/domain/matching-eval";

function uitkomst(overrides: Partial<EvalOutcome> = {}): EvalOutcome {
  return {
    invited: false,
    interested: false,
    declined: false,
    declineReason: null,
    interviewed: false,
    offered: false,
    hired: false,
    withdrawn: false,
    daysToInterview: null,
    daysToHire: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<EvalSnapshot> = {}): EvalSnapshot {
  return {
    vacancyId: "vac-1",
    candidateId: "kand-1",
    score: 80,
    label: "good",
    eligible: true,
    version: "1.0.0",
    role: "mondhygienist",
    regio: "Utrecht",
    hasStrengthReason: true,
    outcome: null,
    ...overrides,
  };
}

describe("precisionAtTop5", () => {
  it("telt alleen de top-5 per vacature en meet positieve uitkomsten", () => {
    // 7 eligible kandidaten op één vacature: alleen de 5 hoogste scores
    // tellen mee. Scores 90..30; de top-5 (90,80,70,60,50) heeft 3 positieve
    // uitkomsten → precision 0.6. De twee laagste (40, 30) zijn positief maar
    // vallen buiten de top-5 en mogen het resultaat niet beïnvloeden.
    const snapshots = [90, 80, 70, 60, 50, 40, 30].map((score, i) =>
      snapshot({
        candidateId: `kand-${i}`,
        score,
        outcome: uitkomst({
          invited: true,
          interested: score >= 70 || score <= 40, // 90, 80, 70 in top-5 positief
        }),
      }),
    );
    const uitkomstWaarde = precisionAtTop5(snapshots);
    expect(uitkomstWaarde.value).toBe(0.6);
    expect(uitkomstWaarde.sampleSize).toBe(5);
    expect(uitkomstWaarde.insufficientData).toBe(false);
  });

  it("negeert ineligible snapshots en snapshots zonder traject", () => {
    const snapshots = [
      snapshot({ candidateId: "a", eligible: false, outcome: uitkomst({ interested: true }) }),
      snapshot({ candidateId: "b", outcome: null }),
    ];
    const waarde = precisionAtTop5(snapshots);
    expect(waarde.value).toBeNull();
    expect(waarde.insufficientData).toBe(true);
  });

  it("geeft insufficientData onder de minimumsteekproef", () => {
    const snapshots = [
      snapshot({ candidateId: "a", outcome: uitkomst({ interested: true }) }),
      snapshot({ candidateId: "b", outcome: uitkomst() }),
    ];
    const waarde = precisionAtTop5(snapshots); // n=2 < 5
    expect(waarde.value).toBeNull();
    expect(waarde.insufficientData).toBe(true);
    expect(waarde.sampleSize).toBe(2);
  });
});

describe("invitationAcceptanceTop5", () => {
  it("meet acceptatie alleen over uitgenodigde top-5-matches", () => {
    const snapshots = [
      // 5 uitgenodigd, 4 geaccepteerd → 0.8
      ...[0, 1, 2, 3].map((i) =>
        snapshot({
          candidateId: `ja-${i}`,
          score: 90 - i,
          outcome: uitkomst({ invited: true, interested: true }),
        }),
      ),
      snapshot({
        candidateId: "nee",
        score: 91,
        outcome: uitkomst({ invited: true, declined: true }),
      }),
      // niet uitgenodigd én buiten de top-5 → telt niet mee in de noemer
      snapshot({ candidateId: "spontaan", score: 60, outcome: uitkomst({ interested: true }) }),
    ];
    const waarde = invitationAcceptanceTop5(snapshots);
    expect(waarde.sampleSize).toBe(5);
    expect(waarde.value).toBe(0.8);
  });
});

describe("interview-, plaatsings- en doorlooptijdmetrics", () => {
  const snapshots = Array.from({ length: 10 }, (_, i) =>
    snapshot({
      vacancyId: `vac-${i}`, // elk eigen vacature: geen top-5-afkap hier
      candidateId: `kand-${i}`,
      outcome: uitkomst({
        invited: true,
        interviewed: i < 4,
        hired: i < 2,
        daysToInterview: i < 4 ? i + 2 : null, // 2,3,4,5
        daysToHire: i < 2 ? 10 + i : null,
      }),
    }),
  );

  it("berekent interviewRate en placementRate over eligible trajecten", () => {
    expect(interviewRate(snapshots).value).toBe(0.4);
    expect(placementRate(snapshots).value).toBe(0.2);
  });

  it("berekent doorlooptijdmedianen en respecteert de minimumsteekproef", () => {
    const interview = timeToInterviewMedian(snapshots, 4);
    expect(interview.value).toBe(3.5); // mediaan van 2,3,4,5
    expect(interview.sampleSize).toBe(4);

    const hire = timeToHireMedian(snapshots); // n=2 < 5
    expect(hire.value).toBeNull();
    expect(hire.insufficientData).toBe(true);
  });
});

describe("uitlegbaarheid", () => {
  it("meet het aandeel eligible matches met minstens één strength-reden", () => {
    const snapshots = [
      ...Array.from({ length: 4 }, (_, i) =>
        snapshot({ candidateId: `uitleg-${i}`, hasStrengthReason: true }),
      ),
      snapshot({ candidateId: "kaal", hasStrengthReason: false }),
      snapshot({ candidateId: "hard", eligible: false, hasStrengthReason: false }),
    ];
    const waarde = explainableShare(snapshots);
    expect(waarde.sampleSize).toBe(5); // alleen eligible
    expect(waarde.value).toBe(0.8);
  });
});

describe("hard-mismatch-regressiedetectie (beide richtingen)", () => {
  it("vindt paren die alleen in de basisversie of alleen in de schaduwversie eligible zijn", () => {
    const paren = [
      { vacancyId: "v1", candidateId: "a", baseEligible: true, shadowEligible: true },
      { vacancyId: "v1", candidateId: "b", baseEligible: false, shadowEligible: false },
      // regressie richting 1: v1 eligible, v2 hard-ineligible
      { vacancyId: "v1", candidateId: "c", baseEligible: true, shadowEligible: false },
      // regressie richting 2: v1 hard-ineligible, v2 eligible
      { vacancyId: "v2", candidateId: "d", baseEligible: false, shadowEligible: true },
    ];
    const regressies = hardMismatchRegressions(paren);

    expect(regressies.totalPairs).toBe(4);
    expect(regressies.eligibleInBaseOnly).toEqual([paren[2]]);
    expect(regressies.eligibleInShadowOnly).toEqual([paren[3]]);
  });

  it("is leeg wanneer eligibility overal gelijk is", () => {
    const regressies = hardMismatchRegressions([
      { vacancyId: "v1", candidateId: "a", baseEligible: true, shadowEligible: true },
      { vacancyId: "v1", candidateId: "b", baseEligible: false, shadowEligible: false },
    ]);
    expect(regressies.eligibleInBaseOnly).toHaveLength(0);
    expect(regressies.eligibleInShadowOnly).toHaveLength(0);
  });
});

describe("evaluateAlgorithm", () => {
  it("filtert op versie en splitst uit per functie en regio met insufficientData", () => {
    const snapshots = [
      ...Array.from({ length: 6 }, (_, i) =>
        snapshot({
          vacancyId: "vac-a",
          candidateId: `v1-${i}`,
          score: 90 - i,
          version: "1.0.0",
          role: "mondhygienist",
          regio: "Utrecht",
          outcome: uitkomst({ invited: true, interested: i % 2 === 0 }),
        }),
      ),
      // andere versie: mag niet meetellen
      snapshot({ candidateId: "v2-x", version: "2.0.0-shadow", outcome: uitkomst({ interested: true }) }),
    ];
    const evaluatie = evaluateAlgorithm(snapshots, "1.0.0");

    expect(evaluatie.version).toBe("1.0.0");
    expect(evaluatie.snapshotCount).toBe(6);
    // top-5 van vac-a: scores 90..86 → 3 van 5 positief
    expect(evaluatie.precisionAtTop5.value).toBe(0.6);
    expect(evaluatie.perRole).toHaveLength(1);
    expect(evaluatie.perRole[0].segment).toBe("mondhygienist");
    expect(evaluatie.perRegio[0].segment).toBe("Utrecht");
    // doorlooptijden ontbreken → onvoldoende data, geen schijnprecisie
    expect(evaluatie.timeToInterviewMedianDays.insufficientData).toBe(true);
    expect(evaluatie.timeToHireMedianDays.insufficientData).toBe(true);
  });
});
