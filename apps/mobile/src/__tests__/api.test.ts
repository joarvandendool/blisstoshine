// Offline-/retry- en dubbele-requesttests voor de API-client:
// - GET's worden bij netwerkfouten en 5xx met backoff herhaald;
// - mutaties (POST/PUT/DELETE) worden NOOIT automatisch herhaald;
// - 401 → één refresh (single-flight) → herhaling; refresh-falen → sessieverlies;
// - enkeleVlucht dedupliceert dubbel tikken naar één verzoek.

const mockOpslag = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  setItemAsync: jest.fn(async (sleutel: string, waarde: string) => {
    mockOpslag.set(sleutel, waarde);
  }),
  getItemAsync: jest.fn(async (sleutel: string) => mockOpslag.get(sleutel) ?? null),
  deleteItemAsync: jest.fn(async (sleutel: string) => {
    mockOpslag.delete(sleutel);
  }),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "https://api.test" } } },
}));

import {
  apiVerzoek,
  ApiFout,
  bijSessieVerlies,
  enkeleVlucht,
  NetwerkFout,
} from "../lib/api";
import { bewaarTokens, leesTokens } from "../lib/secure-tokens";

const TOKENS = {
  accessToken: "mzm_at_" + "a".repeat(64),
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "mzm_rt_" + "b".repeat(64),
  refreshTokenExpiresAt: "2099-02-01T00:00:00.000Z",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: jest.Mock;

beforeEach(async () => {
  mockOpslag.clear();
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  await bewaarTokens(TOKENS);
});

describe("offline en retries", () => {
  it("herhaalt een GET na een netwerkfout en slaagt daarna", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const uit = await apiVerzoek<{ ok: boolean }>("/api/mobile/v1/me");
    expect(uit.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("herhaalt een GET na een 500 en geeft daarna het resultaat", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: { code: "server_error", message: "Oeps" } }, 500))
      .mockResolvedValueOnce(jsonRes({ matches: [] }));
    const uit = await apiVerzoek<{ matches: unknown[] }>("/api/mobile/v1/matches");
    expect(uit.matches).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("geeft NetwerkFout wanneer alle GET-pogingen offline zijn", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    await expect(apiVerzoek("/api/mobile/v1/me")).rejects.toBeInstanceOf(NetwerkFout);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  }, 20_000);

  it("herhaalt een POST NOOIT automatisch — de uitkomst kan al geland zijn", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(
      apiVerzoek("/api/mobile/v1/applications", {
        method: "POST",
        body: { vacancyId: "v1" },
      }),
    ).rejects.toBeInstanceOf(NetwerkFout);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("herhaalt een POST ook niet na een 500", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonRes({ error: { code: "server_error", message: "Oeps" } }, 500),
    );
    await expect(
      apiVerzoek("/api/mobile/v1/applications", { method: "POST", body: {} }),
    ).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("verlopen sessies en refresh", () => {
  it("vernieuwt tokens bij 401 en herhaalt het verzoek éénmaal", async () => {
    const nieuweTokens = {
      ...TOKENS,
      accessToken: "mzm_at_" + "c".repeat(64),
      refreshToken: "mzm_rt_" + "d".repeat(64),
    };
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: { code: "unauthorized", message: "!" } }, 401))
      .mockResolvedValueOnce(jsonRes({ tokens: nieuweTokens })) // refresh
      .mockResolvedValueOnce(jsonRes({ user: { id: "u1" } })); // herhaling
    const uit = await apiVerzoek<{ user: { id: string } }>("/api/mobile/v1/me");
    expect(uit.user.id).toBe("u1");
    // Geroteerde tokens staan in de veilige mockOpslag.
    expect((await leesTokens())?.accessToken).toBe(nieuweTokens.accessToken);
    // De herhaling draagt de nieuwe access-token.
    const laatsteInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect((laatsteInit.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${nieuweTokens.accessToken}`,
    );
  });

  it("meldt sessieverlies en wist tokens wanneer de refresh 401 geeft", async () => {
    const verloren = jest.fn();
    const afmelden = bijSessieVerlies(verloren);
    fetchMock
      .mockResolvedValueOnce(jsonRes({ error: { code: "unauthorized", message: "!" } }, 401))
      .mockResolvedValueOnce(jsonRes({ error: { code: "revoked", message: "weg" } }, 401));
    await expect(apiVerzoek("/api/mobile/v1/me")).rejects.toBeInstanceOf(ApiFout);
    expect(verloren).toHaveBeenCalled();
    expect(await leesTokens()).toBeNull();
    afmelden();
  });
});

describe("dubbele verzoeken (dubbel tikken)", () => {
  it("enkeleVlucht bundelt gelijktijdige aanroepen tot één verzoek", async () => {
    let lopend = 0;
    let maxTegelijk = 0;
    const actie = jest.fn(async () => {
      lopend += 1;
      maxTegelijk = Math.max(maxTegelijk, lopend);
      await new Promise((klaar) => setTimeout(klaar, 30));
      lopend -= 1;
      return { id: "app1" };
    });

    const [een, twee] = await Promise.all([
      enkeleVlucht("solliciteer-v1", actie),
      enkeleVlucht("solliciteer-v1", actie),
    ]);
    expect(actie).toHaveBeenCalledTimes(1);
    expect(maxTegelijk).toBe(1);
    expect(een).toBe(twee);

    // Na afronding kan dezelfde sleutel opnieuw (bewuste tweede actie).
    await enkeleVlucht("solliciteer-v1", actie);
    expect(actie).toHaveBeenCalledTimes(2);
  });
});
