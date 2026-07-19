// POST/DELETE /api/mobile/v1/push-tokens — registratie en verwijdering van
// Expo-pushtokens, gekoppeld aan de mobiele sessie zodat uitloggen ze
// automatisch opruimt. Upsert = idempotent; rotatie (nieuw token, zelfde
// apparaat/sessie) vervangt het oude token.

import { prisma } from "@/lib/db";
import { requireMobileSession } from "@/server/mobile/context";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { pushTokenDeleteSchema, pushTokenSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    const invoer = pushTokenSchema.parse(await leesJson(request));

    // Tokenrotatie: één actueel token per sessie — oude tokens van deze
    // sessie verdwijnen zodra er een nieuw token wordt geregistreerd.
    await prisma.mobilePushToken.deleteMany({
      where: { sessionId: ctx.sessionId, token: { not: invoer.token } },
    });
    await prisma.mobilePushToken.upsert({
      where: { token: invoer.token },
      create: {
        userId: ctx.user.id,
        sessionId: ctx.sessionId,
        token: invoer.token,
        platform: invoer.platform,
      },
      update: { userId: ctx.user.id, sessionId: ctx.sessionId },
    });
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    const invoer = pushTokenDeleteSchema.parse(await leesJson(request));
    await prisma.mobilePushToken.deleteMany({
      where: { token: invoer.token, userId: ctx.user.id },
    });
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
