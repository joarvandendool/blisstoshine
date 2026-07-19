// Vertaling van de zeven servercategoriescores naar de vijf MatchShape-
// dimensies — identiek aan shapeDimensies() op de webmatchdetailpagina.
// Puur presentatie: er wordt niets herberekend aan de score zelf.

import type { MatchResult } from "@mondzorgwerkt/api-contract";
import type { MatchShapeDimensions } from "@/components/MatchShape";

export function shapeDimensies(result: MatchResult): MatchShapeDimensions {
  const c = result.categoryScores;
  return {
    availability: c.availability / 100,
    location: c.travel / 100,
    content: c.specializations / 100,
    technology: c.equipmentAndSoftware / 100,
    culture: c.workplacePreferences / 100,
  };
}
