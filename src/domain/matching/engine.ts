// Deterministische matching-engine. Pure domeinlogica:
// - geen database, geen React, geen routes;
// - geen Date.now() of Math.random() — identieke input geeft identieke output;
// - datumvergelijkingen uitsluitend tussen meegegeven datums;
// - ontbrekende gegevens leiden tot een neutrale categoriescore, nooit tot een crash.

import {
  DAYPARTS,
  WEEKDAYS,
  label,
  type CandidateAvailability,
  type CriterionLevel,
  type CriterionSpec,
  type Daypart,
  type VacancySchedule,
  type Weekday,
} from "../taxonomy";
import {
  ALGORITHM_VERSION,
  AVAILABILITY_LEVEL_VALUES,
  CATEGORY_WEIGHTS,
  CRITERION_LEVEL_WEIGHTS,
  DEVELOPMENT_MATCH_VALUES,
  EMPLOYMENT_WEIGHTS,
  HARD_REGISTRATIONS,
  LABEL_THRESHOLDS,
  NEUTRAL_SCORE,
  TRAVEL_MODEL,
} from "./config";
import type {
  CategoryScores,
  DevelopmentMatch,
  MatchCandidate,
  MatchCategory,
  MatchLabel,
  MatchReason,
  MatchResult,
  MatchVacancy,
} from "./types";

// ---------------------------------------------------------------------------
// Kleine hulpfuncties
// ---------------------------------------------------------------------------

const EXPERIENCE_ORDER: Record<string, number> = { starter: 0, medior: 1, senior: 2 };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Clamp naar 0–100 en rond af; niet-finite waarden vallen terug op neutraal. */
function clampScore(n: number): number {
  if (!Number.isFinite(n)) return NEUTRAL_SCORE;
  return Math.round(Math.min(100, Math.max(0, n)));
}

function veiligeLijst(waarden: string[] | undefined | null): string[] {
  return Array.isArray(waarden) ? waarden.filter((w) => typeof w === "string") : [];
}

function gemiddelde(delen: number[]): number {
  if (delen.length === 0) return NEUTRAL_SCORE / 100;
  return delen.reduce((som, d) => som + d, 0) / delen.length;
}

function lowerFirst(tekst: string): string {
  return tekst.charAt(0).toLowerCase() + tekst.slice(1);
}

/** "a, b en c" — voor labels die mid-zin blijven zoals ze zijn. */
function lijstTekst(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} en ${items[items.length - 1]}`;
}

/**
 * Dagnamen als lijst: "Dinsdag en donderdag" (eerste met hoofdletter) of
 * volledig in kleine letters voor gebruik midden in een zin.
 */
function dagenTekst(dagen: Weekday[], opties?: { kleineLetters?: boolean }): string {
  const labels = dagen.map((dag, i) =>
    i === 0 && !opties?.kleineLetters ? label(dag) : label(dag).toLowerCase(),
  );
  return lijstTekst(labels);
}

/** "dinsdag (ochtend) en donderdag (middag)" */
function slotTekst(slots: Array<{ dag: Weekday; dagdeel: Daypart }>): string {
  return lijstTekst(
    slots.map((s) => `${label(s.dag).toLowerCase()} (${label(s.dagdeel).toLowerCase()})`),
  );
}

/** Deterministische datumtekst (dd-mm-jjjj, UTC). */
function datumTekst(datum: Date): string {
  const dag = String(datum.getUTCDate()).padStart(2, "0");
  const maand = String(datum.getUTCMonth() + 1).padStart(2, "0");
  return `${dag}-${maand}-${datum.getUTCFullYear()}`;
}

/** Hemelsbrede afstand in kilometers (haversine, aardstraal 6371 km). */
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

function criteriumItems(spec: CriterionSpec | undefined): CriteriumItem[] {
  if (!spec || !Array.isArray(spec.values)) return [];
  const niveau: CriterionLevel = spec.level ?? "preferred";
  return spec.values
    .filter((w) => typeof w === "string" && w.length > 0)
    .map((waarde) => ({ waarde, niveau }));
}

// ---------------------------------------------------------------------------
// Beschikbaarheid
// ---------------------------------------------------------------------------

interface BeschikbaarheidsUitkomst {
  score: number;
  /** Dagen waarop álle gevraagde dagdelen aansluiten (preferred of available). */
  volledigeDagen: Weekday[];
  verplichteConflicten: Array<{ dag: Weekday; dagdeel: Daypart }>;
  gewensteConflicten: Array<{ dag: Weekday; dagdeel: Daypart }>;
}

function beoordeelBeschikbaarheid(
  availability: CandidateAvailability,
  schedule: VacancySchedule,
): BeschikbaarheidsUitkomst {
  let totaalGewicht = 0;
  let som = 0;
  const volledigeDagen: Weekday[] = [];
  const verplichteConflicten: Array<{ dag: Weekday; dagdeel: Daypart }> = [];
  const gewensteConflicten: Array<{ dag: Weekday; dagdeel: Daypart }> = [];

  for (const dag of WEEKDAYS) {
    let gevraagd = 0;
    let aansluitend = 0;
    for (const dagdeel of DAYPARTS) {
      const eis = schedule?.[dag]?.[dagdeel] ?? null;
      if (eis !== "required" && eis !== "preferred") continue;
      gevraagd += 1;
      const niveau = availability?.[dag]?.[dagdeel] ?? "unavailable";
      const gewicht = CRITERION_LEVEL_WEIGHTS[eis];
      totaalGewicht += gewicht;
      som += gewicht * (AVAILABILITY_LEVEL_VALUES[niveau] ?? 0);
      if (niveau === "unavailable") {
        (eis === "required" ? verplichteConflicten : gewensteConflicten).push({ dag, dagdeel });
      } else {
        aansluitend += 1;
      }
    }
    if (gevraagd > 0 && aansluitend === gevraagd) volledigeDagen.push(dag);
  }

  const score = totaalGewicht === 0 ? NEUTRAL_SCORE : (som / totaalGewicht) * 100;
  return { score, volledigeDagen, verplichteConflicten, gewensteConflicten };
}

// ---------------------------------------------------------------------------
// Functie en ervaring
// ---------------------------------------------------------------------------

function beoordeelFunctieEnErvaring(candidate: MatchCandidate, vacancy: MatchVacancy): number {
  const functieScore = candidate.role === vacancy.role ? 100 : 0;
  const gevraagd = vacancy.experienceLevel;
  if (!gevraagd) return functieScore;

  const kandidaatNiveau = EXPERIENCE_ORDER[candidate.experienceLevel];
  const gevraagdNiveau = EXPERIENCE_ORDER[gevraagd];
  let ervaringScore: number;
  if (kandidaatNiveau === undefined || gevraagdNiveau === undefined) {
    ervaringScore = NEUTRAL_SCORE;
  } else if (kandidaatNiveau === gevraagdNiveau) {
    ervaringScore = 100;
  } else if (kandidaatNiveau > gevraagdNiveau) {
    ervaringScore = 85; // meer ervaring dan gevraagd: prima, kleine demping
  } else {
    ervaringScore = kandidaatNiveau === gevraagdNiveau - 1 ? 55 : 30;
  }
  return functieScore * 0.6 + ervaringScore * 0.4;
}

// ---------------------------------------------------------------------------
// Reizen
// ---------------------------------------------------------------------------

interface ReisUitkomst {
  score: number;
  minuten: number | null;
  bovenMax: boolean;
}

function beoordeelReizen(candidate: MatchCandidate, vacancy: MatchVacancy): ReisUitkomst {
  const invoer = [candidate.latitude, candidate.longitude, vacancy.latitude, vacancy.longitude];
  const max = candidate.maxTravelMinutes;
  if (!invoer.every(Number.isFinite) || !Number.isFinite(max) || max <= 0) {
    return { score: NEUTRAL_SCORE, minuten: null, bovenMax: false };
  }
  const km = haversineKm(candidate.latitude, candidate.longitude, vacancy.latitude, vacancy.longitude);
  const minuten = km * TRAVEL_MODEL.minutesPerKm;
  const comfortGrens = max * TRAVEL_MODEL.fullScoreFraction;
  const nulGrens = max * TRAVEL_MODEL.zeroScoreFraction;
  let score: number;
  if (minuten <= comfortGrens) score = 100;
  else if (minuten >= nulGrens) score = 0;
  else score = ((nulGrens - minuten) / (nulGrens - comfortGrens)) * 100;
  return { score, minuten, bovenMax: minuten > max };
}

// ---------------------------------------------------------------------------
// Dienstverband
// ---------------------------------------------------------------------------

interface BeloningUitkomst {
  /** 0–1: hoe goed het bod de wens dekt (1 = volledig gedekt). */
  ratio: number;
  /** True zodra er aan één gedeelde contractvorm beloningsgegevens zijn. */
  dataAanwezig: boolean;
  /** True wanneer het bod onder de wens ligt (aandachtspunt). */
  tekort: boolean;
  /** Welke contractvorm het gunstigst uitpakte, voor de uitleg. */
  vorm: "zzp" | "loondienst" | null;
}

/**
 * Beoordeelt de beloning per gedeelde contractvorm (v1.1.0). Voor zzp geldt het
 * omzetpercentage (geheel getal 0–100, nooit een fractie of uurtarief), voor
 * loondienst het maandsalaris. De regel is telkens: dekt het geboden maximum de
 * gewenste ondergrens? Zo ja → 1; zo nee → geboden/gewenst (naar rato). De
 * gunstigste haalbare vorm telt. Zonder gegevens aan beide kanten: neutraal,
 * geen straf en geen aandachtspunt (onbekend ≠ mismatch).
 */
function beoordeelBeloning(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  gedeeldeContractvormen: string[],
): BeloningUitkomst {
  const opties: { ratio: number; vorm: "zzp" | "loondienst" }[] = [];

  if (gedeeldeContractvormen.includes("zzp")) {
    const wens = candidate.revenueShareMin;
    const bod = vacancy.revenueShareMax;
    if (wens != null && bod != null) {
      opties.push({ ratio: wens <= 0 ? 1 : clamp01(bod / wens), vorm: "zzp" });
    }
  }
  if (gedeeldeContractvormen.includes("loondienst")) {
    const wens = candidate.salaryMin;
    const bod = vacancy.salaryMax;
    if (wens != null && bod != null) {
      opties.push({ ratio: wens <= 0 ? 1 : clamp01(bod / wens), vorm: "loondienst" });
    }
  }

  if (opties.length === 0) {
    return { ratio: NEUTRAL_SCORE / 100, dataAanwezig: false, tekort: false, vorm: null };
  }
  const beste = opties.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  // Kleine marge zodat afrondingsruis geen vals aandachtspunt oplevert.
  return { ratio: beste.ratio, dataAanwezig: true, tekort: beste.ratio < 0.999, vorm: beste.vorm };
}

interface DienstverbandUitkomst {
  score: number;
  gedeeldeContractvormen: string[];
  contractDataAanwezig: boolean;
  beloning: BeloningUitkomst;
}

function beoordeelDienstverband(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): DienstverbandUitkomst {
  // Urenoverlap: doorsnede van de ranges t.o.v. de kandidaatwens.
  const cMin = candidate.hoursMin;
  const cMax = candidate.hoursMax;
  const vMin = vacancy.hoursMin;
  const vMax = vacancy.hoursMax;
  let urenRatio: number;
  if (![cMin, cMax, vMin, vMax].every(Number.isFinite) || cMin > cMax || vMin > vMax) {
    urenRatio = NEUTRAL_SCORE / 100;
  } else {
    const overlap = Math.min(cMax, vMax) - Math.max(cMin, vMin);
    const kandidaatBreedte = cMax - cMin;
    urenRatio =
      kandidaatBreedte <= 0
        ? cMin >= vMin && cMin <= vMax
          ? 1
          : 0
        : clamp01(overlap / kandidaatBreedte);
  }

  // Contractvorm-overlap.
  const kandidaatVormen = veiligeLijst(candidate.contractTypes);
  const vacatureVormen = veiligeLijst(vacancy.contractTypes);
  const gedeeld = kandidaatVormen.filter((vorm) => vacatureVormen.includes(vorm));
  const contractDataAanwezig = kandidaatVormen.length > 0 && vacatureVormen.length > 0;
  const contractRatio = contractDataAanwezig
    ? clamp01(gedeeld.length / Math.min(kandidaatVormen.length, vacatureVormen.length))
    : NEUTRAL_SCORE / 100;

  const beloning = beoordeelBeloning(candidate, vacancy, gedeeld);

  const score =
    (urenRatio * EMPLOYMENT_WEIGHTS.hours +
      contractRatio * EMPLOYMENT_WEIGHTS.contract +
      beloning.ratio * EMPLOYMENT_WEIGHTS.compensation) *
    100;
  return { score, gedeeldeContractvormen: gedeeld, contractDataAanwezig, beloning };
}

// ---------------------------------------------------------------------------
// Apparatuur en software (ontwikkelmatch)
// ---------------------------------------------------------------------------

/** Bepaalt het ontwikkelmatch-niveau voor één gevraagde apparatuur-/softwarewaarde. */
export function bepaalOntwikkelMatch(
  candidate: MatchCandidate,
  waarde: string,
  niveau: CriterionLevel,
): DevelopmentMatch {
  const directeErvaring = new Set([
    ...veiligeLijst(candidate.equipmentExperience),
    ...veiligeLijst(candidate.softwareSkills),
  ]);
  if (directeErvaring.has(waarde)) return "direct_experience";
  if (veiligeLijst(candidate.equipmentWantsToWork).includes(waarde)) return "strong_interest";
  if (veiligeLijst(candidate.techniquesWantsToLearn).includes(waarde)) return "wants_to_learn";
  return niveau === "required" ? "mismatch" : "neutral";
}

function beoordeelApparatuurEnSoftware(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  strengths: MatchReason[],
  attentionPoints: MatchReason[],
): number {
  const items = [
    ...criteriumItems(vacancy.criteria?.equipment),
    ...criteriumItems(vacancy.criteria?.software),
  ];
  let totaalGewicht = 0;
  let som = 0;

  for (const item of items) {
    const gewicht = CRITERION_LEVEL_WEIGHTS[item.niveau];
    if (gewicht === 0) continue; // "informational" telt niet mee in de score
    const match = bepaalOntwikkelMatch(candidate, item.waarde, item.niveau);
    let waarde: number;
    switch (match) {
      case "direct_experience":
        waarde = DEVELOPMENT_MATCH_VALUES.directExperience;
        if (item.niveau === "required") {
          strengths.push({
            code: "apparatuur_directe_ervaring",
            category: "equipmentAndSoftware",
            message: `Kandidaat heeft ervaring met ${label(item.waarde)} — een verplicht criterium van deze vacature.`,
          });
        }
        break;
      case "strong_interest":
        waarde = DEVELOPMENT_MATCH_VALUES.strongInterest;
        break;
      case "wants_to_learn":
        if (vacancy.mentorship) {
          waarde = DEVELOPMENT_MATCH_VALUES.wantsToLearnWithMentorship;
          strengths.push({
            code: "wil_leren_met_begeleiding",
            category: "equipmentAndSoftware",
            message: `Kandidaat wil ${label(item.waarde)} leren en de praktijk biedt begeleiding.`,
          });
        } else {
          waarde = DEVELOPMENT_MATCH_VALUES.wantsToLearnWithoutMentorship;
        }
        break;
      case "mismatch":
        waarde = DEVELOPMENT_MATCH_VALUES.mismatch;
        attentionPoints.push({
          code: "verplichte_apparatuur_ontbreekt",
          category: "equipmentAndSoftware",
          message: `Vacature vraagt ${label(item.waarde)} (verplicht); kandidaat heeft hier geen ervaring mee en heeft geen leerwens.`,
        });
        break;
      default:
        waarde = DEVELOPMENT_MATCH_VALUES.neutral;
    }
    totaalGewicht += gewicht;
    som += gewicht * waarde;
  }

  return totaalGewicht === 0 ? NEUTRAL_SCORE : (som / totaalGewicht) * 100;
}

// ---------------------------------------------------------------------------
// Specialisaties en behandelingen
// ---------------------------------------------------------------------------

function beoordeelSpecialisaties(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  strengths: MatchReason[],
  attentionPoints: MatchReason[],
): number {
  const items = [
    ...criteriumItems(vacancy.criteria?.specializations),
    ...criteriumItems(vacancy.criteria?.treatments),
  ];
  const kandidaatHeeft = new Set([
    ...veiligeLijst(candidate.specializations),
    ...veiligeLijst(candidate.treatmentInterests),
  ]);

  let totaalGewicht = 0;
  let som = 0;
  const passend: string[] = [];

  for (const item of items) {
    const gewicht = CRITERION_LEVEL_WEIGHTS[item.niveau];
    if (gewicht === 0) continue;
    totaalGewicht += gewicht;
    if (kandidaatHeeft.has(item.waarde)) {
      som += gewicht * 1;
      passend.push(item.waarde);
    } else if (item.niveau === "required") {
      som += gewicht * DEVELOPMENT_MATCH_VALUES.mismatch;
      attentionPoints.push({
        code: "verplichte_specialisatie_ontbreekt",
        category: "specializations",
        message: `Vacature vraagt ${label(item.waarde)} (verplicht), maar dit staat niet in het kandidaatprofiel.`,
      });
    } else {
      som += gewicht * DEVELOPMENT_MATCH_VALUES.neutral;
    }
  }

  if (passend.length > 0) {
    const labels = passend.map((waarde) => label(waarde).toLowerCase());
    strengths.push({
      code: "specialisatie_overlap",
      category: "specializations",
      message:
        passend.length === 1
          ? `Specialisatie of behandelinteresse ${labels[0]} sluit aan bij de vacature.`
          : `Specialisaties en behandelinteresses ${lijstTekst(labels)} sluiten aan bij de vacature.`,
    });
  }

  return totaalGewicht === 0 ? NEUTRAL_SCORE : (som / totaalGewicht) * 100;
}

// ---------------------------------------------------------------------------
// Werkplekvoorkeuren
// ---------------------------------------------------------------------------

function beoordeelWerkplekVoorkeuren(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  strengths: MatchReason[],
  attentionPoints: MatchReason[],
): number {
  const neutraal = NEUTRAL_SCORE / 100;
  const delen: number[] = [];
  const cultuur = veiligeLijst(vacancy.culture);

  // Praktijkgrootte
  const gewensteGrootte = candidate.preferredPracticeSize;
  if (gewensteGrootte && gewensteGrootte !== "geen_voorkeur" && vacancy.practiceSize) {
    delen.push(gewensteGrootte === vacancy.practiceSize ? 1 : 0.3);
  } else {
    delen.push(neutraal);
  }

  // Werktempo, afgeleid uit de praktijkcultuur
  const tempo = candidate.workPace;
  if (tempo && tempo !== "geen_voorkeur" && cultuur.length > 0) {
    if (cultuur.includes("rustig_tempo")) {
      delen.push(tempo === "rustig" ? 1 : tempo === "hoog" ? 0.3 : neutraal);
    } else if (cultuur.includes("ambitieus") || cultuur.includes("hightech")) {
      delen.push(tempo === "hoog" ? 1 : tempo === "rustig" ? 0.3 : neutraal);
    } else {
      delen.push(neutraal);
    }
  } else {
    delen.push(neutraal);
  }

  // Teamvoorkeuren t.o.v. praktijkgrootte en cultuur
  const teamVoorkeuren = veiligeLijst(candidate.teamPreferences);
  if (teamVoorkeuren.length > 0) {
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
    delen.push(gemiddelde(perVoorkeur));
  } else {
    delen.push(neutraal);
  }

  // Patiëntpopulatie
  const gevraagdePopulatie = Array.from(
    new Set([
      ...veiligeLijst(vacancy.patientPopulation),
      ...criteriumItems(vacancy.criteria?.population).map((item) => item.waarde),
    ]),
  );
  const voorkeurPopulatie = veiligeLijst(candidate.preferredPopulation);
  if (voorkeurPopulatie.length > 0 && gevraagdePopulatie.length > 0) {
    const gedeeld = voorkeurPopulatie.filter((p) => gevraagdePopulatie.includes(p)).length;
    delen.push(0.2 + 0.8 * clamp01(gedeeld / Math.min(voorkeurPopulatie.length, gevraagdePopulatie.length)));
  } else {
    delen.push(neutraal);
  }

  // Begeleiding
  if (candidate.mentorshipNeeded) {
    if (vacancy.mentorship) {
      delen.push(1);
      strengths.push({
        code: "begeleiding_aanwezig",
        category: "workplacePreferences",
        message: "Kandidaat zoekt begeleiding en de praktijk biedt dit.",
      });
    } else {
      delen.push(0.2);
      attentionPoints.push({
        code: "begeleiding_ontbreekt",
        category: "workplacePreferences",
        message: "Kandidaat zoekt begeleiding, maar de vacature biedt geen begeleiding.",
      });
    }
  } else {
    delen.push(neutraal);
  }

  return gemiddelde(delen) * 100;
}

// ---------------------------------------------------------------------------
// Harde mismatches
// ---------------------------------------------------------------------------

function verzamelHardeMismatches(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  verplichteConflicten: Array<{ dag: Weekday; dagdeel: Daypart }>,
  contractDataAanwezig: boolean,
  gedeeldeContractvormen: string[],
): MatchReason[] {
  const redenen: MatchReason[] = [];

  // 1. Verkeerde functie
  if (candidate.role !== vacancy.role) {
    redenen.push({
      code: "functie_ongelijk",
      category: "roleAndExperience",
      message: `Verkeerde functie: de vacature vraagt een ${label(vacancy.role).toLowerCase()}, de kandidaat is ${label(candidate.role).toLowerCase()}.`,
    });
  }

  // 2. Ontbrekende verplichte registratie/bevoegdheid — alleen hard voor de
  //    registraties die het profiel betrouwbaar draagt (HARD_REGISTRATIONS,
  //    de functie-gebonden BIG-registraties). Overige gevraagde registraties
  //    (KRT/KRM/röntgen) legt het profiel niet vast en gelden als zacht
  //    signaal (zie computeMatch) i.p.v. een pool-brede uitsluiting.
  const registraties = vacancy.criteria?.registrations;
  if (registraties && registraties.level === "required") {
    const kandidaatRegistraties = veiligeLijst(candidate.registrations);
    const ontbrekend = veiligeLijst(registraties.values).filter(
      (waarde) =>
        HARD_REGISTRATIONS.includes(waarde) &&
        !kandidaatRegistraties.includes(waarde),
    );
    if (ontbrekend.length > 0) {
      redenen.push({
        code: "verplichte_registratie_ontbreekt",
        category: "roleAndExperience",
        message:
          ontbrekend.length === 1
            ? `Verplichte registratie ontbreekt: ${label(ontbrekend[0])}.`
            : `Verplichte registraties ontbreken: ${lijstTekst(ontbrekend.map((w) => label(w)))}.`,
      });
    }
  }

  // 3. Geen overlap met een verplicht dagdeel
  if (verplichteConflicten.length > 0) {
    redenen.push({
      code: "verplicht_dagdeel_geen_overlap",
      category: "availability",
      message:
        verplichteConflicten.length === 1
          ? `Kandidaat is niet beschikbaar op het verplichte dagdeel ${slotTekst(verplichteConflicten)}.`
          : `Kandidaat is niet beschikbaar op de verplichte dagdelen ${slotTekst(verplichteConflicten)}.`,
    });
  }

  // 4. Geen enkele gemeenschappelijke contractvorm
  if (contractDataAanwezig && gedeeldeContractvormen.length === 0) {
    const kandidaatVormen = veiligeLijst(candidate.contractTypes).map((v) => label(v));
    const vacatureVormen = veiligeLijst(vacancy.contractTypes).map((v) => label(v));
    redenen.push({
      code: "geen_gemeenschappelijke_contractvorm",
      category: "employment",
      message: `Geen gemeenschappelijke contractvorm: de kandidaat wil ${lijstTekst(kandidaatVormen)}, de vacature biedt ${lijstTekst(vacatureVormen)}.`,
    });
  }

  // 5. Kandidaat pas beschikbaar na een harde uiterste startdatum
  if (
    vacancy.startByHard &&
    candidate.availableFrom instanceof Date &&
    vacancy.startBy instanceof Date &&
    candidate.availableFrom.getTime() > vacancy.startBy.getTime()
  ) {
    redenen.push({
      code: "startdatum_te_laat",
      category: "employment",
      message: `Kandidaat is pas beschikbaar vanaf ${datumTekst(candidate.availableFrom)}, na de harde uiterste startdatum ${datumTekst(vacancy.startBy)}.`,
    });
  }

  return redenen;
}

// ---------------------------------------------------------------------------
// Label en samenvatting
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

function maakSamenvatting(
  score: number,
  labelWaarde: Exclude<MatchLabel, "ineligible">,
  volledigeDagen: Weekday[],
): string {
  let kern: string;
  if (volledigeDagen.length === 1) {
    kern = `${dagenTekst(volledigeDagen, { kleineLetters: true })} sluit volledig aan`;
  } else if (volledigeDagen.length > 1) {
    kern = `${dagenTekst(volledigeDagen, { kleineLetters: true })} sluiten volledig aan`;
  } else {
    kern = LABEL_SAMENVATTING[labelWaarde];
  }
  return `${score}% match — ${kern}.`;
}

// ---------------------------------------------------------------------------
// Hoofdfunctie
// ---------------------------------------------------------------------------

export function computeMatch(candidate: MatchCandidate, vacancy: MatchVacancy): MatchResult {
  const strengths: MatchReason[] = [];
  const attentionPoints: MatchReason[] = [];

  // Categoriescores worden altijd berekend — bij een harde mismatch informatief.
  const beschikbaarheid = beoordeelBeschikbaarheid(candidate.availability, vacancy.schedule);
  const reizen = beoordeelReizen(candidate, vacancy);
  const dienstverband = beoordeelDienstverband(candidate, vacancy);

  const categoryScores: CategoryScores = {
    availability: clampScore(beschikbaarheid.score),
    roleAndExperience: clampScore(beoordeelFunctieEnErvaring(candidate, vacancy)),
    travel: clampScore(reizen.score),
    employment: clampScore(dienstverband.score),
    equipmentAndSoftware: clampScore(
      beoordeelApparatuurEnSoftware(candidate, vacancy, strengths, attentionPoints),
    ),
    specializations: clampScore(
      beoordeelSpecialisaties(candidate, vacancy, strengths, attentionPoints),
    ),
    workplacePreferences: clampScore(
      beoordeelWerkplekVoorkeuren(candidate, vacancy, strengths, attentionPoints),
    ),
  };

  // Sterke punten en aandachtspunten rond beschikbaarheid en reistijd.
  if (beschikbaarheid.volledigeDagen.length > 0) {
    const dagen = beschikbaarheid.volledigeDagen;
    strengths.push({
      code: "dagen_sluiten_volledig_aan",
      category: "availability",
      message:
        dagen.length === 1
          ? `${dagenTekst(dagen)} sluit volledig aan.`
          : `${dagenTekst(dagen)} sluiten volledig aan.`,
    });
  }
  if (beschikbaarheid.gewensteConflicten.length > 0) {
    attentionPoints.push({
      code: "gewenst_dagdeel_niet_beschikbaar",
      category: "availability",
      message: `Kandidaat is niet beschikbaar op ${slotTekst(beschikbaarheid.gewensteConflicten)} — door de praktijk gewenste dagdelen.`,
    });
  }
  if (reizen.minuten !== null) {
    const minuten = Math.round(reizen.minuten);
    if (reizen.bovenMax) {
      attentionPoints.push({
        code: "reistijd_boven_maximum",
        category: "travel",
        message: `Geschatte reistijd van ongeveer ${minuten} minuten is langer dan de maximale reistijd van ${candidate.maxTravelMinutes} minuten van de kandidaat.`,
      });
    } else if (reizen.minuten <= candidate.maxTravelMinutes * TRAVEL_MODEL.fullScoreFraction) {
      strengths.push({
        code: "reistijd_ruim_binnen_maximum",
        category: "travel",
        message: `Geschatte reistijd van ongeveer ${minuten} minuten valt ruim binnen de maximale ${candidate.maxTravelMinutes} minuten.`,
      });
    }
  }

  // Beloning: zacht signaal binnen dienstverband (v1.1.0). Een te laag bod
  // drukt de score en levert een aandachtspunt op; een passend bod is een
  // sterk punt. Bewust kwalitatief geformuleerd — geen exacte bedragen/
  // percentages in de uitleg.
  if (dienstverband.beloning.dataAanwezig) {
    if (dienstverband.beloning.tekort) {
      attentionPoints.push({
        code: "beloning_onder_wens",
        category: "employment",
        message:
          dienstverband.beloning.vorm === "zzp"
            ? "Het geboden omzetpercentage ligt onder het percentage dat de kandidaat wenst — bespreekbaar."
            : "Het geboden salaris ligt onder de salariswens van de kandidaat — bespreekbaar.",
      });
    } else {
      strengths.push({
        code: "beloning_sluit_aan",
        category: "employment",
        message:
          dienstverband.beloning.vorm === "zzp"
            ? "Het geboden omzetpercentage sluit aan bij de wens van de kandidaat."
            : "Het geboden salaris sluit aan bij de wens van de kandidaat.",
      });
    }
  }

  // Gevraagde registraties die het profiel niet betrouwbaar vastlegt
  // (bv. KRT/KRM/röntgen): zacht aandachtspunt i.p.v. een harde uitsluiting,
  // zodat een courante eis niet de héle kandidatenpool wegfiltert (v1.1.0).
  const gevraagdeRegistraties = vacancy.criteria?.registrations;
  if (gevraagdeRegistraties && gevraagdeRegistraties.level === "required") {
    const kandidaatRegistraties = veiligeLijst(candidate.registrations);
    const nietVastgelegd = veiligeLijst(gevraagdeRegistraties.values).filter(
      (waarde) =>
        !HARD_REGISTRATIONS.includes(waarde) &&
        !kandidaatRegistraties.includes(waarde),
    );
    if (nietVastgelegd.length > 0) {
      attentionPoints.push({
        code: "registratie_niet_in_profiel",
        category: "roleAndExperience",
        message:
          nietVastgelegd.length === 1
            ? `De praktijk vraagt ${label(nietVastgelegd[0])} — het kandidaatprofiel legt dit niet vast; bevestig dit met de kandidaat.`
            : `De praktijk vraagt ${lijstTekst(nietVastgelegd.map((w) => label(w)))} — het kandidaatprofiel legt deze niet vast; bevestig dit met de kandidaat.`,
      });
    }
  }

  const hardMismatchReasons = verzamelHardeMismatches(
    candidate,
    vacancy,
    beschikbaarheid.verplichteConflicten,
    dienstverband.contractDataAanwezig,
    dienstverband.gedeeldeContractvormen,
  );

  if (hardMismatchReasons.length > 0) {
    return {
      eligible: false,
      score: 0,
      label: "ineligible",
      summary: `Geen match — ${lowerFirst(hardMismatchReasons[0].message)}`,
      hardMismatchReasons,
      strengths,
      attentionPoints,
      categoryScores,
      opportunities: [],
      algorithmVersion: ALGORITHM_VERSION,
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
    summary: maakSamenvatting(score, labelWaarde, beschikbaarheid.volledigeDagen),
    hardMismatchReasons: [],
    strengths,
    attentionPoints,
    categoryScores,
    opportunities: [],
    algorithmVersion: ALGORITHM_VERSION,
  };
}
