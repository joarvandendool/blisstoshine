// POST /api/mobile/v1/auth/refresh — roteert het tokenpaar (single-use
// refresh-tokens). Replay van een al geroteerd token trekt de sessie in en
// antwoordt 401/revoked. Rate limit per IP tegen brute force op tokens.

import { rotateMobileSession } from "@/lib/mobile-auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  clientIp,
  leesJson,
  okRespons,
  rateLimitRespons,
  vangFout,
} from "@/server/mobile/http";
import { refreshSchema } from "@/server/mobile/schemas";
import { toMobileTokens } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const invoer = refreshSchema.parse(await leesJson(request));

    const limiet = await rateLimit(`mobile-refresh:${clientIp(request)}`, {
      limit: 60,
      windowSeconds: 15 * 60,
    });
    if (!limiet.allowed) return rateLimitRespons(limiet.retryAfterSeconds);

    const { tokens } = await rotateMobileSession(invoer.refreshToken);
    return okRespons({ tokens: toMobileTokens(tokens) });
  } catch (fout) {
    return vangFout(fout);
  }
}
