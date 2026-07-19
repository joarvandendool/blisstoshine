// Interne layout: alles onder /intern is uitsluitend toegankelijk voor
// platform-admins (User.isPlatformAdmin). Zonder sessie → redirect naar
// /inloggen; wél ingelogd maar geen platformbeheerder → nette 403-melding,
// zodat duidelijk is waarom de pagina niet zichtbaar is.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import { AppShell, type AppShellNavItem } from "@/components/AppShell";

// Fase 10 (AI-discoverability): privéroute — nooit indexeren. robots.txt
// sluit /intern ook uit, maar robots.txt is geen beveiliging; de echte
// bescherming is de autorisatie hieronder + deze noindex-meta.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const INTERN_NAV: AppShellNavItem[] = [{ href: "/intern", label: "Overzicht" }];

/** Nette 403-melding voor ingelogde gebruikers zonder platformbeheerrechten. */
function GeenToegang() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-x-clip bg-surface px-4 text-ink">
      {/* decoratieve achtergrond-orbs */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb orb-blauw -top-40 -right-44 h-[30rem] w-[30rem]" />
        <div className="orb orb-roze bottom-[-12rem] -left-40 h-[26rem] w-[26rem] opacity-35" />
      </div>

      <main className="glass-strong relative z-10 flex w-full max-w-md flex-col items-center gap-4 rounded-kaart-lg px-8 py-12 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Geen toegang tot{" "}
          <em className="font-serif italic font-bold text-blauw-600">intern</em>
        </h1>
        <p className="text-[15px] leading-relaxed text-ink/70">
          Dit dashboard is alleen beschikbaar voor platformbeheerders van
          mondzorgwerkt. Je bent wel ingelogd, maar dit account heeft geen
          platformbeheerrechten. Denk je dat dit niet klopt? Neem dan contact op
          met het interne team.
        </p>
        <Link
          href="/"
          className="mt-2 inline-flex items-center justify-center rounded-full bg-blauw-600 px-6 py-2.5 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
        >
          Terug naar de homepage
        </Link>
      </main>
    </div>
  );
}

export default async function InternLayout({
  children,
}: {
  children: ReactNode;
}) {
  let beheerder: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    beheerder = await requirePlatformAdmin();
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      return <GeenToegang />;
    }
    throw fout;
  }

  return (
    <AppShell
      nav={INTERN_NAV}
      userName={beheerder.name}
      areaLabel="Intern"
    >
      {children}
    </AppShell>
  );
}
