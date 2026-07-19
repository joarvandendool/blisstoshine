// Integratietests voor de publieke read-model-API (fase 8) en de private
// integratie-API (fase 9):
// (a) de vacaturelijst bevat uitsluitend gepubliceerde vacatures;
// (b) een gesloten (filled) vacature geeft status "closed" (HTTP 410), een
//     onbekende 404;
// (c) ETag + If-None-Match → 304;
// (d) geen enkel kandidaatveld in welke publieke response dan ook
//     (assert op de volledige serialisatie);
// (e) postcode alleen als PC4 (vier cijfers);
// (f) org-endpoints weigeren zonder of met verkeerde scope en geven nooit
//     data van een andere organisatie;
// (g) revenueShare aanwezig bij een zzp-vacature;
// (h) slugs: stabiel na titelwijziging en lazily toegekend aan bestaande
//     gepubliceerde vacatures zonder slug.

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
import { createOrganizationWithLocation } from "@/server/organizations";
import {
  createDraftVacancy,
  markFilled,
  publishVacancy,
  updateVacancy,
} from "@/server/vacancies";
import { createApiKeyForOrg } from "@/server/integrations";
import { alsGebruiker, maakGebruiker, maakKandidaat, prepareTestDb, rooster } from "./helpers";

// Route handlers rechtstreeks aanroepen (Next.js 15: params als Promise).
import { GET as jobsGET } from "../../app/api/public/v1/jobs/route";
import { GET as jobDetailGET } from "../../app/api/public/v1/jobs/[idOrSlug]/route";
import { GET as practiceGET } from "../../app/api/public/v1/practices/[slug]/route";
import { GET as taxonomiesGET } from "../../app/api/public/v1/taxonomies/route";
import { GET as marketInsightsGET } from "../../app/api/public/v1/market-insights/route";
import { GET as orgVacanciesGET } from "../../app/api/public/v1/org/vacancies/route";
import { GET as orgApplicationsGET } from "../../app/api/public/v1/org/applications/route";

/* ------------------------------------------------------------------ */
/* Hulpfuncties                                                        */
/* ------------------------------------------------------------------ */

function verzoek(pad: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${pad}`, { headers });
}

function metParam<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

/** Alle objectsleutels in een geneste JSON-structuur. */
function verzamelKeys(waarde: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(waarde)) {
    for (const element of waarde) verzamelKeys(element, acc);
  } else if (waarde && typeof waarde === "object") {
    for (const [sleutel, kind] of Object.entries(waarde)) {
      acc.add(sleutel);
      verzamelKeys(kind, acc);
    }
  }
  return acc;
}

/** Sleutels die op kandidaatdata zouden duiden — mogen publiek nooit voorkomen. */
const VERBODEN_SLEUTEL =
  /(kandidaat|candidate|applicant|sollicit|application|profiel|profile|email|phone|telefoon|password|wachtwoord|motivation|user)/i;

/* ------------------------------------------------------------------ */
/* Testdata                                                            */
/* ------------------------------------------------------------------ */

let ownerA: Awaited<ReturnType<typeof maakGebruiker>>;
let ownerB: Awaited<ReturnType<typeof maakGebruiker>>;
let anna: Awaited<ReturnType<typeof maakKandidaat>>;
let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let locatieA: { id: string };
let vacLoondienst: { id: string; slug: string | null };
let vacZzp: { id: string; slug: string | null };
let vacDraft: { id: string };
let vacFilled: { id: string; slug: string | null };
let vacOrgB: { id: string };

async function ctxOwnerA() {
  alsGebruiker(ownerA.id);
  return requireMembership(orgA.id);
}

beforeAll(async () => {
  await prepareTestDb();

  ownerA = await maakGebruiker("owner-a@test.nl", "Owner A");
  ownerB = await maakGebruiker("owner-b@test.nl", "Owner B");
  anna = await maakKandidaat("anna@test.nl", "Anna Jansen");

  alsGebruiker(ownerA.id);
  const a = await createOrganizationWithLocation({
    name: "Praktijk Alfa",
    location: { name: "Alfa Utrecht", city: "Utrecht", postcode: "3511 AB", treatmentRooms: 3 },
  });
  orgA = { id: a.organization.id, slug: a.organization.slug };
  locatieA = { id: a.location.id };
  // multi_location-plan: api_access aan, geen vacaturelimiet.
  await getBillingProvider().changePlan(orgA.id, "multi_location");
  // Publicatie-consent: zonder deze vlag bestaat de praktijk publiek niet
  // (het praktijk-endpoint geeft dan 404 — zie public-site-direct.test.ts).
  await prisma.organization.update({
    where: { id: orgA.id },
    data: { publicConsent: true, publicConsentAt: new Date() },
  });

  alsGebruiker(ownerB.id);
  const b = await createOrganizationWithLocation({
    name: "Praktijk Beta",
    location: { name: "Beta Rotterdam", city: "Rotterdam", postcode: "3011 AB", treatmentRooms: 2 },
  });
  orgB = { id: b.organization.id, slug: b.organization.slug };
  await getBillingProvider().changePlan(orgB.id, "growth");

  // Vacatures van organisatie A.
  const ctxA = await ctxOwnerA();
  vacLoondienst = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: locatieA.id,
        title: "Mondhygiënist 3 dagen",
        role: "mondhygienist",
        description: "Zelfstandig werken in een modern team.",
        experienceLevel: "medior",
        schedule: rooster(["di", "do"]),
        hoursMin: 16,
        hoursMax: 24,
        contractTypes: ["loondienst"],
        salaryMin: 320_000,
        salaryMax: 400_000,
        criteria: {
          registrations: { values: ["big_mondhygienist"], level: "required" },
          treatments: { values: ["gebitsreiniging", "periodieke_controle"], level: "preferred" },
          equipment: { values: ["airflow"], level: "preferred" },
          software: { values: ["exquise"], level: "informational" },
          specializations: { values: ["parodontologie"], level: "preferred" },
        },
      })
    ).id,
  );

  vacZzp = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: locatieA.id,
        title: "Tandarts zzp",
        role: "tandarts",
        hoursMin: 8,
        hoursMax: 16,
        contractTypes: ["zzp"],
        revenueShareMax: 45,
      })
    ).id,
  );

  vacDraft = await createDraftVacancy(ctxA, {
    locationId: locatieA.id,
    title: "Conceptvacature",
    role: "tandartsassistent",
    hoursMin: 8,
    hoursMax: 16,
  });

  const teVervullen = await publishVacancy(
    ctxA,
    (
      await createDraftVacancy(ctxA, {
        locationId: locatieA.id,
        title: "Vervulde vacature",
        role: "preventieassistent",
        hoursMin: 8,
        hoursMax: 16,
      })
    ).id,
  );
  vacFilled = await markFilled(ctxA, teVervullen.id);

  // Vacature van organisatie B (voor tenantisolatie op de org-API).
  alsGebruiker(ownerB.id);
  const ctxB = await requireMembership(orgB.id);
  vacOrgB = await publishVacancy(
    ctxB,
    (
      await createDraftVacancy(ctxB, {
        locationId: b.location.id,
        title: "Tandartsassistent Rotterdam",
        role: "tandartsassistent",
        hoursMin: 16,
        hoursMax: 32,
        contractTypes: ["loondienst"],
      })
    ).id,
  );

  // Sollicitatie (kandidaatdata in de database — mag publiek nooit lekken).
  await prisma.application.create({
    data: {
      vacancyId: vacLoondienst.id,
      candidateUserId: anna.user.id,
      status: "submitted",
      motivation: "Ik werk graag met angstpatiënten. Bel 06-12345678.",
    },
  });
});

/* ------------------------------------------------------------------ */
/* Publieke vacature-endpoints                                         */
/* ------------------------------------------------------------------ */

describe("GET /api/public/v1/jobs", () => {
  it("bevat uitsluitend gepubliceerde vacatures", async () => {
    const res = await jobsGET(verzoek("/api/public/v1/jobs"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(vacLoondienst.id);
    expect(ids).toContain(vacZzp.id);
    expect(ids).toContain(vacOrgB.id);
    expect(ids).not.toContain(vacDraft.id);
    expect(ids).not.toContain(vacFilled.id);
    expect(body.total).toBe(3);
    // Nieuwste eerst (datePosted desc).
    const datums = body.items.map((item: { datePosted: string }) => item.datePosted);
    expect([...datums].sort().reverse()).toEqual(datums);
  });

  it("geeft postcodes uitsluitend als vier cijfers (PC4)", async () => {
    const res = await jobsGET(verzoek("/api/public/v1/jobs"));
    const body = await res.json();
    for (const item of body.items) {
      expect(item.location.postcode4).toMatch(/^\d{4}$/);
    }
    // De volledige postcode ("3511 AB") komt nergens in de payload voor.
    expect(JSON.stringify(body)).not.toContain("3511 AB");
  });

  it("filtert op stad en contractvorm", async () => {
    const res = await jobsGET(verzoek("/api/public/v1/jobs?city=utrecht&employmentType=zzp"));
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(vacZzp.id);
    expect(body.items[0].location.region).toBe("Utrecht");
  });

  it("toont revenueShare (omzetpercentage) bij een zzp-vacature", async () => {
    const res = await jobsGET(verzoek("/api/public/v1/jobs?employmentType=zzp"));
    const body = await res.json();
    expect(body.items[0].revenueShare).toEqual({ maxPercent: 45 });
    // Loondienstvacature heeft juist salary en geen revenueShare.
    const alles = await (await jobsGET(verzoek("/api/public/v1/jobs"))).json();
    const loondienst = alles.items.find((i: { id: string }) => i.id === vacLoondienst.id);
    expect(loondienst.revenueShare).toBeUndefined();
    expect(loondienst.salary).toEqual({ minCents: 320_000, maxCents: 400_000, period: "month" });
  });

  it("kent lazily een slug toe aan bestaande gepubliceerde vacatures zonder slug", async () => {
    const zonderSlug = await prisma.vacancy.create({
      data: {
        organizationId: orgA.id,
        locationId: locatieA.id,
        title: "Oude vacature zonder slug",
        role: "mondhygienist",
        schedule: {},
        criteria: {},
        hoursMin: 8,
        hoursMax: 16,
        status: "published",
        publishedAt: new Date("2026-01-05T09:00:00Z"),
      },
    });
    expect(zonderSlug.slug).toBeNull();

    const res = await jobsGET(verzoek("/api/public/v1/jobs"));
    const body = await res.json();
    const item = body.items.find((i: { id: string }) => i.id === zonderSlug.id);
    expect(item.slug).toMatch(/^oude-vacature-zonder-slug-utrecht-[0-9a-f]{6}$/);

    const inDb = await prisma.vacancy.findUniqueOrThrow({ where: { id: zonderSlug.id } });
    expect(inDb.slug).toBe(item.slug);
  });
});

describe("GET /api/public/v1/jobs/[idOrSlug]", () => {
  it("geeft de volledige publieke weergave voor een gepubliceerde vacature", async () => {
    const slug = (await prisma.vacancy.findUniqueOrThrow({ where: { id: vacLoondienst.id } }))
      .slug!;
    const res = await jobDetailGET(
      verzoek(`/api/public/v1/jobs/${slug}`),
      metParam({ idOrSlug: slug }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.slug).toBe(slug);
    expect(body.canonicalUrl).toBe(`/vacatures/${slug}`);
    expect(body.status).toBe("published");
    expect(body.directApply).toBe(true);
    expect(body.organization).toEqual({ name: "Praktijk Alfa", slug: orgA.slug });
    expect(body.location).toEqual({ city: "Utrecht", region: "Utrecht", postcode4: "3511" });
    expect(body.responsibilities).toEqual(["Gebitsreiniging", "Periodieke controle"]);
    expect(body.requirements).toContainEqual({
      label: "BIG-registratie mondhygiënist",
      level: "required",
    });
    expect(body.availability).toContainEqual({
      day: "di",
      dayparts: ["ochtend", "middag"],
      level: "required",
    });
    expect(body.equipment).toEqual([{ key: "airflow", label: "AirFlow" }]);
    expect(body.software).toEqual([{ key: "exquise", label: "Exquise" }]);
    expect(body.specializations).toEqual([
      { key: "parodontologie", label: "Parodontologie" },
    ]);
  });

  it("houdt de slug stabiel na een titelwijziging", async () => {
    const voor = (await prisma.vacancy.findUniqueOrThrow({ where: { id: vacZzp.id } })).slug;
    const ctxA = await ctxOwnerA();
    await updateVacancy(ctxA, vacZzp.id, { title: "Compleet nieuwe titel" });
    const na = (await prisma.vacancy.findUniqueOrThrow({ where: { id: vacZzp.id } })).slug;
    expect(na).toBe(voor);
  });

  it("geeft status 'closed' (HTTP 410) voor een vervulde vacature", async () => {
    const res = await jobDetailGET(
      verzoek(`/api/public/v1/jobs/${vacFilled.id}`),
      metParam({ idOrSlug: vacFilled.id }),
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.status).toBe("closed");
    expect(body.id).toBe(vacFilled.id);
  });

  it("geeft 404 voor onbekende en concept-vacatures", async () => {
    const onbekend = await jobDetailGET(
      verzoek("/api/public/v1/jobs/bestaat-niet"),
      metParam({ idOrSlug: "bestaat-niet" }),
    );
    expect(onbekend.status).toBe(404);
    expect((await onbekend.json()).error.code).toBe("not_found");

    // Concept is publiek onvindbaar, óók op ID.
    const concept = await jobDetailGET(
      verzoek(`/api/public/v1/jobs/${vacDraft.id}`),
      metParam({ idOrSlug: vacDraft.id }),
    );
    expect(concept.status).toBe(404);
  });
});

/* ------------------------------------------------------------------ */
/* Caching                                                             */
/* ------------------------------------------------------------------ */

describe("caching (ETag / If-None-Match)", () => {
  it("geeft 304 wanneer If-None-Match de huidige ETag bevat", async () => {
    const eerste = await jobsGET(verzoek("/api/public/v1/jobs"));
    expect(eerste.status).toBe(200);
    const etag = eerste.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    expect(eerste.headers.get("cache-control")).toContain("s-maxage=300");
    expect(eerste.headers.get("cache-control")).toContain("stale-while-revalidate");

    const tweede = await jobsGET(
      verzoek("/api/public/v1/jobs", { "if-none-match": etag! }),
    );
    expect(tweede.status).toBe(304);
    expect(await tweede.text()).toBe("");
    expect(tweede.headers.get("etag")).toBe(etag);
  });
});

/* ------------------------------------------------------------------ */
/* Geen kandidaatdata, nergens                                         */
/* ------------------------------------------------------------------ */

describe("privacy van de publieke responses", () => {
  it("bevat in geen enkele publieke response een sleutel die op kandidaatdata duidt", async () => {
    const slugA = (await prisma.vacancy.findUniqueOrThrow({ where: { id: vacLoondienst.id } }))
      .slug!;
    const responses = [
      await jobsGET(verzoek("/api/public/v1/jobs")),
      await jobDetailGET(verzoek(`/api/public/v1/jobs/${slugA}`), metParam({ idOrSlug: slugA })),
      await jobDetailGET(
        verzoek(`/api/public/v1/jobs/${vacFilled.id}`),
        metParam({ idOrSlug: vacFilled.id }),
      ),
      await practiceGET(
        verzoek(`/api/public/v1/practices/${orgA.slug}`),
        metParam({ slug: orgA.slug }),
      ),
      await taxonomiesGET(verzoek("/api/public/v1/taxonomies")),
      await marketInsightsGET(verzoek("/api/public/v1/market-insights")),
    ];

    for (const res of responses) {
      const body = await res.json();
      const sleutels = [...verzamelKeys(body)];
      const verdacht = sleutels.filter((sleutel) => VERBODEN_SLEUTEL.test(sleutel));
      expect(verdacht).toEqual([]);
      // Ook waarden lekken niet: naam/e-mail/motivatie van de kandidaat.
      const serialisatie = JSON.stringify(body);
      expect(serialisatie).not.toContain("Anna");
      expect(serialisatie).not.toContain("anna@test.nl");
      expect(serialisatie).not.toContain("06-12345678");
    }
  });

  it("toont een publieke praktijk zonder adresgegevens en met open vacatures", async () => {
    const res = await practiceGET(
      verzoek(`/api/public/v1/practices/${orgA.slug}`),
      metParam({ slug: orgA.slug }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe(orgA.slug);
    expect(body.city).toBe("Utrecht");
    expect(body.region).toBe("Utrecht");
    expect(body.treatmentRooms).toBe(3);
    // 3 open: loondienst, zzp en de lazily-geslugde vacature.
    expect(body.openJobs).toBe(3);
    const sleutels = [...verzamelKeys(body)];
    expect(sleutels).not.toContain("street");
    expect(sleutels).not.toContain("postcode");
    expect(sleutels).not.toContain("latitude");
  });
});

/* ------------------------------------------------------------------ */
/* Private integratie-API (/org/*)                                     */
/* ------------------------------------------------------------------ */

describe("org-endpoints (API-sleutels en scopes)", () => {
  let jobsSleutel: string;
  let pipelineSleutel: string;

  beforeAll(async () => {
    const ctxA = await ctxOwnerA();
    jobsSleutel = (await createApiKeyForOrg(ctxA, "Alleen vacatures", ["jobs:read"])).plaintext;
    pipelineSleutel = (
      await createApiKeyForOrg(ctxA, "Pipeline", ["pipeline:read"])
    ).plaintext;
  });

  it("weigert zonder Authorization-header (401)", async () => {
    const res = await orgVacanciesGET(verzoek("/api/public/v1/org/vacancies"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("weigert een sleutel met de verkeerde scope (403)", async () => {
    const res = await orgApplicationsGET(
      verzoek("/api/public/v1/org/applications", {
        authorization: `Bearer ${jobsSleutel}`,
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("insufficient_scope");
  });

  it("geeft nooit vacatures van een andere organisatie terug", async () => {
    const res = await orgVacanciesGET(
      verzoek("/api/public/v1/org/vacancies", { authorization: `Bearer ${jobsSleutel}` }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(vacLoondienst.id);
    expect(ids).toContain(vacDraft.id); // eigen concepten wél zichtbaar via de org-API
    expect(ids).not.toContain(vacOrgB.id);
  });

  it("toont sollicitaties zonder kandidaatnaam zolang er geen consent is", async () => {
    const res = await orgApplicationsGET(
      verzoek("/api/public/v1/org/applications", {
        authorization: `Bearer ${pipelineSleutel}`,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].vacancyId).toBe(vacLoondienst.id);
    expect(body.items[0].candidate.name).toBeNull();
    expect(body.items[0].candidate.consent).toBe(false);
    // Nooit e-mail of motivatie via de org-API.
    const serialisatie = JSON.stringify(body);
    expect(serialisatie).not.toContain("anna@test.nl");
    expect(serialisatie).not.toContain("06-12345678");
  });

  it("toont de kandidaatnaam wél na expliciete consent", async () => {
    await prisma.candidateConsent.create({
      data: {
        candidateUserId: anna.user.id,
        organizationId: orgA.id,
        vacancyId: vacLoondienst.id,
        scope: "contact_details",
      },
    });
    const res = await orgApplicationsGET(
      verzoek("/api/public/v1/org/applications", {
        authorization: `Bearer ${pipelineSleutel}`,
      }),
    );
    const body = await res.json();
    expect(body.items[0].candidate).toEqual({
      id: anna.user.id,
      name: "Anna Jansen",
      consent: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Entitlement wordt bij élk API-verzoek gecontroleerd                */
/* ------------------------------------------------------------------ */

describe("org-API: recht op api_access wordt live gecontroleerd", () => {
  it("weigert een bestaande sleutel nadat de organisatie api_access verliest (downgrade)", async () => {
    // Eigen, geïsoleerde organisatie zodat orgA/orgB ongemoeid blijven.
    const owner = await maakGebruiker("owner-downgrade@test.nl", "Owner Downgrade");
    alsGebruiker(owner.id);
    const o = await createOrganizationWithLocation({
      name: "Praktijk Downgrade",
      location: {
        name: "Downgrade Utrecht",
        city: "Utrecht",
        postcode: "3511 AB",
        treatmentRooms: 2,
      },
    });
    await getBillingProvider().changePlan(o.organization.id, "multi_location");

    const ctx = await requireMembership(o.organization.id);
    const sleutel = (await createApiKeyForOrg(ctx, "Integratie", ["jobs:read"])).plaintext;

    // Met api_access: 200.
    const okRes = await orgVacanciesGET(
      verzoek("/api/public/v1/org/vacancies", { authorization: `Bearer ${sleutel}` }),
    );
    expect(okRes.status).toBe(200);

    // Downgrade naar growth (geen api_access) → dezelfde sleutel wordt geweigerd.
    await getBillingProvider().changePlan(o.organization.id, "growth");
    const res = await orgVacanciesGET(
      verzoek("/api/public/v1/org/vacancies", { authorization: `Bearer ${sleutel}` }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("entitlement_required");
  });
});
