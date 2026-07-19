// GET /api/mobile/v1/profile — eigen kandidaatprofiel.

import { getOwnProfile } from "@/server/candidates";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toProfileView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { profile } = await getOwnProfile();
    return okRespons({ profile: profile ? toProfileView(profile) : null });
  } catch (fout) {
    return vangFout(fout);
  }
}
