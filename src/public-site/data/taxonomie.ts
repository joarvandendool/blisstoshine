// Gedeelde taxonomieweergave voor de openbare filterbalk. Puur uit code
// (src/domain/taxonomy) — geen database, geen netwerk. Gebruikt door alle
// PublicDataSource-implementaties (fixtures, direct én http-terugval).

import {
  CONTRACT_TYPES,
  DAYPARTS,
  EQUIPMENT,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  WEEKDAYS,
  label,
} from "@/domain/taxonomy";
import type { PublicTaxonomyView } from "./types";

export function taxonomieView(): PublicTaxonomyView {
  const naarTags = (keys: readonly string[]) =>
    keys.map((key) => ({ key, label: label(key) }));
  return {
    roles: naarTags(ROLES),
    // Stage is (nog) geen publieke contractvorm in de zoekfilters.
    employmentTypes: naarTags(CONTRACT_TYPES.filter((c) => c !== "stage")),
    equipment: naarTags(EQUIPMENT),
    software: naarTags(SOFTWARE),
    specializations: naarTags(SPECIALIZATIONS),
    days: naarTags(WEEKDAYS),
    dayparts: naarTags(DAYPARTS),
  };
}
