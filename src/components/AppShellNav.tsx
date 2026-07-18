"use client";

// Navigatieweergaven van de AppShell (desktop-balk + mobiele bottom tabs).
// Client component: het actieve item volgt de echte pathname (usePathname),
// zodat ook op onderliggende pagina's (pipeline, profiel, …) het juiste
// tabblad oplicht. Bij overlappende prefixen (bv. "/kandidaat" en
// "/kandidaat/profiel") wint de langste match.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export interface AppShellNavItem {
  href: string;
  label: string;
  /** Kort label voor de mobiele bottom tabs (valt terug op label). */
  kort?: string;
}

/** Pad zonder hash/query, voor de actief-vergelijking. */
function kaalPad(href: string): string {
  return href.split(/[#?]/)[0];
}

/** Het actieve nav-item: de langste href die de pathname prefixt. */
function actieveHref(pathname: string, items: AppShellNavItem[]): string | null {
  let beste: string | null = null;
  let besteLengte = -1;
  for (const item of items) {
    const pad = kaalPad(item.href);
    const matcht = pathname === pad || pathname.startsWith(`${pad}/`);
    if (matcht && pad.length > besteLengte) {
      beste = item.href;
      besteLengte = pad.length;
    }
  }
  return beste;
}

export function AppShellDesktopNav({ items }: { items: AppShellNavItem[] }) {
  const pathname = usePathname();
  const actief = actieveHref(pathname, items);
  return (
    <nav aria-label="Hoofdnavigatie" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.href === actief ? "page" : undefined}
              className={cx(
                "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold",
                "transition-colors duration-150 motion-reduce:transition-none",
                item.href === actief
                  ? "bg-blauw-600 text-white shadow-(--shadow-knop-blauw)"
                  : "text-ink/80 hover:bg-ink/5 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShellMobileTabs({ items }: { items: AppShellNavItem[] }) {
  const pathname = usePathname();
  const actief = actieveHref(pathname, items);
  return (
    <nav
      aria-label="Hoofdnavigatie (mobiel)"
      className="fixed inset-x-0 bottom-0 z-40 glass-strong rounded-none border-x-0 border-b-0 border-t border-t-ink/5 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => {
          const isActief = item.href === actief;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActief ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[11px] font-semibold",
                  "transition-colors duration-150 motion-reduce:transition-none",
                  isActief ? "text-blauw-700" : "text-ink/70",
                )}
              >
                {/* actieve staat: kleur ÉN indicatorbalkje, nooit alleen kleur */}
                <span
                  aria-hidden="true"
                  className={cx(
                    "h-1 w-8 rounded-full",
                    isActief ? "bg-blauw-600" : "bg-transparent",
                  )}
                />
                <span className="max-w-full truncate">
                  {item.kort ?? item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
