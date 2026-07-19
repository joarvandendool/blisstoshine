// Visuele regressietests van de publieke laag (Workstream B, fase 13).
//
// Screenshot-asserties (toHaveScreenshot, maxDiffPixelRatio 0.02 via
// playwright.config.ts) voor alle publieke kernschermen op 390 en 1440 px
// (768 alleen voor homepage + vacatureoverzicht), plus functionele checks:
// reduced motion, toetsenbordbediening van het mobiele menu, extreem lange
// Nederlandse titels en de nul-resultatenstaat met invoerbehoud.
//
// De suite draait uitsluitend in het desktop-project (tag @visueel; het
// mobiele project sluit hem uit via grepInvert) en regelt de viewports
// zelf. Baselines staan in e2e/visueel-publiek.spec.ts-snapshots/.
//
// BEWUST OVERGESLAGEN — laadstaat: app/vacatures/loading.tsx bestaat, maar
// de fixtures-adapter resolvet synchroon waardoor de laadstaat in productie
// slechts één frame (of helemaal niet) zichtbaar is. Een kunstmatige
// vertraging zou productiecode met testpaden vervuilen; de laadstaat is
// daarom niet betrouwbaar te vangen en wordt hier genoteerd in plaats van
// gescreenshot (zie ook docs/parallel/CODEX_VISUAL_HANDOFF.md).

import { test, expect, type Page } from "@playwright/test";

/* ------------------------------ constanten ------------------------------ */

const VIEWPORTS = {
  "390": { width: 390, height: 844 },
  "768": { width: 768, height: 1024 },
  "1440": { width: 1440, height: 900 },
} as const;

type ViewportNaam = keyof typeof VIEWPORTS;

// Fixture-slugs (src/public-site/data/fixtures.ts — fictieve data).
const OPEN_VACATURE = "/vacatures/mondhygienist-utrecht-de-linde";
const GESLOTEN_VACATURE = "/vacatures/mondhygienist-amsterdam-vondelpark";
const PRAKTIJK = "/praktijken/tandartspraktijk-de-linde-utrecht";
const LANGE_TITEL_VACATURE =
  "/vacatures/waarnemend-tandarts-implantoloog-groningen-noorderlicht";
const LEGE_ZOEKOPDRACHT = "/vacatures?functie=praktijkmanager&plaats=middelburg";

// Seed-praktijk (prisma/seed.ts) voor de ingelogde pricingpagina.
const SEED_PRAKTIJK_EMAIL = "praktijk@delindeboom.nl";
const SEED_PRAKTIJK_WACHTWOORD = "demo-praktijk-2026";
const SEED_PRAKTIJK_ABONNEMENT = "/praktijk/mondzorgpraktijk-de-lindeboom/abonnement";

/* ------------------------------ hulpfuncties ----------------------------- */

async function stabiliseer(page: Page, pad: string, vp: ViewportNaam) {
  await page.setViewportSize(VIEWPORTS[vp]);
  await page.goto(pad);
  // Dynamische routes streamen eerst hun loading.tsx (zonder h1): wacht
  // op de echte inhoud, anders screenshotten we de skeleton-staat.
  await expect(page.locator("h1").first()).toBeVisible();
  // Webfonts eerst — anders verschuift tekst tussen twee runs.
  await page.evaluate(() => document.fonts.ready);
}

async function logInAlsPraktijk(page: Page) {
  await page.goto("/inloggen");
  await page.getByLabel("E-mailadres").fill(SEED_PRAKTIJK_EMAIL);
  await page.getByLabel("Wachtwoord").fill(SEED_PRAKTIJK_WACHTWOORD);
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.waitForURL(/\/praktijk\//);
}

/* --------------------------- screenshot-matrix --------------------------- */

const SCHERMEN: ReadonlyArray<{
  naam: string;
  pad: string;
  viewports: readonly ViewportNaam[];
}> = [
  { naam: "homepage", pad: "/", viewports: ["390", "768", "1440"] },
  {
    naam: "vacatures-overzicht",
    pad: "/vacatures",
    viewports: ["390", "768", "1440"],
  },
  { naam: "vacature-detail-open", pad: OPEN_VACATURE, viewports: ["390", "1440"] },
  {
    naam: "vacature-detail-gesloten",
    pad: GESLOTEN_VACATURE,
    viewports: ["390", "1440"],
  },
  { naam: "praktijkpagina", pad: PRAKTIJK, viewports: ["390", "1440"] },
  {
    naam: "kennispagina",
    pad: "/functies/mondhygienist",
    viewports: ["390", "1440"],
  },
  { naam: "design-system", pad: "/design-system", viewports: ["390", "1440"] },
  {
    naam: "kandidaat-startpunt",
    pad: "/registreren",
    viewports: ["390", "1440"],
  },
  {
    naam: "vacatures-leeg",
    pad: LEGE_ZOEKOPDRACHT,
    viewports: ["390", "1440"],
  },
  {
    naam: "fout-404",
    pad: "/deze-pagina-bestaat-niet",
    viewports: ["390", "1440"],
  },
];

test.describe("@visueel screenshots publieke laag", () => {
  for (const scherm of SCHERMEN) {
    for (const vp of scherm.viewports) {
      test(`${scherm.naam} op ${vp}px`, async ({ page }) => {
        await stabiliseer(page, scherm.pad, vp);
        await expect(page).toHaveScreenshot(`${scherm.naam}-${vp}.png`, {
          fullPage: true,
        });
      });
    }
  }

  for (const vp of ["390", "1440"] as const) {
    test(`pricing (abonnement, ingelogd) op ${vp}px`, async ({ page }) => {
      await logInAlsPraktijk(page);
      await stabiliseer(page, SEED_PRAKTIJK_ABONNEMENT, vp);
      await expect(
        page.getByRole("heading", { name: /abonnement/i }).first(),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(`pricing-abonnement-${vp}.png`, {
        fullPage: true,
      });
    });
  }
});

/* --------------------------- functionele checks -------------------------- */

test.describe("@visueel reduced motion", () => {
  test("Match Shape en decoratie staan stil bij prefers-reduced-motion", async ({
    page,
  }) => {
    // page.emulateMedia i.p.v. test.use({ reducedMotion }): de context-
    // optie bleek in deze Playwright-versie niet door te komen in de
    // fixture-context (gemeten met matchMedia); emulateMedia wél.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stabiliseer(page, "/", "1440");
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    // De hero-Match Shape is aanwezig en volwaardig …
    await expect(page.locator(".mz-blob-a").first()).toBeVisible();
    // … maar animeert niet: de keyframes bestaan alleen binnen
    // @media (prefers-reduced-motion: no-preference).
    const animaties = await page.evaluate(() =>
      [...document.querySelectorAll(".mz-blob-a, .mz-blob-b, .skeleton")].map(
        (el) => getComputedStyle(el).animationName,
      ),
    );
    for (const naam of animaties) expect(naam).toBe("none");
  });
});

test.describe("@visueel toetsenbord en robuustheid", () => {
  test("mobiel menu is volledig met het toetsenbord te bedienen", async ({
    page,
  }) => {
    await stabiliseer(page, "/", "390");

    const menuKnop = page.getByRole("button", { name: /menu openen/i });
    await menuKnop.focus();
    await expect(menuKnop).toHaveAttribute("aria-expanded", "false");

    // Enter opent het paneel.
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /menu sluiten/i }),
    ).toHaveAttribute("aria-expanded", "true");
    const paneel = page.locator("header [id][hidden]");
    await expect(paneel).toHaveCount(0); // niet langer hidden

    // Tab bereikt de menu-items (in het mobiele paneel, niet de op
    // mobiel verborgen desktopnavigatie).
    await page.keyboard.press("Tab");
    const eersteItem = page.locator("header div.md\\:hidden ul a").first();
    await expect(eersteItem).toBeFocused();

    // Escape sluit en zet de focus terug op de menuknop.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: /menu openen/i }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /menu openen/i })).toBeFocused();
  });

  test("extreem lange Nederlandse titel breekt zonder horizontale overflow", async ({
    page,
  }) => {
    await stabiliseer(page, LANGE_TITEL_VACATURE, "390");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Waarnemend tandarts-implantoloog/,
      }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("nul zoekresultaten: lege staat + filters blijven ingevuld", async ({
    page,
  }) => {
    await stabiliseer(page, LEGE_ZOEKOPDRACHT, "1440");
    await expect(
      page.getByRole("heading", {
        name: "Geen vacatures gevonden met deze filters",
      }),
    ).toBeVisible();
    // Invoerbehoud: de gekozen filters staan nog in het formulier.
    await expect(page.locator("#filter-functie")).toHaveValue("praktijkmanager");
    await expect(page.locator("#filter-plaats")).toHaveValue("middelburg");
    // Herstelroutes: per functie verder of alles wissen.
    await expect(
      page.getByRole("link", { name: "Wis alle filters" }),
    ).toBeVisible();
  });
});
