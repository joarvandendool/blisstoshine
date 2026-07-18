"use server";

// Server action voor het solliciteren op een vacature vanuit de matchdetail-
// pagina. Autorisatie en alle domeinregels (actief profiel, gepubliceerde
// vacature, geen dubbele sollicitatie, snapshot + analytics) zitten in de
// servicelaag (applyToVacancy); hier alleen invoervalidatie en nette
// Nederlandse foutafhandeling voor het formulier.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError, requireCandidate } from "@/lib/authz";
import { EntitlementError } from "@/lib/billing";
import { applyToVacancy } from "@/server/applications";

export type SolliciteerFormState =
  | { status: "gelukt" }
  | { status: "fout"; melding: string }
  | null;

const solliciteerSchema = z.object({
  vacancyId: z.string().min(1, "Vacature onbekend"),
  motivatie: z
    .string()
    .trim()
    .max(2000, "Je motivatie mag maximaal 2000 tekens zijn")
    .optional(),
});

export async function solliciteerAction(
  vacancyId: string,
  _vorige: SolliciteerFormState,
  formData: FormData,
): Promise<SolliciteerFormState> {
  await requireCandidate();

  const parsed = solliciteerSchema.safeParse({
    vacancyId,
    motivatie: formData.get("motivatie")?.toString() ?? "",
  });
  if (!parsed.success) {
    return {
      status: "fout",
      melding: parsed.error.errors[0]?.message ?? "Ongeldige invoer",
    };
  }

  try {
    await applyToVacancy(
      parsed.data.vacancyId,
      parsed.data.motivatie ? parsed.data.motivatie : undefined,
    );
  } catch (fout) {
    if (fout instanceof AuthzError || fout instanceof EntitlementError) {
      return { status: "fout", melding: fout.message };
    }
    console.error("Solliciteren mislukt:", fout);
    return {
      status: "fout",
      melding: "Er ging iets mis bij het versturen. Probeer het opnieuw.",
    };
  }

  // De detailpagina toont na revalidatie de sollicitatiestatus in plaats van
  // het formulier.
  revalidatePath(`/kandidaat/matches/${parsed.data.vacancyId}`);
  return { status: "gelukt" };
}
