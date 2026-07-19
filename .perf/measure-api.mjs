// Publieke API-latency (server-side, zonder browser): 25 samples per endpoint
// met 600 ms tussenruimte (ruim onder de rate limit van 120/min/IP).
// Meet TTFB (headers binnen) en totale duur per request; rapporteert p50/p95.
// Output: .perf/raw/api-latency.json
import fs from "node:fs";
import { BASE, VACANCY_LINDEBOOM, SLUG } from "./routes.mjs";

// Publieke DB-slug van de Lindeboom-vacature (de API praat mét de echte
// database, los van de fixture-bron van de pagina's).
const VACANCY_DB_SLUG = "mondhygienist-24-32-uur-utrecht-ca5915";

const ENDPOINTS = [
  { id: "jobs-lijst", pad: "/api/public/v1/jobs" },
  { id: "jobs-lijst-gefilterd", pad: "/api/public/v1/jobs?role=mondhygienist&city=Utrecht" },
  { id: "job-detail-id", pad: `/api/public/v1/jobs/${VACANCY_LINDEBOOM}` },
  { id: "job-detail-slug", pad: `/api/public/v1/jobs/${VACANCY_DB_SLUG}` },
  { id: "praktijk-detail", pad: `/api/public/v1/practices/${SLUG}` },
  { id: "taxonomies", pad: "/api/public/v1/taxonomies" },
];
const SAMPLES = 25;

function kwantiel(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

const uit = [];
for (const ep of ENDPOINTS) {
  const metingen = [];
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + ep.pad);
    const tHeaders = performance.now();
    const body = await res.arrayBuffer();
    const tEind = performance.now();
    metingen.push({ status: res.status, ttfbMs: tHeaders - t0, totaalMs: tEind - t0, bytes: body.byteLength });
    await new Promise((r) => setTimeout(r, 600));
  }
  const ttfbs = metingen.map((m) => m.ttfbMs);
  uit.push({
    endpoint: ep.id, pad: ep.pad, samples: SAMPLES,
    statussen: [...new Set(metingen.map((m) => m.status))],
    bytes: metingen[0].bytes,
    p50Ms: +kwantiel(ttfbs, 0.5).toFixed(1),
    p95Ms: +kwantiel(ttfbs, 0.95).toFixed(1),
    minMs: +Math.min(...ttfbs).toFixed(1),
    maxMs: +Math.max(...ttfbs).toFixed(1),
    metingen,
  });
  console.log(`${ep.id}: p50 ${uit.at(-1).p50Ms}ms p95 ${uit.at(-1).p95Ms}ms (${metingen[0].bytes}B)`);
}
fs.writeFileSync(new URL("./raw/api-latency.json", import.meta.url), JSON.stringify(uit, null, 1));
console.log("Klaar.");
