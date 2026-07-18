// Regio-indeling van de arbeidsmarktmonitor: provincie per stad uit de
// geocodeertabel (src/server/geo.ts kent ±25 steden). Pure data — de
// servicelaag vertaalt postcode → stad; dit domein vertaalt stad → provincie.
// Onbekende steden vallen terug op "onbekend", zodat aggregaties nooit crashen
// en onbekende regio's als eigen (onderdrukbare) groep zichtbaar blijven.

export const ONBEKENDE_REGIO = "onbekend";

const PROVINCIE_PER_STAD: Record<string, string> = {
  Amsterdam: "Noord-Holland",
  Almere: "Flevoland",
  Alkmaar: "Noord-Holland",
  Haarlem: "Noord-Holland",
  Leiden: "Zuid-Holland",
  "Den Haag": "Zuid-Holland",
  Delft: "Zuid-Holland",
  Gouda: "Zuid-Holland",
  Rotterdam: "Zuid-Holland",
  Utrecht: "Utrecht",
  Amersfoort: "Utrecht",
  Middelburg: "Zeeland",
  Breda: "Noord-Brabant",
  Tilburg: "Noord-Brabant",
  "Den Bosch": "Noord-Brabant",
  Eindhoven: "Noord-Brabant",
  Maastricht: "Limburg",
  Nijmegen: "Gelderland",
  Arnhem: "Gelderland",
  Apeldoorn: "Gelderland",
  Enschede: "Overijssel",
  Zwolle: "Overijssel",
  Leeuwarden: "Friesland",
  Assen: "Drenthe",
  Groningen: "Groningen",
};

/** Provincie van een stad uit de geocodeertabel; "onbekend" bij geen match. */
export function provincieVanStad(stad: string | null | undefined): string {
  if (!stad) return ONBEKENDE_REGIO;
  return PROVINCIE_PER_STAD[stad] ?? ONBEKENDE_REGIO;
}
