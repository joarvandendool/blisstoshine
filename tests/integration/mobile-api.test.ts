// Integratietests voor de mobiele kandidaat-API (/api/mobile/v1/*):
// - authenticatie: register/login/refresh-rotatie/replay-detectie/logout;
// - secure-sessiemodel: intrekking werkt per direct, tokens zijn gehasht;
// - dubbele verzoeken: dubbel solliciteren, dubbel beantwoorden → 409;
// - eigendom: gebruiker B kan geen data van gebruiker A zien of muteren;
// - push-tokenlevenscyclus: registratie, rotatie, verwijdering bij logout;
// - accountverwijdering vanuit de app.
//
// De routes worden als functies aangeroepen met echte Request-objecten; de
// identiteit loopt via de Authorization-header en de Bearer-brug in
// src/lib/auth.ts (next/headers wordt hieronder gemockt).

import { beforeAll, describe, expect, it, vi } from "vitest";

/** Authorization-header die de next/headers-mock aan getSessionUser geeft. */
const authHouder: { authorization: string | null } = { authorization: null };

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => ({
    get: (naam: string) =>
      naam.toLowerCase() === "authorization" ? authHouder.authorization : null,
  }),
}));

import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/mobile-auth";
import { prepareTestDb } from "./helpers";
import { emptyAvailability } from "@/domain/taxonomy";

import { POST as registerRoute } from "../../app/api/mobile/v1/auth/register/route";
import { POST as loginRoute } from "../../app/api/mobile/v1/auth/login/route";
import { POST as refreshRoute } from "../../app/api/mobile/v1/auth/refresh/route";
import { POST as logoutRoute } from "../../app/api/mobile/v1/auth/logout/route";
import { GET as meRoute } from "../../app/api/mobile/v1/me/route";
import { PUT as profileStepRoute } from "../../app/api/mobile/v1/profile/step/route";
import { POST as activateRoute } from "../../app/api/mobile/v1/profile/activate/route";
import { GET as matchesRoute } from "../../app/api/mobile/v1/matches/route";
import { GET as matchDetailRoute } from "../../app/api/mobile/v1/matches/[vacancyId]/route";
import {
  GET as applicationsGet,
  POST as applicationsPost,
} from "../../app/api/mobile/v1/applications/route";
import { POST as withdrawRoute } from "../../app/api/mobile/v1/applications/[applicationId]/withdraw/route";
import { GET as invitationsGet } from "../../app/api/mobile/v1/invitations/route";
import { POST as respondRoute } from "../../app/api/mobile/v1/invitations/[invitationId]/respond/route";
import { GET as consentsGet } from "../../app/api/mobile/v1/consents/route";
import { POST as consentRevokeRoute } from "../../app/api/mobile/v1/consents/revoke/route";
import { GET as interviewsGet } from "../../app/api/mobile/v1/interviews/route";
import { POST as interviewConfirmRoute } from "../../app/api/mobile/v1/interviews/[interviewId]/confirm/route";
import {
  DELETE as pushTokenDelete,
  POST as pushTokenPost,
} from "../../app/api/mobile/v1/push-tokens/route";
import { DELETE as accountDelete } from "../../app/api/mobile/v1/account/route";
import { GET as privacyOverviewRoute } from "../../app/api/mobile/v1/privacy/overview/route";

const BASIS = "https://mobiel.test";

// Uniek IP per verzoek: de registratie-rate-limit (5/uur per IP) is een
// aparte, gerichte test en mag de overige scenario's niet raken.
let ipTeller = 0;
function uniekIp(): string {
  ipTeller += 1;
  return `10.0.${Math.floor(ipTeller / 250)}.${(ipTeller % 250) + 1}`;
}

function post(pad: string, body?: unknown, token?: string): Request {
  return new Request(`${BASIS}${pad}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-forwarded-for": uniekIp(),
    },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });
}

function del(pad: string, body?: unknown, token?: string): Request {
  return new Request(`${BASIS}${pad}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Zet de identiteit voor service-routes (via de Bearer-brug). */
function metToken(token: string | null): void {
  authHouder.authorization = token ? `Bearer ${token}` : null;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

async function registreer(email: string, naam = "Test Kandidaat"): Promise<Tokens> {
  const res = await registerRoute(
    post("/api/mobile/v1/auth/register", {
      name: naam,
      email,
      password: "wachtwoord123",
      deviceName: "iPhone 17 (test)",
      platform: "ios",
    }),
  );
  expect(res.status).toBe(201);
  const body = (await json(res)) as { tokens: Tokens };
  return body.tokens;
}

/** Volledige onboarding via de API zodat matches/solliciteren mogelijk is. */
async function onboardKandidaat(token: Tokens): Promise<void> {
  metToken(token.accessToken);
  const beschikbaarheid = emptyAvailability();
  beschikbaarheid.di.ochtend = "preferred";
  beschikbaarheid.di.middag = "preferred";
  beschikbaarheid.do.ochtend = "available";
  beschikbaarheid.do.middag = "available";

  const stap = await profileStepRoute(
    new Request(`${BASIS}/api/mobile/v1/profile/step`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stepName: "test_alles",
        role: "mondhygienist",
        experienceLevel: "medior",
        postcode: "3511 AB",
        maxTravelMinutes: 45,
        hoursMin: 16,
        hoursMax: 32,
        contractTypes: ["loondienst", "zzp"],
        revenueShareMin: 40,
        availability: beschikbaarheid,
        equipmentExperience: ["trios"],
        specializations: ["parodontologie"],
        visibility: "anonymous",
      }),
    }),
  );
  expect(stap.status).toBe(200);
  const activatie = await activateRoute();
  expect(activatie.status).toBe(200);
}

/** Praktijk + gepubliceerde vacature rechtstreeks in de testdatabase. */
async function maakVacature(overrides: { title?: string } = {}) {
  const eigenaar = await prisma.user.create({
    data: {
      email: `praktijk-${Date.now()}-${Math.random()}@test.nl`,
      name: "Praktijkhouder",
      passwordHash: "x",
    },
  });
  const org = await prisma.organization.create({
    data: {
      name: "Tandzorg Utrecht",
      slug: `tandzorg-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      memberships: { create: { userId: eigenaar.id, role: "owner" } },
    },
  });
  const locatie = await prisma.practiceLocation.create({
    data: {
      organizationId: org.id,
      name: "Hoofdlocatie",
      city: "Utrecht",
      postcode: "3511 AB",
      latitude: 52.0907,
      longitude: 5.1214,
    },
  });
  const rooster = {
    di: { ochtend: "required", middag: "preferred" },
    do: { ochtend: "preferred" },
  };
  const vacature = await prisma.vacancy.create({
    data: {
      organizationId: org.id,
      locationId: locatie.id,
      title: overrides.title ?? "Mondhygiënist (2-3 dagen)",
      role: "mondhygienist",
      schedule: rooster,
      hoursMin: 16,
      hoursMax: 24,
      contractTypes: ["loondienst"],
      criteria: {},
      status: "published",
      publishedAt: new Date(),
      slug: `mondhygienist-utrecht-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    },
  });
  return { org, locatie, vacature, eigenaar };
}

beforeAll(async () => {
  await prepareTestDb();
}, 120_000);

describe("mobiele auth: levenscyclus", () => {
  it("registreert, geeft intrekbare tokens en herstelt de sessie via /me", async () => {
    const tokens = await registreer("kandidaat-auth@test.nl");
    expect(tokens.accessToken).toMatch(/^mzm_at_[0-9a-f]{64}$/);
    expect(tokens.refreshToken).toMatch(/^mzm_rt_[0-9a-f]{64}$/);

    // Tokens staan uitsluitend gehasht in de database.
    const sessie = await prisma.mobileSession.findFirst({
      where: { accessTokenHash: hashToken(tokens.accessToken) },
    });
    expect(sessie).not.toBeNull();
    expect(sessie!.accessTokenHash).not.toContain(tokens.accessToken);

    metToken(tokens.accessToken);
    const me = await meRoute();
    expect(me.status).toBe(200);
    const body = (await json(me)) as { user: { email: string }; profile: null };
    expect(body.user.email).toBe("kandidaat-auth@test.nl");
    expect(body.profile).toBeNull();
    // isPlatformAdmin lekt niet naar mobiel.
    expect(JSON.stringify(body.user)).not.toContain("isPlatformAdmin");
  });

  it("weigert dubbele registratie met hetzelfde e-mailadres (409)", async () => {
    await registreer("dubbel@test.nl");
    const res = await registerRoute(
      post("/api/mobile/v1/auth/register", {
        name: "Nogmaals",
        email: "dubbel@test.nl",
        password: "wachtwoord123",
      }),
    );
    expect(res.status).toBe(409);
  });

  it("beperkt registraties tot 5 per uur per IP (429)", async () => {
    const vastIp = "203.0.113.77";
    const registratie = (email: string) =>
      registerRoute(
        new Request(`${BASIS}/api/mobile/v1/auth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": vastIp,
          },
          body: JSON.stringify({
            name: "Spammer",
            email,
            password: "wachtwoord123",
          }),
        }),
      );
    for (let i = 0; i < 5; i += 1) {
      expect((await registratie(`spam-${i}@test.nl`)).status).toBe(201);
    }
    expect((await registratie("spam-5@test.nl")).status).toBe(429);
  });

  it("wijst een fout wachtwoord af en locked na herhaalde mislukkingen", async () => {
    await registreer("lockout@test.nl");
    for (let poging = 0; poging < 8; poging += 1) {
      const res = await loginRoute(
        post("/api/mobile/v1/auth/login", {
          email: "lockout@test.nl",
          password: "verkeerd-wachtwoord",
        }),
      );
      expect(res.status).toBe(401);
    }
    // Lockout blokkeert ook het jǔiste wachtwoord.
    const geblokkeerd = await loginRoute(
      post("/api/mobile/v1/auth/login", {
        email: "lockout@test.nl",
        password: "wachtwoord123",
      }),
    );
    expect(geblokkeerd.status).toBe(429);
    expect(geblokkeerd.headers.get("Retry-After")).toBeTruthy();
  });

  it("roteert tokens bij refresh en trekt de sessie in bij replay", async () => {
    const eerste = await registreer("rotatie@test.nl");

    const refresh1 = await refreshRoute(
      post("/api/mobile/v1/auth/refresh", { refreshToken: eerste.refreshToken }),
    );
    expect(refresh1.status).toBe(200);
    const { tokens: tweede } = (await json(refresh1)) as { tokens: Tokens };
    expect(tweede.accessToken).not.toBe(eerste.accessToken);
    expect(tweede.refreshToken).not.toBe(eerste.refreshToken);

    // Oude access-token is na rotatie direct ongeldig.
    metToken(eerste.accessToken);
    expect((await meRoute()).status).toBe(401);
    metToken(tweede.accessToken);
    expect((await meRoute()).status).toBe(200);

    // Replay van het al gebruikte refresh-token → 401 én sessie ingetrokken.
    const replay = await refreshRoute(
      post("/api/mobile/v1/auth/refresh", { refreshToken: eerste.refreshToken }),
    );
    expect(replay.status).toBe(401);
    const replayBody = (await json(replay)) as { error: { code: string } };
    expect(replayBody.error.code).toBe("revoked");

    metToken(tweede.accessToken);
    expect((await meRoute()).status).toBe(401);
  });

  it("logout trekt de sessie in en verwijdert pushtokens van het apparaat", async () => {
    const tokens = await registreer("logout@test.nl");

    const registratie = await pushTokenPost(
      post(
        "/api/mobile/v1/push-tokens",
        { token: "ExponentPushToken[logout-test-1]", platform: "ios" },
        tokens.accessToken,
      ),
    );
    expect(registratie.status).toBe(200);
    expect(
      await prisma.mobilePushToken.count({
        where: { token: "ExponentPushToken[logout-test-1]" },
      }),
    ).toBe(1);

    const uitloggen = await logoutRoute(
      post("/api/mobile/v1/auth/logout", undefined, tokens.accessToken),
    );
    expect(uitloggen.status).toBe(200);

    metToken(tokens.accessToken);
    expect((await meRoute()).status).toBe(401);
    expect(
      await prisma.mobilePushToken.count({
        where: { token: "ExponentPushToken[logout-test-1]" },
      }),
    ).toBe(0);
  });

  it("weigert een verlopen access-token", async () => {
    const tokens = await registreer("verlopen@test.nl");
    await prisma.mobileSession.updateMany({
      where: { accessTokenHash: hashToken(tokens.accessToken) },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    metToken(tokens.accessToken);
    expect((await meRoute()).status).toBe(401);
  });
});

describe("profiel en onboarding via de mobiele API", () => {
  it("bewaart stappen gedeeltelijk, activeert en geeft de canonieke waarden terug", async () => {
    const tokens = await registreer("onboarding@test.nl");
    await onboardKandidaat(tokens);

    metToken(tokens.accessToken);
    const me = await meRoute();
    const body = (await json(me)) as {
      profile: {
        status: string;
        role: string;
        revenueShareMin: number;
        availability: Record<string, Record<string, string>>;
        completenessScore: number;
      };
    };
    expect(body.profile.status).toBe("active");
    expect(body.profile.role).toBe("mondhygienist");
    expect(body.profile.revenueShareMin).toBe(40);
    expect(body.profile.availability.di.ochtend).toBe("preferred");
    expect(body.profile.availability.zo.avond).toBe("unavailable");
    expect(body.profile.completenessScore).toBeGreaterThan(0);
  });

  it("weigert niet-canonieke waarden (400 invalid)", async () => {
    const tokens = await registreer("validatie@test.nl");
    metToken(tokens.accessToken);
    const res = await profileStepRoute(
      new Request(`${BASIS}/api/mobile/v1/profile/step`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepName: "basis", role: "orthodontist-bestaat-niet" }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("invalid");
  });
});

describe("matches: serveruitkomst, geen mobiele berekening", () => {
  it("levert het volledige MatchResult inclusief uitleg en kansen", async () => {
    const tokens = await registreer("matches@test.nl");
    await onboardKandidaat(tokens);
    const { vacature } = await maakVacature();

    metToken(tokens.accessToken);
    const res = await matchesRoute();
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      matches: Array<{
        vacancyId: string;
        result: {
          eligible: boolean;
          score: number;
          label: string;
          summary: string;
          categoryScores: Record<string, number>;
          strengths: unknown[];
          algorithmVersion: string;
        };
      }>;
    };
    const match = body.matches.find((m) => m.vacancyId === vacature.id);
    expect(match).toBeDefined();
    expect(match!.result.eligible).toBe(true);
    expect(match!.result.score).toBeGreaterThan(0);
    expect(match!.result.algorithmVersion).toBe("1.0.0");
    expect(Object.keys(match!.result.categoryScores).sort()).toEqual([
      "availability",
      "employment",
      "equipmentAndSoftware",
      "roleAndExperience",
      "specializations",
      "travel",
      "workplacePreferences",
    ]);
    expect(typeof match!.result.summary).toBe("string");
  });

  it("matchdetail geeft 410 voor een gesloten vacature", async () => {
    const tokens = await registreer("matchdetail@test.nl");
    await onboardKandidaat(tokens);
    const { vacature } = await maakVacature();
    await prisma.vacancy.update({
      where: { id: vacature.id },
      data: { status: "filled" },
    });

    metToken(tokens.accessToken);
    const res = await matchDetailRoute(
      new Request(`${BASIS}/api/mobile/v1/matches/${vacature.id}`),
      { params: Promise.resolve({ vacancyId: vacature.id }) },
    );
    expect(res.status).toBe(410);
  });
});

describe("solliciteren: dubbele verzoeken en verouderde staat", () => {
  it("solliciteert éénmaal; het tweede (dubbele) verzoek krijgt 409", async () => {
    const tokens = await registreer("solliciteren@test.nl");
    await onboardKandidaat(tokens);
    const { vacature } = await maakVacature();

    metToken(tokens.accessToken);
    const eerste = await applicationsPost(
      post("/api/mobile/v1/applications", {
        vacancyId: vacature.id,
        motivation: "Graag!",
      }),
    );
    expect(eerste.status).toBe(201);

    // Dubbel tikken / herhaald verzoek na time-out → deterministisch 409.
    const tweede = await applicationsPost(
      post("/api/mobile/v1/applications", { vacancyId: vacature.id }),
    );
    expect(tweede.status).toBe(409);

    const lijst = await applicationsGet();
    const lijstBody = (await json(lijst)) as { applications: Array<{ id: string }> };
    expect(lijstBody.applications).toHaveLength(1);
  });

  it("weigert solliciteren op een gesloten vacature (404)", async () => {
    const tokens = await registreer("gesloten@test.nl");
    await onboardKandidaat(tokens);
    const { vacature } = await maakVacature();
    await prisma.vacancy.update({
      where: { id: vacature.id },
      data: { status: "expired" },
    });

    metToken(tokens.accessToken);
    const res = await applicationsPost(
      post("/api/mobile/v1/applications", { vacancyId: vacature.id }),
    );
    expect(res.status).toBe(404);
  });

  it("trekt een sollicitatie terug; nogmaals terugtrekken → 409", async () => {
    const tokens = await registreer("terugtrekken@test.nl");
    await onboardKandidaat(tokens);
    const { vacature } = await maakVacature();

    metToken(tokens.accessToken);
    const aanmaak = await applicationsPost(
      post("/api/mobile/v1/applications", { vacancyId: vacature.id }),
    );
    const { application } = (await json(aanmaak)) as { application: { id: string } };

    const intrekken = await withdrawRoute(
      post(`/api/mobile/v1/applications/${application.id}/withdraw`, {
        reasonCode: "uren",
      }),
      { params: Promise.resolve({ applicationId: application.id }) },
    );
    expect(intrekken.status).toBe(200);

    const nogmaals = await withdrawRoute(
      post(`/api/mobile/v1/applications/${application.id}/withdraw`, {}),
      { params: Promise.resolve({ applicationId: application.id }) },
    );
    expect(nogmaals.status).toBe(409);
  });
});

describe("uitnodigingen, consent en gesprekken", () => {
  it("beantwoordt een uitnodiging éénmaal; tweede apparaat krijgt 409; consent wordt vastgelegd en is intrekbaar", async () => {
    const tokens = await registreer("uitnodiging@test.nl");
    await onboardKandidaat(tokens);
    const { org, vacature } = await maakVacature();

    metToken(tokens.accessToken);
    const meBody = (await json(await meRoute())) as { user: { id: string } };
    const uitnodiging = await prisma.invitation.create({
      data: {
        vacancyId: vacature.id,
        candidateUserId: meBody.user.id,
        message: "Kom kennismaken",
      },
    });

    const lijst = await invitationsGet();
    const lijstBody = (await json(lijst)) as { invitations: Array<{ id: string }> };
    expect(lijstBody.invitations.map((i) => i.id)).toContain(uitnodiging.id);

    const antwoord = await respondRoute(
      post(`/api/mobile/v1/invitations/${uitnodiging.id}/respond`, {
        accepted: true,
        shareContact: true,
      }),
      { params: Promise.resolve({ invitationId: uitnodiging.id }) },
    );
    expect(antwoord.status).toBe(200);

    // Tweede apparaat probeert opnieuw te antwoorden → 409.
    const tweedeApparaat = await respondRoute(
      post(`/api/mobile/v1/invitations/${uitnodiging.id}/respond`, {
        accepted: false,
        reasonCode: "dagen",
      }),
      { params: Promise.resolve({ invitationId: uitnodiging.id }) },
    );
    expect(tweedeApparaat.status).toBe(409);

    // Consent is vastgelegd en zichtbaar; daarna intrekbaar (idempotent).
    const consents = (await json(await consentsGet())) as {
      consents: Array<{ organizationId: string; vacancyId: string | null }>;
    };
    expect(consents.consents.some((c) => c.organizationId === org.id)).toBe(true);

    const intrekken = await consentRevokeRoute(
      post("/api/mobile/v1/consents/revoke", {
        organizationId: org.id,
        vacancyId: vacature.id,
      }),
    );
    expect(intrekken.status).toBe(200);
    const naIntrekking = (await json(await consentsGet())) as {
      consents: unknown[];
    };
    expect(naIntrekking.consents).toHaveLength(0);
  });

  it("bevestigt een gesprek op een geldig slot; ongeldig slot → fout", async () => {
    const tokens = await registreer("gesprek@test.nl");
    await onboardKandidaat(tokens);
    const { vacature, eigenaar } = await maakVacature();

    metToken(tokens.accessToken);
    const meBody = (await json(await meRoute())) as { user: { id: string } };

    const slot = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const interview = await prisma.interview.create({
      data: {
        vacancyId: vacature.id,
        candidateUserId: meBody.user.id,
        proposedByUserId: eigenaar.id,
        slots: [{ startsAt: slot.toISOString(), durationMinutes: 45 }],
      },
    });

    const lijst = (await json(await interviewsGet())) as {
      interviews: Array<{ id: string; slots: Array<{ startsAt: string }> }>;
    };
    expect(lijst.interviews.map((i) => i.id)).toContain(interview.id);

    const fout = await interviewConfirmRoute(
      post(`/api/mobile/v1/interviews/${interview.id}/confirm`, {
        chosenSlot: new Date(Date.now() + 999 * 3600 * 1000).toISOString(),
      }),
      { params: Promise.resolve({ interviewId: interview.id }) },
    );
    expect([400, 409]).toContain(fout.status);

    const bevestiging = await interviewConfirmRoute(
      post(`/api/mobile/v1/interviews/${interview.id}/confirm`, {
        chosenSlot: slot.toISOString(),
      }),
      { params: Promise.resolve({ interviewId: interview.id }) },
    );
    expect(bevestiging.status).toBe(200);
    const bevestigingBody = (await json(bevestiging)) as {
      interview: { status: string; chosenSlot: string };
    };
    expect(bevestigingBody.interview.status).toBe("confirmed");
  });
});

describe("eigendom: gebruiker B kan niet bij data van gebruiker A", () => {
  it("lijsten zijn per gebruiker; andermans mutaties geven 404", async () => {
    const tokensA = await registreer("gebruiker-a@test.nl", "Kandidaat A");
    await onboardKandidaat(tokensA);
    const { vacature } = await maakVacature();

    metToken(tokensA.accessToken);
    const aanmaak = await applicationsPost(
      post("/api/mobile/v1/applications", { vacancyId: vacature.id }),
    );
    const { application } = (await json(aanmaak)) as { application: { id: string } };
    const meA = (await json(await meRoute())) as { user: { id: string } };
    const uitnodigingA = await prisma.invitation.create({
      data: { vacancyId: vacature.id, candidateUserId: meA.user.id },
    });

    const tokensB = await registreer("gebruiker-b@test.nl", "Kandidaat B");
    await onboardKandidaat(tokensB);
    metToken(tokensB.accessToken);

    // B ziet geen sollicitaties of uitnodigingen van A.
    const lijstB = (await json(await applicationsGet())) as {
      applications: unknown[];
    };
    expect(lijstB.applications).toHaveLength(0);
    const uitnodigingenB = (await json(await invitationsGet())) as {
      invitations: unknown[];
    };
    expect(uitnodigingenB.invitations).toHaveLength(0);

    // B kan A's sollicitatie niet intrekken en A's uitnodiging niet beantwoorden.
    const intrekpoging = await withdrawRoute(
      post(`/api/mobile/v1/applications/${application.id}/withdraw`, {}),
      { params: Promise.resolve({ applicationId: application.id }) },
    );
    expect(intrekpoging.status).toBe(404);
    const antwoordpoging = await respondRoute(
      post(`/api/mobile/v1/invitations/${uitnodigingA.id}/respond`, {
        accepted: true,
      }),
      { params: Promise.resolve({ invitationId: uitnodigingA.id }) },
    );
    expect(antwoordpoging.status).toBe(404);
  });

  it("zonder token is alles 401", async () => {
    metToken(null);
    expect((await meRoute()).status).toBe(401);
    expect((await applicationsGet()).status).toBe(401);
    expect((await matchesRoute()).status).toBe(401);
  });
});

describe("push-tokenlevenscyclus", () => {
  it("registreert idempotent, roteert per sessie en verwijdert op verzoek", async () => {
    const tokens = await registreer("push@test.nl");

    const eerste = await pushTokenPost(
      post(
        "/api/mobile/v1/push-tokens",
        { token: "ExponentPushToken[push-1]", platform: "ios" },
        tokens.accessToken,
      ),
    );
    expect(eerste.status).toBe(200);
    // Idempotent: nogmaals hetzelfde token is prima.
    const nogmaals = await pushTokenPost(
      post(
        "/api/mobile/v1/push-tokens",
        { token: "ExponentPushToken[push-1]", platform: "ios" },
        tokens.accessToken,
      ),
    );
    expect(nogmaals.status).toBe(200);
    expect(await prisma.mobilePushToken.count()).toBe(1);

    // Rotatie: nieuw token voor dezelfde sessie vervangt het oude.
    await pushTokenPost(
      post(
        "/api/mobile/v1/push-tokens",
        { token: "ExponentPushToken[push-2]", platform: "ios" },
        tokens.accessToken,
      ),
    );
    const overgebleven = await prisma.mobilePushToken.findMany();
    expect(overgebleven.map((t) => t.token)).toEqual(["ExponentPushToken[push-2]"]);

    const verwijderen = await pushTokenDelete(
      del(
        "/api/mobile/v1/push-tokens",
        { token: "ExponentPushToken[push-2]" },
        tokens.accessToken,
      ),
    );
    expect(verwijderen.status).toBe(200);
    expect(await prisma.mobilePushToken.count()).toBe(0);
  });
});

describe("privacy en accountverwijdering vanuit de app", () => {
  it("toont het gegevensoverzicht en verwijdert het account volledig", async () => {
    const tokens = await registreer("verwijderen@test.nl", "Vera Verwijderd");
    await onboardKandidaat(tokens);

    metToken(tokens.accessToken);
    const overzicht = await privacyOverviewRoute();
    expect(overzicht.status).toBe(200);
    const overzichtBody = (await json(overzicht)) as {
      categories: Array<{ categorie: string }>;
    };
    expect(overzichtBody.categories.length).toBeGreaterThan(0);

    // Zonder juist bevestigingswoord → 400.
    const zonderBevestiging = await accountDelete(
      del("/api/mobile/v1/account", { confirm: "ja" }, tokens.accessToken),
    );
    expect(zonderBevestiging.status).toBe(400);

    const meBody = (await json(await meRoute())) as { user: { id: string } };
    const verwijdering = await accountDelete(
      del("/api/mobile/v1/account", { confirm: "verwijderen" }, tokens.accessToken),
    );
    expect(verwijdering.status).toBe(200);

    // Sessie is ingetrokken; gebruiker is geanonimiseerd; profiel weg.
    metToken(tokens.accessToken);
    expect((await meRoute()).status).toBe(401);
    const gebruiker = await prisma.user.findUnique({ where: { id: meBody.user.id } });
    expect(gebruiker!.name).toBe("Verwijderde gebruiker");
    expect(gebruiker!.email).toContain("verwijderd+");
    expect(
      await prisma.candidateProfile.count({ where: { userId: meBody.user.id } }),
    ).toBe(0);
    // Verwijderverzoek is vastgelegd (AVG-journaal).
    expect(
      await prisma.privacyRequest.count({
        where: { userId: meBody.user.id, kind: "verwijdering" },
      }),
    ).toBe(1);
  });
});
