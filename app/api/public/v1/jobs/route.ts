// GET /api/public/v1/jobs — publieke vacaturelijst (fase 8).
// Alleen gepubliceerde vacatures; NOOIT kandidaatdata. Geen auth (publiek);
// rate limiting per IP; ETag + If-None-Match → 304; CDN-cache 5 minuten.
// Contract: docs/parallel/PUBLIC_READ_MODEL.md.

import type { NextResponse } from "next/server";
import { z } from "zod";
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
  updated_since: z
    .string()
    .refine((waarde) => !Number.isNaN(Date.parse(waarde)), {
      message: "updated_since moet een geldige ISO 8601-datum zijn",
    })
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});

export async function GET(verzoek: Request): Promise<NextResponse> {
  const geweigerd = await enforcePublicRateLimit(verzoek);
  if (geweigerd) return geweigerd;

  const url = new URL(verzoek.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return publicError(
      400,
      "invalid_request",
      parsed.error.errors[0]?.message ?? "Ongeldige queryparameters",
    );
  }

  try {
    const resultaat = await listPublicJobs({
      role: parsed.data.role,
      city: parsed.data.city,
      region: parsed.data.region,
      employmentType: parsed.data.employmentType,
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
