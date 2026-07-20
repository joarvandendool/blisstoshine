// Pipelinetests (deel 4 + 9 van de private-betafase):
// (a) uitnodiging → interesse → consent: naam pas zichtbaar na grantConsent
// (b) gesprek voorstellen + bevestigen → interview_scheduled, historie compleet
// (c) afwijzen met redencode → MatchDecisionFeedback, note zonder e-mail/telefoon
// (d) notificaties zijn idempotent (twee keer uitnodigen → één melding)
// (e) tenant B kan de pipeline van tenant A niet lezen

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
import { AuthzError, requireMembership } from "@/lib/authz";
import { getBillingProvider } from "@/lib/billing";
import { createOrganizationWithLocation } from "@/server/organizations";
import { createDraftVacancy, publishVacancy } from "@/server/vacancies";
import { inviteCandidate, respondToInvitation } from "@/server/invitations";
import { setPipelineStatus } from "@/server/applications";
import {
  confirmInterview,
  grantConsent,
  hasConsent,
  listPipelineForVacancy,
  proposeInterview,
  statusHistory,
  stripContactgegevens,
} from "@/server/pipeline";
import {
  alsGebruiker,
  prepareTestDb,
  maakGebruiker,
  maakKandidaat,
  rooster,
} from "./helpers";

let ownerA: Awaited<ReturnType<typeof maakGebruiker>>;
let ownerB: Awaited<ReturnType<typeof maakGebruiker>>;
let anna: Awaited<ReturnType<typeof maakKandidaat>>;
let bob: Awaited<ReturnType<typeof maakKandidaat>>;
let orgA: { id: string; slug: string };
let orgB: { id: string; slug: string };
let vacatureA: { id: string };
let vacatureB: { id: string };
let invitationId: string;

/** OrgContext van owner A (sessie wordt per aanroep gezet). */
async function ctxVoorOwnerA() {
  alsGebruiker(ownerA.id);
  return requireMembership(orgA.id);
}

beforeAll(async () => {
  await prepareTestDb();

  ownerA = await maakGebruiker("owner-a@test.nl", "Owner A");
  ownerB = await maakGebruiker("owner-b@test.nl", "Owner B");

  alsGebruiker(ownerA.id);
  const a = await createOrganizationWithLocation({
    name: "Praktijk Alfa",
    location: {
      name: "Alfa Utrecht",
      city: "Utrecht",
      postcode: "3511 AB",
      treatmentRooms: 3,
    },
  });
  orgA = a.organization;

  alsGebruiker(ownerB.id);
  const b = await createOrganizationWithLocation({
    name: "Praktijk Beta",
    location: {
      name: "Beta Rotterdam",
      city: "Rotterdam",
      postcode: "3011 AB",
      treatmentRooms: 2,
    },
  });
  orgB = b.organization;

  // Growth-plan voor org A: ruime uitnodigingslimiet voor de tests.
  await getBillingProvider().changePlan(orgA.id, "growth");

  // Anonieme kandidaat: de naam mag pas na consent zichtbaar worden.
  anna = await maakKandidaat("anna@test.nl", "Anna Anoniem", {
    visibility: "anonymous",
  });
  bob = await maakKandidaat("bob@test.nl", "Bob Bekend", {
    visibility: "visible",
  });

  alsGebruiker(ownerA.id);
  const ctxA = await requireMembership(orgA.id);
  vacatureA = await createDraftVacancy(ctxA, {
    locationId: a.location.id,
    title: "Mondhygiënist",
    role: "mondhygienist",
    schedule: rooster(["di", "do"]),
    hoursMin: 16,
    hoursMax: 32,
    contractTypes: ["loondienst"],
  });
  await publishVacancy(ctxA, vacatureA.id);

  alsGebruiker(ownerB.id);
  const ctxB = await requireMembership(orgB.id);
  vacatureB = await createDraftVacancy(ctxB, {
    locationId: b.location.id,
    title: "Mondhygiënist Rotterdam",
    role: "mondhygienist",
    schedule: rooster(["di"]),
    hoursMin: 8,
    hoursMax: 24,
    contractTypes: ["loondienst"],
  });
  await publishVacancy(ctxB, vacatureB.id);
});

describe("(a) uitnodiging → interesse → consent", () => {
  it("na de uitnodiging staat de kandidaat geanonimiseerd in de pipeline", async () => {
    const ctxA = await ctxVoorOwnerA();
    const uitnodiging = await inviteCandidate(
      ctxA,
      vacatureA.id,
      anna.user.id,
      "Kom je kennismaken?",
    );
    invitationId = uitnodiging.id;

    const pipeline = await listPipelineForVacancy(ctxA, vacatureA.id);
    const entry = pipeline.find((e) => e.candidateUserId === anna.user.id);
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("invited");
    expect(entry!.naamZichtbaar).toBe(false);
    expect(entry!.displayName).not.toContain("Anna");
    expect(entry!.displayName.toLowerCase()).toContain("mondhygiënist");
  });

  it("interesse zónder consent-vinkje houdt de naam verborgen", async () => {
    alsGebruiker(anna.user.id);
    await respondToInvitation(invitationId, {
      accepted: true,
      shareContact: false,
    });

    const ctxA = await ctxVoorOwnerA();
    const pipeline = await listPipelineForVacancy(ctxA, vacatureA.id);
    const entry = pipeline.find((e) => e.candidateUserId === anna.user.id)!;
    expect(entry.status).toBe("interested");
    expect(entry.naamZichtbaar).toBe(false);
    expect(entry.displayName).not.toContain("Anna");
  });

  it("pas na grantConsent ziet de praktijk de echte naam", async () => {
    alsGebruiker(anna.user.id);
    await grantConsent(orgA.id, vacatureA.id);
    expect(await hasConsent(anna.user.id, orgA.id, vacatureA.id)).toBe(true);

    const ctxA = await ctxVoorOwnerA();
    const pipeline = await listPipelineForVacancy(ctxA, vacatureA.id);
    const entry = pipeline.find((e) => e.candidateUserId === anna.user.id)!;
    expect(entry.naamZichtbaar).toBe(true);
    expect(entry.displayName).toBe("Anna Anoniem");
  });
});

describe("(b) gesprek voorstellen en bevestigen", () => {
  it("bevestigen zet de pipeline op interview_scheduled met volledige historie", async () => {
    const ctxA = await ctxVoorOwnerA();
    const morgen = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const overmorgen = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const interview = await proposeInterview(
      ctxA,
      vacatureA.id,
      anna.user.id,
      [
        { startsAt: morgen, durationMinutes: 45 },
        { startsAt: overmorgen, durationMinutes: 45 },
      ],
      "We plannen graag een kennismaking in.",
    );
    expect(interview.status).toBe("proposed");

    alsGebruiker(anna.user.id);
    const bevestigd = await confirmInterview(interview.id, morgen);
    expect(bevestigd.status).toBe("confirmed");
    expect(bevestigd.chosenSlot?.getTime()).toBe(morgen.getTime());

    const historie = await statusHistory(vacatureA.id, anna.user.id);
    const overgangen = historie.map((h) => [h.toStatus, h.actorType]);
    expect(overgangen).toEqual([
      ["invited", "practice"],
      ["interested", "candidate"],
      ["interview_proposed", "practice"],
      ["interview_scheduled", "candidate"],
    ]);
    // Elke overgang kent de verantwoordelijke actor.
    for (const wijziging of historie) {
      expect(wijziging.actorUserId).toBeTruthy();
    }

    const ctxA2 = await ctxVoorOwnerA();
    const pipeline = await listPipelineForVacancy(ctxA2, vacatureA.id);
    const entry = pipeline.find((e) => e.candidateUserId === anna.user.id)!;
    expect(entry.status).toBe("interview_scheduled");
  });

  it("gespreksmomenten in het verleden of meer dan vijf zijn ongeldig", async () => {
    const ctxA = await ctxVoorOwnerA();
    const gisteren = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await expect(
      proposeInterview(ctxA, vacatureA.id, anna.user.id, [
        { startsAt: gisteren, durationMinutes: 45 },
      ]),
    ).rejects.toThrow(AuthzError);

    const zesSlots = Array.from({ length: 6 }, (_, i) => ({
      startsAt: new Date(Date.now() + (i + 1) * 60 * 60 * 1000),
      durationMinutes: 30,
    }));
    await expect(
      proposeInterview(ctxA, vacatureA.id, anna.user.id, zesSlots),
    ).rejects.toThrow(AuthzError);
  });
});

describe("(c) afwijzen met redencode en opgeschoonde note", () => {
  it("schrijft MatchDecisionFeedback zonder e-mailadres of telefoonnummer", async () => {
    const ctxA = await ctxVoorOwnerA();
    await setPipelineStatus(ctxA, vacatureA.id, anna.user.id, "rejected", {
      reasonCode: "reisafstand",
      note: "Te ver weg; mail gerust via anna@test.nl of bel 06-12345678 voor uitleg.",
    });

    const feedback = await prisma.matchDecisionFeedback.findFirst({
      where: { vacancyId: vacatureA.id, candidateUserId: anna.user.id },
    });
    expect(feedback).not.toBeNull();
    expect(feedback!.reasonCode).toBe("reisafstand");
    expect(feedback!.decision).toBe("rejected");
    expect(feedback!.actorType).toBe("practice");
    expect(feedback!.note).not.toContain("@");
    expect(feedback!.note).not.toContain("anna@test.nl");
    expect(feedback!.note).not.toContain("12345678");
    expect(feedback!.note).toContain("Te ver weg");

    const historie = await statusHistory(vacatureA.id, anna.user.id);
    expect(historie.at(-1)?.toStatus).toBe("rejected");
    expect(historie.at(-1)?.reasonCode).toBe("reisafstand");
  });

  it("afwijzen zonder redencode is niet toegestaan", async () => {
    const ctxA = await ctxVoorOwnerA();
    await expect(
      setPipelineStatus(ctxA, vacatureA.id, bob.user.id, "rejected"),
    ).rejects.toThrow(AuthzError);
  });

  it("stripContactgegevens haalt e-mail en telefoon uit vrije tekst", () => {
    const schoon = stripContactgegevens(
      "Bel +31 6 1234 5678 of mail naam.achternaam+tag@sub.domein.nl aub",
    );
    expect(schoon).not.toContain("@");
    expect(schoon).not.toContain("5678");
    expect(schoon).toContain("aub");
  });
});

describe("(d) idempotente notificaties", () => {
  it("twee keer dezelfde uitnodiging levert één notificatie op", async () => {
    const ctxA = await ctxVoorOwnerA();
    await inviteCandidate(ctxA, vacatureA.id, bob.user.id, "Eerste bericht");
    await inviteCandidate(ctxA, vacatureA.id, bob.user.id, "Tweede bericht");

    const meldingen = await prisma.notification.count({
      where: { userId: bob.user.id, type: "invitation_received" },
    });
    expect(meldingen).toBe(1);

    // Ook het journaal blijft schoon: één invited-regel.
    const historie = await statusHistory(vacatureA.id, bob.user.id);
    expect(
      historie.filter((h) => h.toStatus === "invited"),
    ).toHaveLength(1);
  });
});

describe("(e) tenantisolatie", () => {
  it("tenant B kan de pipeline van tenant A niet lezen of bedienen", async () => {
    alsGebruiker(ownerB.id);
    const ctxB = await requireMembership(orgB.id);

    await expect(listPipelineForVacancy(ctxB, vacatureA.id)).rejects.toThrow(
      AuthzError,
    );
    await expect(
      proposeInterview(ctxB, vacatureA.id, anna.user.id, [
        { startsAt: new Date(Date.now() + 3600_000), durationMinutes: 45 },
      ]),
    ).rejects.toThrow(AuthzError);
    await expect(
      setPipelineStatus(ctxB, vacatureA.id, anna.user.id, "rejected", {
        reasonCode: "anders",
      }),
    ).rejects.toThrow(AuthzError);

    // De eigen (lege) pipeline van B blijft gewoon leesbaar.
    const eigen = await listPipelineForVacancy(ctxB, vacatureB.id);
    expect(eigen).toEqual([]);
  });
});

describe("uitnodiging verloopt", () => {
  it("zet een geldigheidsdatum (± TTL) bij een nieuwe uitnodiging", async () => {
    const fred = await maakKandidaat("fred-exp@test.nl", "Fred Fresh", {
      visibility: "visible",
    });
    const ctxA = await ctxVoorOwnerA();
    const uitnodiging = await inviteCandidate(ctxA, vacatureA.id, fred.user.id);

    expect(uitnodiging.expiresAt).not.toBeNull();
    const dagen = (uitnodiging.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(dagen).toBeGreaterThan(29);
    expect(dagen).toBeLessThanOrEqual(30.01);
  });

  it("weigert het accepteren van een verlopen uitnodiging (410) en zet de status op expired", async () => {
    const eva = await maakKandidaat("eva-exp@test.nl", "Eva Expired", {
      visibility: "visible",
    });
    const ctxA = await ctxVoorOwnerA();
    const uitnodiging = await inviteCandidate(ctxA, vacatureA.id, eva.user.id);

    // Forceer verlopen (geldigheid in het verleden).
    await prisma.invitation.update({
      where: { id: uitnodiging.id },
      data: { expiresAt: new Date(Date.now() - 86_400_000) },
    });

    alsGebruiker(eva.user.id);
    await expect(
      respondToInvitation(uitnodiging.id, { accepted: true }),
    ).rejects.toMatchObject({ status: 410 });

    const na = await prisma.invitation.findUniqueOrThrow({
      where: { id: uitnodiging.id },
    });
    expect(na.status).toBe("expired");
  });
});
