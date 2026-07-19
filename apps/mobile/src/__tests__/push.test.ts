// Push-tokenlevenscyclus in de app: expliciete toestemming, registratie bij
// de server, rotatie via de tokenlistener en afmelden bij uitloggen.

// let + latere init: de mockfactory draait al tijdens het hoisten van de
// imports; setNotificationHandler mag daarom niets uit deze scope raken.
const mockNotificaties: {
  permissieStatus: string;
  gevraagd: boolean;
  tokenListeners: ((token: { data: string }) => void)[];
} = { permissieStatus: "undetermined", gevraagd: false, tokenListeners: [] };

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: mockNotificaties.permissieStatus })),
  requestPermissionsAsync: jest.fn(async () => {
    mockNotificaties.gevraagd = true;
    return { status: mockNotificaties.permissieStatus === "denied" ? "denied" : "granted" };
  }),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[app-1]" })),
  addPushTokenListener: jest.fn((cb: (token: { data: string }) => void) => {
    mockNotificaties.tokenListeners.push(cb);
    return { remove: jest.fn() };
  }),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "https://api.test", eas: { projectId: "pid" } } } },
}));

const mockRegistreerPushToken = jest.fn(async (_token: string) => ({ ok: true }));
const mockVerwijderPushToken = jest.fn(async (_token: string) => ({ ok: true }));
jest.mock("../lib/endpoints", () => ({
  kandidaatApi: {
    registreerPushToken: (token: string) => mockRegistreerPushToken(token),
    verwijderPushToken: (token: string) => mockVerwijderPushToken(token),
  },
}));

import * as Notifications from "expo-notifications";
import { doelUitNotificatie, meldPushAan, meldPushTokenAf, volgTokenRotatie } from "../lib/push";

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificaties.permissieStatus = "undetermined";
  mockNotificaties.gevraagd = false;
  mockNotificaties.tokenListeners = [];
});

it("vraagt expliciete toestemming en registreert het token bij de server", async () => {
  const aan = await meldPushAan();
  expect(aan).toBe(true);
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
  expect(mockRegistreerPushToken).toHaveBeenCalledWith("ExponentPushToken[app-1]");
});

it("registreert NIET wanneer de gebruiker toestemming weigert", async () => {
  mockNotificaties.permissieStatus = "denied";
  const aan = await meldPushAan();
  expect(aan).toBe(false);
  expect(mockRegistreerPushToken).not.toHaveBeenCalled();
});

it("meldt het token af bij uitloggen (en maar één keer)", async () => {
  await meldPushAan();
  await meldPushTokenAf();
  expect(mockVerwijderPushToken).toHaveBeenCalledWith("ExponentPushToken[app-1]");
  await meldPushTokenAf();
  expect(mockVerwijderPushToken).toHaveBeenCalledTimes(1);
});

it("volgt tokenrotatie: nieuw token wordt her-geregistreerd", async () => {
  await meldPushAan();
  const stop = volgTokenRotatie();
  mockNotificaties.tokenListeners.forEach((cb) => cb({ data: "ExponentPushToken[app-2]" }));
  // microtask afwachten
  await Promise.resolve();
  expect(mockRegistreerPushToken).toHaveBeenLastCalledWith("ExponentPushToken[app-2]");
  stop();
});

it("leidt het juiste scherm af uit pushdata, met veilige fallback", () => {
  const respons = (href: string | null) =>
    ({
      notification: { request: { content: { data: { href } } } },
    }) as never;
  expect(doelUitNotificatie(respons("/kandidaat/uitnodigingen"))).toEqual({
    screen: "invitations",
  });
  expect(doelUitNotificatie(respons(null))).toEqual({ screen: "matches" });
  expect(doelUitNotificatie(respons("/praktijk/x"))).toEqual({ screen: "matches" });
});
