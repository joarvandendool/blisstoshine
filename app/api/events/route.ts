// Client-events-endpoint: POST /api/events.
//
// Alleen een BEPERKTE allowlist van client-side events wordt geaccepteerd
// (paywall_viewed, plan_compared, opportunity_viewed, match_viewed) — alle
// andere events worden uitsluitend server-side getrackt bij de handeling zelf.
//
// AUTORISATIE:
// - requireUser: zonder sessie geen event (401);
// - organizationId wordt ALLEEN doorgegeven na membership-verificatie
//   (requireMembership) — nooit rechtstreeks uit client-input;
// - het plan wordt server-side uit het abonnement bepaald, niet uit de body.
//
// Analytics faalt nooit hard richting het product, maar dit endpoint geeft
// wél nette statuscodes terug zodat misbruik (andermans organizationId,
// onbekende events) zichtbaar geweigerd wordt.

import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError, requireMembership, requireUser } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { planCodeVoorAnalytics } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Allowlist + validatie
// ---------------------------------------------------------------------------

/** De enige events die de client rechtstreeks mag melden. */
const CLIENT_EVENT_ALLOWLIST = [
  "paywall_viewed",
  "plan_compared",
  "opportunity_viewed",
  "match_viewed",
] as const;

const contextWaardeSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
]);

const verzoekSchema = z
  .object({
    name: z.enum(CLIENT_EVENT_ALLOWLIST, {
      errorMap: () => ({ message: "Dit event mag niet vanuit de client worden gemeld" }),
    }),
    organizationId: z.string().min(1).max(64).optional(),
    context: z.record(contextWaardeSchema).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(verzoek: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await verzoek.json();
  } catch {
    return NextResponse.json(
      { fout: "Ongeldige aanvraag (geen geldige JSON)" },
      { status: 400 },
    );
  }

  const parsed = verzoekSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fout: parsed.error.errors[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }
  const { name, organizationId, context } = parsed.data;

  try {
    const user = await requireUser();

    // organizationId gaat alleen mee na geverifieerd membership; het plan
    // wordt server-side bepaald. Zonder organisatie (bv. match_viewed door
    // een kandidaat) gaat het pseudonieme profiel-cuid mee als candidateId.
    let geverifieerdeOrgId: string | undefined;
    let plan: string | undefined;
    let candidateId: string | undefined;

    if (organizationId !== undefined) {
      await requireMembership(organizationId); // 403 zonder actief membership
      geverifieerdeOrgId = organizationId;
      plan = await planCodeVoorAnalytics(organizationId);
    } else {
      const profiel = await prisma.candidateProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      candidateId = profiel?.id;
    }

    // track() valideert de envelope opnieuw (PII-sleutels, primitieve context)
    // en faalt nooit hard.
    await track(name, {
      organizationId: geverifieerdeOrgId,
      userId: user.id,
      candidateId,
      plan,
      context,
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return NextResponse.json({ fout: fout.message }, { status: fout.status });
    }
    console.error("Client-event niet vastgelegd:", fout);
    return NextResponse.json(
      { fout: "Het event kon niet worden vastgelegd" },
      { status: 500 },
    );
  }
}
