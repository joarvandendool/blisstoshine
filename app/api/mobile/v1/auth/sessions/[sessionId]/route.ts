// DELETE /api/mobile/v1/auth/sessions/:id — trekt een ANDERE eigen sessie in
// (bv. verloren toestel). Eigendom wordt server-side afgedwongen.

import { prisma } from "@/lib/db";
import { AuthzError } from "@/lib/authz";
import { revokeMobileSession } from "@/lib/mobile-auth";
import { requireMobileSession } from "@/server/mobile/context";
import { okRespons, vangFout } from "@/server/mobile/http";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  try {
    const ctx = await requireMobileSession(request);
    const { sessionId } = await params;

    const sessie = await prisma.mobileSession.findFirst({
      where: { id: sessionId, userId: ctx.user.id },
      select: { id: true },
    });
    if (!sessie) throw new AuthzError("Sessie niet gevonden", 404);

    await revokeMobileSession(sessie.id, "logout");
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
