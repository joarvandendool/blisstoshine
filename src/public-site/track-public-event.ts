// Client-side verzender voor de vier publieke analytics-events (fase 11).
// Fire-and-forget: analytics mag nooit navigatie of rendering blokkeren.
// keepalive zorgt dat click-events een paginawissel overleven.

import type { PublicEvent } from "@/domain/analytics";
import type { PublicBron } from "./attribution";

export interface PublicEventContext {
  /** Geclassificeerde bezoekbron — nooit een ruwe referrer-URL. */
  bron: PublicBron;
  /** Route-categorie, bv. "home" | "vacatures" | "vacature_detail" | "kennis". */
  route_type?: string;
  /** Taxonomierol (bv. "mondhygienist") — geen vrije identifiers of slugs. */
  rol?: string;
  /** Regio/provincie zoals publiek getoond. */
  regio?: string;
}

export function verstuurPubliekEvent(
  name: PublicEvent,
  context: PublicEventContext,
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, context }),
      keepalive: true,
    }).catch(() => {
      // Bewust stil: analytics faalt nooit richting de bezoeker.
    });
  } catch {
    // idem
  }
}
