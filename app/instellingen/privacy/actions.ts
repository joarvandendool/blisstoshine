"use server";

// Server action van de privacypagina: account verwijderen (AVG art. 17).
// Twee-staps: de pagina toont het bevestigingsformulier pas na een expliciete
// eerste stap, en deze action eist bovendien het getypte woord "verwijderen".
// Server actions krijgen Next.js' ingebouwde Origin-bescherming (zie
// docs/OPERATIONS.md), dus geen extra CSRF-check nodig.

import { redirect } from "next/navigation";
import { AuthzError, requireUser } from "@/lib/authz";
import { clearSessionCookie } from "@/lib/auth";
import { revokeConsent } from "@/server/pipeline";
import { verwijderAccount } from "@/server/privacy";

/**
 * Trekt één eerder verleende toestemming in (AVG art. 7 lid 3). De pagina
 * toont eerst een expliciete bevestigingsstap; autorisatie (ingelogde
 * kandidaat), audit- en analyticsregel gebeuren in de servicelaag
 * (revokeConsent, src/server/pipeline.ts).
 */
export async function trekConsentInAction(formData: FormData): Promise<void> {
  const organizationId = formData.get("organizationId")?.toString().trim();
  const vacancyId = formData.get("vacancyId")?.toString().trim();
  if (!organizationId) redirect("/instellingen/privacy");

  try {
    await revokeConsent(organizationId, vacancyId || undefined);
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  redirect("/instellingen/privacy?ingetrokken=1");
}

export async function verwijderAccountAction(formData: FormData): Promise<void> {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  const bevestiging = formData.get("bevestiging")?.toString().trim().toLowerCase();
  if (bevestiging !== "verwijderen") {
    redirect("/instellingen/privacy?verwijderen=1&fout=bevestiging");
  }

  await verwijderAccount(user.id);
  await clearSessionCookie();
  redirect("/?account_verwijderd=1");
}
