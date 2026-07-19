// ============================================================
// DEVELOPMENT-FIXTURES — GEEN ECHTE DATA.
// Realistische maar volledig fictieve vacatures en praktijken voor de
// openbare site zolang de public read-model-API's (/api/public/v1/*,
// backend-branch) hier nog niet geïntegreerd zijn. Namen, adressen en
// bedragen zijn verzonnen; elke gelijkenis met bestaande praktijken
// berust op toeval. Niet gebruiken in productie: zet PUBLIC_DATA_SOURCE=http
// zodra de backend-branch geïntegreerd is (zie adapter.ts).
// ============================================================

import { label } from "@/domain/taxonomy";
import type {
  PublicJobView,
  PublicPracticeView,
  PublicTag,
} from "./types";

/** Site-basis voor canonieke URL's (fixtures gebruiken de productiedomein-vorm). */
const SITE = "https://mondzorgwerkt.nl";

function tag(key: string): PublicTag {
  return { key, label: label(key) };
}

function tags(...keys: string[]): PublicTag[] {
  return keys.map(tag);
}

/* ------------------------------ praktijken ------------------------------ */

export const FIXTURE_PRACTICES: PublicPracticeView[] = [
  {
    slug: "tandartspraktijk-de-linde-utrecht",
    canonicalUrl: `${SITE}/praktijken/tandartspraktijk-de-linde-utrecht`,
    name: "Tandartspraktijk De Linde",
    description:
      "Familiepraktijk in Utrecht-Oost met vier behandelkamers en een hecht team van elf collega's. We werken volledig digitaal, plannen ruime behandeltijden en houden elke zes weken intervisie. Patiënten blijven hier lang — collega's ook.",
    locations: [{ city: "Utrecht", region: "Utrecht", postcode4: "3581" }],
    treatmentRooms: 4,
    equipment: tags("trios", "opg", "airflow"),
    software: tags("exquise"),
    specializations: tags("parodontologie", "kindertandheelkunde"),
    population: tags("kinderen", "volwassenen", "ouderen"),
    culture: tags("familiegevoel", "patientgericht", "rustig_tempo"),
    mentorship: true,
    development: tags("interne_opleiding", "intervisie", "congresbudget"),
    practiceConsent: true,
    updatedAt: "2026-07-10T09:00:00.000Z",
  },
  {
    slug: "mondzorg-aan-de-maas-rotterdam",
    canonicalUrl: `${SITE}/praktijken/mondzorg-aan-de-maas-rotterdam`,
    name: "Mondzorg aan de Maas",
    description:
      "Groepspraktijk op Rotterdam-Zuid met zes behandelkamers, een eigen preventieteam en avondspreekuren op dinsdag en donderdag. Grootstedelijke patiëntenpopulatie, korte lijnen en veel ruimte om je eigen agenda in te richten.",
    locations: [
      { city: "Rotterdam", region: "Zuid-Holland", postcode4: "3081" },
    ],
    treatmentRooms: 6,
    equipment: tags("primescan", "opg", "cbct", "laser"),
    software: tags("evolution"),
    specializations: tags("implantologie", "endodontologie", "angstbegeleiding"),
    population: tags("volwassenen", "angstpatienten", "medisch_gecompromitteerd"),
    culture: tags("ambitieus", "gestructureerd", "hightech"),
    mentorship: true,
    development: tags("specialisatietraject", "congresbudget", "doorgroei_management"),
    practiceConsent: true,
    updatedAt: "2026-07-12T09:00:00.000Z",
  },
  {
    slug: "praktijk-vondelpark-amsterdam",
    canonicalUrl: `${SITE}/praktijken/praktijk-vondelpark-amsterdam`,
    name: "Praktijk Vondelpark",
    description:
      "Moderne praktijk aan de rand van het Vondelpark met vijf behandelkamers en focus op esthetiek en digitale workflows. Jong team, informele sfeer, en een planning die om jouw week heen gebouwd wordt in plaats van andersom.",
    locations: [
      { city: "Amsterdam", region: "Noord-Holland", postcode4: "1071" },
    ],
    treatmentRooms: 5,
    equipment: tags("itero", "cerec", "opg", "microscoop"),
    software: tags("simplex"),
    specializations: tags("esthetiek", "orthodontie", "implantologie"),
    population: tags("volwassenen", "kinderen"),
    culture: tags("informeel", "hightech", "leergericht"),
    mentorship: false,
    development: tags("congresbudget", "interne_opleiding"),
    practiceConsent: true,
    updatedAt: "2026-07-14T09:00:00.000Z",
  },
  {
    // Bewust ZONDER consent: deze praktijk mag nergens als publieke
    // praktijkpagina verschijnen; haar vacatures blijven wel zichtbaar
    // (zonder praktijkpagina-link). Zo is het consentpad testbaar.
    slug: "tandheelkunde-noorderlicht-groningen",
    canonicalUrl: `${SITE}/praktijken/tandheelkunde-noorderlicht-groningen`,
    name: "Tandheelkunde Noorderlicht",
    description:
      "Allround praktijk in Groningen met drie behandelkamers en een vast, ervaren team.",
    locations: [{ city: "Groningen", region: "Groningen", postcode4: "9711" }],
    treatmentRooms: 3,
    equipment: tags("opg", "airflow"),
    software: tags("oase"),
    specializations: tags("prothetiek"),
    population: tags("volwassenen", "ouderen"),
    culture: tags("gestructureerd", "rustig_tempo"),
    mentorship: false,
    development: tags("congresbudget"),
    practiceConsent: false,
    updatedAt: "2026-07-08T09:00:00.000Z",
  },
];

/* ------------------------------ vacatures ------------------------------- */

interface JobBasis {
  practice: PublicPracticeView;
}

function org({ practice }: JobBasis): PublicJobView["organization"] {
  return { name: practice.name, slug: practice.slug };
}

const [LINDE, MAAS, VONDEL, NOORD] = FIXTURE_PRACTICES;

export const FIXTURE_JOBS: PublicJobView[] = [
  {
    slug: "mondhygienist-utrecht-de-linde",
    canonicalUrl: `${SITE}/vacatures/mondhygienist-utrecht-de-linde`,
    title: "Mondhygiënist met eigen agenda",
    role: tag("mondhygienist"),
    organization: org({ practice: LINDE }),
    location: LINDE.locations[0],
    description:
      "Je krijgt een eigen agenda met vaste patiënten en ruime behandeltijden van 45 tot 60 minuten. Samen met onze tweede mondhygiënist en twee preventieassistenten bouw je het parodontologie-spreekuur verder uit. De dinsdag en donderdag staan vast; de derde dag kies je zelf.",
    responsibilities: [
      "Zelfstandige parodontale screenings en behandelingen (DPSI 3+)",
      "Eigen controle-agenda met vaste patiëntenstam",
      "Begeleiden van de preventieassistenten bij opschaling",
      "Meedenken over het recall-beleid van de praktijk",
    ],
    requirements: [
      { label: "Afgeronde opleiding mondzorgkunde", level: "required" },
      { label: "BIG-registratie mondhygiënist", level: "required" },
      { label: "Ervaring met parodontologie-spreekuren", level: "preferred" },
      { label: "Ervaring met Exquise", level: "preferred" },
    ],
    availability: [
      { day: "di", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "do", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "vr", dayparts: ["ochtend"], level: "preferred" },
    ],
    hoursMin: 24,
    hoursMax: 32,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 340000, maxCents: 420000 },
    revenueShare: null,
    equipment: LINDE.equipment,
    software: LINDE.software,
    specializations: tags("parodontologie"),
    culture: LINDE.culture,
    mentorship: true,
    development: LINDE.development,
    datePosted: "2026-07-01T09:00:00.000Z",
    validThrough: "2026-09-01T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-15T09:00:00.000Z",
  },
  {
    slug: "tandartsassistent-rotterdam-maas",
    canonicalUrl: `${SITE}/vacatures/tandartsassistent-rotterdam-maas`,
    title: "Allround tandartsassistent",
    role: tag("tandartsassistent"),
    organization: org({ practice: MAAS }),
    location: MAAS.locations[0],
    description:
      "Je assisteert aan de stoel bij twee vaste tandartsen en draait mee in ons implantologie-team. Wij plannen in blokken van vier uur, zodat je dagdelen echt van jou zijn. Avonddiensten op dinsdag worden extra beloond en zijn nooit verplicht in je eerste drie maanden.",
    responsibilities: [
      "Assisteren aan de stoel bij restauratief werk en implantologie",
      "Voorbereiden en steriliseren volgens ons WIP-protocol",
      "Röntgenopnames maken (solo of OPG) bij bevoegdheid",
      "Baliewerk in roulatie, maximaal één dagdeel per week",
    ],
    requirements: [
      { label: "Ervaring als tandartsassistent (minimaal 1 jaar)", level: "required" },
      { label: "Röntgenbevoegdheid", level: "preferred" },
      { label: "Ervaring in de implantologie", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "di", dayparts: ["ochtend", "middag", "avond"], level: "required" },
      { day: "wo", dayparts: ["ochtend", "middag"], level: "preferred" },
      { day: "do", dayparts: ["ochtend", "middag"], level: "required" },
    ],
    hoursMin: 28,
    hoursMax: 36,
    employmentTypes: tags("loondienst", "detachering"),
    salary: { minCents: 260000, maxCents: 320000 },
    revenueShare: null,
    equipment: MAAS.equipment,
    software: MAAS.software,
    specializations: tags("implantologie"),
    culture: MAAS.culture,
    mentorship: true,
    development: tags("interne_opleiding", "congresbudget"),
    datePosted: "2026-07-05T09:00:00.000Z",
    validThrough: "2026-08-20T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-16T09:00:00.000Z",
  },
  {
    // De zzp-vacature met omzetpercentage.
    slug: "tandarts-zzp-amsterdam-vondelpark",
    canonicalUrl: `${SITE}/vacatures/tandarts-zzp-amsterdam-vondelpark`,
    title: "Tandarts (zzp) — esthetiek en restauratief",
    role: tag("tandarts"),
    organization: org({ practice: VONDEL }),
    location: VONDEL.locations[0],
    description:
      "Voor twee tot drie vaste dagen per week zoeken we een tandarts die zich thuis voelt in esthetische en restauratieve behandelingen. Je werkt op omzetbasis met een volledig gevulde agenda vanaf dag één, eigen vaste assistent en iTero/CEREC-workflows. De vrijdag is optioneel en blijft van jou.",
    responsibilities: [
      "Volledige behandelkamers met vaste assistentie",
      "Esthetische trajecten: facings, kronen en digitale smile design",
      "Restauratief werk en periodieke controles voor eigen patiëntenstam",
      "Intercollegiaal overleg met onze orthodontist en implantoloog",
    ],
    requirements: [
      { label: "BIG-registratie tandarts", level: "required" },
      { label: "Minimaal 3 jaar ervaring als tandarts", level: "required" },
      { label: "Ervaring met CEREC of iTero", level: "preferred" },
      { label: "KRT-registratie", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "wo", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "vr", dayparts: ["ochtend", "middag"], level: "preferred" },
    ],
    hoursMin: 16,
    hoursMax: 28,
    employmentTypes: tags("zzp"),
    salary: null,
    revenueShare: { maxPercent: 45 },
    equipment: VONDEL.equipment,
    software: VONDEL.software,
    specializations: tags("esthetiek", "implantologie"),
    culture: VONDEL.culture,
    mentorship: false,
    development: tags("congresbudget"),
    datePosted: "2026-06-24T09:00:00.000Z",
    validThrough: "2026-08-31T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-14T09:00:00.000Z",
  },
  {
    slug: "preventieassistent-utrecht-de-linde",
    canonicalUrl: `${SITE}/vacatures/preventieassistent-utrecht-de-linde`,
    title: "Preventieassistent (16–24 uur)",
    role: tag("preventieassistent"),
    organization: org({ practice: LINDE }),
    location: LINDE.locations[0],
    description:
      "Je draait eigen preventiespreekuren onder supervisie van onze mondhygiënisten, met veel kindercontacten uit ons kindertandheelkunde-spreekuur. Werkdagen stemmen we af op je week — school-uren zijn bespreekbaar en de woensdagmiddag is bij ons juist rustig.",
    responsibilities: [
      "Zelfstandige preventiespreekuren (poetsinstructie, fluoride, sealen)",
      "Gebitsreiniging bij DPSI 0–2",
      "Voorlichting aan ouders en kinderen",
      "Ondersteunen van het recall-team",
    ],
    requirements: [
      { label: "Certificaat preventieassistent", level: "required" },
      { label: "Ervaring met kinderen in de stoel", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["ochtend"], level: "required" },
      { day: "wo", dayparts: ["ochtend", "middag"], level: "preferred" },
      { day: "vr", dayparts: ["ochtend", "middag"], level: "required" },
    ],
    hoursMin: 16,
    hoursMax: 24,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 240000, maxCents: 280000 },
    revenueShare: null,
    equipment: tags("airflow"),
    software: LINDE.software,
    specializations: tags("kindertandheelkunde"),
    culture: LINDE.culture,
    mentorship: true,
    development: tags("interne_opleiding", "intervisie"),
    datePosted: "2026-07-08T09:00:00.000Z",
    validThrough: "2026-09-08T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-16T09:00:00.000Z",
  },
  {
    slug: "tandarts-groningen-noorderlicht",
    canonicalUrl: `${SITE}/vacatures/tandarts-groningen-noorderlicht`,
    title: "Tandarts algemene praktijk",
    role: tag("tandarts"),
    organization: org({ practice: NOORD }),
    location: NOORD.locations[0],
    description:
      "Ervaren, rustig team zoekt een tandarts voor drie tot vier vaste dagen. Volledig allround werk met nadruk op prothetiek en ouderenzorg; loondienst of zzp is beide bespreekbaar. Je neemt een bestaande, goed onderhouden patiëntenstam over van onze vertrekkende collega.",
    responsibilities: [
      "Allround tandheelkunde voor een vaste patiëntenstam",
      "Prothetische trajecten in samenwerking met ons tandtechnisch lab",
      "Zorg voor ouderen en medisch gecompromitteerde patiënten",
      "Supervisie van twee assistenten",
    ],
    requirements: [
      { label: "BIG-registratie tandarts", level: "required" },
      { label: "Ervaring met prothetiek", level: "preferred" },
      { label: "Affiniteit met ouderenzorg", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "di", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "do", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "vr", dayparts: ["ochtend"], level: "preferred" },
    ],
    hoursMin: 24,
    hoursMax: 32,
    employmentTypes: tags("loondienst", "zzp"),
    salary: { minCents: 620000, maxCents: 780000 },
    revenueShare: null,
    equipment: NOORD.equipment,
    software: NOORD.software,
    specializations: tags("prothetiek"),
    culture: NOORD.culture,
    mentorship: false,
    development: NOORD.development,
    datePosted: "2026-06-30T09:00:00.000Z",
    validThrough: "2026-08-30T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-11T09:00:00.000Z",
  },
  {
    // De gesloten vacature (vervuld): detailpagina toont de gesloten staat.
    slug: "mondhygienist-amsterdam-vondelpark",
    canonicalUrl: `${SITE}/vacatures/mondhygienist-amsterdam-vondelpark`,
    title: "Mondhygiënist (vervuld)",
    role: tag("mondhygienist"),
    organization: org({ practice: VONDEL }),
    location: VONDEL.locations[0],
    description:
      "Deze rol is inmiddels vervuld. We zochten een mondhygiënist voor twee vaste dagen met focus op esthetische nazorg en AirFlow-behandelingen.",
    responsibilities: [
      "Eigen agenda met controle- en reinigingsafspraken",
      "Esthetische nazorgtrajecten",
    ],
    requirements: [
      { label: "Afgeronde opleiding mondzorgkunde", level: "required" },
    ],
    availability: [
      { day: "di", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "do", dayparts: ["ochtend", "middag"], level: "required" },
    ],
    hoursMin: 16,
    hoursMax: 20,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 330000, maxCents: 400000 },
    revenueShare: null,
    equipment: VONDEL.equipment,
    software: VONDEL.software,
    specializations: tags("esthetiek"),
    culture: VONDEL.culture,
    mentorship: false,
    development: tags("congresbudget"),
    datePosted: "2026-05-12T09:00:00.000Z",
    validThrough: "2026-07-01T09:00:00.000Z",
    status: "closed",
    directApply: false,
    updatedAt: "2026-07-02T09:00:00.000Z",
  },
  {
    slug: "orthodontieassistent-rotterdam-maas",
    canonicalUrl: `${SITE}/vacatures/orthodontieassistent-rotterdam-maas`,
    title: "Orthodontieassistent",
    role: tag("orthodontieassistent"),
    organization: org({ practice: MAAS }),
    location: MAAS.locations[0],
    description:
      "Voor onze groeiende orthodontie-tak zoeken we een assistent die zelfstandig bogen wisselt, scans maakt en jonge patiënten op hun gemak stelt. Je werkt in een vast duo met onze orthodontist en wordt intern opgeleid richting klinische taken.",
    responsibilities: [
      "Wisselen van bogen en plaatsen van modules",
      "iTero-scans en lichtfoto's maken",
      "Begeleiden van kinderen en ouders tijdens het traject",
      "Voorraadbeheer van de ortho-unit",
    ],
    requirements: [
      { label: "Ervaring als tandarts- of orthodontieassistent", level: "required" },
      { label: "Ervaring met intraorale scanners", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["middag"], level: "preferred" },
      { day: "wo", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "do", dayparts: ["ochtend", "middag", "avond"], level: "required" },
      { day: "za", dayparts: ["ochtend"], level: "preferred" },
    ],
    hoursMin: 20,
    hoursMax: 28,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 270000, maxCents: 330000 },
    revenueShare: null,
    equipment: tags("itero", "opg"),
    software: MAAS.software,
    specializations: tags("orthodontie"),
    culture: MAAS.culture,
    mentorship: true,
    development: tags("interne_opleiding", "specialisatietraject"),
    datePosted: "2026-07-10T09:00:00.000Z",
    validThrough: "2026-09-10T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-17T09:00:00.000Z",
  },
  {
    slug: "praktijkmanager-groningen-noorderlicht",
    canonicalUrl: `${SITE}/vacatures/praktijkmanager-groningen-noorderlicht`,
    title: "Praktijkmanager (parttime)",
    role: tag("praktijkmanager"),
    organization: org({ practice: NOORD }),
    location: NOORD.locations[0],
    description:
      "Je neemt de dagelijkse leiding van onze praktijk over van de praktijkhouder: roosters, inkoop, kwaliteit en een team van acht collega's. Drie vaste dagen, waarvan de indeling in overleg — de rest van je week blijft van jou.",
    responsibilities: [
      "Personeelsplanning en roosterbeheer",
      "Kwaliteits- en hygiënebeleid (WIP, IGJ-proof)",
      "Inkoop en leverancierscontacten",
      "Maandelijkse cijfers en sturing met de praktijkhouder",
    ],
    requirements: [
      { label: "Leidinggevende ervaring in de zorg", level: "required" },
      { label: "Ervaring in de mondzorg", level: "preferred" },
      { label: "Ervaring met Oase", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "wo", dayparts: ["ochtend", "middag"], level: "required" },
      { day: "do", dayparts: ["ochtend", "middag"], level: "preferred" },
    ],
    hoursMin: 20,
    hoursMax: 24,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 320000, maxCents: 390000 },
    revenueShare: null,
    equipment: [],
    software: NOORD.software,
    specializations: [],
    culture: NOORD.culture,
    mentorship: false,
    development: tags("doorgroei_management"),
    datePosted: "2026-07-03T09:00:00.000Z",
    validThrough: "2026-09-03T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-13T09:00:00.000Z",
  },
  {
    slug: "tandartsassistent-avond-amsterdam-vondelpark",
    canonicalUrl: `${SITE}/vacatures/tandartsassistent-avond-amsterdam-vondelpark`,
    title: "Tandartsassistent voor avonden en zaterdag",
    role: tag("tandartsassistent"),
    organization: org({ practice: VONDEL }),
    location: VONDEL.locations[0],
    description:
      "Studeer je of combineer je banen? Wij zoeken een assistent voor onze avondopenstelling (maandag en woensdag) en de zaterdagochtend. Kleine vaste ploeg, toeslag op avond- en weekenduren en je rooster zes weken vooruit vast.",
    responsibilities: [
      "Assisteren aan de stoel tijdens avond- en zaterdagspreekuren",
      "Sterilisatie en kamervoorbereiding",
      "Telefoon en agenda tijdens rustige blokken",
    ],
    requirements: [
      { label: "Basiservaring als tandartsassistent of afgeronde cursus", level: "required" },
      { label: "Röntgenbevoegdheid", level: "preferred" },
    ],
    availability: [
      { day: "ma", dayparts: ["avond"], level: "required" },
      { day: "wo", dayparts: ["avond"], level: "required" },
      { day: "za", dayparts: ["ochtend"], level: "preferred" },
    ],
    hoursMin: 8,
    hoursMax: 14,
    employmentTypes: tags("loondienst"),
    salary: { minCents: 250000, maxCents: 290000 },
    revenueShare: null,
    equipment: tags("itero", "opg"),
    software: VONDEL.software,
    specializations: [],
    culture: VONDEL.culture,
    mentorship: true,
    development: tags("interne_opleiding"),
    datePosted: "2026-07-12T09:00:00.000Z",
    validThrough: "2026-09-12T09:00:00.000Z",
    status: "published",
    directApply: true,
    updatedAt: "2026-07-17T09:00:00.000Z",
  },
];
