// robots.txt (fase 10) — crawlerbeleid van de openbare site.
// Volledig beleid en rationale: docs/design/CRAWLER_POLICY.md.
//
// Kern:
// - AI-ANSWER/SEARCH-crawlers (OAI-SearchBot, Claude-SearchBot, Claude-User)
//   zijn welkom op de openbare inhoud: zij sturen bezoekers/attributie terug.
// - AI-TRAININGS-crawlers (GPTBot, ClaudeBot) staan standaard op Disallow;
//   configureerbaar via env AI_TRAINING_CRAWLERS=allow|disallow
//   (default: disallow).
// - Privé-routes staan voor álle bots op Disallow, maar robots.txt is GEEN
//   beveiliging: de echte bescherming is autorisatie + robots-noindex in de
//   layouts van die routes.

import type { MetadataRoute } from "next";
import { siteUrl } from "@/public-site/seo";

/** Privéroutes: uitgesloten voor alle crawlers (plus auth + noindex). */
const PRIVATE_PADEN = [
  "/kandidaat",
  "/praktijk",
  "/intern",
  "/instellingen",
  "/design-system",
  "/api",
];

export default function robots(): MetadataRoute.Robots {
  // Trainingscrawlers: standaard geweigerd; bewust via env open te zetten.
  const trainingToegestaan = process.env.AI_TRAINING_CRAWLERS === "allow";

  return {
    rules: [
      // Reguliere crawlers (Googlebot e.d.): openbare inhoud toegestaan.
      { userAgent: "*", allow: "/", disallow: PRIVATE_PADEN },
      // AI-answer/search-crawlers en agent-bezoek: expliciet toegestaan.
      {
        userAgent: ["OAI-SearchBot", "Claude-SearchBot", "Claude-User"],
        allow: "/",
        disallow: PRIVATE_PADEN,
      },
      // AI-trainingscrawlers: env-gestuurd (AI_TRAINING_CRAWLERS), default disallow.
      trainingToegestaan
        ? {
            userAgent: ["GPTBot", "ClaudeBot"],
            allow: "/",
            disallow: PRIVATE_PADEN,
          }
        : { userAgent: ["GPTBot", "ClaudeBot"], disallow: "/" },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
