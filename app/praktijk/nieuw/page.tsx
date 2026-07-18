// Praktijk-start: organisatie aanmaken. Eigen rustige full-screen pagina
// (bewust zónder AppShell — er is nog geen praktijkomgeving). Wie al lid is
// van een organisatie gaat direct door naar het bijbehorende dashboard; wie
// niet is ingelogd eerst naar /inloggen.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthzError, firstOrganizationOf, requireUser } from "@/lib/authz";
import { TRIAL_DAYS } from "@/lib/config";
import { Badge } from "@/components/ui";
import { NieuwPraktijkForm } from "./nieuw-form";

export const metadata: Metadata = {
  title: "Start je praktijkomgeving — mondzorgwerkt",
  description:
    "Maak in een paar minuten je praktijkprofiel aan en plaats direct je eerste vacature. Proefperiode van 14 dagen, zonder betaalgegevens.",
};

export const dynamic = "force-dynamic";

export default async function NieuwePraktijkPagina() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }

  // Al een organisatie? Dan is de start al gemaakt — door naar het dashboard.
  const membership = await firstOrganizationOf(user.id);
  if (membership) redirect(`/praktijk/${membership.organization.slug}`);

  const voornaam = user.name.split(" ")[0] ?? user.name;

  return (
    <main className="relative min-h-dvh overflow-x-clip bg-surface text-ink">
      {/* dromerige achtergrond-orbs — puur decoratief */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb orb-blauw animate-zweef-traag -top-44 -right-40 h-[32rem] w-[32rem]" />
        <div className="orb orb-roze animate-zweef -bottom-32 -left-36 h-[28rem] w-[28rem] opacity-35" />
        <div className="orb orb-paars top-1/3 -left-52 h-[22rem] w-[22rem]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-ink"
            aria-label="mondzorgwerkt — naar de homepage"
          >
            mondzorg<em className="font-serif italic font-bold">werkt</em>
          </Link>
          <Badge tone="blauw">{TRIAL_DAYS} dagen gratis proberen</Badge>
        </header>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Welkom {voornaam}, stel je{" "}
            <em className="font-serif italic font-bold text-blauw-600">praktijk</em>{" "}
            voor
          </h1>
          <p className="max-w-xl text-[16px] leading-relaxed text-ink/70">
            Vertel in één keer wie jullie zijn en hoe jullie werken. Kandidaten
            matchen op deze kenmerken — en jouw proefperiode van {TRIAL_DAYS}{" "}
            dagen start direct na het aanmaken.
          </p>
        </div>

        <NieuwPraktijkForm trialDagen={TRIAL_DAYS} />
      </div>
    </main>
  );
}
