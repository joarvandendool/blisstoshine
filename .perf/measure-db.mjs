// Niet-invasieve DB-profilering per kernroute via PostgreSQL-statementlogging
// (log_min_duration_statement = 0 op database mondzorgwerkt_perf; geen
// codewijziging). Per route: 5 opgewarmde requests; per request tellen we de
// execute-statements, sommeren de duur en bewaren de langzaamste statements
// inclusief parameters (uit de DETAIL-regels) voor EXPLAIN ANALYZE.
// Output: .perf/raw/db-routes.json
import fs from "node:fs";
import { ROUTES, BASE, cookieHeader, SLUG, VACANCY_LINDEBOOM } from "./routes.mjs";

const LOG = "/var/log/postgresql/postgresql-16-main.log";
const HERHALINGEN = 5;

// Ook de simulate-API als "route" profileren (POST).
const DOELEN = [
  ...ROUTES.map((r) => ({ ...r, methode: "GET", body: undefined })),
  { id: "api-jobs", pad: "/api/public/v1/jobs", rol: null, methode: "GET" },
  { id: "api-job-detail", pad: `/api/public/v1/jobs/${VACANCY_LINDEBOOM}`, rol: null, methode: "GET" },
  {
    id: "api-studio-simulate", pad: "/api/praktijk/studio/simulate", rol: "praktijk", methode: "POST",
    body: JSON.stringify({ slug: SLUG, vacancyId: VACANCY_LINDEBOOM, overrides: { hoursMin: 24 } }),
    headers: { "content-type": "application/json", origin: BASE, referer: `${BASE}/praktijk/${SLUG}` },
  },
];

function leesVanaf(offset) {
  const fd = fs.openSync(LOG, "r");
  const grootte = fs.fstatSync(fd).size;
  const len = grootte - offset;
  if (len <= 0) { fs.closeSync(fd); return ""; }
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, offset);
  fs.closeSync(fd);
  return buf.toString("utf8");
}

function parseLog(tekst) {
  // execute-regels + bijbehorende parameters-DETAIL.
  const regels = tekst.split("\n");
  const statements = [];
  for (let i = 0; i < regels.length; i++) {
    const r = regels[i];
    if (!r.includes("@mondzorgwerkt_perf LOG:  duration:")) continue;
    const m = r.match(/duration: ([\d.]+) ms\s+(?:execute|statement)\s*[^:]*:\s*(.*)$/);
    if (!m) continue;
    let sql = m[2];
    // multiline statements: volg regels zonder timestampprefix
    let j = i + 1;
    while (j < regels.length && regels[j] && !/^\d{4}-\d{2}-\d{2} /.test(regels[j])) { sql += " " + regels[j].trim(); j++; }
    let params = null;
    if (j < regels.length && regels[j].includes("DETAIL:  parameters:")) {
      params = regels[j].split("DETAIL:  parameters:")[1].trim().slice(0, 2000);
    }
    statements.push({ ms: parseFloat(m[1]), sql: sql.trim(), params });
  }
  return statements;
}

function normaliseer(sql) {
  return sql.replace(/\$\d+/g, "$?").replace(/\s+/g, " ").slice(0, 400);
}

const uit = [];
for (const doel of DOELEN) {
  const requests = [];
  for (let i = 0; i < HERHALINGEN; i++) {
    const offset = fs.statSync(LOG).size;
    const t0 = Date.now();
    const res = await fetch(BASE + doel.pad, {
      method: doel.methode,
      headers: {
        ...(doel.rol ? { cookie: cookieHeader(doel.rol) } : {}),
        ...(doel.headers || {}),
      },
      body: doel.body,
      redirect: "manual",
    });
    await res.arrayBuffer();
    const httpMs = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 350));
    const statements = parseLog(leesVanaf(offset));
    requests.push({
      status: res.status, httpMs,
      queryCount: statements.length,
      dbMsTotaal: statements.reduce((a, s) => a + s.ms, 0),
      statements,
    });
  }
  // aggregatie over de runs: per genormaliseerd statement aantal + tijd
  const perQuery = new Map();
  for (const req of requests) {
    for (const s of req.statements) {
      const k = normaliseer(s.sql);
      const e = perQuery.get(k) || { count: 0, totMs: 0, maxMs: 0, voorbeeldParams: s.params, sql: s.sql };
      e.count++; e.totMs += s.ms; e.maxMs = Math.max(e.maxMs, s.ms);
      perQuery.set(k, e);
    }
  }
  const topQueries = [...perQuery.entries()]
    .map(([norm, e]) => ({ norm, ...e, gemMs: e.totMs / e.count, perRequest: e.count / requests.length }))
    .sort((a, b) => b.totMs - a.totMs)
    .slice(0, 12);
  uit.push({
    route: doel.id, pad: doel.pad, status: requests[0]?.status,
    queryCountPerRequest: requests.map((r) => r.queryCount),
    dbMsPerRequest: requests.map((r) => +r.dbMsTotaal.toFixed(1)),
    httpMsPerRequest: requests.map((r) => r.httpMs),
    topQueries: topQueries.map((q) => ({ ...q, sql: q.sql.slice(0, 500) })),
  });
  console.log(`${doel.id}: status ${requests[0]?.status}, queries/request ${requests.map((r) => r.queryCount).join("/")}, db-ms ${requests.map((r) => r.dbMsTotaal.toFixed(0)).join("/")}, http-ms ${requests.map((r) => r.httpMs).join("/")}`);
}
fs.writeFileSync(new URL("./raw/db-routes.json", import.meta.url), JSON.stringify(uit, null, 1));
console.log("Klaar.");
