// Logt de drie demo-accounts in via de echte login-UI en bewaart storageState
// (cookies) per rol, zodat meetcontexten geauthenticeerd maar met lege cache
// kunnen starten.
import { chromium } from "playwright";
import fs from "node:fs";
import { BASE, EXEC } from "./routes.mjs";

const ACCOUNTS = [
  { rol: "kandidaat", email: "kandidaat@demo.nl", pw: "demo-kandidaat-2026" },
  { rol: "praktijk", email: "praktijk@delindeboom.nl", pw: "demo-praktijk-2026" },
  { rol: "admin", email: "admin@mondzorgwerkt.nl", pw: "demo-admin-2026" },
];

const browser = await chromium.launch({ executablePath: EXEC });
for (const acc of ACCOUNTS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/inloggen`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', acc.email);
  await page.fill('input[name="password"]', acc.pw);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("inloggen"), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log(acc.rol, "->", page.url());
  const state = await ctx.storageState();
  fs.writeFileSync(new URL(`./state-${acc.rol}.json`, import.meta.url), JSON.stringify(state));
  await ctx.close();
}
await browser.close();
