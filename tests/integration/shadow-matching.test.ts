// Integratietests voor schaduwmatching (fase 7), tegen de testdatabase.
// Kern:
// (a) een schaduwrun schrijft ShadowMatchScore-rijen zonder ook maar iets aan
//     zichtbare matchdata te veranderen (geen MatchSnapshot, vacature en
//     profielen onaangeroerd);
// (b) een tweede run is idempotent-achtig: geen dubbele rijen voor hetzelfde
//     paar + dezelfde versiecombinatie (bestaande rijen worden opgeruimd);
// (c) eligibility is per constructie identiek tussen v1 en v2 (geen
//     hard-mismatch-regressies) en compareShadow rapporteert dat.
//
// AUTORISATIE: de service is bewust TENANT-LOOS (leest over organisaties
// heen) en wordt in productie uitsluitend aangeroepen vanaf /intern nadat de
// pagina/action requirePlatformAdmin() heeft gedaan — dezelfde afspraak als
// src/server/kpi.ts. Deze tests roepen de service direct aan, precies zoals
// de interne pagina dat na de admin-poort doet.

import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", async () => {
  // Alleen ./helpers importeren — @/lib/auth zou een circulaire dynamic
  // import veroorzaken (auth importeert zelf next/headers).
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
import { ALGORITHM_VERSION } from "@/domain/matching";
import { ALGORITHM_VERSION_V2 } from "@/domain/matching/v2";
import { createOrganizationWithLocation } from "@/server/organizations";
import { createDraftVacancy, publishVacancy } from "@/server/vacancies";
import {
  compareShadow,
  runShadowBatch,
  runShadowForVacancy,
} from "@/server/shadow-matching";
import {
  alsGebruiker,
  prepareTestDb,
  maakGebruiker,
  maakKandidaat,
  rooster,
} from "./helpers";

let owner: Awaited<ReturnType<typeof maakGebruiker>>;
let passend: Awaited<ReturnType<typeof maakKandidaat>>;
let verkeerdeRol: Awaited<ReturnType<typeof maakKandidaat>>;
let verborgen: Awaited<ReturnType<typeof maakKandidaat>>;
let vacature: { id: string };
let vacatureUpdatedAt: Date;

beforeAll(async () => {
  await prepareTestDb();

  owner = await maakGebruiker("owner@test.nl", "Owner");
  alsGebruiker(owner.id);
  const { organization, location } = await createOrganizationWithLocation({
    name: "Praktijk Schaduw",
    location: {
      name: "Schaduw Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 3,
    },
  });

  const ctx = await requireMembership(organization.id);
  const concept = await createDraftVacancy(ctx, {
    locationId: location.id,
    title: "Mondhygiënist Utrecht",
    role: "mondhygienist",
    schedule: rooster(["di", "do"]),
    hoursMin: 16,
    hoursMax: 32,
    contractTypes: ["loondienst"],
    mentorship: true,
  });
  vacature = await publishVacancy(ctx, concept.id);
  vacatureUpdatedAt = (await prisma.vacancy.findUniqueOrThrow({
    where: { id: vacature.id },
    select: { updatedAt: true },
  })).updatedAt;

  // Passende kandidaat (zelfde rol, beschikbaar op di/do, Utrecht).
  passend = await maakKandidaat("passend@test.nl", "Petra Passend", {
    techniquesWantsToLearn: ["cerec"],
  });
  // Harde mismatch: verkeerde functie → ineligible in v1 én v2.
  verkeerdeRol = await maakKandidaat("tandarts@test.nl", "Ton Tandarts", {
    role: "tandarts",
  });
  // Verborgen profiel: draait nergens in mee, ook niet in de schaduwrun.
  verborgen = await maakKandidaat("verborgen@test.nl", "Vera Verborgen", {
    visibility: "hidden",
  });
});

describe("(a) schaduwrun schrijft scores zonder zichtbare data te wijzigen", () => {
  it("legt per vindbare kandidaat één ShadowMatchScore vast met beide versies", async () => {
    const uitkomst = await runShadowForVacancy(vacature.id);
    expect(uitkomst.aantal).toBe(2); // passend + verkeerde rol; verborgen niet

    const rijen = await prisma.shadowMatchScore.findMany({
      where: { vacancyId: vacature.id },
    });
    expect(rijen).toHaveLength(2);
    for (const rij of rijen) {
      expect(rij.baseVersion).toBe(ALGORITHM_VERSION);
      expect(rij.shadowVersion).toBe(ALGORITHM_VERSION_V2);
      // Diff bevat per categorie base/shadow/delta.
      const diff = rij.diff as Record<string, { base: number; shadow: number; delta: number }>;
      expect(diff.travel).toBeDefined();
      expect(diff.totaal.delta).toBe(rij.shadowScore - rij.baseScore);
    }

    const kandidaatIds = rijen.map((rij) => rij.candidateUserId).sort();
    expect(kandidaatIds).toEqual([passend.user.id, verkeerdeRol.user.id].sort());
    expect(kandidaatIds).not.toContain(verborgen.user.id);
  });

  it("laat MatchSnapshot en de zichtbare bronnen volledig onaangeroerd", async () => {
    // Geen enkel beslismoment-snapshot: schaduwscores zijn geen MatchSnapshots.
    expect(await prisma.matchSnapshot.count()).toBe(0);

    // Vacature en kandidaatprofiel zijn niet gewijzigd door de run.
    const vacatureNa = await prisma.vacancy.findUniqueOrThrow({
      where: { id: vacature.id },
      select: { updatedAt: true, status: true },
    });
    expect(vacatureNa.status).toBe("published");
    expect(vacatureNa.updatedAt.getTime()).toBe(vacatureUpdatedAt.getTime());

    const profielNa = await prisma.candidateProfile.findUniqueOrThrow({
      where: { userId: passend.user.id },
      select: { status: true, visibility: true },
    });
    expect(profielNa.status).toBe("active");
  });

  it("houdt eligibility identiek tussen v1 en v2 (contract van de schaduwversie)", async () => {
    const rijen = await prisma.shadowMatchScore.findMany({
      where: { vacancyId: vacature.id },
    });
    for (const rij of rijen) {
      expect(rij.shadowEligible).toBe(rij.baseEligible);
    }
    const mismatch = rijen.find((rij) => rij.candidateUserId === verkeerdeRol.user.id)!;
    expect(mismatch.baseEligible).toBe(false);
    expect(mismatch.baseScore).toBe(0);
    expect(mismatch.shadowScore).toBe(0);

    const goed = rijen.find((rij) => rij.candidateUserId === passend.user.id)!;
    expect(goed.baseEligible).toBe(true);
    expect(goed.shadowEligible).toBe(true);
  });
});

describe("(b) tweede run is idempotent-achtig", () => {
  it("laat geen dubbele rijen achter voor hetzelfde paar en dezelfde versies", async () => {
    await runShadowForVacancy(vacature.id);
    await runShadowForVacancy(vacature.id);

    const rijen = await prisma.shadowMatchScore.findMany({
      where: {
        vacancyId: vacature.id,
        baseVersion: ALGORITHM_VERSION,
        shadowVersion: ALGORITHM_VERSION_V2,
      },
    });
    expect(rijen).toHaveLength(2);

    const paren = rijen.map((rij) => `${rij.vacancyId}:${rij.candidateUserId}`);
    expect(new Set(paren).size).toBe(paren.length); // geen dubbele paren
  });

  it("draait als batch over gepubliceerde vacatures zonder te groeien", async () => {
    const batch = await runShadowBatch(10);
    expect(batch.vacatures).toBe(1);
    expect(batch.scores).toBe(2);
    expect(batch.shadowVersion).toBe(ALGORITHM_VERSION_V2);
    expect(await prisma.shadowMatchScore.count()).toBe(2);
  });
});

describe("(c) vergelijking en regressierapportage", () => {
  it("rapporteert nul hard-mismatch-regressies en geanonimiseerde uitschieters", async () => {
    const vergelijking = await compareShadow();

    expect(vergelijking.baseVersion).toBe(ALGORITHM_VERSION);
    expect(vergelijking.shadowVersion).toBe(ALGORITHM_VERSION_V2);
    expect(vergelijking.paren).toBe(2);
    expect(vergelijking.vacatures).toBe(1);
    expect(vergelijking.regressies.eligibleInBaseOnly).toHaveLength(0);
    expect(vergelijking.regressies.eligibleInShadowOnly).toHaveLength(0);

    // Uitschieters bevatten uitsluitend pseudoniemen — nooit namen of ruwe IDs.
    for (const mover of [...vergelijking.topStijgers, ...vergelijking.topDalers]) {
      expect(mover.pseudoniem).toMatch(/^kandidaat-[0-9a-f]{8}$/);
      expect(mover.pseudoniem).not.toContain(passend.user.id);
    }

    // Elke categorie heeft een gemiddeld delta; gewijzigde categorieën dragen
    // een Nederlandse verklaring.
    expect(vergelijking.perCategorie).toHaveLength(7);
    const reistijd = vergelijking.perCategorie.find((c) => c.categorie === "travel")!;
    expect(reistijd.verklaring).toContain("v2");

    // Zonder MatchSnapshots/uitkomsten: evaluatie zegt "onvoldoende data" in
    // plaats van schijnprecisie.
    expect(vergelijking.evaluatieActief.snapshotCount).toBe(0);
    expect(vergelijking.evaluatieActief.precisionAtTop5.insufficientData).toBe(true);
  });
});
