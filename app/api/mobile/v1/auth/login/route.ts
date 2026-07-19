// POST /api/mobile/v1/auth/login — zelfde brute-force-regels als de weblogin
// (app/(auth)/actions.ts): per e-mail 10/15min, per IP 30/15min en een
// lockout op mislukte pogingen (8/15min) die ook een juist wachtwoord
// blokkeert zolang het venster vol is.

import { verifyCredentials } from "@/lib/auth";
import { createMobileSession } from "@/lib/mobile-auth";
import { peekRateLimit, rateLimit } from "@/lib/rate-limit";
import {
  clientIp,
  foutRespons,
  leesJson,
  okRespons,
  rateLimitRespons,
  vangFout,
} from "@/server/mobile/http";
import { loginSchema } from "@/server/mobile/schemas";
import { toMobileTokens } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

const KWARTIER = 15 * 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const invoer = loginSchema.parse(await leesJson(request));
    const email = invoer.email.toLowerCase().trim();
    const ip = clientIp(request);

    const [perEmail, perIp, mislukteLogins] = await Promise.all([
      rateLimit(`login:${email}`, { limit: 10, windowSeconds: KWARTIER }),
      rateLimit(`login-ip:${ip}`, { limit: 30, windowSeconds: KWARTIER }),
      peekRateLimit(`login-fail:${email}`, { limit: 8, windowSeconds: KWARTIER }),
    ]);
    if (!perEmail.allowed || !perIp.allowed || !mislukteLogins.allowed) {
      return rateLimitRespons(
        Math.max(
          perEmail.retryAfterSeconds,
          perIp.retryAfterSeconds,
          mislukteLogins.retryAfterSeconds,
        ),
      );
    }

    const user = await verifyCredentials(email, invoer.password);
    if (!user) {
      const naMislukking = await rateLimit(`login-fail:${email}`, {
        limit: 8,
        windowSeconds: KWARTIER,
      });
      if (!naMislukking.allowed) {
        return rateLimitRespons(naMislukking.retryAfterSeconds);
      }
      return foutRespons(401, "unauthorized", "E-mailadres of wachtwoord klopt niet");
    }

    const { tokens } = await createMobileSession(user.id, {
      deviceName: invoer.deviceName,
      platform: invoer.platform,
    });

    return okRespons({
      user: { id: user.id, email: user.email, name: user.name },
      tokens: toMobileTokens(tokens),
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
