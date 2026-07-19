// Client-events-endpoint: POST /api/events.
//
// Alleen een BEPERKTE allowlist van client-side events wordt geaccepteerd —
// alle andere events worden uitsluitend server-side getrackt bij de
// handeling zelf. Twee takken:
//
// 1. INGELOGDE events (paywall_viewed, plan_compared, opportunity_viewed,
//    match_viewed) — requireUser; organizationId alleen na
//    membership-verificatie; plan server-side bepaald.
// 2. PUBLIEKE events (PUBLIC_EVENTS uit het domein: public_page_viewed,
//    public_job_viewed, public_apply_clicked, public_register_clicked) —
//    ANONIEM (fase 11): geen requireUser, géén userId in het event, wel
//    rate-limited per IP (in-memory teller). Privacy: het IP wordt
//    uitsluitend kortstondig in het geheugen gebruikt voor de limiet en
//    NOOIT in het event opgeslagen; context is een gesloten set
//    (geclassificeerde bron + categorische route/rol/regio), geen
//    referrer-URL's en geen vrije identifiers.
//
// Analytics faalt nooit hard richting het product, maar dit endpoint geeft
// wél nette statuscodes terug zodat misbruik (andermans organizationId,
// onbekende events, flooding) zichtbaar geweigerd wordt.

import { NextResponse } from "next/server";
import { z } from "zod";
import { PUBLIC_EVENTS, type PublicEvent } from "@/domain/analytics";
import { AuthzError, requireMembership, requireUser } from "@/lib/authz";
import { track } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { PUBLIC_BRONNEN } from "@/public-site/attribution";
import { planCodeVoorAnalytics } from "@/server/organizations";

// ---------------------------------------------------------------------------
// Allowlist + validatie
// ---------------------------------------------------------------------------

/** Client-events die een ingelogde gebruiker vereisen. */
const CLIENT_EVENT_ALLOWLIST = [
  "paywall_viewed",
  "plan_compared",
  "opportunity_viewed",
  "match_viewed",
] as const;

const PUBLIC_EVENT_SET: ReadonlySet<string> = new Set(PUBLIC_EVENTS);

const contextWaardeSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
]);

const verzoekSchema = z
  .object({
    name: z.enum(
      [...CLIENT_EVENT_ALLOWLIST, ...PUBLIC_EVENTS] as [string, ...string[]],
      {
        errorMap: () => ({
          message: "Dit event mag niet vanuit de client worden gemeld",
        }),
      },
    ),
    organizationId: z.string().min(1).max(64).optional(),
    context: z.record(contextWaardeSchema).optional(),
  })
  .strict();

/**
 * Context van publieke events is een GESLOTEN set: geclassificeerde bron
 * (verplicht), plus categorische route/rol/regio. Geen vrije identifiers,
 * geen slugs, geen referrer-URL's.
 */
const publiekeContextSchema = z
  .object({
    bron: z.enum(PUBLIC_BRONNEN, {
      errorMap: () => ({ message: "Onbekende bron voor een publiek event" }),
    }),
    route_type: z
      .string()
      .max(40)
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    rol: z
      .string()
      .max(40)
      .regex(/^[a-z][a-z_]*$/)
      .optional(),
    regio: z.string().max(64).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Rate limit voor de anonieme tak (publieke events)
// ---------------------------------------------------------------------------
// Eenvoudige in-memory fixed-window-teller per IP. Het IP dient uitsluitend
// als tijdelijke telsleutel in het procesgeheugen en wordt nergens
// gepersisteerd of aan het event gekoppeld.

const PUBLIEK_LIMIET_PER_MINUUT = 60;
const PUBLIEK_VENSTER_MS = 60_000;
const PUBLIEK_MAX_SLEUTELS = 10_000;

const publiekeTeller = new Map<string, { count: number; reset: number }>();

function publiekRateLimited(verzoek: Request): boolean {
  const ip =
    verzoek.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    verzoek.headers.get("x-real-ip") ||
    "onbekend";
  const nu = Date.now();
  const bestaand = publiekeTeller.get(ip);
  if (!bestaand || bestaand.reset < nu) {
    // Grove opruiming zodat de map nooit onbegrensd groeit.
    if (publiekeTeller.size >= PUBLIEK_MAX_SLEUTELS) publiekeTeller.clear();
    publiekeTeller.set(ip, { count: 1, reset: nu + PUBLIEK_VENSTER_MS });
    return false;
  }
  bestaand.count += 1;
  return bestaand.count > PUBLIEK_LIMIET_PER_MINUUT;
}

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

  // ------------------------- anonieme, publieke tak -------------------------
  if (PUBLIC_EVENT_SET.has(name)) {
    if (organizationId !== undefined) {
      return NextResponse.json(
        { fout: "Publieke events dragen geen organisatie" },
        { status: 400 },
      );
    }
    const publiekeContext = publiekeContextSchema.safeParse(context ?? {});
    if (!publiekeContext.success) {
      return NextResponse.json(
        {
          fout:
            publiekeContext.error.errors[0]?.message ??
            "Ongeldige context voor een publiek event",
        },
        { status: 400 },
      );
    }
    if (publiekRateLimited(verzoek)) {
      return NextResponse.json(
        { fout: "Te veel events; probeer het later opnieuw" },
        { status: 429 },
      );
    }
    // Geen userId/candidateId: het event blijft anoniem. De geclassificeerde
    // bron gaat als acquisitionSource mee zodat de funnel
    // bron → registratie → activatie te leggen is.
    await track(name as PublicEvent, {
      acquisitionSource: publiekeContext.data.bron,
      context: publiekeContext.data,
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // -------------------------- ingelogde tak (as-is) --------------------------
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
    await track(name as (typeof CLIENT_EVENT_ALLOWLIST)[number], {
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
