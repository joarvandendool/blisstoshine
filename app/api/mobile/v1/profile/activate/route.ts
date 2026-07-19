// POST /api/mobile/v1/profile/activate — profiel activeren na onboarding.

import { activateProfile } from "@/server/candidates";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toProfileView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const profiel = await activateProfile();
    return okRespons({ profile: toProfileView(profiel) });
  } catch (fout) {
    return vangFout(fout);
  }
}
