// Mondzorgwerkt-designtokens voor iOS — één-op-één overgenomen uit
// app/globals.css en app/marketing.css van de webapp ("Precision in flow"):
// cobalt (#0120ec), cloud (#cddfee), toegankelijk roze (#ed6ca5), inkt op
// een licht oppervlak, glass-vlakken, veel witruimte en rustige beweging.

export const kleur = {
  // merkrollen
  cobalt: "#0120ec", // primair blauw (--color-brand-blue)
  cloud: "#cddfee", // lichtblauw (--color-brand-light)
  roze: "#ed6ca5", // accent (--color-brand-pink)
  inkt: "#0a0d1c", // tekst (--color-ink)
  oppervlak: "#f4f8fc", // paginaachtergrond (--color-surface)
  wit: "#ffffff",

  // blauwschaal (--color-blauw-*)
  blauw50: "#eef3ff",
  blauw100: "#dbe6ff",
  blauw200: "#bccfff",
  blauw300: "#8fabff",
  blauw400: "#5c7dff",
  blauw500: "#2e4cf7",
  blauw600: "#0120ec",
  blauw700: "#0119c2",
  blauw800: "#051697",
  blauw900: "#0a1670",

  // rozeschaal (--color-roze-*)
  roze50: "#fdf2f7",
  roze100: "#fbe2ee",
  roze200: "#f8c6dd",
  roze300: "#f3a1c5",
  roze400: "#ed6ca5",
  roze500: "#e04589",
  roze600: "#c92b70",
  roze700: "#a52d63",
  roze800: "#86254f",
  roze900: "#6f2143",

  // signaalkleuren (zelfde tinten als de webapp gebruikt)
  groen100: "#d1fae5",
  groen800: "#065f46",
  amber100: "#fef3c7",
  amber800: "#92400e",
  rood50: "#fef2f2",
  rood100: "#fee2e2",
  rood700: "#b91c1c",
} as const;

/** Inkt met dekking — de webapp werkt veel met ink/70 e.d. */
export function inkt(opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${kleur.inkt}${alpha}`;
}

export const radius = {
  kaart: 24, // --radius-kaart
  kaartLg: 28, // --radius-kaart-lg
  kaartXl: 36, // --radius-kaart-xl
  veld: 14, // --radius-veld
  cel: 12, // WeekGrid-cellen (rounded-xl)
  pill: 999,
} as const;

/** 4px-basisschaal zoals Tailwind in de webapp. */
export const ruimte = {
  xs: 6,
  s: 12,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 40,
} as const;

export const typo = {
  // Editorial: één accentwoord in cursieve serif binnen een sans-kop.
  // De stand-ins van de webapp (Archivo + Playfair Display) zijn niet
  // gebundeld; iOS-systeemfonts benaderen dat: SF Pro + New York (serif).
  sans: undefined, // systeem (SF Pro)
  serifItalic: { fontFamily: "Georgia", fontStyle: "italic" as const },
  h1: { fontSize: 30, fontWeight: "600" as const, letterSpacing: -0.8, lineHeight: 36 },
  h2: { fontSize: 24, fontWeight: "600" as const, letterSpacing: -0.5, lineHeight: 30 },
  h3: { fontSize: 19, fontWeight: "600" as const, lineHeight: 25 },
  body: { fontSize: 16, lineHeight: 24 },
  klein: { fontSize: 14, lineHeight: 20 },
  eyebrow: {
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
} as const;

/** Glass-elevatie (—shadow-glass) vertaald naar iOS-schaduwen. */
export const schaduw = {
  glass: {
    shadowColor: kleur.inkt,
    shadowOpacity: 0.06,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
  },
  glassSterk: {
    shadowColor: kleur.cobalt,
    shadowOpacity: 0.08,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
    elevation: 6,
  },
  knopBlauw: {
    shadowColor: kleur.cobalt,
    shadowOpacity: 0.25,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

/** Rustige beweging: 150ms interactie, 500ms voortgang, trage ambient loops. */
export const motion = {
  interactie: 150,
  kaart: 200,
  voortgang: 500,
  blobA: 9000,
  blobB: 12000,
} as const;

/** Minimale tikdoelen (webapp hanteert ≥44–48px). */
export const tikdoel = 48;
