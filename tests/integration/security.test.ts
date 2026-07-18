// Security-hardeningtests (SCALE_AUDIT §4.1–4.3):
// - admin-bootstrap alleen via PLATFORM_ADMIN_EMAIL en alleen zolang er nog
//   geen platform-admin bestaat (geen "eerste gebruiker wordt admin" meer)
// - rateLimit blokkeert boven de limiet en herstelt in een nieuw venster
// - mislukte logins leiden tot een generieke lockout-melding via loginAction

import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// Mutabel IP voor de headers()-mock; vi.hoisted zodat de mockfactory erbij kan.
const ipHouder = vi.hoisted(() => ({ ip: "203.0.113.7" }));

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
    headers: async () => ({
      get: (naam: string) =>
        naam.toLowerCase() === "x-forwarded-for" ? ipHouder.ip : null,
    }),
  };
});

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { rateLimit, peekRateLimit } from "@/lib/rate-limit";
import { loginAction, registerAction } from "../../app/(auth)/actions";
import { prepareTestDb, maakGebruiker } from "./helpers";

const TE_VEEL_POGINGEN = "Te veel pogingen. Probeer het over een paar minuten opnieuw.";
const FOUTE_LOGIN = "E-mailadres of wachtwoord klopt niet";

const oorspronkelijkAdminEmail = process.env.PLATFORM_ADMIN_EMAIL;

function herstelAdminEmail(): void {
  if (oorspronkelijkAdminEmail === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAIL;
  } else {
    process.env.PLATFORM_ADMIN_EMAIL = oorspronkelijkAdminEmail;
  }
}

function loginForm(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

function registerForm(email: string): FormData {
  const fd = new FormData();
  fd.set("name", "Test Persoon");
  fd.set("email", email);
  fd.set("password", "voldoende-lang-wachtwoord");
  fd.set("accountType", "kandidaat");
  return fd;
}

beforeAll(async () => {
  await prepareTestDb();
});

afterEach(() => {
  herstelAdminEmail();
});

// Volgorde is betekenisvol (singleFork, sequentieel): de bootstrap-tests
// bouwen de admin-toestand stap voor stap op.
describe("admin-bootstrap via PLATFORM_ADMIN_EMAIL", () => {
  it("zonder PLATFORM_ADMIN_EMAIL wordt niemand admin — ook niet op een lege database", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    expect(await prisma.user.count()).toBe(0);

    const user = await registerUser({
      email: "eerste@test.nl",
      password: "wachtwoord-123",
      name: "Eerste Gebruiker",
    });
    expect(user.isPlatformAdmin).toBe(false);
  });

  it("met PLATFORM_ADMIN_EMAIL en nog geen admin wordt alleen het matchende adres admin (case-insensitive, ook op een niet-lege database)", async () => {
    process.env.PLATFORM_ADMIN_EMAIL = "Beheer@Test.nl";

    // Niet-matchend adres: geen admin, ook al bestaat er nog geen admin.
    const gewoon = await registerUser({
      email: "gewoon@test.nl",
      password: "wachtwoord-123",
      name: "Gewone Gebruiker",
    });
    expect(gewoon.isPlatformAdmin).toBe(false);

    // Matchend adres (andere casing): wél admin, ondanks bestaande gebruikers.
    const beheerder = await registerUser({
      email: "BEHEER@test.nl",
      password: "wachtwoord-123",
      name: "Beheerder",
    });
    expect(beheerder.isPlatformAdmin).toBe(true);
  });

  it("bestaande admin aanwezig: nieuwe registratie met het env-adres wordt GEEN admin", async () => {
    expect(await prisma.user.count({ where: { isPlatformAdmin: true } })).toBe(1);

    process.env.PLATFORM_ADMIN_EMAIL = "tweede-admin@test.nl";
    const tweede = await registerUser({
      email: "tweede-admin@test.nl",
      password: "wachtwoord-123",
      name: "Tweede Admin",
    });
    expect(tweede.isPlatformAdmin).toBe(false);
  });

  it("bootstrap werkt ook wanneer een bestaande admin via de database is aangemaakt", async () => {
    await maakGebruiker("db-admin@test.nl", "DB Admin", true);
    process.env.PLATFORM_ADMIN_EMAIL = "derde-admin@test.nl";
    const derde = await registerUser({
      email: "derde-admin@test.nl",
      password: "wachtwoord-123",
      name: "Derde Admin",
    });
    expect(derde.isPlatformAdmin).toBe(false);
  });
});

describe("rateLimit (vaste vensters op RateLimitCounter)", () => {
  it("staat pogingen toe tot de limiet en blokkeert daarboven", async () => {
    const opts = { limit: 3, windowSeconds: 900 };

    for (let i = 1; i <= 3; i++) {
      const res = await rateLimit("test:limiet", opts);
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(3 - i);
      expect(res.retryAfterSeconds).toBe(0);
    }

    const geblokkeerd = await rateLimit("test:limiet", opts);
    expect(geblokkeerd.allowed).toBe(false);
    expect(geblokkeerd.remaining).toBe(0);
    expect(geblokkeerd.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(geblokkeerd.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it("herstelt in een nieuw venster en ruimt verlopen vensters op", async () => {
    const opts = { limit: 2, windowSeconds: 900 };
    await rateLimit("test:herstel", opts);
    await rateLimit("test:herstel", opts);
    expect((await rateLimit("test:herstel", opts)).allowed).toBe(false);

    // Simuleer het verstrijken van de tijd: schuif het venster ver terug.
    await prisma.rateLimitCounter.updateMany({
      where: { key: "test:herstel" },
      data: { windowStart: new Date(Date.now() - 3 * 900 * 1000) },
    });

    const nieuwVenster = await rateLimit("test:herstel", opts);
    expect(nieuwVenster.allowed).toBe(true);
    expect(nieuwVenster.remaining).toBe(1);

    // Het verlopen venster (< nu - 2×venster) is in dezelfde aanroep opgeruimd.
    const rijen = await prisma.rateLimitCounter.findMany({
      where: { key: "test:herstel" },
    });
    expect(rijen).toHaveLength(1);
  });

  it("peekRateLimit telt niet mee en blokkeert bij een vol venster", async () => {
    const opts = { limit: 2, windowSeconds: 900 };

    expect((await peekRateLimit("test:peek", opts)).allowed).toBe(true);
    expect(await prisma.rateLimitCounter.count({ where: { key: "test:peek" } })).toBe(0);

    await rateLimit("test:peek", opts);
    await rateLimit("test:peek", opts);
    const vol = await peekRateLimit("test:peek", opts);
    expect(vol.allowed).toBe(false);
    expect(vol.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("faalt open bij databasefouten (beschikbaarheid boven strengheid)", async () => {
    // Let op: geen mockRestore op de Prisma-delegate — dat schrijft een kapotte
    // descriptor terug op de client-proxy. In plaats daarvan vangen we het
    // origineel en zetten we dat na de gesimuleerde fout expliciet terug als
    // spy-implementatie.
    const origineleUpsert = prisma.rateLimitCounter.upsert.bind(
      prisma.rateLimitCounter,
    );
    const spy = vi
      .spyOn(prisma.rateLimitCounter, "upsert")
      .mockRejectedValueOnce(new Error("database onbereikbaar"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await rateLimit("test:fail-open", { limit: 2, windowSeconds: 60 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(2);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
      spy.mockImplementation(origineleUpsert as never);
    }

    // Na de eenmalige fout telt de limiter weer echt (eerste échte poging).
    const tweede = await rateLimit("test:fail-open", { limit: 2, windowSeconds: 60 });
    expect(tweede.allowed).toBe(true);
    expect(tweede.remaining).toBe(1);
  });
});

describe("lockout op mislukte logins via loginAction", () => {
  const EMAIL = "lockout@test.nl";
  const WACHTWOORD = "juist-wachtwoord-123";

  beforeAll(async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    // registerUser levert een echte bcrypt-hash op zodat loginAction werkt.
    await registerUser({ email: EMAIL, password: WACHTWOORD, name: "Lock Out" });
    ipHouder.ip = "192.0.2.55";
  });

  it("geeft na 8 mislukte pogingen de generieke lockout-melding — ook met het juiste wachtwoord", async () => {
    for (let i = 1; i <= 8; i++) {
      const res = await loginAction(null, loginForm(EMAIL, "fout-wachtwoord"));
      expect(res?.error).toBe(FOUTE_LOGIN);
    }

    // Poging 9 (fout wachtwoord): geblokkeerd door de lockout-teller.
    const geblokkeerd = await loginAction(null, loginForm(EMAIL, "fout-wachtwoord"));
    expect(geblokkeerd?.error).toBe(TE_VEEL_POGINGEN);

    // Zelfs het juiste wachtwoord komt er tijdens de lockout niet meer in,
    // en de melding verklapt niet dat het account bestaat.
    const metJuistWachtwoord = await loginAction(null, loginForm(EMAIL, WACHTWOORD));
    expect(metJuistWachtwoord?.error).toBe(TE_VEEL_POGINGEN);
  });

  it("geeft ook voor niet-bestaande accounts dezelfde meldingen (geen accountenumeratie)", async () => {
    for (let i = 1; i <= 8; i++) {
      const res = await loginAction(null, loginForm("bestaat-niet@test.nl", "x-wachtwoord"));
      expect(res?.error).toBe(FOUTE_LOGIN);
    }
    const geblokkeerd = await loginAction(
      null,
      loginForm("bestaat-niet@test.nl", "x-wachtwoord"),
    );
    expect(geblokkeerd?.error).toBe(TE_VEEL_POGINGEN);
  });
});

describe("registratielimiet per IP via registerAction", () => {
  it("staat 5 registraties per uur per IP toe en blokkeert de zesde", async () => {
    delete process.env.PLATFORM_ADMIN_EMAIL;
    ipHouder.ip = "198.51.100.9";

    for (let i = 1; i <= 5; i++) {
      // Succesvolle registratie eindigt in redirect() en gooit dus.
      const uitkomst = await registerAction(
        null,
        registerForm(`spam-${i}@test.nl`),
      ).catch((e: unknown) => e);
      expect(uitkomst).toBeInstanceOf(Error);
    }

    const zesde = await registerAction(null, registerForm("spam-6@test.nl"));
    expect(zesde?.error).toBe(TE_VEEL_POGINGEN);
    // En het account is dus niet aangemaakt.
    expect(
      await prisma.user.findUnique({ where: { email: "spam-6@test.nl" } }),
    ).toBeNull();
  });
});
