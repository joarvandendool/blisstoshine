// AppShell — productshell voor de ingelogde omgevingen (kandidaat, praktijk,
// intern). Server component voor de statische delen; de navigatie zelf is een
// client component (AppShellNav) die het actieve item uit de echte pathname
// afleidt, ook op onderliggende pagina's.
//
// Desktop: glass-bovenbalk met wordmark, areanavigatie en gebruikersmenu.
// Mobiel: navigatie als bottom tabs met grote tap-targets.
// Uitloggen: form POST naar /api/auth/logout (route zelf leeft elders).

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { NotificationBell } from "@/components/NotificationBell";
import {
  AppShellDesktopNav,
  AppShellMobileTabs,
  type AppShellNavItem,
} from "@/components/AppShellNav";

export type { AppShellNavItem };

export interface AppShellProps {
  children: ReactNode;
  nav: AppShellNavItem[];
  userName: string;
  /** Label van de omgeving, bv. "Praktijk" of "Kandidaat". */
  areaLabel?: string;
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center text-xl font-semibold tracking-tight text-ink"
      aria-label="mondzorgwerkt — naar de homepage"
    >
      mondzorg
      <em className="font-serif italic font-bold">werkt</em>
    </Link>
  );
}

export function AppShell({ children, nav, userName, areaLabel }: AppShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-surface text-ink">
      {/* dromerige achtergrond-orbs, puur decoratief */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="orb orb-blauw animate-zweef-traag -top-40 -right-44 h-[30rem] w-[30rem]" />
        <div className="orb orb-roze animate-zweef -top-24 -left-40 h-[26rem] w-[26rem] opacity-35" />
        <div className="orb orb-paars bottom-[-14rem] left-1/3 h-[24rem] w-[24rem]" />
      </div>

      {/* bovenbalk */}
      <header className="sticky top-0 z-40 glass-strong rounded-none border-x-0 border-t-0 border-b border-b-ink/5">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Wordmark />
            {areaLabel ? (
              <span className="hidden rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-blauw-900 sm:inline-flex">
                {areaLabel}
              </span>
            ) : null}
          </div>

          {/* areanavigatie — desktop */}
          <AppShellDesktopNav items={nav} />

          {/* meldingen + gebruiker + uitloggen */}
          <div className="flex items-center gap-3">
            <NotificationBell />
            <span className="hidden max-w-40 truncate text-sm font-medium text-ink sm:inline">
              {userName}
            </span>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className={cx(
                  "inline-flex min-h-10 items-center rounded-full border border-ink/10 bg-white/70 px-4 py-2",
                  "text-sm font-semibold text-ink backdrop-blur",
                  "transition-colors duration-150 hover:bg-white motion-reduce:transition-none",
                )}
              >
                Uitloggen
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* inhoud — extra ruimte onderaan voor de mobiele tabs */}
      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-28 sm:px-6 md:pb-14">
        {children}
      </main>

      {/* areanavigatie — mobiel als bottom tabs */}
      <AppShellMobileTabs items={nav} />
    </div>
  );
}

export default AppShell;
