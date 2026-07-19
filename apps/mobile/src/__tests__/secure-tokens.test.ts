// Secure-storagetests: tokens gaan uitsluitend naar expo-secure-store
// (Keychain), overleven een round-trip, en corrupte inhoud wordt gewist.

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

import * as SecureStore from "expo-secure-store";
import { bewaarTokens, leesTokens, wisTokens } from "../lib/secure-tokens";

const TOKENS = {
  accessToken: "mzm_at_" + "a".repeat(64),
  accessTokenExpiresAt: "2026-07-19T12:00:00.000Z",
  refreshToken: "mzm_rt_" + "b".repeat(64),
  refreshTokenExpiresAt: "2026-08-18T12:00:00.000Z",
};

beforeEach(() => {
  mockOpslag.clear();
  jest.clearAllMocks();
});

it("bewaart en leest tokens via SecureStore (nooit AsyncStorage)", async () => {
  await bewaarTokens(TOKENS);
  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  // Keychain-toegankelijkheid: pas na eerste ontgrendeling.
  expect((SecureStore.setItemAsync as jest.Mock).mock.calls[0][2]).toEqual({
    keychainAccessible: "AFTER_FIRST_UNLOCK",
  });
  expect(await leesTokens()).toEqual(TOKENS);
});

it("wist tokens volledig bij uitloggen", async () => {
  await bewaarTokens(TOKENS);
  await wisTokens();
  expect(await leesTokens()).toBeNull();
  expect(mockOpslag.size).toBe(0);
});

it("wist corrupte of onvolledige inhoud in plaats van te crashen", async () => {
  mockOpslag.set("mz_mobile_tokens_v1", "geen json {{");
  expect(await leesTokens()).toBeNull();
  expect(mockOpslag.size).toBe(0);

  mockOpslag.set("mz_mobile_tokens_v1", JSON.stringify({ accessToken: "iets" }));
  expect(await leesTokens()).toBeNull();
  expect(mockOpslag.size).toBe(0);
});
