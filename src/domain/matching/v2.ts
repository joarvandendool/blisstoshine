// Matching-engine v2 — SCHADUWVERSIE (fase 7). Draait uitsluitend naast de
// actieve v1 (ALGORITHM_VERSION "1.0.0"); geen enkele zichtbare score komt
// hiervandaan. Promotie naar actief kan alleen via een expliciete wijziging
// van de actieve engine (src/domain/matching/engine.ts + servicelaag) —
// zie src/server/shadow-matching.ts.
//
// Zelfde contract als v1: computeMatchV2(candidate, vacancy) → MatchResult.
// Deterministisch: geen Date.now(), geen Math.random().
//
// HARDE MISMATCHES: identiek aan v1 — v2 hergebruikt letterlijk de
// hard-mismatch-uitkomst van computeMatch (v1), zodat er per constructie geen
// regressies op eligibility kunnen ontstaan (een kandidaat is in v2 eligible
// dan en slechts dan als die het in v1 is).
//
// PRIVACY: net als v1 gebruikt de scoring uitsluitend werkgerelateerde
// gegevens (rol, ervaring, beschikbaarheid, reistijd, contractwensen,
// vakinhoud, werkplekvoorkeuren). Er zitten géén beschermde of gevoelige
// persoonsgegevens (gezondheid, afkomst, leeftijd, geslacht, …) in de
// invoertypen of in de berekening — dat was in v1 al zo en blijft zo.
//
// VERBETERINGEN t.o.v. v1, onderbouwd op de feedbackpraktijk
// (MatchDecisionFeedback-redencodes en pipeline-uitkomsten):
// (1) REISTIJD — zachtere curve. v1 loopt lineair naar 0 bij 130% van de
//     maximale reistijd; kandidaten nét boven hun maximum vallen daardoor
//     hard weg terwijl de afwijsreden "reisafstand" in de praktijk zelden
//     over enkele minuten gaat. v2 bouwt cosinusvormig af naar 0 bij 160%,
//     zodat "net boven max" een lage maar geen nul-score geeft.
// (2) VOORKEURSDAGEN — overlap op preferred-dagdelen weegt zwaarder naarmate
//     de vacature méér preferred-slots heeft: een rooster dat vooral uit
//     wensen bestaat, zegt dan ook echt iets over de aansluiting.
// (3) ONTWIKKELMATCH — "wil leren mét begeleiding" telt iets zwaarder
//     (0.85 i.p.v. 0.8): trajecten met leerwens + begeleiding leiden in de
//     pipeline relatief vaak tot een gesprek.
// (4) CULTUUR/POPULATIE — werkplekvoorkeur-onderdelen tellen alleen mee
//     wanneer BEIDE kanten data hebben. v1 telt ontbrekende onderdelen als
//     neutraal (60), wat scores van goed ingevulde profielen vertekent; v2
//     middelt uitsluitend over onderdelen met data aan beide kanten.

import {
  DAYPARTS,
  WEEKDAYS,
  type CandidateAvailability,
  type CriterionLevel,
  type VacancySchedule,
} from "../taxonomy";
import {
  AVAILABILITY_LEVEL_VALUES,
  CATEGORY_WEIGHTS,
  CRITERION_LEVEL_WEIGHTS,
  DEVELOPMENT_MATCH_VALUES,
  LABEL_THRESHOLDS,
  NEUTRAL_SCORE,
  TRAVEL_MODEL,
} from "./config";
import { bepaalOntwikkelMatch, computeMatch } from "./engine";
import type {
  CategoryScores,
  MatchCandidate,
  MatchCategory,
  MatchLabel,
  MatchResult,
  MatchVacancy,
} from "./types";

/** Versie van de schaduwengine; wordt nooit als actieve versie weggeschreven. */
export const ALGORITHM_VERSION_V2 = "2.0.0-shadow";

// ---------------------------------------------------------------------------
// v2-configuratie — alleen de afwijkingen t.o.v. v1 (zie kop van dit bestand)
// ---------------------------------------------------------------------------

/** (1) Reistijd: zelfde comfortgrens als v1, maar afbouw tot 160% i.p.v. 130%. */
const TRAVEL_MODEL_V2 = {
  minutesPerKm: TRAVEL_MODEL.minutesPerKm,
  fullScoreFraction: TRAVEL_MODEL.fullScoreFraction, // 0.5 — ongewijzigd
  zeroScoreFraction: 1.6, // v1: 1.3 — zachtere staart
} as const;

/**
 * (2) Gewicht van preferred-dagdelen, afhankelijk van het aantal
 * preferred-slots in het hele rooster. v1 hanteert altijd 1 (required = 2).
 */
function preferredGewichtV2(aantalPreferredSlots: number): number {
  if (aantalPreferredSlots >= 6) return 1.5;
  if (aantalPreferredSlots >= 3) return 1.25;
  return CRITERION_LEVEL_WEIGHTS.preferred; // 1 — gelijk aan v1
}

/** (3) Ontwikkelmatch: alleen wantsToLearnWithMentorship wijkt af van v1. */
const DEVELOPMENT_MATCH_VALUES_V2 = {
  ...DEVELOPMENT_MATCH_VALUES,
  wantsToLearnWithMentorship: 0.85, // v1: 0.8
} as const;

/** Volledige v2-configuratie, reproduceerbaar op te slaan naast de v1-config. */
export const MATCHING_CONFIG_V2 = {
  algorithmVersion: ALGORITHM_VERSION_V2,
  basis: "1.0.0",
  weights: CATEGORY_WEIGHTS, // categoriegewichten ongewijzigd
  labelThresholds: LABEL_THRESHOLDS, // labelgrenzen ongewijzigd
  travelModel: TRAVEL_MODEL_V2,
  developmentMatchValues: DEVELOPMENT_MATCH_VALUES_V2,
  preferredSlotWeighting: { vanaf3: 1.25, vanaf6: 1.5 },
  workplacePreferences: "alleen onderdelen met data aan beide kanten",
} as const;

// ---------------------------------------------------------------------------
// Hulpfuncties (bewust lokaal — engine.ts blijft onaangeroerd)
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return NEUTRAL_SCORE;
  return Math.round(Math.min(100, Math.max(0, n)));
}

function veiligeLijst(waarden: string[] | undefined | null): string[] {
  return Array.isArray(waarden) ? waarden.filter((w) => typeof w === "string") : [];
}

/** Hemelsbrede afstand in kilometers — identiek aan v1 (haversine, 6371 km). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (graden: number) => (graden * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, a)));
}

interface CriteriumItem {
  waarde: string;
  niveau: CriterionLevel;
}

function criteriumItems(
  spec: { values: string[]; level: CriterionLevel } | undefined,
): CriteriumItem[] {
  if (!spec || !Array.isArray(spec.values)) return [];
  const niveau: CriterionLevel = spec.level ?? "preferred";
  return spec.values
    .filter((w) => typeof w === "string" && w.length > 0)
    .map((waarde) => ({ waarde, niveau }));
}

// ---------------------------------------------------------------------------
// (2) Beschikbaarheid met opgeschaald preferred-gewicht
// ---------------------------------------------------------------------------

function beoordeelBeschikbaarheidV2(
  availability: CandidateAvailability,
  schedule: VacancySchedule,
): number {
  // Tel eerst het aantal preferred-slots in het hele rooster: dat bepaalt hoe
  // zwaar preferred-dagdelen meetellen (verschil met v1, zie kop).
  let aantalPreferred = 0;
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      if (schedule?.[dag]?.[dagdeel] === "preferred") aantalPreferred += 1;
    }
  }
  const gewichtPreferred = preferredGewichtV2(aantalPreferred);

  let totaalGewicht = 0;
  let som = 0;
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      const eis = schedule?.[dag]?.[dagdeel] ?? null;
      if (eis !== "required" && eis !== "preferred") continue;
      const niveau = availability?.[dag]?.[dagdeel] ?? "unavailable";
      const gewicht =
        eis === "required" ? CRITERION_LEVEL_WEIGHTS.required : gewichtPreferred;
      totaalGewicht += gewicht;
      som += gewicht * (AVAILABILITY_LEVEL_VALUES[niveau] ?? 0);
    }
  }
  return totaalGewicht === 0 ? NEUTRAL_SCORE : (som / totaalGewicht) * 100;
}

// ---------------------------------------------------------------------------
// (1) Reistijd met zachte afbouwcurve
// ---------------------------------------------------------------------------

function beoordeelReizenV2(candidate: MatchCandidate, vacancy: MatchVacancy): number {
  const invoer = [candidate.latitude, candidate.longitude, vacancy.latitude, vacancy.longitude];
  const max = candidate.maxTravelMinutes;
  if (!invoer.every(Number.isFinite) || !Number.isFinite(max) || max <= 0) {
    return NEUTRAL_SCORE;
  }
  const km = haversineKm(candidate.latitude, candidate.longitude, vacancy.latitude, vacancy.longitude);
  const minuten = km * TRAVEL_MODEL_V2.minutesPerKm;
  const comfortGrens = max * TRAVEL_MODEL_V2.fullScoreFraction;
  const nulGrens = max * TRAVEL_MODEL_V2.zeroScoreFraction;
  if (minuten <= comfortGrens) return 100;
  if (minuten >= nulGrens) return 0;
  // Cosinusvormige afbouw (verschil met v1, dat lineair afbouwt naar 0 bij
  // 130%): vlak aflopend rond de comfortgrens, een staart boven het maximum.
  const t = (minuten - comfortGrens) / (nulGrens - comfortGrens); // 0..1
  return 50 * (1 + Math.cos(Math.PI * t));
}

// ---------------------------------------------------------------------------
// (3) Apparatuur en software met zwaardere begeleide leerwens
// ---------------------------------------------------------------------------

function beoordeelApparatuurEnSoftwareV2(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): number {
  const items = [
    ...criteriumItems(vacancy.criteria?.equipment),
    ...criteriumItems(vacancy.criteria?.software),
  ];
  let totaalGewicht = 0;
  let som = 0;

  for (const item of items) {
    const gewicht = CRITERION_LEVEL_WEIGHTS[item.niveau];
    if (gewicht === 0) continue; // "informational" telt niet mee — gelijk aan v1
    const match = bepaalOntwikkelMatch(candidate, item.waarde, item.niveau);
    let waarde: number;
    switch (match) {
      case "direct_experience":
        waarde = DEVELOPMENT_MATCH_VALUES_V2.directExperience;
        break;
      case "strong_interest":
        waarde = DEVELOPMENT_MATCH_VALUES_V2.strongInterest;
        break;
      case "wants_to_learn":
        waarde = vacancy.mentorship
          ? DEVELOPMENT_MATCH_VALUES_V2.wantsToLearnWithMentorship // 0.85, v1: 0.8
          : DEVELOPMENT_MATCH_VALUES_V2.wantsToLearnWithoutMentorship;
        break;
      case "mismatch":
        waarde = DEVELOPMENT_MATCH_VALUES_V2.mismatch;
        break;
      default:
        waarde = DEVELOPMENT_MATCH_VALUES_V2.neutral;
    }
    totaalGewicht += gewicht;
    som += gewicht * waarde;
  }

  return totaalGewicht === 0 ? NEUTRAL_SCORE : (som / totaalGewicht) * 100;
}

// ---------------------------------------------------------------------------
// (4) Werkplekvoorkeuren: alleen onderdelen met data aan beide kanten
// ---------------------------------------------------------------------------

function beoordeelWerkplekVoorkeurenV2(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): number {
  const neutraal = NEUTRAL_SCORE / 100;
  // Verschil met v1: ontbreekt data aan één van beide kanten, dan wordt het
  // onderdeel OVERGESLAGEN in plaats van als neutraal (60) meegeteld.
  const delen: number[] = [];
  const cultuur = veiligeLijst(vacancy.culture);

  // Praktijkgrootte — alleen wanneer kandidaat een voorkeur heeft én de
  // praktijkgrootte bekend is.
  const gewensteGrootte = candidate.preferredPracticeSize;
  if (gewensteGrootte && gewensteGrootte !== "geen_voorkeur" && vacancy.practiceSize) {
    delen.push(gewensteGrootte === vacancy.practiceSize ? 1 : 0.3);
  }

  // Werktempo — alleen wanneer kandidaat een tempo heeft én de cultuur er
  // iets over zegt.
  const tempo = candidate.workPace;
  if (tempo && tempo !== "geen_voorkeur" && cultuur.length > 0) {
    if (cultuur.includes("rustig_tempo")) {
      delen.push(tempo === "rustig" ? 1 : tempo === "hoog" ? 0.3 : neutraal);
    } else if (cultuur.includes("ambitieus") || cultuur.includes("hightech")) {
      delen.push(tempo === "hoog" ? 1 : tempo === "rustig" ? 0.3 : neutraal);
    }
    // cultuur zonder tempo-signaal: geen uitspraak mogelijk → overslaan
  }

  // Teamvoorkeuren — alleen wanneer de vacature praktijkgrootte of cultuur
  // meegeeft (anders valt er niets te vergelijken).
  const teamVoorkeuren = veiligeLijst(candidate.teamPreferences);
  if (teamVoorkeuren.length > 0 && (vacancy.practiceSize || cultuur.length > 0)) {
    const perVoorkeur = teamVoorkeuren.map((voorkeur) => {
      switch (voorkeur) {
        case "klein_team":
          return vacancy.practiceSize === "klein" ? 1 : vacancy.practiceSize === "groot" ? 0.2 : neutraal;
        case "groot_team":
          return vacancy.practiceSize === "groot" ? 1 : vacancy.practiceSize === "klein" ? 0.2 : neutraal;
        case "veel_overleg":
          return cultuur.includes("informeel") || cultuur.includes("familiegevoel") ? 1 : neutraal;
        case "zelfstandig_werken":
          return cultuur.includes("gestructureerd") ? 0.8 : neutraal;
        default:
          return neutraal;
      }
    });
    delen.push(perVoorkeur.reduce((som, d) => som + d, 0) / perVoorkeur.length);
  }

  // Patiëntpopulatie — alleen wanneer beide kanten data hebben (kern van
  // verbetering (4)).
  const gevraagdePopulatie = Array.from(
    new Set([
      ...veiligeLijst(vacancy.patientPopulation),
      ...criteriumItems(vacancy.criteria?.population).map((item) => item.waarde),
    ]),
  );
  const voorkeurPopulatie = veiligeLijst(candidate.preferredPopulation);
  if (voorkeurPopulatie.length > 0 && gevraagdePopulatie.length > 0) {
    const gedeeld = voorkeurPopulatie.filter((p) => gevraagdePopulatie.includes(p)).length;
    delen.push(
      0.2 + 0.8 * clamp01(gedeeld / Math.min(voorkeurPopulatie.length, gevraagdePopulatie.length)),
    );
  }

  // Begeleiding — alleen relevant wanneer de kandidaat begeleiding zoekt;
  // zonder die wens valt er niets te matchen → overslaan (v1 telt neutraal).
  if (candidate.mentorshipNeeded) {
    delen.push(vacancy.mentorship ? 1 : 0.2);
  }

  // Geen enkel onderdeel met data aan beide kanten → neutrale categoriescore
  // (dezelfde defensieve terugval als elders in de engine).
  if (delen.length === 0) return NEUTRAL_SCORE;
  return (delen.reduce((som, d) => som + d, 0) / delen.length) * 100;
}

// ---------------------------------------------------------------------------
// Label en samenvatting (gelijk aan v1)
// ---------------------------------------------------------------------------

function scoreLabel(score: number): Exclude<MatchLabel, "ineligible"> {
  if (score >= LABEL_THRESHOLDS.excellent) return "excellent";
  if (score >= LABEL_THRESHOLDS.good) return "good";
  if (score >= LABEL_THRESHOLDS.partial) return "partial";
  return "low";
}

const LABEL_SAMENVATTING: Record<Exclude<MatchLabel, "ineligible">, string> = {
  excellent: "uitstekende aansluiting op de gevraagde criteria",
  good: "goede aansluiting op de gevraagde criteria",
  partial: "gedeeltelijke aansluiting op de gevraagde criteria",
  low: "beperkte aansluiting op de gevraagde criteria",
};

// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------

/**
 * Schaduwscore v2 — zelfde contract als computeMatch (v1).
 *
 * De harde mismatches komen letterlijk uit v1 (computeMatch), zodat
 * eligibility per constructie identiek is. De categorieën functie/ervaring,
 * dienstverband en specialisaties zijn inhoudelijk ongewijzigd en worden
 * daarom uit het v1-resultaat overgenomen; beschikbaarheid, reistijd,
 * apparatuur/software en werkplekvoorkeuren worden met de v2-regels
 * (zie kop van dit bestand) opnieuw berekend. Ook de uitlegteksten
 * (strengths/attentionPoints) komen uit v1: de redenen blijven geldig, alleen
 * de weging verschilt — zo blijft elke v2-match even uitlegbaar als in v1.
 */
export function computeMatchV2(candidate: MatchCandidate, vacancy: MatchVacancy): MatchResult {
  const v1 = computeMatch(candidate, vacancy);

  const categoryScores: CategoryScores = {
    // Opnieuw berekend volgens de v2-regels:
    availability: clampScore(beoordeelBeschikbaarheidV2(candidate.availability, vacancy.schedule)),
    travel: clampScore(beoordeelReizenV2(candidate, vacancy)),
    equipmentAndSoftware: clampScore(beoordeelApparatuurEnSoftwareV2(candidate, vacancy)),
    workplacePreferences: clampScore(beoordeelWerkplekVoorkeurenV2(candidate, vacancy)),
    // Inhoudelijk ongewijzigd t.o.v. v1 — overgenomen uit het v1-resultaat:
    roleAndExperience: v1.categoryScores.roleAndExperience,
    employment: v1.categoryScores.employment,
    specializations: v1.categoryScores.specializations,
  };

  // Harde mismatch: identiek aan v1 (geen regressies mogelijk). De
  // categoriescores zijn dan informatief, net als in v1.
  if (!v1.eligible) {
    return {
      ...v1,
      categoryScores,
      algorithmVersion: ALGORITHM_VERSION_V2,
    };
  }

  const gewogenTotaal = (Object.keys(CATEGORY_WEIGHTS) as MatchCategory[]).reduce(
    (som, categorie) => som + CATEGORY_WEIGHTS[categorie] * categoryScores[categorie],
    0,
  );
  const score = clampScore(gewogenTotaal);
  const labelWaarde = scoreLabel(score);

  return {
    eligible: true,
    score,
    label: labelWaarde,
    summary: `${score}% match — ${LABEL_SAMENVATTING[labelWaarde]}.`,
    hardMismatchReasons: [],
    strengths: v1.strengths,
    attentionPoints: v1.attentionPoints,
    categoryScores,
    opportunities: [],
    algorithmVersion: ALGORITHM_VERSION_V2,
  };
}
