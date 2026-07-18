// AppShell — productshell voor de ingelogde omgevingen (kandidaat, praktijk,
// intern). Server component: geen client hooks; het actieve nav-item wordt
// bepaald uit de meegegeven activePath.
//
// Desktop: glass-bovenbalk met wordmark, areanavigatie en gebruikersmenu.
// Mobiel: navigatie als bottom tabs met grote tap-targets.
// Uitloggen: form POST naar /api/auth/logout (route zelf leeft elders).

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export interface AppShellNavItem {
  href: string;
  label: string;
}

export interface AppShellProps {
  children: ReactNode;
  nav: AppShellNavItem[];
  /** Huidige pathname; bepaalt het actieve nav-item. */
  activePath: string;
  userName: string;
  /** Label van de omgeving, bv. "Praktijk" of "Kandidaat". */
  areaLabel?: string;
}

function isActief(activePath: string, href: string): boolean {
  return activePath === href || activePath.startsWith(`${href}/`);
}

function Wordmark() {
  return (
    <Link
      href="/"
      className="text-xl font-semibold tracking-tight text-ink"
      aria-label="mondzorgwerkt — naar de homepage"
    >
      mondzorg
      <em className="font-serif italic font-bold">werkt</em>
    </Link>
  );
}

export function AppShell({
  children,
  nav,
  activePath,
  userName,
  areaLabel,
}: AppShellProps) {
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
          <nav aria-label="Hoofdnavigatie" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {nav.map((item) => {
                const actief = isActief(activePath, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={actief ? "page" : undefined}
                      className={cx(
                        "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold",
                        "transition-colors duration-150 motion-reduce:transition-none",
                        actief
                          ? "bg-blauw-600 text-white shadow-(--shadow-knop-blauw)"
                          : "text-ink/80 hover:bg-ink/5 hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* gebruiker + uitloggen */}
          <div className="flex items-center gap-3">
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
      <nav
        aria-label="Hoofdnavigatie"
        className="fixed inset-x-0 bottom-0 z-40 glass-strong rounded-none border-x-0 border-b-0 border-t border-t-ink/5 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${Math.max(nav.length, 1)}, minmax(0, 1fr))` }}
        >
          {nav.map((item) => {
            const actief = isActief(activePath, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={actief ? "page" : undefined}
                  className={cx(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-xs font-semibold",
                    "transition-colors duration-150 motion-reduce:transition-none",
                    actief ? "text-blauw-700" : "text-ink/70",
                  )}
                >
                  {/* actieve staat: kleur ÉN indicatorbalkje, nooit alleen kleur */}
                  <span
                    aria-hidden="true"
                    className={cx(
                      "h-1 w-8 rounded-full",
                      actief ? "bg-blauw-600" : "bg-transparent",
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default AppShell;
