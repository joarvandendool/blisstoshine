// Pushnotificaties: expliciete toestemming, tokenregistratie/-rotatie bij de
// server, afmelden bij uitloggen en het afhandelen van taps (deep links).
// De zichtbare pushtekst komt van de server en bevat nooit kandidaatdata.

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { resolveDeepLink, targetToPath, type DeepLinkTarget } from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "./endpoints";

// Meldingen op de voorgrond rustig tonen (banner, geen geluid).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

let laatstGeregistreerd: string | null = null;

/**
 * Vraagt (indien nodig) toestemming en registreert het Expo-pushtoken bij de
 * server. Retourneert of push actief is. Wordt pas aangeroepen NA een
 * expliciete gebruikerskeuze in de instellingen of onboarding-afronding.
 */
export async function meldPushAan(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const huidig = await Notifications.getPermissionsAsync();
  let status = huidig.status;
  if (status !== "granted") {
    const gevraagd = await Notifications.requestPermissionsAsync();
    status = gevraagd.status;
  }
  if (status !== "granted") return false;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  await kandidaatApi.registreerPushToken(token.data);
  laatstGeregistreerd = token.data;
  return true;
}

/** Bij uitloggen: token bij de server verwijderen (server ruimt ook zelf op). */
export async function meldPushTokenAf(): Promise<void> {
  if (!laatstGeregistreerd) return;
  const token = laatstGeregistreerd;
  laatstGeregistreerd = null;
  await kandidaatApi.verwijderPushToken(token).catch(() => {});
}

/** Tokenrotatie: iOS kan het token vernieuwen terwijl de app draait. */
export function volgTokenRotatie(): () => void {
  if (Platform.OS === "web") return () => {};
  const abonnement = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === "string" && token.data !== laatstGeregistreerd) {
      laatstGeregistreerd = token.data;
      void kandidaatApi.registreerPushToken(token.data).catch(() => {});
    }
  });
  return () => abonnement.remove();
}

/** Deep-linkdoel uit een notificatierespons (tap op een push). */
export function doelUitNotificatie(
  respons: Notifications.NotificationResponse,
): DeepLinkTarget {
  const data = respons.notification.request.content.data as
    | { href?: string | null }
    | undefined;
  return resolveDeepLink(data?.href ?? null);
}

/**
 * Luistert op pushtaps en navigeert naar het juiste scherm; content die niet
 * meer bestaat valt in de schermen zelf veilig terug (404 → melding + lijst).
 */
export function volgNotificatieTaps(navigeer: (pad: string) => void): () => void {
  if (Platform.OS === "web") return () => {};
  const abonnement = Notifications.addNotificationResponseReceivedListener(
    (respons) => {
      navigeer(targetToPath(doelUitNotificatie(respons)));
    },
  );
  // Koude start via een notificatie.
  void Notifications.getLastNotificationResponseAsync().then((respons) => {
    if (respons) navigeer(targetToPath(doelUitNotificatie(respons)));
  });
  return () => abonnement.remove();
}
