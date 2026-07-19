// Aggregatie van ruwe browserruns naar mediaan + spreiding per
// route × profiel × cachetoestand. Output: .perf/raw/browser-agg.json en een
// Markdown-tabel op stdout.
import fs from "node:fs";

const runs = JSON.parse(fs.readFileSync(new URL("./raw/browser-runs.json", import.meta.url), "utf8"));

const METRIEKEN = ["ttfb", "fcp", "lcp", "cls", "tbt", "domContentLoaded", "load", "requests", "transferTotaal", "transferJs", "transferCss", "inlineFlightBytes", "lastLongTaskEnd"];

function mediaan(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

const groepen = new Map();
for (const r of runs) {
  if (r.fout) continue;
  for (const fase of ["koud", "warm"]) {
    const k = `${r.profiel}|${r.route}|${fase}`;
    if (!groepen.has(k)) groepen.set(k, { profiel: r.profiel, route: r.route, pad: r.pad, fase, runs: [] });
    groepen.get(k).runs.push(r[fase]);
  }
}

const agg = [];
for (const g of groepen.values()) {
  const rij = { profiel: g.profiel, route: g.route, pad: g.pad, fase: g.fase, n: g.runs.length };
  for (const m of METRIEKEN) {
    const vals = g.runs.map((r) => r[m]).filter((v) => v != null && Number.isFinite(v));
    if (!vals.length) { rij[m] = null; continue; }
    rij[m] = { med: +mediaan(vals).toFixed(m === "cls" ? 4 : 1), min: +Math.min(...vals).toFixed(m === "cls" ? 4 : 1), max: +Math.max(...vals).toFixed(m === "cls" ? 4 : 1) };
  }
  // LCP-element en CLS-bronnen uit de eerste run
  rij.lcpElement = g.runs[0].lcpElement;
  rij.clsSources = g.runs[0].clsSources;
  rij.fouten = g.runs.flatMap((r) => [...r.fouten.console, ...r.fouten.pageerrors, ...r.fouten.netwerk]);
  rij.longtaskCount = { med: mediaan(g.runs.map((r) => r.longtasks.length)) };
  agg.push(rij);
}
fs.writeFileSync(new URL("./raw/browser-agg.json", import.meta.url), JSON.stringify(agg, null, 1));

// Markdown-tabellen
const f = (v, eenheid = "") => (v == null ? "—" : `${v.med}${eenheid} (${v.min}–${v.max})`);
for (const profiel of ["desktop-snel", "mobiel-traag"]) {
  for (const fase of ["koud", "warm"]) {
    console.log(`\n### ${profiel} — ${fase} (n per cel = ${agg.find((a) => a.profiel === profiel && a.fase === fase)?.n ?? "?"})\n`);
    console.log("| Route | TTFB | FCP | LCP | CLS | TBT* | Load | Req | Transfer | JS | RSC-flight |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of agg.filter((a) => a.profiel === profiel && a.fase === fase)) {
      const kb = (v) => (v == null ? "—" : `${(v.med / 1024).toFixed(0)} kB`);
      console.log(`| ${r.route} | ${f(r.ttfb, "ms")} | ${f(r.fcp, "ms")} | ${f(r.lcp, "ms")} | ${f(r.cls)} | ${f(r.tbt, "ms")} | ${f(r.load, "ms")} | ${r.requests?.med ?? "—"} | ${kb(r.transferTotaal)} | ${kb(r.transferJs)} | ${kb(r.inlineFlightBytes)} |`);
    }
  }
}
