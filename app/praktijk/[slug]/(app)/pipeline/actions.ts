"use server";

// Server actions van de praktijk-pipeline:
// - gesprek voorstellen (max 3 datumtijd-velden in de UI, service staat 5 toe)
// - aanbod doen / aannemen (setPipelineStatus)
// - afwijzen met verplichte redencode + optionele toelichting
//
// Elke actie begint bij getOrgForUserBySlug met capability pipeline.manage
// (tenantisolatie); de servicelaag verzorgt journaal, feedback, notificaties
// en analytics.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { getOrgForUserBySlug } from "@/server/organizations";
import { setPipelineStatus } from "@/server/applications";
import {
  FEEDBACK_REASON_CODES,
  proposeInterview,
  type InterviewSlotInput,
} from "@/server/pipeline";

function herlaad(slug: string): void {
  revalidatePath(`/praktijk/${slug}/pipeline`);
  revalidatePath(`/praktijk/${slug}`);
}

// ---------------------------------------------------------------------------
// Gesprek voorstellen
// ---------------------------------------------------------------------------

const gesprekSchema = z.object({
  vacancyId: z.string().min(1),
  candidateUserId: z.string().min(1),
  duurMinuten: z.coerce.number().int().min(10).max(480).default(45),
});

export async function stelGesprekVoorAction(
  slug: string,
  vacancyId: string,
  candidateUserId: string,
  formData: FormData,
): Promise<void> {
  const parsed = gesprekSchema.safeParse({
    vacancyId,
    candidateUserId,
    duurMinuten: formData.get("duurMinuten")?.toString() ?? "45",
  });
  if (!parsed.success) return;

  // Maximaal drie datumtijd-velden; lege velden worden overgeslagen.
  const slots: InterviewSlotInput[] = [];
  for (const veld of ["slot1", "slot2", "slot3"]) {
    const waarde = formData.get(veld)?.toString().trim();
    if (!waarde) continue;
    const start = new Date(waarde);
    if (Number.isNaN(start.getTime())) continue;
    slots.push({ startsAt: start, durationMinutes: parsed.data.duurMinuten });
  }
  if (slots.length === 0) return;

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "pipeline.manage");
    await proposeInterview(
      ctx,
      parsed.data.vacancyId,
      parsed.data.candidateUserId,
      slots,
    );
  } catch (fout) {
    // Ongeldige invoer of race (kandidaat reageerde net): na revalidatie
    // toont de pagina de actuele stand — geen harde fout.
    if (!(fout instanceof AuthzError)) throw fout;
  }
  herlaad(slug);
}

// ---------------------------------------------------------------------------
// Aanbod doen / aannemen
// ---------------------------------------------------------------------------

export async function zetStatusAction(
  slug: string,
  vacancyId: string,
  candidateUserId: string,
  naar: "offer" | "hired",
): Promise<void> {
  try {
    const { ctx } = await getOrgForUserBySlug(slug, "pipeline.manage");
    await setPipelineStatus(ctx, vacancyId, candidateUserId, naar);
  } catch (fout) {
    if (!(fout instanceof AuthzError)) throw fout;
  }
  herlaad(slug);
}

// ---------------------------------------------------------------------------
// Afwijzen (verplichte redencode)
// ---------------------------------------------------------------------------

const afwijsSchema = z.object({
  reasonCode: z.enum(FEEDBACK_REASON_CODES),
  note: z.string().trim().max(500).optional(),
});

export async function wijsAfAction(
  slug: string,
  vacancyId: string,
  candidateUserId: string,
  formData: FormData,
): Promise<void> {
  const parsed = afwijsSchema.safeParse({
    reasonCode: formData.get("reasonCode")?.toString(),
    note: formData.get("note")?.toString() ?? "",
  });
  if (!parsed.success) return; // de select is verplicht in de UI

  try {
    const { ctx } = await getOrgForUserBySlug(slug, "pipeline.manage");
    await setPipelineStatus(ctx, vacancyId, candidateUserId, "rejected", {
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note || undefined,
    });
  } catch (fout) {
    if (!(fout instanceof AuthzError)) throw fout;
  }
  herlaad(slug);
}
