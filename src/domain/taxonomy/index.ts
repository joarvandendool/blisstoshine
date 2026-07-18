// Gedeelde mondzorg-taxonomie. Eén bron van waarheid voor kandidaatprofielen,
// vacatures, matching en Talent Radar. Sleutels zijn stabiel (opslag);
// labels zijn presentatie.

export const WEEKDAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const DAYPARTS = ["ochtend", "middag", "avond"] as const;
export type Daypart = (typeof DAYPARTS)[number];

export type AvailabilityLevel = "preferred" | "available" | "unavailable";
export type ScheduleRequirement = "required" | "preferred" | null;

/** Beschikbaarheid van een kandidaat per weekdag en dagdeel. */
export type CandidateAvailability = Record<
  Weekday,
  Record<Daypart, AvailabilityLevel>
>;

/** Gevraagde werkdagen/dagdelen van een vacature. null = niet gevraagd. */
export type VacancySchedule = Record<
  Weekday,
  Record<Daypart, ScheduleRequirement>
>;

export type CriterionLevel = "required" | "preferred" | "informational";

export interface CriterionSpec {
  values: string[];
  level: CriterionLevel;
}

/** Gestructureerde vacaturecriteria naast het rooster. */
export interface VacancyCriteria {
  registrations?: CriterionSpec; // bevoegdheden/registraties (bv. BIG, KRM)
  equipment?: CriterionSpec;
  software?: CriterionSpec;
  specializations?: CriterionSpec;
  treatments?: CriterionSpec;
  population?: CriterionSpec;
}

export const ROLES = [
  "tandarts",
  "mondhygienist",
  "tandartsassistent",
  "preventieassistent",
  "orthodontieassistent",
  "praktijkmanager",
] as const;
export type Role = (typeof ROLES)[number];

export const EXPERIENCE_LEVELS = ["starter", "medior", "senior"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const CONTRACT_TYPES = ["loondienst", "zzp", "detachering", "stage"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const REGISTRATIONS = [
  "big_tandarts",
  "big_mondhygienist",
  "krt",
  "krm",
  "rontgenbevoegdheid",
] as const;

export const EQUIPMENT = [
  "trios",
  "cerec",
  "primescan",
  "itero",
  "opg",
  "cbct",
  "microscoop",
  "laser",
  "airflow",
] as const;

export const SOFTWARE = [
  "exquise",
  "simplex",
  "evolution",
  "oase",
  "novadent",
  "curve",
] as const;

export const SPECIALIZATIONS = [
  "parodontologie",
  "endodontologie",
  "implantologie",
  "orthodontie",
  "kindertandheelkunde",
  "angstbegeleiding",
  "esthetiek",
  "prothetiek",
  "gnathologie",
] as const;

export const TREATMENTS = [
  "periodieke_controle",
  "restauratief",
  "wortelkanaalbehandeling",
  "extracties",
  "gebitsreiniging",
  "facings",
  "kronen_bruggen",
  "implantaten",
  "beugelbehandeling",
] as const;

export const PATIENT_POPULATION = [
  "kinderen",
  "volwassenen",
  "ouderen",
  "angstpatienten",
  "medisch_gecompromitteerd",
] as const;

export const CULTURE = [
  "informeel",
  "gestructureerd",
  "leergericht",
  "familiegevoel",
  "ambitieus",
  "rustig_tempo",
  "hightech",
  "patientgericht",
] as const;

export const DEVELOPMENT = [
  "interne_opleiding",
  "congresbudget",
  "intervisie",
  "specialisatietraject",
  "doorgroei_management",
] as const;

export const PRACTICE_SIZES = ["klein", "middel", "groot", "geen_voorkeur"] as const;
export const WORK_PACES = ["rustig", "gemiddeld", "hoog", "geen_voorkeur"] as const;

export const TEAM_PREFERENCES = [
  "klein_team",
  "groot_team",
  "veel_overleg",
  "zelfstandig_werken",
  "jong_team",
  "ervaren_team",
] as const;

/** Nederlandse weergavelabels voor alle taxonomiesleutels. */
export const LABELS: Record<string, string> = {
  // rollen
  tandarts: "Tandarts",
  mondhygienist: "Mondhygiënist",
  tandartsassistent: "Tandartsassistent",
  preventieassistent: "Preventieassistent",
  orthodontieassistent: "Orthodontieassistent",
  praktijkmanager: "Praktijkmanager",
  // ervaring
  starter: "Starter",
  medior: "Medior",
  senior: "Senior",
  // contract
  loondienst: "Loondienst",
  zzp: "ZZP",
  detachering: "Detachering",
  stage: "Stage",
  // registraties
  big_tandarts: "BIG-registratie tandarts",
  big_mondhygienist: "BIG-registratie mondhygiënist",
  krt: "KRT-registratie",
  krm: "KRM-registratie",
  rontgenbevoegdheid: "Röntgenbevoegdheid",
  // apparatuur
  trios: "TRIOS intraorale scanner",
  cerec: "CEREC",
  primescan: "Primescan",
  itero: "iTero",
  opg: "Panoramische röntgen (OPG)",
  cbct: "CBCT",
  microscoop: "Microscoop",
  laser: "Laser",
  airflow: "AirFlow",
  // software
  exquise: "Exquise",
  simplex: "Simplex",
  evolution: "Evolution",
  oase: "Oase",
  novadent: "Novadent",
  curve: "Curve",
  // specialisaties
  parodontologie: "Parodontologie",
  endodontologie: "Endodontologie",
  implantologie: "Implantologie",
  orthodontie: "Orthodontie",
  kindertandheelkunde: "Kindertandheelkunde",
  angstbegeleiding: "Angstbegeleiding",
  esthetiek: "Esthetische tandheelkunde",
  prothetiek: "Prothetiek",
  gnathologie: "Gnathologie",
  // behandelingen
  periodieke_controle: "Periodieke controle",
  restauratief: "Restauratief werk",
  wortelkanaalbehandeling: "Wortelkanaalbehandeling",
  extracties: "Extracties",
  gebitsreiniging: "Gebitsreiniging",
  facings: "Facings",
  kronen_bruggen: "Kronen en bruggen",
  implantaten: "Implantaten",
  beugelbehandeling: "Beugelbehandeling",
  // populatie
  kinderen: "Kinderen",
  volwassenen: "Volwassenen",
  ouderen: "Ouderen",
  angstpatienten: "Angstpatiënten",
  medisch_gecompromitteerd: "Medisch gecompromitteerde patiënten",
  // cultuur
  informeel: "Informeel",
  gestructureerd: "Gestructureerd",
  leergericht: "Leergericht",
  familiegevoel: "Familiegevoel",
  ambitieus: "Ambitieus",
  rustig_tempo: "Rustig tempo",
  hightech: "Hightech",
  patientgericht: "Patiëntgericht",
  // ontwikkeling
  interne_opleiding: "Interne opleiding",
  congresbudget: "Congresbudget",
  intervisie: "Intervisie",
  specialisatietraject: "Specialisatietraject",
  doorgroei_management: "Doorgroei naar management",
  // grootte / tempo
  klein: "Klein",
  middel: "Middelgroot",
  groot: "Groot",
  geen_voorkeur: "Geen voorkeur",
  rustig: "Rustig",
  gemiddeld: "Gemiddeld",
  hoog: "Hoog",
  // team
  klein_team: "Klein team",
  groot_team: "Groot team",
  veel_overleg: "Veel overleg",
  zelfstandig_werken: "Zelfstandig werken",
  jong_team: "Jong team",
  ervaren_team: "Ervaren team",
  // weekdagen
  ma: "Maandag",
  di: "Dinsdag",
  wo: "Woensdag",
  do: "Donderdag",
  vr: "Vrijdag",
  za: "Zaterdag",
  zo: "Zondag",
  // dagdelen
  ochtend: "Ochtend",
  middag: "Middag",
  avond: "Avond",
};

export function label(key: string): string {
  return LABELS[key] ?? key;
}

/** Lege beschikbaarheid (alles unavailable) — handig voor onboarding en tests. */
export function emptyAvailability(): CandidateAvailability {
  const out = {} as CandidateAvailability;
  for (const d of WEEKDAYS) {
    out[d] = { ochtend: "unavailable", middag: "unavailable", avond: "unavailable" };
  }
  return out;
}

/** Leeg vacatuurrooster (niets gevraagd). */
export function emptySchedule(): VacancySchedule {
  const out = {} as VacancySchedule;
  for (const d of WEEKDAYS) {
    out[d] = { ochtend: null, middag: null, avond: null };
  }
  return out;
}
