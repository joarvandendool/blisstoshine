// Deterministische geocodering van Nederlandse postcodes — bewust een kleine,
// lokale tabel in plaats van een externe geocoding-API: geen netwerkverkeer,
// geen sleutels, altijd reproduceerbare coördinaten voor matching en seed.
//
// Werking: eerst wordt op de eerste vier cijfers (PC4) gezocht; is die niet
// bekend, dan op de eerste twee cijfers (PC2, het postcodegebied van de stad).
// De functie crasht nooit: onherkenbare invoer geeft null.

export interface GeoPoint {
  city: string;
  latitude: number;
  longitude: number;
}

/** PC4 → stadscentrum, voor ±25 Nederlandse steden. */
const PC4_TABEL: Record<string, GeoPoint> = {
  "1011": { city: "Amsterdam", latitude: 52.3728, longitude: 4.8936 },
  "1315": { city: "Almere", latitude: 52.3508, longitude: 5.2647 },
  "1811": { city: "Alkmaar", latitude: 52.6324, longitude: 4.7534 },
  "2011": { city: "Haarlem", latitude: 52.3874, longitude: 4.6462 },
  "2311": { city: "Leiden", latitude: 52.1601, longitude: 4.497 },
  "2511": { city: "Den Haag", latitude: 52.0705, longitude: 4.3007 },
  "2611": { city: "Delft", latitude: 52.0116, longitude: 4.3571 },
  "2801": { city: "Gouda", latitude: 52.0115, longitude: 4.7104 },
  "3011": { city: "Rotterdam", latitude: 51.9225, longitude: 4.4792 },
  "3511": { city: "Utrecht", latitude: 52.0907, longitude: 5.1214 },
  "3811": { city: "Amersfoort", latitude: 52.1561, longitude: 5.3878 },
  "4331": { city: "Middelburg", latitude: 51.4988, longitude: 3.6136 },
  "4811": { city: "Breda", latitude: 51.5719, longitude: 4.7683 },
  "5011": { city: "Tilburg", latitude: 51.5555, longitude: 5.0913 },
  "5211": { city: "Den Bosch", latitude: 51.6978, longitude: 5.3037 },
  "5611": { city: "Eindhoven", latitude: 51.4416, longitude: 5.4697 },
  "6211": { city: "Maastricht", latitude: 50.8514, longitude: 5.691 },
  "6511": { city: "Nijmegen", latitude: 51.8126, longitude: 5.8372 },
  "6811": { city: "Arnhem", latitude: 51.9851, longitude: 5.8987 },
  "7311": { city: "Apeldoorn", latitude: 52.2112, longitude: 5.9699 },
  "7511": { city: "Enschede", latitude: 52.2215, longitude: 6.8937 },
  "8011": { city: "Zwolle", latitude: 52.5168, longitude: 6.083 },
  "8911": { city: "Leeuwarden", latitude: 53.2012, longitude: 5.7999 },
  "9401": { city: "Assen", latitude: 52.9925, longitude: 6.5649 },
  "9711": { city: "Groningen", latitude: 53.2194, longitude: 6.5665 },
};

/**
 * PC2 → dichtstbijzijnde stad uit de tabel. Hiermee vallen ook omliggende
 * postcodes (bv. 3512, 3581) terug op het juiste stadscentrum.
 */
const PC2_TABEL: Record<string, GeoPoint> = Object.fromEntries(
  Object.entries(PC4_TABEL).map(([pc4, punt]) => [pc4.slice(0, 2), punt]),
);

/**
 * Geocodeert een Nederlandse postcode ("3511", "3511 AB", "3511ab") naar
 * stad + coördinaten. Eerst exact op PC4, anders op PC2; onbekende of
 * onbruikbare invoer geeft null. Crasht nooit.
 */
export function geocodePostcode(postcode: string): GeoPoint | null {
  if (typeof postcode !== "string") return null;
  const cijfers = /^(\d{2})(\d{2})?/.exec(postcode.trim().replace(/\s+/g, ""));
  if (!cijfers) return null;

  const pc2 = cijfers[1];
  const pc4 = cijfers[2] !== undefined ? pc2 + cijfers[2] : null;

  if (pc4 && PC4_TABEL[pc4]) return PC4_TABEL[pc4];
  return PC2_TABEL[pc2] ?? null;
}
