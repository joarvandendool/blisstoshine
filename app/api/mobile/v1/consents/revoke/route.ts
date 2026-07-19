// POST /api/mobile/v1/consents/revoke — toestemming intrekken (idempotent).

import { revokeConsent } from "@/server/pipeline";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { consentRevokeSchema } from "@/server/mobile/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const invoer = consentRevokeSchema.parse(await leesJson(request));
    await revokeConsent(invoer.organizationId, invoer.vacancyId);
    return okRespons({ ok: true });
  } catch (fout) {
    return vangFout(fout);
  }
}
