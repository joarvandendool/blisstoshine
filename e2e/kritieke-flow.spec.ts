// End-to-end-test van de kritieke gebruikersflow van Mondzorgwerkt:
//
//  1. kandidaat registreert en doorloopt de volledige onboarding;
//  2. praktijk registreert en maakt organisatie + locatie (Utrecht);
//  3. praktijk publiceert een vacature via de wizard;
//  4. kandidaat ziet de match in de feed en opent het matchdetail (uitleg);
//  5. (= stap 7 uit de opdracht) de Match Studio toont op trial de beperkte
//     modus met upgrade-uitnodiging;
//  6. praktijk upgradet via de abonnementspagina (gesimuleerde betaling)
//     naar Essential en daarna Growth (zodat er ook een echte upgrade —
//     subscription_upgraded — plaatsvindt);
//  7. praktijk simuleert in de volledige studio een roosterwijziging en de
//     kandidatenpool verandert (wacht op de simulate-API-response);
//  8. kandidaat solliciteert met motivatie;
//  9. praktijk zet de sollicitatie naar gesprek en daarna naar aangenomen;
// 10. de bijbehorende AnalyticsEvent-rijen bestaan (verificatie via Prisma).
//
// De twee actoren (kandidaat en praktijk) hebben elk hun eigen browsercontext
// die de hele serial-suite blijft leven, zodat sessies niet opnieuw hoeven te
// worden opgebouwd. E-mailadressen krijgen een timestamp-suffix zodat de test
// herhaalbaar is op een reeds gevulde database.

import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { db } from "./db";

/* ------------------------------- testdata -------------------------------- */

const RUN = Date.now();
const WACHTWOORD = "Testwachtwoord1";

const KANDIDAAT_NAAM = `E2E Kandidaat ${RUN}`;
const KANDIDAAT_EMAIL = `e2e-kandidaat-${RUN}@voorbeeld.nl`;

const PRAKTIJK_OWNER_NAAM = `E2E Eigenaar ${RUN}`;
const PRAKTIJK_EMAIL = `e2e-praktijk-${RUN}@voorbeeld.nl`;
const PRAKTIJK_NAAM = `E2E Praktijk ${RUN}`;

const VACATURE_TITEL = `Mondhygiënist E2E ${RUN}`;

/* --------------------------- gedeelde toestand --------------------------- */

let kandidaatContext: BrowserContext;
let praktijkContext: BrowserContext;
let kandidaat: Page;
let praktijk: Page;

let praktijkSlug = "";
let vacancyId = "";
let studioPad = "";
let matchDetailPad = "";

/* ------------------------------ hulpfuncties ----------------------------- */

/**
 * Klik met het element eerst in het midden van het scherm. Op mobiel ligt de
 * vaste tabbalk (Hoofdnavigatie) over de onderrand van de pagina; Playwrights
 * minimale scroll zet knoppen onderaan de pagina precies dáronder, waardoor
 * de tap wordt onderschept. Centreren lost dat op en is op desktop onschadelijk.
 * behavior "instant" is nodig omdat de app html{scroll-behavior:smooth} zet en
 * een animerende (asynchrone) scroll de klik-hittest zou laten racen.
 */
async function klik(knop: Locator): Promise<void> {
  await knop.evaluate((el) =>
    el.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant",
    }),
  );
  await knop.click();
}

/** Klikt een WeekGrid-cel (button met aria-label "Dinsdag ochtend: …") en
 *  wacht tot de cel de verwachte nieuwe staat meldt. */
async function klikDagdeel(
  page: Page,
  cel: "Maandag" | "Dinsdag" | "Woensdag" | "Donderdag" | "Vrijdag",
  deel: "ochtend" | "middag" | "avond",
  verwachteStaat: string,
): Promise<void> {
  const knop = page.getByRole("button", {
    name: new RegExp(`^${cel} ${deel}:`),
  });
  await klik(knop);
  await expect(knop).toHaveAccessibleName(`${cel} ${deel}: ${verwachteStaat}`);
}

/** Leest het aantal matchbare kandidaten uit de pool-teller van de studio. */
async function poolTeller(page: Page): Promise<number> {
  const teller = page.locator('p[aria-live="polite"]');
  await expect(teller).toBeVisible();
  const tekst = (await teller.textContent()) ?? "";
  const match = /(\d+)/.exec(tekst);
  expect(match, `pool-teller onleesbaar: "${tekst}"`).not.toBeNull();
  return Number(match![1]);
}

/* --------------------------------- suite --------------------------------- */

test.describe.serial("Kritieke gebruikersflow", () => {
  test.beforeAll(async ({ browser }) => {
    // Twee actoren met elk een eigen sessie, met de emulatie-instellingen
    // (viewport, mobiel) van het gekozen project.
    const use = test.info().project.use;
    const opties = {
      baseURL: use.baseURL,
      viewport: use.viewport,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
    };
    kandidaatContext = await browser.newContext(opties);
    praktijkContext = await browser.newContext(opties);
    kandidaat = await kandidaatContext.newPage();
    praktijk = await praktijkContext.newPage();
  });

  test.afterAll(async () => {
    await kandidaatContext?.close();
    await praktijkContext?.close();
    await db.$disconnect();
  });

  /* ---------------------- 1. kandidaat maakt profiel ---------------------- */

  test("1. kandidaat registreert en activeert een volledig profiel", async () => {
    await kandidaat.goto("/registreren");
    await kandidaat.getByLabel("Volledige naam").fill(KANDIDAAT_NAAM);
    await kandidaat.getByLabel("E-mailadres").fill(KANDIDAAT_EMAIL);
    await kandidaat.getByLabel("Wachtwoord").fill(WACHTWOORD);
    await klik(kandidaat.getByRole("button", { name: "Maak gratis profiel" }));
    await kandidaat.waitForURL("**/kandidaat/onboarding");

    // Stap 1 — functie en ervaring.
    await expect(
      kandidaat.getByRole("heading", { name: "Wat doe je?" }),
    ).toBeVisible();
    await klik(
      kandidaat
        .getByRole("group", { name: "Functie" })
        .getByRole("button", { name: "Mondhygiënist", exact: true }),
    );
    const medior = kandidaat.getByRole("button", { name: /^Medior/ });
    await klik(medior);
    await expect(medior).toHaveAttribute("aria-pressed", "true");
    await klik(kandidaat.getByRole("button", { name: "Verder" }));

    // Stap 2 — werkweek: dinsdag + donderdag als voorkeur.
    await expect(
      kandidaat.getByRole("heading", { name: "Jouw ideale werkweek" }),
    ).toBeVisible();
    await klikDagdeel(kandidaat, "Dinsdag", "ochtend", "voorkeur");
    await klikDagdeel(kandidaat, "Dinsdag", "middag", "voorkeur");
    await klikDagdeel(kandidaat, "Donderdag", "ochtend", "voorkeur");
    await klikDagdeel(kandidaat, "Donderdag", "middag", "voorkeur");
    await klik(kandidaat.getByRole("button", { name: "Verder" }));

    // Stap 3 — locatie, uren en contract.
    await expect(
      kandidaat.getByRole("heading", { name: "Waar en hoeveel?" }),
    ).toBeVisible();
    await kandidaat.locator("#postcode").fill("3511 AB");
    await kandidaat.locator("#uren-min").selectOption("16");
    await kandidaat.locator("#uren-max").selectOption("32");
    await klik(
      kandidaat
        .getByRole("group", { name: "Contractvorm" })
        .getByRole("button", { name: "Loondienst", exact: true }),
    );
    await klik(kandidaat.getByRole("button", { name: "Verder" }));

    // Stap 4 — vakinhoud: minimaal iets aanklikken.
    await expect(
      kandidaat.getByRole("heading", { name: "Jouw vakinhoud" }),
    ).toBeVisible();
    await klik(
      kandidaat
        .getByRole("group", { name: "Apparatuurervaring" })
        .getByRole("button", { name: "AirFlow", exact: true }),
    );
    await klik(kandidaat.getByRole("button", { name: "Verder" }));

    // Stap 5 — werkplek (alles optioneel).
    await expect(
      kandidaat.getByRole("heading", { name: "Jouw ideale werkplek" }),
    ).toBeVisible();
    await klik(kandidaat.getByRole("button", { name: "Verder" }));

    // Stap 6 — zichtbaarheid: zichtbaar met naam, daarna activeren.
    await expect(
      kandidaat.getByRole("heading", { name: "Wie mag jou zien?" }),
    ).toBeVisible();
    await klik(
      kandidaat
        .getByRole("button", { name: /^Zichtbaar met naam/ }),
    );
    await klik(
      kandidaat
        .getByRole("button", { name: "Activeer mijn profiel" }),
    );
    await kandidaat.waitForURL("**/kandidaat");
    await expect(
      kandidaat.getByRole("heading", { name: /^Hallo/ }),
    ).toBeVisible();
  });

  /* ----------------- 2. praktijk maakt organisatie + locatie -------------- */

  test("2. praktijk registreert en maakt organisatie met locatie in Utrecht", async () => {
    await praktijk.goto("/registreren?type=praktijk");
    await praktijk.getByLabel("Je naam").fill(PRAKTIJK_OWNER_NAAM);
    await praktijk.getByLabel("E-mailadres").fill(PRAKTIJK_EMAIL);
    await praktijk.getByLabel("Wachtwoord").fill(WACHTWOORD);
    await klik(praktijk.getByRole("button", { name: "Start als praktijk" }));
    await praktijk.waitForURL("**/praktijk/nieuw");

    await praktijk.locator("#praktijknaam").fill(PRAKTIJK_NAAM);
    await praktijk.locator("#postcode").fill("3511 AB");
    await praktijk.locator("#plaats").fill("Utrecht");
    await klik(
      praktijk
        .getByRole("button", { name: "Start je praktijkomgeving" }),
    );

    await praktijk.waitForURL(/\/praktijk\/(?!nieuw$)[^/]+$/);
    praktijkSlug = new URL(praktijk.url()).pathname.split("/").pop() ?? "";
    expect(praktijkSlug.length).toBeGreaterThan(0);

    await expect(
      praktijk.getByRole("heading", { name: `Dashboard van ${PRAKTIJK_NAAM}` }),
    ).toBeVisible();
    await expect(praktijk.getByText("Plan: Proefperiode")).toBeVisible();
  });

  /* --------------------- 3. praktijk publiceert vacature ------------------ */

  test("3. praktijk doorloopt de vacaturewizard en publiceert", async () => {
    await praktijk.goto(`/praktijk/${praktijkSlug}/vacatures/nieuw`);

    // Stap 1 — basis.
    await expect(
      praktijk.getByRole("heading", { name: "Wie zoeken jullie?" }),
    ).toBeVisible();
    await klik(
      praktijk
        .getByRole("group", { name: "Functie" })
        .getByRole("button", { name: "Mondhygiënist", exact: true }),
    );
    // Automatisch titelvoorstel, daarna een unieke titel voor deze run.
    await expect(praktijk.locator("#titel")).toHaveValue(
      "Mondhygiënist in Utrecht",
    );
    await praktijk.locator("#titel").fill(VACATURE_TITEL);
    await klik(praktijk.getByRole("button", { name: "Verder" }));

    // Stap 2 — werkweek: dinsdag + donderdag nodig, 16–32 uur, loondienst.
    await expect(
      praktijk.getByRole("heading", { name: "Welke werkweek vragen jullie?" }),
    ).toBeVisible();
    await klikDagdeel(praktijk, "Dinsdag", "ochtend", "nodig");
    await klikDagdeel(praktijk, "Dinsdag", "middag", "nodig");
    await klikDagdeel(praktijk, "Donderdag", "ochtend", "nodig");
    await klikDagdeel(praktijk, "Donderdag", "middag", "nodig");
    await praktijk.locator("#uren-min").selectOption("16");
    await praktijk.locator("#uren-max").selectOption("32");
    await klik(
      praktijk
        .getByRole("group", { name: "Contractvorm" })
        .getByRole("button", { name: "Loondienst", exact: true }),
    );
    await klik(praktijk.getByRole("button", { name: "Verder" }));

    // Stap 3 — eisen & aanbod (optioneel, doorklikken).
    await expect(
      praktijk.getByRole("heading", { name: "Eisen én aanbod" }),
    ).toBeVisible();
    await klik(praktijk.getByRole("button", { name: "Verder" }));

    // Stap 4 — Talent Radar-preview (trial: teaser + upsell voor het rapport).
    await expect(
      praktijk.getByRole("heading", { name: /Talent Radar/ }),
    ).toBeVisible();
    await expect(
      praktijk.getByText("Wil je het volledige rapport?"),
    ).toBeVisible({ timeout: 15_000 });
    await klik(praktijk.getByRole("button", { name: "Verder" }));

    // Stap 5 — publiceren.
    await expect(
      praktijk.getByRole("heading", { name: "Klaar om te publiceren?" }),
    ).toBeVisible();
    await klik(praktijk.getByRole("button", { name: "Publiceer vacature" }));
    await praktijk.waitForURL(`**/praktijk/${praktijkSlug}`);

    await expect(praktijk.getByText("Gepubliceerd", { exact: true })).toBeVisible();
    await expect(praktijk.getByText(VACATURE_TITEL).first()).toBeVisible();

    // Vacancy-id en studio-pad vastleggen voor de vervolgstappen.
    const studioHref = await praktijk
      .getByRole("link", { name: "Match Studio" })
      .getAttribute("href");
    expect(studioHref).toBeTruthy();
    studioPad = studioHref!;
    const idMatch = /\/vacatures\/([^/]+)\/studio$/.exec(studioPad);
    expect(idMatch).not.toBeNull();
    vacancyId = idMatch![1];
  });

  /* ------------------------ 4. match wordt berekend ----------------------- */

  test("4. kandidaat ziet de nieuwe vacature met score en uitleg", async () => {
    await kandidaat.goto("/kandidaat");

    const kaart = kandidaat
      .getByRole("listitem")
      .filter({ hasText: VACATURE_TITEL });
    await expect(kaart).toBeVisible();
    await expect(kaart.getByText(PRAKTIJK_NAAM)).toBeVisible();
    // Matchscore zichtbaar op de kaart.
    await expect(kaart.getByText(/\d+%/).first()).toBeVisible();

    await klik(kaart.getByRole("link", { name: "Bekijk match" }));
    await kandidaat.waitForURL(`**/kandidaat/matches/${vacancyId}`);
    matchDetailPad = new URL(kandidaat.url()).pathname;

    // Uitleg: score, categoriescores en sterke punten.
    await expect(
      kandidaat.getByRole("heading", { name: VACATURE_TITEL }),
    ).toBeVisible();
    await expect(kandidaat.getByText(/\d+%/).first()).toBeVisible();
    await expect(
      kandidaat.getByRole("heading", { name: "Sterke punten" }),
    ).toBeVisible();
    await expect(
      kandidaat.getByText("Beschikbaarheid", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      kandidaat.getByText("Reisafstand", { exact: true }).first(),
    ).toBeVisible();
    // Solliciteren is mogelijk (de match is eligible) — nodig voor stap 8.
    await expect(
      kandidaat.getByRole("button", { name: "Solliciteer op deze vacature" }),
    ).toBeVisible();
  });

  /* -------- 5. (stap 7) studio op trial: beperkte modus + upgrade --------- */

  test("5. Match Studio toont op trial de beperkte modus met upgrade-uitnodiging", async () => {
    await praktijk.goto(studioPad);

    await expect(
      praktijk.getByText("Beperkte weergave — simulatie hoort bij Growth"),
    ).toBeVisible();
    await expect(
      praktijk.getByRole("heading", {
        name: "Simuleren en opportunity-voorstellen",
      }),
    ).toBeVisible();
    await expect(
      praktijk.getByText(
        "Urenrange en begeleiding zijn hier vergrendeld — simuleren hoort bij Growth.",
      ),
    ).toBeVisible();
    await expect(
      praktijk.getByRole("link", { name: "Bekijk het Growth-plan" }),
    ).toBeVisible();

    // In de beperkte modus blijft de pool zichtbaar, maar zijn de
    // roostercellen géén knoppen (readonly weergave).
    await expect(
      praktijk.getByRole("button", { name: /^Dinsdag ochtend:/ }),
    ).toHaveCount(0);
  });

  /* --------------- 6. upgrade naar Growth (gesimuleerde betaling) --------- */

  test("6. praktijk upgradet via de abonnementspagina naar Growth", async () => {
    await praktijk.goto(`/praktijk/${praktijkSlug}/abonnement`);
    await expect(
      praktijk.getByText("Testomgeving — geen echte betaling").first(),
    ).toBeVisible();

    // Vanaf trial eerst een betaald plan starten (subscription_started) …
    await klik(praktijk.getByRole("button", { name: "Start Essential" }));
    await expect(
      praktijk.getByText("Je abonnement is gewijzigd naar Essential", {
        exact: false,
      }),
    ).toBeVisible();

    // … en daarna de echte upgrade naar Growth (subscription_upgraded).
    await klik(
      praktijk
        .getByRole("button", { name: "Upgrade naar Growth" }),
    );
    await expect(
      praktijk.getByText("Je abonnement is gewijzigd naar Growth", {
        exact: false,
      }),
    ).toBeVisible();

    const growthKaart = praktijk
      .getByRole("listitem")
      .filter({ has: praktijk.getByRole("heading", { name: "Growth", exact: true }) });
    await expect(growthKaart.getByText("Huidig plan")).toBeVisible();
    await expect(
      growthKaart.getByText("Dit is je huidige plan."),
    ).toBeVisible();
  });

  /* --------- 7. (stap 5+6) simulatie in de volledige Match Studio --------- */

  test("7. praktijk simuleert een roosterwijziging en de pool verandert", async () => {
    await praktijk.goto(studioPad);

    // Volledige modus na de upgrade.
    await expect(
      praktijk.getByText(/Klik op een dagdeel om te simuleren/),
    ).toBeVisible();
    await expect(
      praktijk.getByText("Beperkte weergave — simulatie hoort bij Growth"),
    ).toHaveCount(0);

    // De nieuwe kandidaat is met naam zichtbaar in de pool.
    await expect(praktijk.getByText(KANDIDAAT_NAAM).first()).toBeVisible();

    const voor = await poolTeller(praktijk);
    expect(voor).toBeGreaterThan(0);

    // Woensdagochtend "nodig" maken: een extra harde eis kan de pool alleen
    // maar verkleinen, en de nieuwe kandidaat (di+do) valt er zeker uit.
    const simulatie = praktijk.waitForResponse(
      (res) =>
        res.url().includes("/api/praktijk/studio/simulate") &&
        res.request().method() === "POST",
    );
    await klikDagdeel(praktijk, "Woensdag", "ochtend", "nodig");
    await expect(
      praktijk.getByText("Simulatie — nog niets opgeslagen"),
    ).toBeVisible();
    const antwoord = await simulatie;
    expect(antwoord.ok()).toBeTruthy();

    // Pool-teller en delta-indicatie veranderen mee.
    await expect(async () => {
      const na = await poolTeller(praktijk);
      expect(na).toBeLessThan(voor);
    }).toPass({ timeout: 10_000 });
    await expect(
      praktijk.getByText(/door deze aanpassing/).first(),
    ).toBeVisible();

    // Niets opslaan: simulatie herstellen zodat de vacature ongewijzigd blijft.
    await klik(praktijk.getByRole("button", { name: "Herstel origineel" }));
    await expect(
      praktijk.getByText("Simulatie — nog niets opgeslagen"),
    ).toHaveCount(0);
  });

  /* ------------------------- 8. kandidaat solliciteert -------------------- */

  test("8. kandidaat solliciteert met motivatie en ziet een bevestiging", async () => {
    await kandidaat.goto(matchDetailPad);
    await kandidaat
      .locator("#motivatie")
      .fill(
        "Dinsdag en donderdag passen precies in mijn week — ik kom graag kennismaken.",
      );
    await klik(
      kandidaat
        .getByRole("button", { name: "Solliciteer op deze vacature" }),
    );
    // Bevestiging: ofwel de succesmelding van het formulier, ofwel — doordat
    // revalidatePath de pagina direct opnieuw rendert — de statuskaart
    // "Je sollicitatie" met de status "Verstuurd".
    await expect(
      kandidaat
        .getByText("Je sollicitatie is verstuurd.")
        .or(kandidaat.getByText("Verstuurd — wacht op reactie van de praktijk"))
        .first(),
    ).toBeVisible();
    await expect(
      kandidaat.getByRole("button", { name: "Solliciteer op deze vacature" }),
    ).toHaveCount(0);
  });

  /* ------------------ 9. praktijk: gesprek en aangenomen ------------------ */

  test("9. praktijk zet de sollicitatie naar gesprek en daarna naar aangenomen", async () => {
    await praktijk.goto(`/praktijk/${praktijkSlug}`);

    // De sollicitatie staat met naam en status "Nieuw" in de pipeline.
    await expect(praktijk.getByText(KANDIDAAT_NAAM).first()).toBeVisible();
    await expect(praktijk.getByText("Nieuw", { exact: true })).toBeVisible();

    await klik(praktijk.getByRole("button", { name: "Plan gesprek" }));
    await expect(praktijk.getByText("Gesprek", { exact: true })).toBeVisible();
    await expect(praktijk.getByText("1 in gesprek")).toBeVisible();

    await klik(praktijk.getByRole("button", { name: "Aannemen" }));
    await expect(
      praktijk.getByText("Aangenomen", { exact: true }),
    ).toBeVisible();
    await expect(praktijk.getByText("1 aangenomen")).toBeVisible();
  });

  /* ----------------------- 10. AnalyticsEvents bestaan -------------------- */

  test("10. de AnalyticsEvents van de flow staan in de database", async () => {
    const gebruiker = await db.user.findUnique({
      where: { email: KANDIDAAT_EMAIL },
      include: { candidateProfile: { select: { id: true } } },
    });
    expect(gebruiker?.candidateProfile?.id).toBeTruthy();
    const profielId = gebruiker!.candidateProfile!.id;

    const organisatie = await db.organization.findUnique({
      where: { slug: praktijkSlug },
      select: { id: true },
    });
    expect(organisatie?.id).toBeTruthy();
    const orgId = organisatie!.id;

    const verwacht: Array<{
      name: string;
      where: Record<string, unknown>;
    }> = [
      {
        name: "candidate_profile_activated",
        where: { candidateId: profielId },
      },
      { name: "vacancy_published", where: { organizationId: orgId } },
      {
        name: "match_viewed",
        where: { candidateId: profielId, organizationId: orgId },
      },
      {
        name: "application_submitted",
        where: { candidateId: profielId, organizationId: orgId },
      },
      {
        name: "interview_scheduled",
        where: { candidateId: profielId, organizationId: orgId },
      },
      {
        name: "candidate_hired",
        where: { candidateId: profielId, organizationId: orgId },
      },
      {
        name: "subscription_upgraded",
        where: { organizationId: orgId, plan: "growth" },
      },
    ];

    for (const { name, where } of verwacht) {
      // match_viewed wordt fire-and-forget geschreven; poll voor de zekerheid.
      await expect
        .poll(
          async () => db.analyticsEvent.count({ where: { name, ...where } }),
          {
            message: `AnalyticsEvent "${name}" ontbreekt voor deze run`,
            timeout: 10_000,
          },
        )
        .toBeGreaterThan(0);
    }
  });
});
