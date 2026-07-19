// Bron-attributie voor de openbare site (Workstream B, fase 11).
//
// Classificeert document.referrer + utm-parameters naar een GESLOTEN set
// bronnen en bewaart de eerste-touch-bron in sessionStorage. Privacy:
// de ruwe referrer-URL verlaat de browser nooit — alleen het
// geclassificeerde bronlabel gaat mee in analytics-events.
//
// Buckets (afgesproken met de funnel-analyse):
//   google              — Google-zoekverkeer (incl. utm_source=google)
//   chatgpt             — ChatGPT / OpenAI-answer-verkeer
//   claude              — Claude (claude.ai / Claude-links)
//   perplexity          — Perplexity
//   answer_engine_overig— overige AI-answer-engines (Copilot, Gemini, …)
//   social              — sociale netwerken
//   direct              — geen/onbekende verwijzer (default, ook bij twijfel)

export const PUBLIC_BRONNEN = [
  "google",
  "chatgpt",
  "claude",
  "perplexity",
  "answer_engine_overig",
  "social",
  "direct",
] as const;

export type PublicBron = (typeof PUBLIC_BRONNEN)[number];

const SESSION_KEY = "mw_bron_eerste_touch";

/** hostname eindigt op (sub)domein — "www.google.nl" matcht "google.nl" niet "oogle.nl". */
function hostEindigtOp(host: string, domein: string): boolean {
  return host === domein || host.endsWith(`.${domein}`);
}

function classificeerHost(host: string): PublicBron | null {
  const h = host.toLowerCase();
  // Google-zoekdomeinen (google.com, google.nl, …)
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "google";
  if (hostEindigtOp(h, "chatgpt.com") || hostEindigtOp(h, "chat.openai.com") || hostEindigtOp(h, "openai.com")) {
    return "chatgpt";
  }
  if (hostEindigtOp(h, "claude.ai") || hostEindigtOp(h, "claude.com") || hostEindigtOp(h, "anthropic.com")) {
    return "claude";
  }
  if (hostEindigtOp(h, "perplexity.ai")) return "perplexity";
  // Overige answer-engines
  for (const d of [
    "copilot.microsoft.com",
    "gemini.google.com",
    "you.com",
    "phind.com",
    "chat.mistral.ai",
    "kagi.com",
    "poe.com",
  ]) {
    if (hostEindigtOp(h, d)) return "answer_engine_overig";
  }
  // Sociale netwerken
  for (const d of [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "lnkd.in",
    "x.com",
    "twitter.com",
    "t.co",
    "tiktok.com",
    "youtube.com",
    "reddit.com",
    "whatsapp.com",
  ]) {
    if (hostEindigtOp(h, d)) return "social";
  }
  return null;
}

function classificeerUtm(source: string): PublicBron | null {
  const s = source.toLowerCase();
  if (s.includes("google")) return "google";
  if (s.includes("chatgpt") || s.includes("openai")) return "chatgpt";
  if (s.includes("claude") || s.includes("anthropic")) return "claude";
  if (s.includes("perplexity")) return "perplexity";
  if (s.includes("copilot") || s.includes("gemini") || s.includes("bing_chat")) {
    return "answer_engine_overig";
  }
  if (
    ["facebook", "instagram", "linkedin", "twitter", "x", "tiktok", "social", "youtube", "reddit", "whatsapp"].some(
      (d) => s.includes(d),
    )
  ) {
    return "social";
  }
  return null;
}

/**
 * Classificeer een bezoek naar bron. utm_source wint van de referrer
 * (campagnes labelen bewust); onbekende of eigen verwijzers → "direct".
 */
export function classificeerBron(
  referrer: string,
  searchParams: URLSearchParams,
): PublicBron {
  const utm = searchParams.get("utm_source");
  if (utm) {
    const vanUtm = classificeerUtm(utm);
    if (vanUtm) return vanUtm;
  }
  if (referrer) {
    try {
      const host = new URL(referrer).hostname;
      // Interne navigatie is geen nieuwe bron.
      if (
        typeof window !== "undefined" &&
        host === window.location.hostname
      ) {
        return "direct";
      }
      const vanHost = classificeerHost(host);
      if (vanHost) return vanHost;
    } catch {
      // Ongeldige referrer-URL → behandelen als direct.
    }
  }
  return "direct";
}

/**
 * Eerste-touch-bron van deze sessie: bij het eerste bezoek geclassificeerd
 * en in sessionStorage bewaard; daarna altijd dezelfde waarde zodat de
 * funnel bron → registratie → activatie aan één bron toe te schrijven is.
 * Alleen bruikbaar in de browser; op de server (of zonder storage) valt
 * hij terug op classificatie zonder opslag.
 */
export function eersteTouchBron(): PublicBron {
  if (typeof window === "undefined") return "direct";
  const huidige = classificeerBron(
    document.referrer,
    new URLSearchParams(window.location.search),
  );
  try {
    const bewaard = window.sessionStorage.getItem(SESSION_KEY);
    if (bewaard && (PUBLIC_BRONNEN as readonly string[]).includes(bewaard)) {
      return bewaard as PublicBron;
    }
    window.sessionStorage.setItem(SESSION_KEY, huidige);
  } catch {
    // Storage geblokkeerd (privacy-modus) — classificatie zonder opslag.
  }
  return huidige;
}
