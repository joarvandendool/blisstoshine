"use server";

// Server actions van Team & locaties:
// - nodigLidUitAction: bestaande platformgebruiker (op e-mail) toevoegen met
//   rol en optionele locatietoewijzing (capability members.manage);
// - wijzigLidAction / deactiveerLidAction: rol/locaties wijzigen, lid
//   deactiveren;
// - voegLocatieToeAction / bewerkLocatieAction: locatie-CRUD (capability
//   location.manage; max_locations-entitlement wordt in de servicelaag
//   afgedwongen en hier als nette melding teruggegeven).
//
// Elke actie begint bij getOrgForUserBySlug (geverifieerd membership =
// tenantisolatie). Alle invoer wordt eerst met Zod gevalideerd.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import {
  MEMBER_ROLES,
  addLocation,
  deactivateMember,
  getOrgForUserBySlug,
  inviteMember,
  updateLocation,
  updateMember,
} from "@/server/organizations";

export type ActieResultaat =
  | { ok: true }
  | { ok: false; fout: string; upgradeHint?: string };

const rolSchema = z.enum(MEMBER_ROLES, {
  errorMap: () => ({ message: "Kies een rol uit de lijst" }),
});

const uitnodigSchema = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in"),
  role: rolSchema,
  locationIds: z.array(z.string().min(1)).max(50),
});

const wijzigSchema = z.object({
  membershipId: z.string().min(1, "Lid onbekend"),
  role: rolSchema,
  locationIds: z.array(z.string().min(1)).max(50),
});

const locatieSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Vul een naam in").max(120),
  postcode: z
    .string()
    .trim()
    .regex(/^\d{4}\s?[A-Za-z]{2}$/, "Vul een geldige postcode in (bv. 3511 AB)"),
  city: z.string().trim().max(80).optional(),
  street: z.string().trim().max(120).optional(),
  houseNumber: z.string().trim().max(12).optional(),
  phone: z.string().trim().max(20).optional(),
  treatmentRooms: z.number().int().min(1, "Minimaal 1 kamer").max(50),
});

function naarResultaat(fout: unknown, standaard: string): ActieResultaat {
  if (fout instanceof EntitlementError) {
    return { ok: false, fout: fout.message, upgradeHint: fout.upgradeHint };
  }
  if (fout instanceof AuthzError) return { ok: false, fout: fout.message };
  console.error(standaard, fout);
  return { ok: false, fout: standaard };
}

/** Lid uitnodigen op e-mailadres van een bestaande gebruiker. */
export async function nodigLidUitAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = uitnodigSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "members.manage");
    await inviteMember(ctx, parsed.data.email, parsed.data.role, parsed.data.locationIds);
    revalidatePath(`/praktijk/${slug}/team`);
    return { ok: true };
  } catch (fout) {
    return naarResultaat(fout, "Uitnodigen is niet gelukt. Probeer het opnieuw.");
  }
}

/** Rol en locatietoewijzing van een lid wijzigen. */
export async function wijzigLidAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = wijzigSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "members.manage");
    await updateMember(ctx, parsed.data.membershipId, {
      role: parsed.data.role,
      locationIds: parsed.data.locationIds,
    });
    revalidatePath(`/praktijk/${slug}/team`);
    return { ok: true };
  } catch (fout) {
    return naarResultaat(fout, "Wijzigen is niet gelukt. Probeer het opnieuw.");
  }
}

/** Lid deactiveren (membership wordt ingetrokken). */
export async function deactiveerLidAction(
  slug: string,
  membershipId: string,
): Promise<ActieResultaat> {
  if (!membershipId) return { ok: false, fout: "Lid onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "members.manage");
    await deactivateMember(ctx, membershipId);
    revalidatePath(`/praktijk/${slug}/team`);
    return { ok: true };
  } catch (fout) {
    return naarResultaat(fout, "Deactiveren is niet gelukt. Probeer het opnieuw.");
  }
}

/** Locatie toevoegen (max_locations-entitlement in de servicelaag). */
export async function voegLocatieToeAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = locatieSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await addLocation(ctx, {
      name: parsed.data.name,
      postcode: parsed.data.postcode,
      city: parsed.data.city,
      street: parsed.data.street,
      houseNumber: parsed.data.houseNumber,
      phone: parsed.data.phone,
      treatmentRooms: parsed.data.treatmentRooms,
    });
    revalidatePath(`/praktijk/${slug}/team`);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    return naarResultaat(fout, "De locatie is niet toegevoegd. Probeer het opnieuw.");
  }
}

/** Locatie bewerken. */
export async function bewerkLocatieAction(
  slug: string,
  invoer: unknown,
): Promise<ActieResultaat> {
  const parsed = locatieSchema.safeParse(invoer);
  if (!parsed.success) {
    return { ok: false, fout: parsed.error.errors[0]?.message ?? "Controleer je invoer" };
  }
  if (!parsed.data.id) return { ok: false, fout: "Locatie onbekend" };
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "location.manage");
    await updateLocation(ctx, parsed.data.id, {
      name: parsed.data.name,
      postcode: parsed.data.postcode,
      city: parsed.data.city,
      street: parsed.data.street,
      houseNumber: parsed.data.houseNumber,
      phone: parsed.data.phone,
      treatmentRooms: parsed.data.treatmentRooms,
    });
    revalidatePath(`/praktijk/${slug}/team`);
    revalidatePath(`/praktijk/${slug}/bezetting`);
    return { ok: true };
  } catch (fout) {
    return naarResultaat(fout, "De locatie is niet bijgewerkt. Probeer het opnieuw.");
  }
}
