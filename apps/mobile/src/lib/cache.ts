// Minimale in-memory cache voor lijstdata (matches, uitnodigingen, …).
// Bewust geen persistente cache: kandidaatdata blijft alleen in het geheugen
// en verdwijnt bij uitloggen (wisCache) en bij het sluiten van de app.

const opslag = new Map<string, { waarde: unknown; tijdstip: number }>();

const MAX_LEEFTIJD_MS = 60_000;

export function uitCache<T>(sleutel: string): T | null {
  const rij = opslag.get(sleutel);
  if (!rij) return null;
  if (Date.now() - rij.tijdstip > MAX_LEEFTIJD_MS) {
    opslag.delete(sleutel);
    return null;
  }
  return rij.waarde as T;
}

export function inCache(sleutel: string, waarde: unknown): void {
  opslag.set(sleutel, { waarde, tijdstip: Date.now() });
}

export function verwijderUitCache(sleutel: string): void {
  opslag.delete(sleutel);
}

/** Bij uitloggen of accountverwijdering: álles weg. */
export function wisCache(): void {
  opslag.clear();
}
