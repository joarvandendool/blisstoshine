// End-to-end run van de mobiele app (Expo web-render) tegen de echte lokale
// backend + screenshots van kernschermen. iPhone-viewport; web-security uit
// omdat metro (8081) en de API (3000) verschillende origins zijn (op iOS
// native bestaat CORS niet).

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const UIT = "/home/user/blisstoshine/apps/mobile/screenshots";
mkdirSync(UIT, { recursive: true });

const EMAIL = `demo-mobiel-${Date.now()}@demo.nl`;
const WACHTWOORD = "demo-mobiel-2026";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "nl-NL",
});
const page = await context.newPage();
page.setDefaultTimeout(60000);

async function foto(naam) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${UIT}/${naam}.png` });
  console.log(`✓ ${naam}`);
}

console.log("e-mail voor deze run:", EMAIL);

// 1. Openbaar zoeken (zonder login) — eerste bundel kan lang duren.
await page.goto("http://localhost:8081/", { waitUntil: "networkidle", timeout: 300000 });
await page.getByText("Werk dat past", { exact: false }).waitFor({ timeout: 300000 });
await page.waitForTimeout(2500);
await foto("01-openbaar-zoeken");

// 2. Vacaturedetail openbaar
const kaart = page.locator('[role="button"][aria-label*=" bij "]').first();
await kaart.scrollIntoViewIfNeeded();
await kaart.click({ force: true });
await page.getByText("Voorwaarden").waitFor();
await foto("02-vacaturedetail-openbaar");

// 3. Registreren
await page.getByText("Maak een account", { exact: false }).first().click();
await page.getByLabel("Naam").fill("Demo Mobiel");
await page.getByLabel("E-mailadres").fill(EMAIL);
await page.getByLabel("Wachtwoord (minimaal 8 tekens)").fill(WACHTWOORD);
await foto("03-registreren");
await page.getByRole("button", { name: "Account maken", exact: true }).click();

// 4. Onboarding stap 1: functie
await page.getByText("functie?", { exact: false }).waitFor();
await foto("04-onboarding-functie");
await page.getByRole("checkbox", { name: "Mondhygiënist" }).click();
await page.getByRole("checkbox", { name: "Medior" }).click();
await page.getByRole("button", { name: "Volgende" }).click();

// 5. Werkweek: dagdelen aantikken. De demo-vacature vereist di + do (ochtend
// en middag) én wo ochtend, dus die zetten we op voorkeur/beschikbaar zodat
// er een eligible match ontstaat.
await page.getByText("werkweek samen", { exact: false }).waitFor();
const cel = (dag, deel) => page.getByRole("button", { name: `${dag} ${deel}: niet beschikbaar` });
await cel("Dinsdag", "Ochtend").click();
await cel("Dinsdag", "Middag").click();
await cel("Woensdag", "Ochtend").click();
await cel("Donderdag", "Ochtend").click();
await cel("Donderdag", "Middag").click();
// donderdag nog een tik → beschikbaar (i.p.v. voorkeur)
await page.getByRole("button", { name: "Donderdag Ochtend: voorkeur" }).click();
await page.getByRole("button", { name: "Donderdag Middag: voorkeur" }).click();
await foto("05-onboarding-werkweek");
await page.getByRole("button", { name: "Volgende" }).click();

// 6. Uren/reistijd/startdatum
await page.getByText("reisafstand", { exact: false }).first().waitFor();
await page.getByLabel("Postcode (bv. 3511 AB)").fill("3511 AB");
await page.getByLabel("Maximale reistijd (minuten)").fill("45");
await page.getByLabel("Uren per week (min)").fill("16");
await page.getByLabel("Uren per week (max)").fill("28");
await foto("06-onboarding-uren");
await page.getByRole("button", { name: "Volgende" }).click();

// 7. Vakinhoud (scanner + specialisaties)
await page.getByText("specialisaties", { exact: false }).first().waitFor();
await page.getByRole("checkbox", { name: "TRIOS intraorale scanner" }).click();
await page.getByRole("checkbox", { name: "Parodontologie" }).click();
await page.getByRole("checkbox", { name: "Exquise" }).click();
await foto("07-onboarding-vakinhoud");
await page.getByRole("button", { name: "Volgende" }).click();

// 8. Contract + zzp-omzetpercentage
await page.getByRole("checkbox", { name: "Loondienst" }).locator("visible=true").first().waitFor();
await page.getByRole("checkbox", { name: "Loondienst" }).locator("visible=true").first().click();
await page.getByRole("checkbox", { name: "ZZP", exact: true }).locator("visible=true").first().click();
await page.getByLabel("Gewenst omzetpercentage bij zzp (0–100)").fill("40");
await foto("08-onboarding-contract");
await page.getByRole("button", { name: "Volgende" }).click();

// 9. Zichtbaarheid + activeren
await page.getByText("Wie mag je naam", { exact: false }).waitFor();
await foto("09-onboarding-zichtbaarheid");
await page.getByRole("button", { name: "Profiel activeren" }).click();

// 10. Matchfeed
await page.getByText("compleet", { exact: false }).locator("visible=true").first().waitFor();
await page.waitForTimeout(3000);
await foto("10-matches");

// 11. Matchdetail met uitleg
const matchKaart = page.locator('[role="button"][aria-label*="match van"]').locator("visible=true").first();
await matchKaart.scrollIntoViewIfNeeded();
await matchKaart.click({ force: true });
await page.getByText("Waarom deze score").waitFor();
await foto("11-matchdetail-uitleg");

// 12. Solliciteren
await page.getByLabel("Motivatie (optioneel)").fill("Graag kom ik kennismaken — dinsdag en donderdag passen perfect.");
await page.getByRole("button", { name: "Solliciteer op deze vacature" }).click();
await page.getByText("bevestigd door de server", { exact: false }).waitFor();
await foto("12-gesolliciteerd");

// Praktijkkant simuleren: uitnodiging + gesprek + notificatie voor deze gebruiker.
const { execSync } = await import("node:child_process");
execSync(
  `node /home/user/blisstoshine/apps/mobile/e2e/seed-invitation.mjs ${EMAIL}`,
  { cwd: "/home/user/blisstoshine", stdio: "inherit" },
);

// Vanaf hier UITSLUITEND client-side navigeren: een volledige page.goto zou
// op web de in-memory tokenopslag wissen (op iOS blijft de sessie in de
// Keychain). Terug naar de tabs via de browserhistorie (history-API =
// client-side in expo-router), daarna via de tabbalk.
async function naarTab(label) {
  // React Navigation web rendert tabs als link/tab, niet als button.
  const kandidaten = [
    page.getByRole("tab", { name: label }),
    page.getByRole("link", { name: label }),
    page.locator(`[href="/${label.toLowerCase()}"]`),
    page.getByText(label, { exact: true }),
  ];
  for (const kandidaat of kandidaten) {
    const el = kandidaat.first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ force: true });
      await page.waitForTimeout(1200);
      return;
    }
  }
  throw new Error(`tab niet gevonden: ${label}`);
}

await page.goBack(); // match-detail → matchtab
await page.waitForTimeout(1200);

// 13. Uitnodigingen (na server-side seed)
await naarTab("Uitnodigingen");
// Wachten tot de lijst (uitnodiging óf gesprek) geladen is.
await page
  .getByRole("button", { name: "Ik heb interesse" })
  .first()
  .waitFor({ timeout: 30000 })
  .catch(() => {});
await page.waitForTimeout(1500);
await foto("13-uitnodigingen");

// 14. Interesse tonen + consent delen
const interesse = page.getByRole("button", { name: "Ik heb interesse" }).first();
if (await interesse.isVisible().catch(() => false)) {
  await page.getByLabel("Deel mijn naam en contactgegevens met deze praktijk").first().click();
  await foto("14-uitnodiging-consent");
  await interesse.click();
  await page.waitForTimeout(2000);
}

// 15. Gesprek bevestigen
const kies = page.getByRole("button", { name: "Kies een moment" }).first();
if (await kies.isVisible().catch(() => false)) {
  await kies.click();
  await page.getByText("Plan je", { exact: false }).waitFor();
  // Slotchip: alleen de zichtbare (achtergrondschermen houden verborgen chips).
  await page.locator('[role="checkbox"]:visible').first().click();
  await foto("15-gesprek-kiezen");
  await page.getByRole("button", { name: "Bevestig dit moment" }).click();
  await page.getByText("Bevestigd:", { exact: false }).waitFor();
  await foto("16-gesprek-bevestigd");
  await page.goBack();
  await page.waitForTimeout(1000);
}

// 17. Profiel
await naarTab("Profiel");
await page.getByRole("button", { name: "Beschikbaarheid aanpassen" }).waitFor();
await page.waitForTimeout(1200);
await foto("17-profiel");

// 18. Beschikbaarheid aanpassen (en na herstart terugzien)
await page.getByRole("button", { name: "Beschikbaarheid aanpassen" }).click();
const vrOchtend = page.getByRole("button", { name: "Vrijdag Ochtend: niet beschikbaar" });
await vrOchtend.waitFor();
await vrOchtend.click();
await foto("18-beschikbaarheid-aanpassen");
await page.getByRole("button", { name: "Opslaan" }).click();
await page.waitForTimeout(1500);

// 19. Notificatievoorkeuren (via de profiel-tab)
await naarTab("Profiel");
await page.getByRole("button", { name: "Notificatievoorkeuren" }).click();
await page.getByText("Nieuwe uitnodiging", { exact: false }).first().waitFor();
await page.waitForTimeout(1200);
await foto("19-notificatievoorkeuren");
await page.goBack();
await page.waitForTimeout(1000);

// 20. Privacy + gegevens
await naarTab("Profiel");
await page.getByRole("button", { name: "Privacy en gegevens" }).click();
await page.getByText("Privacyverklaring").waitFor();
await page.waitForTimeout(1500);
await foto("20-privacy");

// 21. Accountverwijdering (scherm, niet uitvoeren voor deze demo-run)
await page.getByRole("button", { name: "Account verwijderen…" }).click();
await page.getByText("niet ongedaan", { exact: false }).waitFor();
await foto("21-account-verwijderen");

await browser.close();
console.log("KLAAR");
