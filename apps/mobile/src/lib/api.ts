// API-client van de kandidaat-app. Eén plek voor:
// - basis-URL en tijdslimieten;
// - Authorization-header uit de veilige tokenopslag;
// - automatische refresh bij 401 (single-flight: één refresh tegelijk);
// - retries mét exponentiële backoff, UITSLUITEND voor idempotente GET's;
//   niet-idempotente POST's worden nooit blind herhaald — bij een
//   onduidelijke uitkomst herlaadt de UI eerst de staat (zie contract §6);
// - de fout-envelope { error: { code, message } } als getypeerde ApiFout.

import { type MobileTokens } from "@mondzorgwerkt/api-contract";
import { bewaarTokens, leesTokens, wisTokens } from "./secure-tokens";
import { apiBasisUrl } from "./config";

export class ApiFout extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiFout";
    this.status = status;
    this.code = code;
  }
}

/** Netwerk-/time-outfout: de uitkomst van de mutatie is ONBEKEND. */
export class NetwerkFout extends Error {
  constructor(message = "Geen verbinding. Controleer je internet en probeer opnieuw.") {
    super(message);
    this.name = "NetwerkFout";
  }
}

const TIMEOUT_MS = 15_000;
const GET_RETRIES = 2; // totaal 3 pogingen
const BACKOFF_MS = 600;

type Luisteraar = () => void;
const uitlogLuisteraars = new Set<Luisteraar>();

/** SessionProvider abonneert zich: geforceerd uitloggen bij sessieverlies. */
export function bijSessieVerlies(luisteraar: Luisteraar): () => void {
  uitlogLuisteraars.add(luisteraar);
  return () => uitlogLuisteraars.delete(luisteraar);
}

async function sessieVerloren(): Promise<void> {
  await wisTokens();
  for (const luisteraar of uitlogLuisteraars) luisteraar();
}

function metTimeout(init: RequestInit): { init: RequestInit; opruimen: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return {
    init: { ...init, signal: controller.signal },
    opruimen: () => clearTimeout(timer),
  };
}

async function parseFout(res: Response): Promise<ApiFout> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiFout(
      res.status,
      body.error?.code ?? "server_error",
      body.error?.message ?? "Er ging iets mis. Probeer het later opnieuw.",
    );
  } catch {
    return new ApiFout(res.status, "server_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}

// --------------------------------------------------------------------------
// Refresh (single-flight)
// --------------------------------------------------------------------------

let refreshBezig: Promise<MobileTokens | null> | null = null;

async function refreshTokens(): Promise<MobileTokens | null> {
  if (refreshBezig) return refreshBezig;
  refreshBezig = (async () => {
    const huidig = await leesTokens();
    if (!huidig) return null;
    try {
      const { init, opruimen } = metTimeout({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: huidig.refreshToken }),
      });
      const res = await fetch(`${apiBasisUrl()}/api/mobile/v1/auth/refresh`, init).finally(
        opruimen,
      );
      if (!res.ok) {
        // 401/revoked: sessie is weg — lokaal uitloggen.
        if (res.status === 401) await sessieVerloren();
        return null;
      }
      const body = (await res.json()) as { tokens: MobileTokens };
      await bewaarTokens(body.tokens);
      return body.tokens;
    } catch {
      // Netwerkfout tijdens refresh: sessie behouden; latere poging kan slagen.
      return null;
    } finally {
      refreshBezig = null;
    }
  })();
  return refreshBezig;
}

// --------------------------------------------------------------------------
// Kernverzoek
// --------------------------------------------------------------------------

interface VerzoekOpties {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** true = zonder Authorization (openbare endpoints). */
  publiek?: boolean;
}

async function eenmalig(pad: string, opties: VerzoekOpties): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opties.body !== undefined) headers["Content-Type"] = "application/json";
  if (!opties.publiek) {
    const tokens = await leesTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  const { init, opruimen } = metTimeout({
    method: opties.method ?? "GET",
    headers,
    body: opties.body === undefined ? undefined : JSON.stringify(opties.body),
  });
  try {
    return await fetch(`${apiBasisUrl()}${pad}`, init);
  } catch {
    throw new NetwerkFout();
  } finally {
    opruimen();
  }
}

const slaap = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Voert een API-verzoek uit. GET's worden bij netwerk-/5xx-fouten met
 * backoff opnieuw geprobeerd; mutaties nooit. Een 401 op een ingelogde route
 * triggert één refresh-poging en daarna één herhaling van het verzoek.
 */
export async function apiVerzoek<T>(pad: string, opties: VerzoekOpties = {}): Promise<T> {
  const isGet = (opties.method ?? "GET") === "GET";
  const pogingen = isGet ? 1 + GET_RETRIES : 1;

  let laatsteFout: unknown = null;
  for (let poging = 0; poging < pogingen; poging += 1) {
    if (poging > 0) await slaap(BACKOFF_MS * 2 ** (poging - 1));
    try {
      let res = await eenmalig(pad, opties);

      if (res.status === 401 && !opties.publiek) {
        const vernieuwd = await refreshTokens();
        if (!vernieuwd) throw await parseFout(res);
        res = await eenmalig(pad, opties);
        if (res.status === 401) {
          await sessieVerloren();
          throw await parseFout(res);
        }
      }

      if (!res.ok) {
        const fout = await parseFout(res);
        // 5xx op GET mag opnieuw; al het andere is definitief.
        if (isGet && res.status >= 500 && poging < pogingen - 1) {
          laatsteFout = fout;
          continue;
        }
        throw fout;
      }
      return (await res.json()) as T;
    } catch (fout) {
      if (fout instanceof NetwerkFout && isGet && poging < pogingen - 1) {
        laatsteFout = fout;
        continue;
      }
      throw fout;
    }
  }
  throw laatsteFout ?? new NetwerkFout();
}

// --------------------------------------------------------------------------
// Single-flight voor mutaties (bescherming tegen dubbel tikken)
// --------------------------------------------------------------------------

const lopendeMutaties = new Map<string, Promise<unknown>>();

/**
 * Voert een mutatie hooguit één keer tegelijk uit per sleutel. Een tweede
 * aanroep terwijl de eerste loopt, krijgt hetzelfde resultaat (of dezelfde
 * fout) — dubbel tikken kan zo nooit twee verzoeken veroorzaken.
 */
export function enkeleVlucht<T>(sleutel: string, actie: () => Promise<T>): Promise<T> {
  const lopend = lopendeMutaties.get(sleutel);
  if (lopend) return lopend as Promise<T>;
  const belofte = actie().finally(() => lopendeMutaties.delete(sleutel));
  lopendeMutaties.set(sleutel, belofte);
  return belofte;
}
