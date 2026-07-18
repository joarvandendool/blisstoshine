// CSRF-bescherming voor route handlers die met sessiecookies muteren.
//
// Server actions krijgen Next.js' ingebouwde Origin-controle, maar route
// handlers (app/api/**) niet. De sessiecookie staat op sameSite=lax; dat
// beschermt tegen cross-site POST-formulieren in moderne browsers, maar we
// dwingen het hier expliciet en testbaar af (defense-in-depth, zie
// docs/OPERATIONS.md): een muterend verzoek mét Origin-header moet van onze
// eigen host komen.
//
// Alleen relevant voor cookie-gedragen endpoints. Publieke GET-API's en
// Bearer-API's (/api/public/v1/*) hebben geen cookies en dus geen CSRF-risico.

import { AuthzError } from "@/lib/authz";

/**
 * Hosts die als "eigen origin" gelden. Naast de Host van het verzoek zelf
 * (met x-forwarded-host-voorrang, zoals Vercel die zet) accepteren we de
 * deployment-hosts uit de omgeving: VERCEL_URL (unieke deployment-URL),
 * VERCEL_BRANCH_URL (stabiele branch-URL), VERCEL_PROJECT_PRODUCTION_URL
 * (productiedomein) en een eventueel eigen APP_HOST.
 */
export function allowedOriginHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (requestHost) hosts.add(requestHost.trim().toLowerCase());
  for (const env of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.APP_HOST,
  ]) {
    if (env) hosts.add(env.trim().toLowerCase().replace(/^https?:\/\//, ""));
  }
  return hosts;
}

/**
 * Weigert (AuthzError 403) muterende verzoeken waarvan de Origin-header niet
 * bij onze eigen host hoort. Verzoeken ZONDER Origin-header worden toegestaan:
 * browsers sturen Origin altijd mee bij cross-site POST's (daar zit het
 * CSRF-risico), terwijl niet-browserclients (curl, tests, health checks) geen
 * cookies dragen en dus geen CSRF kunnen plegen. Een letterlijke "null"-origin
 * (sandboxed iframe, data-URL) wordt wél geweigerd.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "") return;

  let originHost: string | null = null;
  if (origin !== "null") {
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
  }

  if (!originHost || !allowedOriginHosts(request).has(originHost)) {
    throw new AuthzError(
      "Verzoek geweigerd: de afzender (Origin) hoort niet bij deze applicatie.",
      403,
    );
  }
}
