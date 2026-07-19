// Browser-labmeting per route. Twee profielen:
//  - desktop-snel : 1440×900, geen throttling
//  - mobiel-traag : 390×844, 4× CPU-throttle + Fast-3G-achtig netwerk via CDP
// Per run: verse context (cookies wel, cache leeg) → koude navigatie → warme
// tweede navigatie in dezelfde context. 3 runs per route per profiel.
// Output: .perf/raw/browser-runs.json (elke individuele run).
import { chromium } from "playwright";
import fs from "node:fs";
import { ROUTES, BASE, EXEC, storageStatePath } from "./routes.mjs";

const PROFIELEN = [
  { id: "desktop-snel", viewport: { width: 1440, height: 900 }, throttle: false, settle: 1500 },
  {
    id: "mobiel-traag",
    viewport: { width: 390, height: 844 },
    throttle: true,
    // Fast-3G-achtig (Lighthouse-conventie): 150 ms RTT, 1,6 Mbps down, 750 kbps up; CPU 4×.
    net: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9 },
    cpu: 4,
    settle: 3000,
  },
];
const RUNS = Number(process.env.PERF_RUNS ?? 5);

const initScript = () => {
  const W = (window.__perf = { lcp: [], cls: 0, clsSources: [], longtasks: [], });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const el = e.element;
        W.lcp.push({
          t: e.startTime, size: e.size, url: e.url || null,
          tag: el ? el.tagName : null,
          id: el && el.id ? el.id : null,
          cls: el ? String(el.className || "").slice(0, 80) : null,
          text: el && el.textContent ? el.textContent.trim().slice(0, 90) : null,
        });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        W.cls += e.value;
        for (const s of e.sources || []) {
          const n = s.node;
          W.clsSources.push({
            value: e.value, t: e.startTime,
            node: n && n.tagName ? n.tagName + (n.id ? "#" + n.id : "") + (n.className ? "." + String(n.className).split(" ").slice(0, 2).join(".") : "") : String(n),
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) W.longtasks.push({ t: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
};

async function verzamel(page) {
  return page.evaluate(() => {
    const W = window.__perf || { lcp: [], cls: 0, clsSources: [], longtasks: [] };
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const res = performance.getEntriesByType("resource");
    const somPer = (pred) => res.filter(pred).reduce((a, r) => a + (r.transferSize || 0), 0);
    const isJs = (r) => /\.js(\?|$)/.test(r.name) || r.initiatorType === "script";
    const isCss = (r) => /\.css(\?|$)/.test(r.name) || r.initiatorType === "css" && /\.css/.test(r.name);
    const rsc = res.filter((r) => r.name.includes("_rsc=") || (r.initiatorType === "fetch" && r.name.startsWith(location.origin) && !r.name.includes("/api/")));
    const lcp = W.lcp.length ? W.lcp[W.lcp.length - 1] : null;
    const tbtBron = fcp == null ? [] : W.longtasks.filter((t) => t.t >= fcp);
    const flight = Array.isArray(self.__next_f)
      ? self.__next_f.reduce((a, e) => a + (Array.isArray(e) && typeof e[1] === "string" ? e[1].length : 0), 0)
      : 0;
    return {
      ttfb: nav ? nav.responseStart : null,
      docTransfer: nav ? nav.transferSize : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav ? nav.loadEventEnd : null,
      fcp,
      lcp: lcp ? lcp.t : null,
      lcpElement: lcp,
      cls: W.cls,
      clsSources: W.clsSources.slice(0, 10),
      longtasks: W.longtasks,
      tbt: tbtBron.reduce((a, t) => a + Math.max(0, t.dur - 50), 0),
      lastLongTaskEnd: W.longtasks.length ? Math.max(...W.longtasks.map((t) => t.t + t.dur)) : null,
      requests: res.length + 1, // +1 voor het document zelf
      transferTotaal: (nav ? nav.transferSize : 0) + somPer(() => true),
      transferJs: somPer(isJs),
      transferCss: somPer(isCss),
      rscRequests: rsc.length,
      rscTransfer: rsc.reduce((a, r) => a + (r.transferSize || 0), 0),
      inlineFlightBytes: flight,
    };
  });
}

async function navMeting(page, url, settle) {
  const fouten = { console: [], pageerrors: [], netwerk: [] };
  const onConsole = (m) => { if (m.type() === "error") fouten.console.push(m.text().slice(0, 200)); };
  const onPageError = (e) => fouten.pageerrors.push(String(e).slice(0, 200));
  const onReqFail = (r) => fouten.netwerk.push(`${r.method()} ${r.url()} → ${r.failure()?.errorText}`);
  const onResp = (r) => { if (r.status() >= 400) fouten.netwerk.push(`${r.request().method()} ${r.url()} → HTTP ${r.status()}`); };
  page.on("console", onConsole); page.on("pageerror", onPageError);
  page.on("requestfailed", onReqFail); page.on("response", onResp);
  await page.goto(url, { waitUntil: "load", timeout: 90000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(settle);
  const m = await verzamel(page);
  page.off("console", onConsole); page.off("pageerror", onPageError);
  page.off("requestfailed", onReqFail); page.off("response", onResp);
  return { ...m, fouten };
}

const uit = [];
const browser = await chromium.launch({ executablePath: EXEC });
for (const prof of PROFIELEN) {
  for (const route of ROUTES) {
    for (let run = 1; run <= RUNS; run++) {
      const ctx = await browser.newContext({
        viewport: prof.viewport,
        storageState: route.rol ? storageStatePath(route.rol) : undefined,
        isMobile: prof.id === "mobiel-traag",
        deviceScaleFactor: prof.id === "mobiel-traag" ? 3 : 1,
      });
      await ctx.addInitScript(initScript);
      const page = await ctx.newPage();
      if (prof.throttle) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", prof.net);
      }
      const url = BASE + route.pad;
      try {
        const koud = await navMeting(page, url, prof.settle);
        const warm = await navMeting(page, url, prof.settle);
        uit.push({ profiel: prof.id, route: route.id, pad: route.pad, run, koud, warm });
        console.log(`${prof.id} ${route.id} run ${run}: koud TTFB ${koud.ttfb?.toFixed(0)}ms LCP ${koud.lcp?.toFixed(0)}ms | warm LCP ${warm.lcp?.toFixed(0)}ms`);
      } catch (e) {
        uit.push({ profiel: prof.id, route: route.id, pad: route.pad, run, fout: String(e).slice(0, 300) });
        console.log(`${prof.id} ${route.id} run ${run}: FOUT ${e}`);
      }
      await ctx.close();
    }
  }
}
await browser.close();
fs.mkdirSync(new URL("./raw/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./raw/browser-runs.json", import.meta.url), JSON.stringify(uit, null, 1));
console.log("Klaar:", uit.length, "runs");
