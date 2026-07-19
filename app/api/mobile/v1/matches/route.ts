// GET /api/mobile/v1/matches — persoonlijke matchfeed. Het volledige
// MatchResult (score, uitleg, kansen) komt van de server; de app rekent niets.

import { AuthzError, requireCandidate } from "@/lib/authz";
import { matchesForCandidate } from "@/server/matching";
import { okRespons, vangFout } from "@/server/mobile/http";
import { toMatchListItem } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { profile } = await requireCandidate();
    if (!profile || profile.status !== "active") {
      throw new AuthzError("Rond eerst je profiel af om matches te zien", 403);
    }
    const matches = await matchesForCandidate(profile);
    return okRespons({ matches: matches.map(toMatchListItem) });
  } catch (fout) {
    return vangFout(fout);
  }
}
