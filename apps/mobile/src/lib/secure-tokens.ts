// Tokenopslag: uitsluitend expo-secure-store (iOS Keychain). Bewust GEEN
// AsyncStorage — de sessie mag nooit onversleuteld op schijf staan. Op web
// (alleen voor ontwikkeling/screenshots) valt SecureStore niet beschikbaar
// uit naar een in-memory opslag die bij herladen leeg is.

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { MobileTokens } from "@mondzorgwerkt/api-contract";

const SLEUTEL = "mz_mobile_tokens_v1";

const geheugen = new Map<string, string>();

async function bewaarRuw(waarde: string): Promise<void> {
  if (Platform.OS === "web") {
    geheugen.set(SLEUTEL, waarde);
    return;
  }
  await SecureStore.setItemAsync(SLEUTEL, waarde, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

async function leesRuw(): Promise<string | null> {
  if (Platform.OS === "web") return geheugen.get(SLEUTEL) ?? null;
  return SecureStore.getItemAsync(SLEUTEL);
}

export async function bewaarTokens(tokens: MobileTokens): Promise<void> {
  await bewaarRuw(JSON.stringify(tokens));
}

export async function leesTokens(): Promise<MobileTokens | null> {
  try {
    const ruw = await leesRuw();
    if (!ruw) return null;
    const geparsed = JSON.parse(ruw) as Partial<MobileTokens>;
    if (
      typeof geparsed.accessToken !== "string" ||
      typeof geparsed.refreshToken !== "string" ||
      typeof geparsed.accessTokenExpiresAt !== "string" ||
      typeof geparsed.refreshTokenExpiresAt !== "string"
    ) {
      await wisTokens();
      return null;
    }
    return geparsed as MobileTokens;
  } catch {
    await wisTokens();
    return null;
  }
}

export async function wisTokens(): Promise<void> {
  if (Platform.OS === "web") {
    geheugen.delete(SLEUTEL);
    return;
  }
  await SecureStore.deleteItemAsync(SLEUTEL).catch(() => {});
}
