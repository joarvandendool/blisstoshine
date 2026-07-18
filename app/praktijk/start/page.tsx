// Commerciële praktijkonboarding — één doorlopende flow op /praktijk/start.
// Eigen rustige full-screen pagina (bewust zónder AppShell — de praktijk-
// omgeving bestaat pas na stap 1). Wie niet is ingelogd gaat naar /inloggen;
// wie al geactiveerd is (Organization.activatedAt) direct naar het dashboard;
// wie een organisatie heeft maar nog niet geactiveerd is, hervat de flow op
// de juiste stap (autosave in Organization.onboardingState).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthzError, firstOrganizationOf, requireUser } from "@/lib/authz";
import { getActiveSubscription } from "@/lib/billing";
import { TRIAL_DAYS } from "@/lib/config";
import { prisma } from "@/lib/db";
import {
  leesOnboardingState,
  legeOnboardingState,
  type OnboardingStateData,
} from "@/server/onboarding";
import { StartFlow, type PraktijkGegevens } from "./start-flow";

export const metadata: Metadata = {
  title: "Start je praktijk — mondzorgwerkt",
  description:
    "Vertel in zeven korte stappen wie je zoekt en zie direct hoeveel kandidaten er in jouw regio binnen bereik zijn.",
};

export const dynamic = "force-dynamic";

/** Resterende hele dagen tot een datum (minimaal 0). */
function dagenTot(datum: Date): number {
  return Math.max(0, Math.ceil((datum.getTime() - Date.now()) / 86_400_000));
}

export default async function PraktijkStartPagina() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  const membership = await firstOrganizationOf(user.id);

  let state: OnboardingStateData = legeOnboardingState();
  let organisatie: { slug: string } | null = null;
  let praktijk: PraktijkGegevens = {
    naam: "",
    plaats: "",
    postcode: "",
    behandelkamers: 3,
    telefoon: "",
  };
  let trialDagenOver: number | null = null;

  if (membership) {
    const org = membership.organization;
    // Geactiveerde praktijken horen niet meer in de onboarding.
    if (org.activatedAt) redirect(`/praktijk/${org.slug}`);

    state = leesOnboardingState(org.onboardingState);
    organisatie = { slug: org.slug };

    const locatie = await prisma.practiceLocation.findFirst({
      where: { organizationId: org.id },
      orderBy: { createdAt: "asc" },
    });
    praktijk = {
      naam: org.name,
      plaats: locatie?.city ?? "",
      postcode: locatie?.postcode ?? "",
      behandelkamers: locatie?.treatmentRooms ?? 3,
      telefoon: locatie?.phone ?? "",
    };

    const abonnement = await getActiveSubscription(org.id);
    trialDagenOver =
      abonnement?.status === "trialing" && abonnement.trialEndsAt
        ? dagenTot(abonnement.trialEndsAt)
        : null;
  }

  const voornaam = user.name.split(" ")[0] ?? user.name;

  return (
    <StartFlow
      voornaam={voornaam}
      trialDagen={TRIAL_DAYS}
      trialDagenOver={trialDagenOver}
      organisatie={organisatie}
      praktijkInit={praktijk}
      stateInit={state}
    />
  );
}
