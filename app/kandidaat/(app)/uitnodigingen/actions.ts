"use server";

// Server actions van de uitnodigingen-pagina van de kandidaat:
// - interesse tonen (met expliciete consent-keuze voor naam + contactgegevens)
// - afwijzen met optionele gestructureerde reden
// - een voorgesteld gespreksmoment bevestigen (→ bevestigingsscherm)
//
// Autorisatie en domeinregels (eigen uitnodiging/gesprek, journaal, feedback,
// notificaties, analytics) zitten in de servicelaag.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthzError, requireCandidate } from "@/lib/authz";
import { respondToInvitation } from "@/server/invitations";
import { confirmInterview, FEEDBACK_REASON_CODES } from "@/server/pipeline";

function herlaad(): void {
  revalidatePath("/kandidaat/uitnodigingen");
  revalidatePath("/kandidaat");
}

export async function toonInteresseAction(
  invitationId: string,
  formData: FormData,
): Promise<void> {
  await requireCandidate();
  const deelContact = formData.get("deelContact") === "ja";
  try {
    await respondToInvitation(invitationId, {
      accepted: true,
      shareContact: deelContact,
    });
  } catch (fout) {
    // Al beantwoord of verdwenen: na revalidatie toont de pagina de actuele
    // stand — geen harde fout richting de kandidaat.
    if (!(fout instanceof AuthzError)) throw fout;
  }
  herlaad();
}

const afwijsSchema = z.object({
  reasonCode: z.enum(FEEDBACK_REASON_CODES).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function wijsUitnodigingAfAction(
  invitationId: string,
  formData: FormData,
): Promise<void> {
  await requireCandidate();
  const parsed = afwijsSchema.safeParse({
    reasonCode: formData.get("reasonCode")?.toString() || undefined,
    note: formData.get("note")?.toString() ?? "",
  });
  try {
    await respondToInvitation(invitationId, {
      accepted: false,
      reasonCode: parsed.success ? parsed.data.reasonCode : undefined,
      note: parsed.success ? parsed.data.note || undefined : undefined,
    });
  } catch (fout) {
    if (!(fout instanceof AuthzError)) throw fout;
  }
  herlaad();
}

export async function bevestigGesprekAction(
  interviewId: string,
  formData: FormData,
): Promise<void> {
  await requireCandidate();
  const gekozen = formData.get("slot")?.toString();
  if (!gekozen) return;

  try {
    await confirmInterview(interviewId, gekozen);
  } catch (fout) {
    if (fout instanceof AuthzError) {
      herlaad();
      return;
    }
    throw fout;
  }

  herlaad();
  redirect(`/kandidaat/uitnodigingen/bevestigd?gesprek=${interviewId}`);
}
