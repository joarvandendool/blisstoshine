// PUT /api/mobile/v1/profile/step — één onboarding-/profielstap opslaan.
// Zelfde semantiek als de webflow: alleen meegegeven velden overschrijven,
// arrays vervangen volledig; de server herberekent de volledigheidsscore.

import { saveProfileStep } from "@/server/candidates";
import { leesJson, okRespons, vangFout } from "@/server/mobile/http";
import { profileStepSchema } from "@/server/mobile/schemas";
import { toProfileView } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<Response> {
  try {
    const stap = profileStepSchema.parse(await leesJson(request));
    const profiel = await saveProfileStep({
      ...stap,
      availableFrom:
        stap.availableFrom === undefined
          ? undefined
          : stap.availableFrom === null
            ? null
            : new Date(stap.availableFrom),
    });
    return okRespons({ profile: toProfileView(profiel) });
  } catch (fout) {
    return vangFout(fout);
  }
}
