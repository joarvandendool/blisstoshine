// PERF-hulpmodule: generatieteller voor de request-gecachte abonnementsketen
// (zie getActiveSubscription in ./index.ts). React cache() leeft per
// serverrequest; deze teller zorgt er bovendien voor dat een schrijfactie op
// abonnements- of catalogusdata binnen diezelfde request de cache omzeilt —
// een server action die het plan wijzigt leest dus nooit een stale rij terug.
//
// Eigen module (en niet in index.ts) om een importcyclus tussen index.ts en
// de provider-adapters (local.ts) te vermijden.

let abonnementGeneratie = 0;

/** Huidige generatie — onderdeel van de cachesleutel. */
export function huidigeAbonnementGeneratie(): number {
  return abonnementGeneratie;
}

/** Aanroepen ná elke schrijfactie op abonnements- of catalogusdata. */
export function verversAbonnementCache(): void {
  abonnementGeneratie += 1;
}
