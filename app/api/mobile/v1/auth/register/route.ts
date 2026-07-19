// POST /api/mobile/v1/auth/register — kandidaatregistratie vanuit de app.
// Zelfde regels als de webregistratie (app/(auth)/actions.ts): 5 per uur per
// IP, bestaand e-mailadres → nette fout. Levert direct een mobiele sessie op.

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { createMobileSession } from "@/lib/mobile-auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  clientIp,
  foutRespons,
  leesJson,
  okRespons,
  rateLimitRespons,
  vangFout,
} from "@/server/mobile/http";
import { registerSchema } from "@/server/mobile/schemas";
import { toMobileTokens } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const invoer = registerSchema.parse(await leesJson(request));

    const limiet = await rateLimit(`register:${clientIp(request)}`, {
      limit: 5,
      windowSeconds: 60 * 60,
    });
    if (!limiet.allowed) return rateLimitRespons(limiet.retryAfterSeconds);

    const bestaand = await prisma.user.findUnique({
      where: { email: invoer.email.toLowerCase().trim() },
      select: { id: true },
    });
    if (bestaand) {
      return foutRespons(
        409,
        "conflict",
        "Er bestaat al een account met dit e-mailadres",
      );
    }

    const user = await registerUser({
      name: invoer.name,
      email: invoer.email,
      password: invoer.password,
    });
    const { tokens } = await createMobileSession(user.id, {
      deviceName: invoer.deviceName,
      platform: invoer.platform,
    });

    return okRespons(
      {
        user: { id: user.id, email: user.email, name: user.name },
        tokens: toMobileTokens(tokens),
      },
      201,
    );
  } catch (fout) {
    return vangFout(fout);
  }
}
