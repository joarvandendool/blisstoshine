// Bevestigingsscherm na het kiezen van een gespreksmoment: MatchShape-viering
// met de matchscore, het bevestigde moment en de praktijkgegevens. Alleen
// bereikbaar voor het eigen, bevestigde gesprek (getOwnInterview).

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCandidate } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getOwnInterview } from "@/server/pipeline";
import { MatchShape } from "@/components/MatchShape";
import { Badge, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function GesprekBevestigdPagina({
  searchParams,
}: {
  searchParams: Promise<{ gesprek?: string }>;
}) {
  const { user } = await requireCandidate();
  const { gesprek } = await searchParams;
  if (!gesprek) redirect("/kandidaat/uitnodigingen");

  const interview = await getOwnInterview(gesprek);
  if (!interview || interview.status !== "confirmed" || !interview.chosenSlot) {
    notFound();
  }

  const vacature = await prisma.vacancy.findUnique({
    where: { id: interview.vacancyId },
    select: {
      title: true,
      location: { select: { city: true } },
      organization: { select: { name: true } },
    },
  });
  const snapshot = await prisma.matchSnapshot.findFirst({
    where: { vacancyId: interview.vacancyId, candidateUserId: user.id },
    orderBy: { createdAt: "desc" },
    select: { score: true },
  });

  const wanneer = interview.chosenSlot.toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col gap-10">
      <Card strong className="flex flex-col items-center gap-4 py-10 text-center">
        <MatchShape score={snapshot?.score ?? 100} size="hero" showScore={false} />
        <Badge tone="roze">Gesprek bevestigd</Badge>
        <div className="flex max-w-xl flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Jullie gaan{" "}
            <em className="font-serif italic font-bold text-blauw-600">
              kennismaken
            </em>
          </h1>
          <p className="text-[16px] leading-relaxed text-ink/80">
            Je gesprek{vacature ? ` met ${vacature.organization.name}` : ""}
            {vacature ? ` over “${vacature.title}”` : ""} staat vast op{" "}
            <strong className="font-semibold text-ink">{wanneer}</strong>
            {vacature?.location.city ? ` in ${vacature.location.city}` : ""}. De
            praktijk heeft een bevestiging ontvangen.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/kandidaat/uitnodigingen"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
          >
            Terug naar je uitnodigingen
          </Link>
          <Link
            href="/kandidaat"
            className="text-sm font-semibold text-blauw-700 underline-offset-4 hover:underline"
          >
            Naar je matches
          </Link>
        </div>
      </Card>
    </div>
  );
}
