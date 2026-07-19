// GET /api/mobile/v1/me — sessieherstel: gebruiker + eigen profiel.
// profile.status stuurt de app-routering (draft → onboarding, active → app).

import { getOwnProfile } from "@/server/candidates";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toProfileView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { user, profile } = await getOwnProfile();
    return okRespons({
      user: { id: user.id, email: user.email, name: user.name },
      profile: profile ? toProfileView(profile) : null,
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
