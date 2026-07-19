// Compacte e2e-tests voor de beta-onderdelen:
//
//  a. een nieuwe praktijk registreert en doorloopt de commerciële onboarding
//     op /praktijk/start tot en met de Talent Radar-stap, en ziet daar het
//     teaser-aantal potentiële kandidaten (vereist ≥ 5 actieve mondhygiënisten
//     binnen reisafstand van Utrecht — gegarandeerd door de seed plus elke
//     eerdere run van de kritieke flow);
//  b. de seed-kandidaat Iris (iris@demo.nl) opent /kandidaat/uitnodigingen en
//     ziet haar openstaande persoonlijke uitnodiging van De Lindeboom.
//     NB: de seed bevat géén uitnodiging voor Sanne (kandidaat@demo.nl) — de
//     openstaande uitnodiging is voor Iris; deze test gebruikt daarom Iris.
//     De test is alleen-lezen: interesse tonen of afwijzen zou de seed-staat
//     veranderen en de herhaalbaarheid breken.

import { test, expect, type Locator, type Page } from "@playwright/test";

const RUN = Date.now();
const WACHTWOORD = "Testwachtwoord1";
const PRAKTIJK_EMAIL = `beta-praktijk-${RUN}@voorbeeld.nl`;
const PRAKTIJK_NAAM = `Beta Praktijk ${RUN}`;

// Eigen gesimuleerd client-IP per run (x-forwarded-for): de registratie-
// limiet is 5 per uur per IP en de hele suite deelt anders één IP — zie de
// toelichting in kritieke-flow.spec.ts.
test.use({
  extraHTTPHeaders: {
    "x-forwarded-for": `10.${Math.floor(RUN / 256) % 256}.${RUN % 256}.3`,
  },
});

/** Klik met het element eerst gecentreerd (zie kritieke-flow.spec.ts). */
async function klik(knop: Locator): Promise<void> {
  await knop.evaluate((el) =>
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }),
  );
  await knop.click();
}

/** WeekGrid-cel omzetten en de nieuwe staat verifiëren. */
async function klikDagdeel(
  page: Page,
  dag: string,
  deel: string,
  verwachteStaat: string,
): Promise<void> {
  const knop = page.getByRole("button", { name: new RegExp(`^${dag} ${deel}:`) });
  await klik(knop);
  await expect(knop).toHaveAccessibleName(`${dag} ${deel}: ${verwachteStaat}`);
}

test("praktijk doorloopt /praktijk/start tot de Talent Radar en ziet het teaser-aantal", async ({
  page,
}) => {
  // Registreren als praktijk → automatisch door naar /praktijk/start.
  await page.goto("/registreren?type=praktijk");
  await page.getByLabel("Je naam").fill(`Beta Eigenaar ${RUN}`);
  await page.getByLabel("E-mailadres").fill(PRAKTIJK_EMAIL);
  await page.getByLabel("Wachtwoord").fill(WACHTWOORD);
  await klik(page.getByRole("button", { name: "Start als praktijk" }));
  await page.waitForURL("**/praktijk/start");

  // Stap 1 — praktijkgegevens (maakt organisatie + trial aan).
  await expect(
    page.getByRole("heading", { name: /stel je praktijk voor/ }),
  ).toBeVisible();
  await page.locator("#praktijknaam").fill(PRAKTIJK_NAAM);
  await page.locator("#plaats").fill("Utrecht");
  await page.locator("#postcode").fill("3511 AB");
  await klik(page.getByRole("button", { name: "Verder" }));

  // Stap 2 — functie + ervaringsniveau.
  await expect(page.getByRole("heading", { name: "Wie zoek je?" })).toBeVisible();
  await klik(
    page
      .getByRole("group", { name: "Functie" })
      .getByRole("button", { name: "Mondhygiënist", exact: true }),
  );
  await klik(page.getByRole("button", { name: /^Geen voorkeur/ }));
  await klik(page.getByRole("button", { name: "Verder" }));

  // Stap 3 — werkdagen: dinsdag- en donderdagochtend nodig.
  await expect(
    page.getByRole("heading", { name: "Wanneer heb je iemand nodig?" }),
  ).toBeVisible();
  await klikDagdeel(page, "Dinsdag", "ochtend", "nodig");
  await klikDagdeel(page, "Donderdag", "ochtend", "nodig");
  await klik(page.getByRole("button", { name: "Verder" }));

  // Stap 4 — uren & contract (defaults volstaan, wel een contractvorm kiezen).
  await expect(page.getByRole("heading", { name: "Uren en contract" })).toBeVisible();
  await klik(
    page
      .getByRole("group", { name: "Contractvorm" })
      .getByRole("button", { name: "Loondienst", exact: true }),
  );
  await klik(page.getByRole("button", { name: "Verder" }));

  // Stap 5 — uitrusting: alles optioneel.
  await expect(
    page.getByRole("heading", { name: "Waarmee gaan ze werken?" }),
  ).toBeVisible();
  await klik(page.getByRole("button", { name: "Verder" }));

  // Stap 6 — Talent Radar: het teaser-aantal verschijnt na de live berekening.
  await expect(
    page.getByRole("heading", { name: "Dit is jouw talentmarkt" }),
  ).toBeVisible();
  await expect(
    page.getByText(/\d+ potentiële kandidaten in jouw regio/),
  ).toBeVisible({ timeout: 15_000 });
  // Trial heeft geen volledig marktrapport: de upsell verwijst naar abonnementen.
  await expect(
    page.getByRole("link", { name: "Bekijk de abonnementen" }),
  ).toBeVisible();
});

test("kandidaat Iris ziet haar openstaande uitnodiging op /kandidaat/uitnodigingen", async ({
  page,
}) => {
  // Inloggen als Iris — de seed-kandidaat met een openstaande uitnodiging.
  await page.goto("/inloggen");
  await page.getByLabel("E-mailadres").fill("iris@demo.nl");
  await page.getByLabel("Wachtwoord").fill("demo-kandidaat-2026");
  await klik(page.getByRole("button", { name: "Inloggen" }));
  await page.waitForURL("**/kandidaat");

  // Via de navigatie naar de uitnodigingenpagina. Regex i.p.v. exact:
  // op mobiel is de desktopnav ("Hoofdnavigatie") CSS-verborgen en dus
  // onzichtbaar voor getByRole; daar zijn de bottom tabs
  // ("Hoofdnavigatie (mobiel)") de zichtbare navigatie.
  await klik(
    page
      .getByRole("navigation", { name: /Hoofdnavigatie/ })
      .getByRole("link", { name: "Uitnodigingen" }),
  );
  await page.waitForURL("**/kandidaat/uitnodigingen");

  // De openstaande uitnodiging van De Lindeboom staat er met boodschap,
  // matchscore en de acties — zonder er iets mee te doen (herhaalbaarheid).
  await expect(
    page.getByRole("heading", { name: "Jouw uitnodigingen" }),
  ).toBeVisible();
  await expect(page.getByText("Persoonlijke uitnodiging").first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mondhygiënist 24–32 uur" }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Mondzorgpraktijk De Lindeboom", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ik heb interesse" }),
  ).toBeVisible();
  // Privacyduidelijkheid: wat de praktijk nu al ziet vs. na toestemming.
  await expect(page.getByText("Dit ziet de praktijk nu al")).toBeVisible();
  await expect(page.getByText("Pas ná jouw toestemming")).toBeVisible();
});
