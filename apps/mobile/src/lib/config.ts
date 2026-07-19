// Basisconfiguratie. De API-URL komt uit EXPO_PUBLIC_API_URL (development
// build) of uit app.json → extra.apiUrl. Er staan GEEN geheimen in de app.

import Constants from "expo-constants";

export function apiBasisUrl(): string {
  const uitEnv = process.env.EXPO_PUBLIC_API_URL;
  if (uitEnv) return uitEnv.replace(/\/$/, "");
  const uitExtra = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)
    ?.apiUrl;
  return (uitExtra ?? "http://localhost:3000").replace(/\/$/, "");
}
