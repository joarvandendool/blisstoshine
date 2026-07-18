// Publieke API van de matching-module: types, geversioneerde configuratie en
// de deterministische engine.

export * from "./types";
export * from "./config";
export { computeMatch, bepaalOntwikkelMatch } from "./engine";
