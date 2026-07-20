// GET /api/public/v1/jobs — publieke vacaturelijst (fase 8 + site-integratie).
// Alleen gepubliceerde vacatures; NOOIT kandidaatdata. Geen auth (publiek);
// rate limiting per IP; ETag + If-None-Match → 304; CDN-cache 5 minuten.
// Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import { z } from "zod";
import { WEEKDAYS, type Weekday } from "@/domain/taxonomy";
import {
  enforcePublicRateLimit,
  publicCacheResponse,
  publicError,
} from "@/server/public/http";
import { listPublicJobs, MAX_PAGE_SIZE } from "@/server/public/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  role: z.string().trim().min(1).max(100).optional(),
  city: z.string().trim().min(1).max(100).optional(),
  region: z.string().trim().min(1).max(100).optional(),
  employmentType: z.string().trim().min(1).max(100).optional(),
  equipment: z.string().trim().min(1).max(100).optional(),
  software: z.string().trim().min(1).max(100).optional(),
  specialization: z.string().trim().min(1).max(100).optional(),
  organization: z.string().trim().min(1).max(100).optional(),
  hoursMin: z.coerce.number().int().min(0).max(80).optional(),
  hoursMax: z.coerce.number().int().min(0).max(80).optional(),
  updated_since: z
    .string()
    .refine((waarde) => !Number.isNaN(Date.parse(waarde)), {
      message: "updated_since moet een geldige ISO 8601-datum zijn",
    })
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

// Herhaalbare parameter: ?day=di&day=do — de vacature moet ál deze dagen
// vragen (zelfde semantiek als de filterbalk van de openbare site).
const daySchema = z.array(z.enum(WEEKDAYS)).max(7);

export async function GET(verzoek: Request): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  const url = new URL(verzoek.url);
  // Object.fromEntries verliest herhaalde parameters; day apart uitlezen.
  const { day: _dag, ...enkelvoudig } = Object.fromEntries(url.searchParams);
  void _dag;
  const parsed = querySchema.safeParse(enkelvoudig);
  const dagen = daySchema.safeParse(url.searchParams.getAll("day"));
  if (!parsed.success) {
    return publicError(
      400,
      "invalid_request",
      parsed.error.errors[0]?.message ?? "Ongeldige queryparameters",
    );
  }
  if (!dagen.success) {
    return publicError(
      400,
      "invalid_request",
      "day moet een geldige weekdag zijn (ma|di|wo|do|vr|za|zo)",
    );
  }

  try {
    const resultaat = await listPublicJobs({
      role: parsed.data.role,
      city: parsed.data.city,
      region: parsed.data.region,
      days: dagen.data.length > 0 ? (dagen.data as Weekday[]) : undefined,
      hoursMin: parsed.data.hoursMin,
      hoursMax: parsed.data.hoursMax,
      employmentType: parsed.data.employmentType,
      equipment: parsed.data.equipment,
      software: parsed.data.software,
      specialization: parsed.data.specialization,
      organization: parsed.data.organization,
      updatedSince: parsed.data.updated_since
        ? new Date(parsed.data.updated_since)
        : undefined,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return publicCacheResponse(verzoek, resultaat);
  } catch (fout) {
    console.error("Publieke vacaturelijst mislukt:", fout);
    return publicError(500, "internal_error", "Er ging iets mis. Probeer het later opnieuw.");
  }
}
