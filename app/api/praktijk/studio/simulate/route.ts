// Simulatie-endpoint van de Match Studio.
// POST { slug, vacancyId, overrides } → de doorgerekende kandidatenpool met
// per kandidaat de delta t.o.v. de basis (simulateVacancyPool rekent op een
// kopie; er wordt hier nooit iets opgeslagen).
//
// AUTORISATIE (kritiek voor tenantisolatie):
// - de organisatie wordt uitsluitend bepaald via getOrgForUserBySlug — het
//   geverifieerde membership van de ingelogde gebruiker, nooit client-input;
// - de vacature wordt in de servicelaag op ctx.organizationId gescoped: een
//   vacancyId van een andere organisatie geeft 404, nooit data;
// - de entitlement match_studio_full wordt afgedwongen via @/lib/billing.

import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { assertSameOrigin } from "@/lib/security";
import { EntitlementError, enforceEntitlement } from "@/lib/billing";
import { getOrgForUserBySlug } from "@/server/organizations";
import {
  simulateVacancyPool,
  type SimulationOverrides,
} from "@/server/matching";
import type { VacancySchedule } from "@/domain/taxonomy";
import type { CategoryScores, MatchLabel } from "@/domain/matching";

// ---------------------------------------------------------------------------
// Wire-contract — de client (studio.tsx) importeert deze types type-only.
// Privacy: alleen het profiel-cuid als sleutel; namen kent de client al uit
// de initiële serverrender en gaan hier dus niet opnieuw over de lijn.
// ---------------------------------------------------------------------------

export interface SimulatieKandidaatWire {
  profileId: string;
  /** Gesimuleerde score (0–100). */
  score: number;
  label: MatchLabel;
  eligible: boolean;
  /** Gesimuleerde score minus basisscore. */
  scoreDelta: number;
  /** true wanneer de kandidaat door de simulatie matchbaar wordt. */
  becameEligible: boolean;
  categoryScores: CategoryScores;
  /** Belangrijkste sterke punt in de gesimuleerde situatie. */
  topStrength: string | null;
  summary: string;
}

export interface SimulatiePoolWire {
  kandidaten: SimulatieKandidaatWire[];
  baseEligibleCount: number;
  simulatedEligibleCount: number;
  /** Extra matchbare kandidaten dankzij de simulatie (kan negatief zijn). */
  extraEligibleCount: number;
}

export interface SimulatieFoutWire {
  fout: string;
  /** Alleen gezet bij 402 (EntitlementError). */
  upgradeHint?: string;
}

// ---------------------------------------------------------------------------
// Zod-validatie — exact het VacancySchedule-contract uit de taxonomie.
// ---------------------------------------------------------------------------

const eisSchema = z.union([
  z.literal("required"),
  z.literal("preferred"),
  z.null(),
]);

const dagSchema = z.object({
  ochtend: eisSchema,
  middag: eisSchema,
  avond: eisSchema,
});

const roosterSchema = z.object({
  ma: dagSchema,
  di: dagSchema,
  wo: dagSchema,
  do: dagSchema,
  vr: dagSchema,
  za: dagSchema,
  zo: dagSchema,
});

const verzoekSchema = z.object({
  slug: z.string().min(1, "Praktijk ontbreekt"),
  vacancyId: z.string().min(1, "Vacature ontbreekt"),
  overrides: z
    .object({
      schedule: roosterSchema.optional(),
      hoursMin: z.number().int().min(0).max(80).optional(),
      hoursMax: z.number().int().min(0).max(80).optional(),
      mentorship: z.boolean().optional(),
    })
    .refine(
      (o) =>
        o.hoursMin === undefined ||
        o.hoursMax === undefined ||
        o.hoursMin <= o.hoursMax,
      { message: "Het minimum aantal uren mag niet boven het maximum liggen" },
    ),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(verzoek: Request): Promise<NextResponse> {
  // CSRF: muterend cookie-endpoint — alleen eigen origin (src/lib/security.ts).
  try {
    assertSameOrigin(verzoek);
  } catch (fout) {
    if (fout instanceof AuthzError) {
      return NextResponse.json<SimulatieFoutWire>(
        { fout: fout.message },
        { status: fout.status },
      );
    }
    throw fout;
  }

  let body: unknown;
  try {
    body = await verzoek.json();
  } catch {
    return NextResponse.json<SimulatieFoutWire>(
      { fout: "Ongeldige aanvraag (geen geldige JSON)" },
      { status: 400 },
    );
  }

  const parsed = verzoekSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json<SimulatieFoutWire>(
      { fout: parsed.error.errors[0]?.message ?? "Ongeldige invoer" },
      { status: 400 },
    );
  }

  try {
    // Tenantisolatie: membership + capability verifiëren vóór álles.
    const { ctx } = await getOrgForUserBySlug(parsed.data.slug, "vacancy.manage");

    // Simuleren is onderdeel van de volledige Match Studio.
    await enforceEntitlement(ctx.organizationId, "match_studio_full");

    const overrides: SimulationOverrides = {
      ...(parsed.data.overrides.schedule !== undefined
        ? { schedule: parsed.data.overrides.schedule as VacancySchedule }
        : {}),
      ...(parsed.data.overrides.hoursMin !== undefined
        ? { hoursMin: parsed.data.overrides.hoursMin }
        : {}),
      ...(parsed.data.overrides.hoursMax !== undefined
        ? { hoursMax: parsed.data.overrides.hoursMax }
        : {}),
      ...(parsed.data.overrides.mentorship !== undefined
        ? { mentorship: parsed.data.overrides.mentorship }
        : {}),
    };

    const resultaat = await simulateVacancyPool(
      ctx,
      parsed.data.vacancyId,
      overrides,
    );

    const pool: SimulatiePoolWire = {
      kandidaten: resultaat.entries.map((entry) => ({
        profileId: entry.profile.id,
        score: entry.simulated.score,
        label: entry.simulated.label,
        eligible: entry.simulated.eligible,
        scoreDelta: entry.scoreDelta,
        becameEligible: entry.becameEligible,
        categoryScores: entry.simulated.categoryScores,
        topStrength: entry.simulated.strengths[0]?.message ?? null,
        summary: entry.simulated.summary,
      })),
      baseEligibleCount: resultaat.baseEligibleCount,
      simulatedEligibleCount: resultaat.simulatedEligibleCount,
      extraEligibleCount: resultaat.extraEligibleCount,
    };

    return NextResponse.json(pool);
  } catch (fout) {
    if (fout instanceof EntitlementError) {
      return NextResponse.json<SimulatieFoutWire>(
        { fout: fout.message, upgradeHint: fout.upgradeHint },
        { status: 402 },
      );
    }
    if (fout instanceof AuthzError) {
      return NextResponse.json<SimulatieFoutWire>(
        { fout: fout.message },
        { status: fout.status },
      );
    }
    console.error("Match Studio-simulatie mislukt:", fout);
    return NextResponse.json<SimulatieFoutWire>(
      { fout: "De simulatie is niet gelukt. Probeer het opnieuw." },
      { status: 500 },
    );
  }
}
