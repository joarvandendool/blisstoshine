// GET /api/mobile/v1/privacy/overview — overzicht van bewaarde gegevens
// (AVG art. 15), zelfde bron als /instellingen/privacy.

import { requireUser } from "@/lib/authz";
import { gegevensOverzicht } from "@/server/privacy";
import { okRespons, vangFout } from "@/server/mobile/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser();
    const categories = await gegevensOverzicht(user.id);
    return okRespons({ categories });
  } catch (fout) {
    return vangFout(fout);
  }
}
