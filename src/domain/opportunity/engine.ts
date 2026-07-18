// Opportunity-engine ("Maak deze match mogelijk"). Pure domeinlogica:
// - onderzoekt concrete verschillen tussen kandidaat en vacature;
// - haalt telkens een AANGEPASTE KOPIE van kandidaat of vacature opnieuw door
//   computeMatch (de originelen worden nooit gemuteerd) en meet zo de
//   geprojecteerde score van elk voorstel;
// - retourneert alleen voorstellen die de score aantoonbaar verhogen
//   (projectedScore > currentScore), aflopend gesorteerd, maximaal drie;
// - werkt ook voor ineligible basisresultaten: een voorstel dat de harde
//   mismatch wegneemt maakt de kandidaat weer matchbaar (score > 0);
// - deterministisch: identieke invoer geeft identieke voorstellen.

import {
  DAYPARTS,
  WEEKDAYS,
  label,
  type CriterionLevel,
  type CriterionSpec,
  type Daypart,
  type Weekday,
} from "../taxonomy";
import {
  bepaalOntwikkelMatch,
  computeMatch,
  type MatchCandidate,
  type MatchOpportunity,
  type MatchResult,
  type MatchVacancy,
} from "../matching";

/** Maximaal aantal voorstellen dat per match wordt teruggegeven. */
const MAX_VOORSTELLEN = 3;

// ---------------------------------------------------------------------------
// Hulpfuncties — bewust lokaal: deze module leunt uitsluitend op de publieke
// API van taxonomy en matching.
// ---------------------------------------------------------------------------

interface Slot {
  dag: Weekday;
  dagdeel: Daypart;
}

/** Criteriumsleutel van een roosterslot, bv. "schedule.wo.ochtend". */
function slotSleutel(slot: Slot): string {
  return `schedule.${slot.dag}.${slot.dagdeel}`;
}

/** Dag en dagdeel als één Nederlands woord, bv. "woensdagochtend". */
function slotNaam(slot: Slot): string {
  return `${label(slot.dag).toLowerCase()}${label(slot.dagdeel).toLowerCase()}`;
}

/** "a, b en c" of "a, b of c" — voor opsommingen midden in een zin. */
function lijstTekst(items: string[], voegwoord: "en" | "of" = "en"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${voegwoord} ${items[items.length - 1]}`;
}

/** Deterministische datumtekst (dd-mm-jjjj, UTC). */
function datumTekst(datum: Date): string {
  const dag = String(datum.getUTCDate()).padStart(2, "0");
  const maand = String(datum.getUTCMonth() + 1).padStart(2, "0");
  return `${dag}-${maand}-${datum.getUTCFullYear()}`;
}

function veiligeLijst(waarden: string[] | undefined | null): string[] {
  return Array.isArray(waarden) ? waarden.filter((w) => typeof w === "string") : [];
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

/** Nederlandse effectzin: wat er met de match gebeurt als het voorstel doorgaat. */
function effectTekst(basis: MatchResult, projected: MatchResult): string {
  if (!basis.eligible && projected.eligible) {
    return `wordt deze kandidaat weer een match van ${projected.score}%`;
  }
  return `stijgt de match van ${basis.score}% naar ${projected.score}%`;
}

/** Intern voorstel: aangepaste kopieën plus presentatie, vóór projectie. */
interface Voorstel {
  code: string;
  candidate: MatchCandidate;
  vacancy: MatchVacancy;
  affectedCriteria: string[];
  requiresCandidateApproval: boolean;
  requiresPracticeApproval: boolean;
  title: string;
  explanation: (basis: MatchResult, projected: MatchResult) => string;
}

// ---------------------------------------------------------------------------
// Strategieën — elke strategie levert nul of meer voorstellen op basis van
// diepe kopieën (structuredClone); de originelen blijven onaangeroerd.
// ---------------------------------------------------------------------------

/** "relax_required_day": verplicht dagdeel waar de kandidaat niet kan → voorkeur. */
function voorstellenRelaxRequiredDay(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): Voorstel[] {
  const conflicten: Slot[] = [];
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      const eis = vacancy.schedule?.[dag]?.[dagdeel] ?? null;
      const niveau = candidate.availability?.[dag]?.[dagdeel] ?? "unavailable";
      if (eis === "required" && niveau === "unavailable") conflicten.push({ dag, dagdeel });
    }
  }
  if (conflicten.length === 0) return [];

  // Eén voorstel per conflictslot; bij meerdere conflicten ook één gecombineerd
  // voorstel (losse versoepelingen nemen de harde mismatch dan niet weg).
  const groepen: Slot[][] = conflicten.map((slot) => [slot]);
  if (conflicten.length > 1) groepen.push([...conflicten]);

  return groepen.map((groep) => {
    const kopie = structuredClone(vacancy);
    for (const slot of groep) kopie.schedule[slot.dag][slot.dagdeel] = "preferred";
    const namen = groep.map(slotNaam);
    return {
      code: "relax_required_day",
      candidate,
      vacancy: kopie,
      affectedCriteria: groep.map(slotSleutel),
      requiresCandidateApproval: false,
      requiresPracticeApproval: true,
      title:
        groep.length === 1
          ? `Maak ${namen[0]} flexibel in plaats van verplicht`
          : `Maak de verplichte dagdelen ${lijstTekst(namen)} flexibel`,
      explanation: (basis, projected) =>
        groep.length === 1
          ? `De vacature vraagt ${namen[0]} als verplicht dagdeel, maar de kandidaat is dan niet beschikbaar. Wanneer de praktijk ${namen[0]} als voorkeur behandelt in plaats van als verplichting, ${effectTekst(basis, projected)}.`
          : `De kandidaat is niet beschikbaar op de verplichte dagdelen ${lijstTekst(namen)}. Wanneer de praktijk deze dagdelen als voorkeur behandelt in plaats van als verplichting, ${effectTekst(basis, projected)}.`,
    };
  });
}

/** "flex_candidate_day": kandidaat is "available" op een gevraagd slot → vraag voorkeur. */
function voorstellenFlexCandidateDay(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): Voorstel[] {
  const voorstellen: Voorstel[] = [];
  for (const dag of WEEKDAYS) {
    for (const dagdeel of DAYPARTS) {
      const eis = vacancy.schedule?.[dag]?.[dagdeel] ?? null;
      if (eis !== "required" && eis !== "preferred") continue;
      const niveau = candidate.availability?.[dag]?.[dagdeel] ?? "unavailable";
      if (niveau !== "available") continue;

      const slot: Slot = { dag, dagdeel };
      const kopie = structuredClone(candidate);
      kopie.availability[dag][dagdeel] = "preferred";
      const naam = slotNaam(slot);
      voorstellen.push({
        code: "flex_candidate_day",
        candidate: kopie,
        vacancy,
        affectedCriteria: [slotSleutel(slot)],
        requiresCandidateApproval: true,
        requiresPracticeApproval: false,
        title: `Vraag de kandidaat ${naam} als voorkeursdagdeel te zien`,
        explanation: (basis, projected) =>
          `De kandidaat is beschikbaar op ${naam}, maar ziet dit nog niet als voorkeursdagdeel. Wanneer ${naam} flexibel is, ${effectTekst(basis, projected)}.`,
      });
    }
  }
  return voorstellen;
}

/** "lower_min_hours": vacature-minimum verlagen tot het maximum van de kandidaat. */
function voorstelLowerMinHours(candidate: MatchCandidate, vacancy: MatchVacancy): Voorstel[] {
  if (
    !Number.isFinite(candidate.hoursMax) ||
    !Number.isFinite(vacancy.hoursMin) ||
    candidate.hoursMax >= vacancy.hoursMin
  ) {
    return [];
  }
  const kopie = structuredClone(vacancy);
  kopie.hoursMin = candidate.hoursMax;
  return [
    {
      code: "lower_min_hours",
      candidate,
      vacancy: kopie,
      affectedCriteria: ["hoursMin"],
      requiresCandidateApproval: false,
      requiresPracticeApproval: true,
      title: `Verlaag het minimum naar ${candidate.hoursMax} uur per week`,
      explanation: (basis, projected) =>
        `De vacature vraagt minimaal ${vacancy.hoursMin} uur per week, terwijl de kandidaat maximaal ${candidate.hoursMax} uur wil werken. Wanneer de praktijk het minimum verlaagt naar ${candidate.hoursMax} uur, ${effectTekst(basis, projected)}.`,
    },
  ];
}

/** "offer_mentorship": kandidaat wil gevraagde apparatuur/software leren, praktijk biedt (nog) geen begeleiding. */
function voorstelOfferMentorship(candidate: MatchCandidate, vacancy: MatchVacancy): Voorstel[] {
  if (vacancy.mentorship) return [];
  const gevraagd = [
    ...criteriumItems(vacancy.criteria?.equipment),
    ...criteriumItems(vacancy.criteria?.software),
  ];
  const leerwensen = Array.from(
    new Set(
      gevraagd
        .filter(
          (item) => bepaalOntwikkelMatch(candidate, item.waarde, item.niveau) === "wants_to_learn",
        )
        .map((item) => item.waarde),
    ),
  );
  if (leerwensen.length === 0) return [];

  const kopie = structuredClone(vacancy);
  kopie.mentorship = true;
  const labels = leerwensen.map((waarde) => label(waarde));
  return [
    {
      code: "offer_mentorship",
      candidate,
      vacancy: kopie,
      affectedCriteria: ["mentorship"],
      requiresCandidateApproval: false,
      requiresPracticeApproval: true,
      title: `Bied begeleiding aan bij ${lijstTekst(labels)}`,
      explanation: (basis, projected) =>
        `De kandidaat wil ${lijstTekst(labels)} leren, maar de vacature biedt geen begeleiding. Wanneer de praktijk begeleiding aanbiedt, ${effectTekst(basis, projected)}.`,
    },
  ];
}

/** "accept_later_start": harde uiterste startdatum opschuiven tot de beschikbaarheidsdatum van de kandidaat. */
function voorstelAccepteerLatereStart(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): Voorstel[] {
  if (
    !vacancy.startByHard ||
    !(vacancy.startBy instanceof Date) ||
    !(candidate.availableFrom instanceof Date) ||
    candidate.availableFrom.getTime() <= vacancy.startBy.getTime()
  ) {
    return [];
  }
  const kopie = structuredClone(vacancy);
  kopie.startBy = new Date(candidate.availableFrom.getTime());
  const vanaf = datumTekst(candidate.availableFrom);
  const uiterlijk = datumTekst(vacancy.startBy);
  return [
    {
      code: "accept_later_start",
      candidate,
      vacancy: kopie,
      affectedCriteria: ["startBy"],
      requiresCandidateApproval: false,
      requiresPracticeApproval: true,
      title: `Accepteer een startdatum per ${vanaf}`,
      explanation: (basis, projected) =>
        `De kandidaat is pas beschikbaar vanaf ${vanaf}, na de harde uiterste startdatum ${uiterlijk}. Wanneer de praktijk de startdatum opschuift naar ${vanaf}, ${effectTekst(basis, projected)}.`,
    },
  ];
}

/** "alternative_contract": contractvorm van de kandidaat toevoegen als er geen overlap is. */
function voorstelAlternatiefContract(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): Voorstel[] {
  const kandidaatVormen = veiligeLijst(candidate.contractTypes);
  const vacatureVormen = veiligeLijst(vacancy.contractTypes);
  if (kandidaatVormen.length === 0 || vacatureVormen.length === 0) return [];
  if (kandidaatVormen.some((vorm) => vacatureVormen.includes(vorm))) return [];

  const kopie = structuredClone(vacancy);
  kopie.contractTypes = [
    ...vacatureVormen,
    ...kandidaatVormen.filter((vorm) => !vacatureVormen.includes(vorm)),
  ];
  const kandidaatLabels = kandidaatVormen.map((vorm) => label(vorm));
  const vacatureLabels = vacatureVormen.map((vorm) => label(vorm));
  return [
    {
      code: "alternative_contract",
      candidate,
      vacancy: kopie,
      affectedCriteria: ["contractTypes"],
      requiresCandidateApproval: true,
      requiresPracticeApproval: true,
      title: `Bied ook ${lijstTekst(kandidaatLabels, "of")} aan als contractvorm`,
      explanation: (basis, projected) =>
        `Kandidaat en vacature delen geen contractvorm: de kandidaat wil ${lijstTekst(kandidaatLabels, "of")}, de vacature biedt ${lijstTekst(vacatureLabels, "of")}. Wanneer de praktijk ook ${lijstTekst(kandidaatLabels, "of")} aanbiedt, ${effectTekst(basis, projected)}.`,
    },
  ];
}

/** Alle kandidaat-voorstellen in vaste, deterministische volgorde. */
function verzamelVoorstellen(candidate: MatchCandidate, vacancy: MatchVacancy): Voorstel[] {
  return [
    ...voorstellenRelaxRequiredDay(candidate, vacancy),
    ...voorstellenFlexCandidateDay(candidate, vacancy),
    ...voorstelLowerMinHours(candidate, vacancy),
    ...voorstelOfferMentorship(candidate, vacancy),
    ...voorstelAccepteerLatereStart(candidate, vacancy),
    ...voorstelAlternatiefContract(candidate, vacancy),
  ];
}

// ---------------------------------------------------------------------------
// Publieke API
// ---------------------------------------------------------------------------

/**
 * Genereert "Maak deze match mogelijk"-voorstellen. Elk voorstel is gemeten
 * door een aangepaste kopie door computeMatch te halen; alleen voorstellen met
 * projectedScore > currentScore blijven over, aflopend gesorteerd op
 * projectedScore (bij gelijke score in strategievolgorde), maximaal drie.
 */
export function generateOpportunities(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
  base?: MatchResult,
): MatchOpportunity[] {
  const basis = base ?? computeMatch(candidate, vacancy);

  const uitkomsten: MatchOpportunity[] = [];
  for (const voorstel of verzamelVoorstellen(candidate, vacancy)) {
    const projected = computeMatch(voorstel.candidate, voorstel.vacancy);
    if (projected.score <= basis.score) continue; // alleen aantoonbare verbetering
    uitkomsten.push({
      code: voorstel.code,
      title: voorstel.title,
      explanation: voorstel.explanation(basis, projected),
      currentScore: basis.score,
      projectedScore: projected.score,
      affectedCriteria: voorstel.affectedCriteria,
      requiresCandidateApproval: voorstel.requiresCandidateApproval,
      requiresPracticeApproval: voorstel.requiresPracticeApproval,
    });
  }

  // Stabiele sortering: aflopend op projectedScore, ties behouden invoervolgorde.
  uitkomsten.sort((a, b) => b.projectedScore - a.projectedScore);
  return uitkomsten.slice(0, MAX_VOORSTELLEN);
}

/** computeMatch met gevulde opportunities — verder identiek aan het basisresultaat. */
export function computeMatchWithOpportunities(
  candidate: MatchCandidate,
  vacancy: MatchVacancy,
): MatchResult {
  const basis = computeMatch(candidate, vacancy);
  return { ...basis, opportunities: generateOpportunities(candidate, vacancy, basis) };
}
