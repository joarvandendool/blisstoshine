// Contracttests voor de site-integratie van de openbare laag:
// de DirectDataSource (src/public-site/data/direct.ts) levert het
// frontend-contract (src/public-site/data/types.ts) rechtstreeks uit de
// (test)database, met exact dezelfde regels en vormen als de fixtures:
// (a) alleen gepubliceerde vacatures in lijsten; gesloten wél per slug;
// (b) praktijken uitsluitend mét publicatie-consent;
// (c) correcte paginering incl. totalPages en paginaklem;
// (d) structurele gelijkheid van sleutels met de fixtures;
// (e) filtersemantiek (dagen: álle gekozen dagen; uren: rangeoverlap;
//     stad: case-insensitieve deelmatch op "stad regio") met grensgevallen;
// (f) zzp-omzetpercentage als geheel getal 0–100 (nooit fractie/uurtarief);
// (g) de nieuwe publieke endpoints (GET /practices, jobs-filters).

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
  const { sessieHouder, createTestSessionToken } = await import("./helpers");
  return {
    cookies: async () => ({
      get: (naam: string) =>
        naam === "mz_session" && sessieHouder.userId
          ? { value: createTestSessionToken(sessieHouder.userId) }
          : undefined,
      set: () => {},
      delete: () => {},
    }),
  };
});

import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing";
import { createOrganizationWithLocation, addLocation } from "@/server/organizations";
import { createDraftVacancy, markFilled, publishVacancy } from "@/server/vacancies";
import { DirectDataSource, FixtureDataSource } from "@/public-site/data/adapter";
import { FIXTURE_JOBS, FIXTURE_PRACTICES } from "@/public-site/data/fixtures";
import { alsGebruiker, maakGebruiker, prepareTestDb, rooster } from "./helpers";

// Route handlers rechtstreeks aanroepen (zelfde stijl als public-api.test.ts).
import { GET as jobsGET } from "../../app/api/public/v1/jobs/route";
import { GET as jobDetailGET } from "../../app/api/public/v1/jobs/[idOrSlug]/route";
import { GET as practicesGET } from "../../app/api/public/v1/practices/route";
import { GET as practiceGET } from "../../app/api/public/v1/practices/[slug]/route";

function verzoek(pad: string): Request {
  return new Request(`http://localhost${pad}`);
}

function metParam<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

/** Sleutels van een object, gesorteerd — voor structurele contractchecks. */
function sleutels(waarde: unknown): string[] {
  return Object.keys(waarde as Record<string, unknown>).sort();
}

const bron = new DirectDataSource();

let orgConsent: { id: string; slug: string };
let orgZonder: { id: string; slug: string };
let vacMondhygienist: { id: string; slug: string | null };
let vacAssistent: { id: string; slug: string | null };
let vacZzp: { id: string; slug: string | null };
let vacFilled: { id: string; slug: string | null };

beforeAll(async () => {
  await prepareTestDb();

  const ownerA = await maakGebruiker("direct-a@test.nl", "Owner A");
  const ownerB = await maakGebruiker("direct-b@test.nl", "Owner B");

  alsGebruiker(ownerA.id);
  const a = await createOrganizationWithLocation({
    name: "Praktijk Consent",
    location: {
      name: "Consent Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 4,
      traits: ["informeel", "leergericht"],
      equipment: ["trios"],
      software: ["exquise"],
      specializations: ["parodontologie"],
      patientPopulation: ["volwassenen"],
    },
  });
  orgConsent = { id: a.organization.id, slug: a.organization.slug };
  await getBillingProvider().changePlan(orgConsent.id, "multi_location");

  // Tweede locatie: de praktijkview aggregeert over álle locaties.
  const ctxA = await requireMembership(orgConsent.id);
  await addLocation(ctxA, {
    name: "Consent Amsterdam",
    city: "Amsterdam",
    postcode: "1011 AC",
    treatmentRooms: 2,
    equipment: ["itero"],
    software: ["exquise"],
    specializations: ["implantologie"],
    patientPopulation: ["kinderen"],
  });

  // Publicatie-consent: expliciet vastgelegd (Organization.publicConsent).
  await prisma.organization.update({
    where: { id: orgConsent.id },
    data: {
      publicConsent: true,
      publicConsentAt: new Date(),
      publicDescription: "Publieke testpraktijk met twee locaties.",
    },
  });

  alsGebruiker(ownerB.id);
  const b = await createOrganizationWithLocation({
    name: "Praktijk Zonder Consent",
    location: { name: "Zonder Rotterdam", city: "Rotterdam", postcode: "3011 AB", treatmentRooms: 2 },
  });
  orgZonder = { id: b.organization.id, slug: b.organization.slug };
  await getBillingProvider().changePlan(orgZonder.id, "growth");

  // Vacatures van de consent-praktijk.
  alsGebruiker(ownerA.id);
  vacMondhygienist = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: a.location.id,
        title: "Mondhygiënist direct",
        role: "mondhygienist",
        description: "Echte databasevacature voor de contracttests.",
        schedule: rooster(["di", "do"], ["vr"]),
        hoursMin: 24,
        hoursMax: 32,
        contractTypes: ["loondienst", "zzp"],
        salaryMin: 320_000,
        salaryMax: 410_000,
        criteria: {
          registrations: { values: ["big_mondhygienist"], level: "required" },
          equipment: { values: ["trios"], level: "preferred" },
          software: { values: ["exquise"], level: "informational" },
          specializations: { values: ["parodontologie"], level: "preferred" },
          treatments: { values: ["gebitsreiniging"], level: "preferred" },
        },
        culture: ["informeel", "leergericht"],
        mentorship: true,
        development: ["interne_opleiding", "congresbudget"],
      })
    ).id,
  );

  // Zonder salaris én zonder omzetpercentage → salary/revenueShare null.
  vacAssistent = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: a.location.id,
        title: "Assistent zonder salarisindicatie",
        role: "tandartsassistent",
        schedule: rooster(["ma"]),
        hoursMin: 8,
        hoursMax: 16,
        contractTypes: ["loondienst"],
      })
    ).id,
  );

  // Concept: bestaat publiek niet.
  await createDraftVacancy(ctxA, {
    locationId: a.location.id,
    title: "Concept direct",
    role: "tandarts",
    hoursMin: 8,
    hoursMax: 16,
  });

  // Ooit gepubliceerd, inmiddels vervuld: alleen per slug, status "closed".
  const teVervullen = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: a.location.id,
        title: "Vervulde directvacature",
        role: "preventieassistent",
        hoursMin: 8,
        hoursMax: 16,
      })
    ).id,
  );
  vacFilled = await markFilled(ctxA, teVervullen.id);

  // Zzp-vacature van de praktijk zonder consent: de vacature is wél publiek.
  alsGebruiker(ownerB.id);
  const ctxB = await requireMembership(orgZonder.id);
  vacZzp = await publishVacancy(
    ctxB,
    (
      await createDraftVacancy(ctxB, {
        locationId: b.location.id,
        title: "Tandarts zzp direct",
        role: "tandarts",
        schedule: rooster(["ma", "di"]),
        hoursMin: 24,
        hoursMax: 36,
        contractTypes: ["zzp"],
        revenueShareMax: 45,
      })
    ).id,
  );
});

/* ------------------------------------------------------------------ */
/* Lijsten: published-only, sortering, paginering                      */
/* ------------------------------------------------------------------ */

describe("DirectDataSource.getJobs", () => {
  it("bevat uitsluitend gepubliceerde vacatures, nieuwste eerst", async () => {
    const resultaat = await bron.getJobs({}, 1);
    const titels = resultaat.items.map((j) => j.title);
    expect(titels).toContain("Mondhygiënist direct");
    expect(titels).toContain("Assistent zonder salarisindicatie");
    expect(titels).toContain("Tandarts zzp direct");
    expect(titels).not.toContain("Concept direct");
    expect(titels).not.toContain("Vervulde directvacature");
    expect(resultaat.total).toBe(3);
    expect(resultaat.totalPages).toBe(1);
    const datums = resultaat.items.map((j) => j.datePosted);
    expect([...datums].sort().reverse()).toEqual(datums);
  });

  it("pagineert op 6 met totalPages en klemt een pagina buiten bereik", async () => {
    // Vijf extra gepubliceerde vacatures → 8 totaal → 2 pagina's.
    alsGebruiker((await prisma.user.findUniqueOrThrow({ where: { email: "direct-a@test.nl" } })).id);
    const ctxA = await requireMembership(orgConsent.id);
    const locatie = await prisma.practiceLocation.findFirstOrThrow({
      where: { organizationId: orgConsent.id },
      orderBy: { createdAt: "asc" },
    });
    for (let i = 1; i <= 5; i += 1) {
      await publishVacancy(
        ctxA,
        (
          await createDraftVacancy(ctxA, {
            locationId: locatie.id,
            title: `Vulvacature ${i}`,
            role: "tandartsassistent",
            hoursMin: 8,
            hoursMax: 16,
            contractTypes: ["loondienst"],
          })
        ).id,
      );
    }

    const pagina1 = await bron.getJobs({}, 1);
    expect(pagina1.total).toBe(8);
    expect(pagina1.pageSize).toBe(6);
    expect(pagina1.totalPages).toBe(2);
    expect(pagina1.items).toHaveLength(6);

    const pagina2 = await bron.getJobs({}, 2);
    expect(pagina2.items).toHaveLength(2);

    // Pagina buiten bereik wordt geklemd op de laatste pagina (fixturegedrag).
    const teVer = await bron.getJobs({}, 99);
    expect(teVer.page).toBe(2);
    expect(teVer.items).toHaveLength(2);

    // Opruimen zodat de filtertests over de drie kernvacatures gaan.
    await prisma.vacancy.deleteMany({ where: { title: { startsWith: "Vulvacature" } } });
  });
});

/* ------------------------------------------------------------------ */
/* Detail: gesloten per slug, concepten bestaan niet                   */
/* ------------------------------------------------------------------ */

describe("DirectDataSource.getJob", () => {
  it("levert een gepubliceerde vacature op slug, met tags en labels", async () => {
    const job = await bron.getJob(vacMondhygienist.slug ?? "");
    expect(job).not.toBeNull();
    expect(job?.status).toBe("published");
    expect(job?.role).toEqual({ key: "mondhygienist", label: "Mondhygiënist" });
    // employmentTypes zijn PublicTags (key + Nederlands label), geen strings.
    expect(job?.employmentTypes).toEqual([
      { key: "loondienst", label: "Loondienst" },
      { key: "zzp", label: "ZZP" },
    ]);
    expect(job?.culture.map((t) => t.key)).toEqual(["informeel", "leergericht"]);
    expect(job?.mentorship).toBe(true);
    expect(job?.development.map((t) => t.key)).toEqual([
      "interne_opleiding",
      "congresbudget",
    ]);
    // "informational" bestaat niet in het sitecontract → "preferred".
    for (const eis of job?.requirements ?? []) {
      expect(["required", "preferred"]).toContain(eis.level);
    }
  });

  it("levert een gesloten vacature per slug met status closed", async () => {
    const job = await bron.getJob(vacFilled.slug ?? "");
    expect(job).not.toBeNull();
    expect(job?.status).toBe("closed");
  });

  it("kent concepten en onbekende slugs niet", async () => {
    const concept = await prisma.vacancy.findFirstOrThrow({
      where: { title: "Concept direct" },
    });
    expect(await bron.getJob(concept.id)).toBeNull();
    expect(await bron.getJob("bestaat-niet")).toBeNull();
  });

  it("mapt ontbrekende data eerlijk: geen salaris/omzet → null, geen beschrijving → lege string", async () => {
    const job = await bron.getJob(vacAssistent.slug ?? "");
    expect(job?.salary).toBeNull();
    expect(job?.revenueShare).toBeNull();
    expect(job?.description).toBe("");
    expect(job?.validThrough).toBeNull();
  });

  it("houdt het zzp-omzetpercentage een geheel getal 0–100", async () => {
    const job = await bron.getJob(vacZzp.slug ?? "");
    expect(job?.salary).toBeNull();
    expect(job?.revenueShare).toEqual({ maxPercent: 45 });
    expect(Number.isInteger(job?.revenueShare?.maxPercent)).toBe(true);
    expect(job?.revenueShare?.maxPercent).toBeGreaterThanOrEqual(0);
    expect(job?.revenueShare?.maxPercent).toBeLessThanOrEqual(100);
  });
});

/* ------------------------------------------------------------------ */
/* Structurele gelijkheid met de fixtures                              */
/* ------------------------------------------------------------------ */

describe("contractvorm t.o.v. de fixtures", () => {
  it("een directe vacature heeft exact de sleutels van een fixturevacature", async () => {
    const direct = await bron.getJob(vacMondhygienist.slug ?? "");
    const fixture = FIXTURE_JOBS[0];
    expect(sleutels(direct)).toEqual(sleutels(fixture));
    expect(sleutels(direct?.location)).toEqual(sleutels(fixture.location));
    expect(sleutels(direct?.organization)).toEqual(sleutels(fixture.organization));
    expect(sleutels(direct?.availability[0])).toEqual(sleutels(fixture.availability[0]));
    expect(sleutels(direct?.salary)).toEqual(
      sleutels({ minCents: 0, maxCents: 0 }),
    );
    expect(direct?.location.postcode4).toMatch(/^\d{4}$/);
  });

  it("een directe praktijk heeft exact de sleutels van een fixturepraktijk", async () => {
    const direct = await bron.getPractice(orgConsent.slug);
    const fixture = FIXTURE_PRACTICES[0];
    expect(sleutels(direct)).toEqual(sleutels(fixture));
    expect(sleutels(direct?.locations[0])).toEqual(sleutels(fixture.locations[0]));
  });

  it("getJobs-resultaat heeft dezelfde vorm als het fixtureresultaat", async () => {
    const direct = await bron.getJobs({}, 1);
    const fixture = await new FixtureDataSource().getJobs({}, 1);
    expect(sleutels(direct)).toEqual(sleutels(fixture));
  });

  it("de taxonomie heeft de vorm van het frontend-contract", async () => {
    const taxonomie = await bron.getTaxonomies();
    expect(sleutels(taxonomie)).toEqual(
      ["roles", "employmentTypes", "equipment", "software", "specializations", "days", "dayparts"].sort(),
    );
    // Stage is geen publieke contractvorm in de zoekfilters.
    expect(taxonomie.employmentTypes.map((t) => t.key)).not.toContain("stage");
  });
});

/* ------------------------------------------------------------------ */
/* Filtersemantiek (identiek aan FixtureDataSource.matchtFilters)      */
/* ------------------------------------------------------------------ */

describe("DirectDataSource-filters", () => {
  it("dagen: de vacature moet álle gekozen dagen vragen (required óf preferred)", async () => {
    // di+do (required) én vr (preferred) worden gevraagd → allemaal matchen.
    expect((await bron.getJobs({ days: ["di", "do"] }, 1)).items.map((j) => j.title)).toEqual([
      "Mondhygiënist direct",
    ]);
    expect((await bron.getJobs({ days: ["vr"] }, 1)).items.map((j) => j.title)).toEqual([
      "Mondhygiënist direct",
    ]);
    // wo wordt níet gevraagd → één ontbrekende dag sluit uit.
    expect((await bron.getJobs({ days: ["di", "wo"] }, 1)).items).toHaveLength(0);
  });

  it("uren: rangeoverlap, inclusief de exacte grenzen", async () => {
    const rol = { role: "mondhygienist" }; // vacature: 24–32 uur
    expect((await bron.getJobs({ ...rol, hoursMin: 32 }, 1)).items).toHaveLength(1);
    expect((await bron.getJobs({ ...rol, hoursMin: 33 }, 1)).items).toHaveLength(0);
    expect((await bron.getJobs({ ...rol, hoursMax: 24 }, 1)).items).toHaveLength(1);
    expect((await bron.getJobs({ ...rol, hoursMax: 23 }, 1)).items).toHaveLength(0);
    expect((await bron.getJobs({ ...rol, hoursMin: 8, hoursMax: 40 }, 1)).items).toHaveLength(1);
  });

  it("stad: case-insensitieve deelmatch op stad én regio", async () => {
    expect((await bron.getJobs({ city: "utre" }, 1)).items.length).toBeGreaterThanOrEqual(2);
    expect((await bron.getJobs({ city: "UTRECHT" }, 1)).items.length).toBeGreaterThanOrEqual(2);
    // "zuid-holland" is de afgeleide regio van Rotterdam.
    expect((await bron.getJobs({ city: "zuid-holland" }, 1)).items.map((j) => j.title)).toEqual([
      "Tandarts zzp direct",
    ]);
    expect((await bron.getJobs({ city: "Groningen" }, 1)).items).toHaveLength(0);
  });

  it("rol, contractvorm, criteria en organisatie", async () => {
    expect((await bron.getJobs({ role: "tandarts" }, 1)).items.map((j) => j.title)).toEqual([
      "Tandarts zzp direct",
    ]);
    const zzp = await bron.getJobs({ employmentType: "zzp" }, 1);
    expect(zzp.items.map((j) => j.title).sort()).toEqual([
      "Mondhygiënist direct",
      "Tandarts zzp direct",
    ]);
    expect((await bron.getJobs({ equipment: "trios" }, 1)).items).toHaveLength(1);
    expect((await bron.getJobs({ software: "exquise" }, 1)).items).toHaveLength(1);
    expect((await bron.getJobs({ specialization: "parodontologie" }, 1)).items).toHaveLength(1);
    expect((await bron.getJobs({ specialization: "orthodontie" }, 1)).items).toHaveLength(0);
    const vanOrg = await bron.getJobs({ organization: orgConsent.slug }, 1);
    expect(vanOrg.items.every((j) => j.organization.slug === orgConsent.slug)).toBe(true);
    expect(vanOrg.total).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Praktijken: consent-filtering en afgeleide kenmerken                */
/* ------------------------------------------------------------------ */

describe("DirectDataSource-praktijken", () => {
  it("levert alléén praktijken mét publicatie-consent", async () => {
    const praktijken = await bron.getPractices();
    expect(praktijken.map((p) => p.slug)).toEqual([orgConsent.slug]);
    expect(praktijken[0].practiceConsent).toBe(true);
    expect(await bron.getPractice(orgZonder.slug)).toBeNull();
  });

  it("aggregeert locaties en leidt begeleiding/ontwikkeling af uit vacatures", async () => {
    const praktijk = await bron.getPractice(orgConsent.slug);
    expect(praktijk?.locations).toHaveLength(2);
    expect(praktijk?.locations.map((l) => l.city)).toEqual(["Utrecht", "Amsterdam"]);
    for (const locatie of praktijk?.locations ?? []) {
      expect(locatie.postcode4).toMatch(/^\d{4}$/);
    }
    expect(praktijk?.equipment.map((t) => t.key).sort()).toEqual(["itero", "trios"]);
    expect(praktijk?.population.map((t) => t.key).sort()).toEqual(["kinderen", "volwassenen"]);
    expect(praktijk?.culture.map((t) => t.key).sort()).toEqual(["informeel", "leergericht"]);
    // Uit de gepubliceerde mondhygiënistvacature.
    expect(praktijk?.mentorship).toBe(true);
    expect(praktijk?.development.map((t) => t.key)).toContain("interne_opleiding");
    expect(praktijk?.description).toBe("Publieke testpraktijk met twee locaties.");
  });

  it("de vacatures van een praktijk zonder consent blijven wél publiek", async () => {
    const job = await bron.getJob(vacZzp.slug ?? "");
    expect(job).not.toBeNull();
    expect(job?.organization.slug).toBe(orgZonder.slug);
  });
});

/* ------------------------------------------------------------------ */
/* Nieuwe/uitgebreide publieke endpoints                               */
/* ------------------------------------------------------------------ */

describe("GET /api/public/v1/practices", () => {
  it("levert alleen consented praktijken, met ETag-caching", async () => {
    const res = await practicesGET(verzoek("/api/public/v1/practices"));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeTruthy();
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].slug).toBe(orgConsent.slug);
    expect(body.items[0].practiceConsent).toBe(true);
  });

  it("praktijkdetail zonder consent geeft 404", async () => {
    const res = await practiceGET(
      verzoek(`/api/public/v1/practices/${orgZonder.slug}`),
      metParam({ slug: orgZonder.slug }),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/public/v1/jobs — nieuwe filters en velden", () => {
  it("ondersteunt day/hoursMin/hoursMax/organization en levert totalPages", async () => {
    const res = await jobsGET(
      verzoek(`/api/public/v1/jobs?day=di&day=do&hoursMin=24&organization=${orgConsent.slug}`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Mondhygiënist direct");
    expect(body.totalPages).toBe(1);
    // Lijstitems bevatten nu ook de kaartvelden (availability e.d.).
    expect(Array.isArray(body.items[0].availability)).toBe(true);
    expect(body.items[0].availability.length).toBeGreaterThan(0);
  });

  it("weigert een ongeldige dag met 400", async () => {
    const res = await jobsGET(verzoek("/api/public/v1/jobs?day=maandag"));
    expect(res.status).toBe(400);
  });

  it("het detail bevat culture/mentorship/development", async () => {
    const slug = vacMondhygienist.slug ?? "";
    const res = await jobDetailGET(
      verzoek(`/api/public/v1/jobs/${slug}`),
      metParam({ idOrSlug: slug }),
    );
    const body = await res.json();
    expect(body.culture).toEqual([
      { key: "informeel", label: "Informeel" },
      { key: "leergericht", label: "Leergericht" },
    ]);
    expect(body.mentorship).toBe(true);
    expect(body.development.map((t: { key: string }) => t.key)).toEqual([
      "interne_opleiding",
      "congresbudget",
    ]);
  });
});
