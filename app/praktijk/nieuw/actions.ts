"use server";

// Server action voor de praktijk-start (organisatie aanmaken).
//
// Regels:
// - de actie begint met requireUser (autorisatie uit @/lib/authz);
// - alle invoer wordt met Zod gevalideerd tegen de taxonomie voordat de
//   servicelaag (createOrganizationWithLocation) wordt aangeroepen;
// - analytics (organization_created / location_created) en het starten van het
//   trial-abonnement gebeuren in de servicelaag — hier niets dubbel doen.

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthzError, requireUser } from "@/lib/authz";
import { createOrganizationWithLocation } from "@/server/organizations";
import {
  CULTURE,
  EQUIPMENT,
  PATIENT_POPULATION,
  SOFTWARE,
  SPECIALIZATIONS,
} from "@/domain/taxonomy";

/** Resultaat richting de client; bij succes wordt geredirect en komt er niets terug. */
export type PraktijkStartResultaat = { ok: false; fout: string };

const POSTCODE_PATROON = /^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/;
const KVK_PATROON = /^[0-9]{8}$/;

const praktijkSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Vul de naam van je praktijk in")
    .max(120, "De praktijknaam is te lang"),
  kvkNumber: z
    .string()
    .trim()
    .regex(KVK_PATROON, "Een KvK-nummer bestaat uit 8 cijfers")
    .nullable(),
  locationName: z
    .string()
    .trim()
    .max(120, "De locatienaam is te lang")
    .nullable(),
  street: z.string().trim().max(120, "De straatnaam is te lang").nullable(),
  houseNumber: z.string().trim().max(10, "Controleer het huisnummer").nullable(),
  postcode: z
    .string()
    .trim()
    .regex(POSTCODE_PATROON, "Vul een geldige postcode in, bijvoorbeeld 3511 AB"),
  city: z.string().trim().min(2, "Vul de plaatsnaam in").max(80, "De plaatsnaam is te lang"),
  phone: z.string().trim().max(20, "Controleer het telefoonnummer").nullable(),
  treatmentRooms: z
    .number({ invalid_type_error: "Kies het aantal behandelkamers" })
    .int()
    .min(1, "Minimaal 1 behandelkamer")
    .max(50, "Controleer het aantal behandelkamers"),
  traits: z.array(z.enum(CULTURE)),
  equipment: z.array(z.enum(EQUIPMENT)),
  software: z.array(z.enum(SOFTWARE)),
  specializations: z.array(z.enum(SPECIALIZATIONS)),
  patientPopulation: z.array(z.enum(PATIENT_POPULATION)),
});

/**
 * Maakt de praktijkorganisatie met eerste locatie aan (owner-membership +
 * trial-abonnement via de servicelaag) en stuurt door naar het dashboard.
 */
export async function maakPraktijkAction(
  invoer: unknown,
): Promise<PraktijkStartResultaat> {
  let slug: string;
  try {
    await requireUser();

    const parsed = praktijkSchema.safeParse(invoer);
    if (!parsed.success) {
      return {
        ok: false,
        fout: parsed.error.errors[0]?.message ?? "Controleer je invoer",
      };
    }
    const d = parsed.data;

    const { organization } = await createOrganizationWithLocation({
      name: d.name,
      kvkNumber: d.kvkNumber ?? undefined,
      location: {
        name: d.locationName ?? undefined,
        street: d.street ?? undefined,
        houseNumber: d.houseNumber ?? undefined,
        postcode: d.postcode.toUpperCase(),
        city: d.city,
        phone: d.phone ?? undefined,
        treatmentRooms: d.treatmentRooms,
        traits: d.traits,
        equipment: d.equipment,
        software: d.software,
        specializations: d.specializations,
        patientPopulation: d.patientPopulation,
      },
    });
    slug = organization.slug;
  } catch (fout) {
    if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
    console.error("Praktijk aanmaken mislukt:", fout);
    return {
      ok: false,
      fout: "Het aanmaken van je praktijk is niet gelukt. Probeer het opnieuw.",
    };
  }
  redirect(`/praktijk/${slug}`);
}
