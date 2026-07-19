// Genereert een volledig meetrapport (Markdown) uit de ruwe metingen in
// .perf/raw/. Gebruik:
//   node .perf/rapport.mjs "Titel" > docs/perf/BASELINE.md
// Verwacht (voor zover aanwezig; ontbrekende bronnen worden overgeslagen):
//   raw/coldstart.txt, raw/coldwarm-server.json, raw/db-routes.json,
//   raw/api-latency.json, raw/browser-runs.json, raw/interactions.json,
//   raw/build-*.log (routetabel met bundelgroottes)
import fs from "node:fs";

const titel = process.argv[2] ?? "Meetrapport";
const RAW = new URL("./raw/", import.meta.url);

function lees(naam) {
  try {
    return JSON.parse(fs.readFileSync(new URL(naam, RAW), "utf8"));
  } catch {
    return null;
  }
}
function mediaan(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const f1 = (v) => (v == null || Number.isNaN(v) ? "—" : (+v).toFixed(1));
const f0 = (v) => (v == null || Number.isNaN(v) ? "—" : (+v).toFixed(0));

const uit = [];
const p = (...regels) => uit.push(...regels);

p(`# ${titel}`, "");
p(`_Gegenereerd: ${new Date().toISOString()} — productiebuild (\`next start\`, poort 3700), lokale PostgreSQL (database mondzorgwerkt_perf, seed-dataset), Node ${process.version}._`, "");

/* ---------------- koude start ---------------- */
try {
  const start = fs.readFileSync(new URL("coldstart.txt", RAW), "utf8").trim();
  p("## Koude start", "", "```", start, "```", "");
} catch {}

/* ---------------- server-TTFB koud/warm ---------------- */
const coldwarm = lees("coldwarm-server.json");
if (coldwarm) {
  p("## Server-TTFB per route (koud vs. warm, server-side fetch)", "");
  p("Koud = allereerste request na een verse `next start`; warm = mediaan van de 5 vervolgrequests.", "");
  p("| Route | Pad | Koud (ms) | Warm mediaan (ms) | Warm min–max |");
  p("|---|---|---:|---:|---|");
  for (const r of coldwarm) {
    const warm = r.warmMs;
    p(`| ${r.route} | \`${r.pad}\` | ${f1(r.koudMs)} | ${f1(mediaan(warm))} | ${f1(Math.min(...warm))}–${f1(Math.max(...warm))} |`);
  }
  p("");
}

/* ---------------- databaseprofiel ---------------- */
const db = lees("db-routes.json");
if (db) {
  p("## Databaseprofiel per route (5 opgewarmde requests, PostgreSQL-statementlog)", "");
  p("| Route | Status | Queries/request (mediaan) | DB-tijd/request (mediaan, ms) | HTTP-tijd (mediaan, ms) |");
  p("|---|---:|---:|---:|---:|");
  for (const r of db) {
    p(`| ${r.route} | ${r.status} | ${f0(mediaan(r.queryCountPerRequest))} | ${f1(mediaan(r.dbMsPerRequest))} | ${f0(mediaan(r.httpMsPerRequest))} |`);
  }
  p("");
  // opvallendste herhaalde statements
  p("### Meest herhaalde statements (per request) op de zwaarste routes", "");
  const zwaar = [...db]
    .sort((a, b) => mediaan(b.queryCountPerRequest) - mediaan(a.queryCountPerRequest))
    .slice(0, 5)
    .filter((r) => mediaan(r.queryCountPerRequest) > 10);
  for (const r of zwaar) {
    p(`**${r.route}** (${f0(mediaan(r.queryCountPerRequest))} q/request):`);
    for (const q of (r.topQueries ?? []).slice(0, 4)) {
      const tabel = q.norm.match(/"public"\."(\w+)"/)?.[1] ?? "?";
      p(`- ${q.perRequest.toFixed(1)}×/request op \`${tabel}\` (${q.norm.slice(0, 90).replaceAll("|", "\\|")}…)`);
    }
    p("");
  }
}

/* ---------------- API-latency ---------------- */
const api = lees("api-latency.json");
if (api) {
  p("## Publieke API-latency (25 samples per endpoint, TTFB)", "");
  p("| Endpoint | Pad | p50 (ms) | p95 (ms) | min–max (ms) | Body (B) |");
  p("|---|---|---:|---:|---|---:|");
  for (const e of api) {
    p(`| ${e.endpoint} | \`${e.pad.replaceAll("|", "\\|")}\` | ${f1(e.p50Ms)} | ${f1(e.p95Ms)} | ${f1(e.minMs)}–${f1(e.maxMs)} | ${e.bytes} |`);
  }
  p("");
}

/* ---------------- browsermetingen ---------------- */
const runs = lees("browser-runs.json");
if (runs) {
  const METR = ["ttfb", "fcp", "lcp", "cls", "tbt", "load", "requests", "transferTotaal", "transferJs", "inlineFlightBytes"];
  const groepen = new Map();
  for (const r of runs) {
    if (r.fout) continue;
    for (const fase of ["koud", "warm"]) {
      const k = `${r.profiel}|${r.route}|${fase}`;
      if (!groepen.has(k)) groepen.set(k, { profiel: r.profiel, route: r.route, fase, runs: [] });
      groepen.get(k).runs.push(r[fase]);
    }
  }
  p("## Browsermetingen (Playwright/Chromium, mediaan over runs)", "");
  p("Koud = verse browsercontext zonder cache; warm = tweede navigatie in dezelfde context. Profiel mobiel-traag: 390×844, 4× CPU-throttle, Fast-3G-achtig netwerk.", "");
  for (const profiel of ["desktop-snel", "mobiel-traag"]) {
    for (const fase of ["koud", "warm"]) {
      const rijen = [...groepen.values()].filter((g) => g.profiel === profiel && g.fase === fase);
      if (rijen.length === 0) continue;
      p(`### ${profiel} — ${fase} (n=${rijen[0].runs.length})`, "");
      p("| Route | TTFB | FCP | LCP | CLS | TBT | Load | Req | Transfer | JS | RSC-flight |");
      p("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
      for (const g of rijen) {
        const med = (m) => {
          const vals = g.runs.map((r) => r[m]).filter((v) => v != null && Number.isFinite(v));
          return vals.length ? mediaan(vals) : null;
        };
        const kb = (v) => (v == null ? "—" : `${(v / 1024).toFixed(0)} kB`);
        p(`| ${g.route} | ${f0(med("ttfb"))} | ${f0(med("fcp"))} | ${f0(med("lcp"))} | ${med("cls") == null ? "—" : med("cls").toFixed(3)} | ${f0(med("tbt"))} | ${f0(med("load"))} | ${f0(med("requests"))} | ${kb(med("transferTotaal"))} | ${kb(med("transferJs"))} | ${kb(med("inlineFlightBytes"))} |`);
      }
      p("");
    }
  }
  // fouten
  const fouten = runs.filter((r) => r.fout);
  const paginafouten = runs.filter((r) => !r.fout && ["koud", "warm"].some((f) => r[f].fouten && (r[f].fouten.pageerrors.length || r[f].fouten.netwerk.length)));
  if (fouten.length || paginafouten.length) {
    p("### Meetfouten / paginafouten", "");
    if (fouten.length) p(`- ${fouten.length} runs mislukt (navigatiefout).`);
    const perRoute = new Map();
    for (const r of paginafouten) perRoute.set(`${r.route}`, (perRoute.get(r.route) ?? 0) + 1);
    for (const [route, n] of perRoute) p(`- ${route}: ${n} runs met pagina-/netwerkfouten (zie raw/browser-runs.json).`);
    p("");
  }
}

/* ---------------- interacties ---------------- */
const inter = lees("interactions.json");
if (inter) {
  p("## Kerninteracties (Playwright, warme server)", "");
  if (inter.serverActions?.length) {
    const per = new Map();
    for (const a of inter.serverActions) {
      if (!per.has(a.actie)) per.set(a.actie, []);
      per.get(a.actie).push(a.wallMs);
    }
    p("| Server action | n | Mediaan wall (ms) | min–max |");
    p("|---|---:|---:|---|");
    for (const [actie, tijden] of per) {
      p(`| ${actie} | ${tijden.length} | ${f0(mediaan(tijden))} | ${f0(Math.min(...tijden))}–${f0(Math.max(...tijden))} |`);
    }
    p("");
  }
  if (inter.simulate?.length) {
    const t = inter.simulate.map((s) => s.ms);
    p(`**Match Studio simulate-API** (n=${t.length}): mediaan ${f0(mediaan(t))} ms, min–max ${f0(Math.min(...t))}–${f0(Math.max(...t))} ms.`, "");
  }
  if (inter.transitions?.length) {
    const per = new Map();
    for (const t of inter.transitions) {
      const k = `${t.profiel}|${t.overgang}`;
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(t.ms);
    }
    p("| Navigatie-overgang | Profiel | n | Mediaan (ms) | min–max |");
    p("|---|---|---:|---:|---|");
    for (const [k, tijden] of per) {
      const [profiel, overgang] = k.split("|");
      p(`| ${overgang} | ${profiel} | ${tijden.length} | ${f0(mediaan(tijden))} | ${f0(Math.min(...tijden))}–${f0(Math.max(...tijden))} |`);
    }
    p("");
  }
}

/* ---------------- bundelgroottes ---------------- */
const buildLog = process.argv[3];
if (buildLog && fs.existsSync(buildLog)) {
  const regels = fs.readFileSync(buildLog, "utf8").split("\n");
  const rijen = [];
  for (const r of regels) {
    const m = r.match(/^[├└┌]\s*([ƒ○●])\s+(\S+)\s+([\d.]+\s*k?B)\s+([\d.]+\s*k?B)/);
    if (m) rijen.push({ soort: m[1], route: m[2], size: m[3], firstLoad: m[4] });
  }
  if (rijen.length) {
    p("## Bundelgroottes per route (uit de build-output)", "");
    p("ƒ = dynamisch, ○ = statisch, ● = SSG.", "");
    p("| Route | Soort | Size | First Load JS |");
    p("|---|---|---:|---:|");
    for (const r of rijen) p(`| \`${r.route}\` | ${r.soort} | ${r.size} | ${r.firstLoad} |`);
    p("");
    const shared = regels.find((r) => r.includes("First Load JS shared by all"));
    if (shared) p(`_${shared.trim().replace(/^\+\s*/, "")}_`, "");
  }
}

process.stdout.write(uit.join("\n") + "\n");
