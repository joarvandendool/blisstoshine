// Gedeelde routetabel voor alle meetscripts.
// Poortrange 3700-3799 is gereserveerd voor deze perf-sprint.
export const BASE = process.env.PERF_BASE ?? "http://localhost:3700";
export const EXEC = "/opt/pw-browsers/chromium";
export const SLUG = "mondzorgpraktijk-de-lindeboom";
export const VACANCY_LINDEBOOM = "cmrrm3t19004x7dsnm074g8ca"; // Mondhygiënist 24–32 uur (published)
// Publieke pagina's draaien op de fixture-databron (default op main; de
// http-bron heeft nog integratiegebreken — zie restpunten in het rapport).
export const VACANCY_SLUG = "mondhygienist-utrecht-de-linde"; // fixture-slug detailpagina
export const PRACTICE_SLUG = "tandartspraktijk-de-linde-utrecht"; // fixture-slug praktijkpagina

export const ROUTES = [
  // — publieke laag (na merge Workstream B) —
  { id: "home", pad: "/", rol: null },
  { id: "vacatures-lijst", pad: "/vacatures", rol: null },
  { id: "vacatures-gefilterd", pad: "/vacatures?role=mondhygienist&city=Utrecht", rol: null },
  { id: "vacature-detail", pad: `/vacatures/${VACANCY_SLUG}`, rol: null },
  { id: "praktijk-profiel-publiek", pad: `/praktijken/${PRACTICE_SLUG}`, rol: null },
  { id: "kennis-functie", pad: "/functies/mondhygienist", rol: null },
  { id: "kennis-arbeidsmarkt", pad: "/arbeidsmarkt/mondhygienist/utrecht", rol: null },
  { id: "inloggen", pad: "/inloggen", rol: null },
  { id: "registreren", pad: "/registreren", rol: null },
  { id: "kandidaat-feed", pad: "/kandidaat", rol: "kandidaat" },
  { id: "kandidaat-matchdetail", pad: `/kandidaat/matches/${VACANCY_LINDEBOOM}`, rol: "kandidaat" },
  { id: "kandidaat-uitnodigingen", pad: "/kandidaat/uitnodigingen", rol: "kandidaat" },
  { id: "kandidaat-profiel", pad: "/kandidaat/profiel", rol: "kandidaat" },
  { id: "praktijk-dashboard", pad: `/praktijk/${SLUG}`, rol: "praktijk" },
  { id: "praktijk-pipeline", pad: `/praktijk/${SLUG}/pipeline`, rol: "praktijk" },
  { id: "praktijk-bezetting", pad: `/praktijk/${SLUG}/bezetting`, rol: "praktijk" },
  { id: "praktijk-studio", pad: `/praktijk/${SLUG}/vacatures/${VACANCY_LINDEBOOM}/studio`, rol: "praktijk" },
  { id: "praktijk-radar", pad: `/praktijk/${SLUG}/radar`, rol: "praktijk" },
  { id: "praktijk-abonnement", pad: `/praktijk/${SLUG}/abonnement`, rol: "praktijk" },
  { id: "praktijk-start", pad: "/praktijk/start", rol: "praktijk" },
  { id: "intern", pad: "/intern", rol: "admin" },
  { id: "intern-monitor", pad: "/intern/monitor", rol: "admin" },
  { id: "intern-health", pad: "/intern/health", rol: "admin" },
];

import fs from "node:fs";

export function cookieHeader(rol) {
  if (!rol) return "";
  const state = JSON.parse(
    fs.readFileSync(new URL(`./state-${rol}.json`, import.meta.url), "utf8"),
  );
  return state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

export function storageStatePath(rol) {
  return new URL(`./state-${rol}.json`, import.meta.url).pathname;
}
