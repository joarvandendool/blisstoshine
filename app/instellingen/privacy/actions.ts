"use server";

// Server action van de privacypagina: account verwijderen (AVG art. 17).
// Twee-staps: de pagina toont het bevestigingsformulier pas na een expliciete
// eerste stap, en deze action eist bovendien het getypte woord "verwijderen".
// Server actions krijgen Next.js' ingebouwde Origin-bescherming (zie
// docs/OPERATIONS.md), dus geen extra CSRF-check nodig.

import { redirect } from "next/navigation";
import { AuthzError, requireUser } from "@/lib/authz";
import { clearSessionCookie } from "@/lib/auth";
import { verwijderAccount } from "@/server/privacy";

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
