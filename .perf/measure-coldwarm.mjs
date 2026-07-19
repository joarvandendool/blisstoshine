// Koude vs. warme serverresponses: dit script wordt aangeroepen NA een verse
// `next start` (koud) — het meet per route de allereerste server-TTFB en
// daarna 5 opgewarmde responses. Server-side fetch, geen browser.
// Output: .perf/raw/coldwarm-server.json (argument: label koud|warm-run)
import fs from "node:fs";
import { ROUTES, BASE, cookieHeader } from "./routes.mjs";

const uit = [];
for (const r of ROUTES) {
  const headers = r.rol ? { cookie: cookieHeader(r.rol) } : {};
  const tijden = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const res = await fetch(BASE + r.pad, { headers, redirect: "manual" });
    const tHeaders = performance.now();
    await res.arrayBuffer();
    tijden.push({ n: i, status: res.status, ttfbMs: +(tHeaders - t0).toFixed(1) });
  }
  uit.push({ route: r.id, pad: r.pad, koudMs: tijden[0].ttfbMs, warmMs: tijden.slice(1).map((t) => t.ttfbMs) });
  console.log(`${r.id}: koud ${tijden[0].ttfbMs}ms → warm ${tijden.slice(1).map((t) => t.ttfbMs).join("/")}`);
}
fs.writeFileSync(new URL("./raw/coldwarm-server.json", import.meta.url), JSON.stringify(uit, null, 1));
console.log("Klaar.");
