// Interactiemetingen (op de warme productieserver, desktop-profiel zonder
// throttling tenzij anders vermeld):
//  A. Server action: beschikbaarheid wijzigen (werkweek-sectie opslaan)
//  B. Server action: profielsectie zichtbaarheid opslaan
//  C. Match Studio simulate-API-roundtrip (fetch vanuit de studiopagina)
//  D. Navigatie-overgangen klik→bruikbare pagina: feed→detail,
//     dashboard→studio, dashboard→bezetting (desktop én mobiel-traag)
// Output: .perf/raw/interactions.json
import { chromium } from "playwright";
import fs from "node:fs";
import { BASE, EXEC, SLUG, VACANCY_LINDEBOOM, storageStatePath } from "./routes.mjs";

const uit = { serverActions: [], simulate: [], transitions: [] };
const browser = await chromium.launch({ executablePath: EXEC });

/* ---- helper: meet de eerstvolgende server action POST op een pagina ---- */
async function meetServerActionKlik(page, klik) {
  const respPromise = page.waitForResponse(
    (r) => r.request().method() === "POST" && !!r.request().headers()["next-action"],
    { timeout: 30000 },
  );
  const t0 = Date.now();
  await klik();
  const resp = await respPromise;
  await resp.finished().catch(() => {});
  const wall = Date.now() - t0;
  const timing = resp.request().timing();
  const netDuur = timing && timing.responseEnd > 0 ? timing.responseEnd - timing.requestStart : null;
  return { wallMs: wall, requestMs: netDuur, status: resp.status() };
}

/* ================= A + B: profiel server actions ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: storageStatePath("kandidaat") });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kandidaat/profiel`, { waitUntil: "networkidle" });
  for (let i = 0; i < 5; i++) {
    // A: wijzig één werkweekcel (toggle heen/terug over runs) en sla op.
    await page.locator('div[role="group"][aria-label="Werkweek: dagen en dagdelen"] button').first().click();
    const opslaanWerkweek = page.getByRole("button", { name: /^Opslaan/ }).first();
    const a = await meetServerActionKlik(page, () => opslaanWerkweek.click());
    uit.serverActions.push({ actie: "beschikbaarheid-opslaan", run: i + 1, ...a });
    await page.waitForTimeout(400);
    // B: sla de zichtbaarheidssectie op (tweede Opslaan-knop).
    const opslaanZichtbaarheid = page.getByRole("button", { name: /^Opslaan/ }).nth(1);
    const b = await meetServerActionKlik(page, () => opslaanZichtbaarheid.click());
    uit.serverActions.push({ actie: "profielsectie-zichtbaarheid-opslaan", run: i + 1, ...b });
    await page.waitForTimeout(400);
    console.log(`run ${i + 1}: beschikbaarheid ${a.wallMs}ms / zichtbaarheid ${b.wallMs}ms`);
  }
  await ctx.close();
}

/* ================= C: Match Studio simulate roundtrip ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: storageStatePath("praktijk") });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/praktijk/${SLUG}/vacatures/${VACANCY_LINDEBOOM}/studio`, { waitUntil: "networkidle" });
  for (let i = 0; i < 20; i++) {
    const r = await page.evaluate(
      async ({ slug, vacancyId, i }) => {
        const body = JSON.stringify({ slug, vacancyId, overrides: { hoursMin: 20 + (i % 8), mentorship: i % 2 === 0 } });
        const t0 = performance.now();
        const resp = await fetch("/api/praktijk/studio/simulate", {
          method: "POST", headers: { "content-type": "application/json" }, body,
        });
        const tekst = await resp.text();
        return { ms: performance.now() - t0, status: resp.status, bytes: tekst.length };
      },
      { slug: SLUG, vacancyId: VACANCY_LINDEBOOM, i },
    );
    uit.simulate.push({ run: i + 1, ...r });
  }
  console.log("simulate:", uit.simulate.map((s) => s.ms.toFixed(0)).join(" "));
  await ctx.close();
}

/* ================= D: navigatie-overgangen ================= */
const PROFIELEN = [
  { id: "desktop-snel", viewport: { width: 1440, height: 900 }, throttle: false },
  { id: "mobiel-traag", viewport: { width: 390, height: 844 }, throttle: true },
];
const OVERGANGEN = [
  {
    id: "feed→detail", rol: "kandidaat", start: "/kandidaat",
    linkSelector: 'a[href*="/kandidaat/matches/"]', doelUrl: /\/kandidaat\/matches\//,
  },
  {
    id: "dashboard→studio", rol: "praktijk", start: `/praktijk/${SLUG}`,
    linkSelector: 'a[href*="/studio"]', doelUrl: /\/studio$/,
  },
  {
    id: "dashboard→bezetting", rol: "praktijk", start: `/praktijk/${SLUG}`,
    linkSelector: 'a[href$="/bezetting"]', doelUrl: /\/bezetting$/,
  },
];
for (const prof of PROFIELEN) {
  for (const ov of OVERGANGEN) {
    for (let run = 1; run <= 3; run++) {
      const ctx = await browser.newContext({ viewport: prof.viewport, storageState: storageStatePath(ov.rol) });
      const page = await ctx.newPage();
      if (prof.throttle) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false, latency: 150,
          downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9,
          uploadThroughput: (750 * 1024) / 8 * 0.9,
        });
      }
      await page.goto(BASE + ov.start, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
      const link = page.locator(ov.linkSelector).first();
      await link.waitFor({ state: "visible", timeout: 20000 });
      const t0 = Date.now();
      await link.click();
      await page.waitForURL(ov.doelUrl, { timeout: 60000 });
      await page.locator("h1, h2").first().waitFor({ state: "visible", timeout: 60000 });
      const ms = Date.now() - t0;
      uit.transitions.push({ profiel: prof.id, overgang: ov.id, run, ms });
      console.log(`${prof.id} ${ov.id} run ${run}: ${ms}ms`);
      await ctx.close();
    }
  }
}

await browser.close();
fs.writeFileSync(new URL("./raw/interactions.json", import.meta.url), JSON.stringify(uit, null, 1));
console.log("Klaar.");
