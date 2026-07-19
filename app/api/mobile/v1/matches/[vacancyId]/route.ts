// GET /api/mobile/v1/matches/:vacancyId — uitlegbaar matchdetail voor één
// gepubliceerde vacature, inclusief eigen sollicitatie-/uitnodigingsstatus.
// 410 wanneer de vacature niet meer open is (ooit gepubliceerd), 404 anders.

import { AuthzError, requireCandidate } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { track } from "@/lib/analytics";
import { computeMatchWithOpportunities } from "@/domain/opportunity";
import { profileToMatchCandidate } from "@/server/candidates";
import { vacancyToMatchVacancy } from "@/server/vacancies";
import { foutRespons, okRespons, vangFout } from "@/server/mobile/http";
import { toMatchDetail } from "@/server/mobile/views";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vacancyId: string }> },
): Promise<Response> {
  try {
    const { user, profile } = await requireCandidate();
    if (!profile) {
      throw new AuthzError("Rond eerst je profiel af om matches te zien", 403);
    }
    const { vacancyId } = await params;

    const vacature = await prisma.vacancy.findFirst({
      where: {
        OR: [{ id: vacancyId }, { slug: vacancyId }],
        organization: { status: "active" },
      },
      include: { location: true, organization: { select: { name: true } } },
    });
    if (!vacature || vacature.status === "draft" || vacature.publishedAt === null) {
      throw new AuthzError("Vacature niet gevonden", 404);
    }
    if (vacature.status !== "published") {
      return foutRespons(410, "gone", "Deze vacature is niet meer beschikbaar.");
    }

    const resultaat = computeMatchWithOpportunities(
      profileToMatchCandidate(profile),
      vacancyToMatchVacancy(vacature, vacature.location),
    );

    const [sollicitatie, uitnodiging] = await Promise.all([
      prisma.application.findUnique({
        where: {
          vacancyId_candidateUserId: {
            vacancyId: vacature.id,
            candidateUserId: user.id,
          },
        },
        select: { id: true, status: true, createdAt: true },
      }),
      prisma.invitation.findUnique({
        where: {
          vacancyId_candidateUserId: {
            vacancyId: vacature.id,
            candidateUserId: user.id,
          },
        },
        select: { id: true, status: true },
      }),
    ]);

    // Zelfde analytics-event als de webweergave; fire-and-forget.
    void track("match_viewed", {
      userId: user.id,
      candidateId: profile.id,
      organizationId: vacature.organizationId,
      locationId: vacature.locationId,
      context: { vacancyId: vacature.id, score: resultaat.score, bron: "mobiel" },
    });

    const { organization, location, ...vacatureRest } = vacature;
    return okRespons({
      match: toMatchDetail(
        {
          vacancy: vacatureRest,
          location,
          organizationName: organization.name,
          result: resultaat,
        },
        { application: sollicitatie, invitation: uitnodiging },
      ),
    });
  } catch (fout) {
    return vangFout(fout);
  }
}
