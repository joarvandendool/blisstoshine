// Deep-linkvertaling: webpaden (Notification.href) en pushdata → interne
// app-routes. Puur en aan beide kanten getest, zodat web-href's en de app
// dezelfde bestemming afleiden. Onbekende of verdwenen content valt altijd
// veilig terug op de matches-tab.

export type DeepLinkTarget =
  | { screen: "matches" }
  | { screen: "match"; vacancyId: string }
  | { screen: "invitations" }
  | { screen: "interview"; interviewId: string }
  | { screen: "notifications" }
  | { screen: "profile" };

export const DEEP_LINK_SCHEME = "mondzorgwerkt";

/** Veilige fallback wanneer content niet (meer) bestaat. */
export const DEEP_LINK_FALLBACK: DeepLinkTarget = { screen: "matches" };

/**
 * Vertaalt een web-href (uit Notification.href) of een app-URL-pad naar een
 * scherm. Accepteert paden met of zonder leidende slash of schema.
 */
export function resolveDeepLink(href: string | null | undefined): DeepLinkTarget {
  if (!href) return DEEP_LINK_FALLBACK;

  let pad = href.trim();
  // Bij een volledige URL alleen het pad overhouden. Bij http(s) is het deel
  // vóór de eerste slash een hostnaam en vervalt het; bij het eigen
  // custom-schema ("mondzorgwerkt://match/xyz") is alles na "://" het pad.
  const schemaIndex = pad.indexOf("://");
  if (schemaIndex >= 0) {
    const schema = pad.slice(0, schemaIndex).toLowerCase();
    pad = pad.slice(schemaIndex + 3);
    if (schema === "http" || schema === "https") {
      const eersteSlash = pad.indexOf("/");
      pad = eersteSlash === -1 ? "" : pad.slice(eersteSlash);
    }
  }
  pad = pad.replace(/^\/+/, "").replace(/\?.*$/, "").replace(/#.*$/, "");
  const delen = pad.split("/").filter(Boolean);

  // Webpaden: /kandidaat, /kandidaat/uitnodigingen, /kandidaat/matches/:id
  if (delen[0] === "kandidaat") {
    if (delen.length === 1) return { screen: "matches" };
    if (delen[1] === "uitnodigingen") return { screen: "invitations" };
    if (delen[1] === "matches" && typeof delen[2] === "string" && delen[2].length > 0) {
      return { screen: "match", vacancyId: delen[2] };
    }
    if (delen[1] === "profiel") return { screen: "profile" };
    return DEEP_LINK_FALLBACK;
  }

  // App-schema-paden: matches, match/:id, uitnodigingen, gesprek/:id, notificaties
  switch (delen[0]) {
    case "matches":
      return delen[1] ? { screen: "match", vacancyId: delen[1] } : { screen: "matches" };
    case "match":
      return delen[1] ? { screen: "match", vacancyId: delen[1] } : DEEP_LINK_FALLBACK;
    case "uitnodigingen":
    case "invitations":
      return { screen: "invitations" };
    case "gesprek":
    case "interview":
      return delen[1]
        ? { screen: "interview", interviewId: delen[1] }
        : { screen: "invitations" };
    case "notificaties":
    case "notifications":
      return { screen: "notifications" };
    case "profiel":
    case "profile":
      return { screen: "profile" };
    default:
      return DEEP_LINK_FALLBACK;
  }
}

/** Router-pad (Expo Router) voor een DeepLinkTarget. */
export function targetToPath(target: DeepLinkTarget): string {
  switch (target.screen) {
    case "matches":
      return "/(app)/(tabs)";
    case "match":
      return `/(app)/match/${target.vacancyId}`;
    case "invitations":
      return "/(app)/(tabs)/uitnodigingen";
    case "interview":
      return `/(app)/gesprek/${target.interviewId}`;
    case "notifications":
      return "/(app)/notificaties";
    case "profile":
      return "/(app)/(tabs)/profiel";
  }
}
