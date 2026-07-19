// PublicShell — gedeelde header + footer van de openbare site
// (/, /vacatures/**, /praktijken/**). Server component; alleen het mobiele
// menu is een klein client-eiland (PublicNav.tsx).
//
// Toegankelijkheid: skip-link, targets ≥ 44px, AA-contrast (wordmark
// cobalt op licht, footer licht op cobalt — BRAND_TRANSLATION.md), vaste
// headerhoogte (geen layout shift).

import Link from "next/link";
import { cx } from "@/components/ui";
import { PublicMobileMenu } from "./PublicNav";
import {
  PublicAnalytics,
  type PublicJobAnalyticsContext,
} from "./PublicAnalytics";
import { KENNIS_ARTIKELEN } from "./kennis/artikelen";
import { PUBLIC_NAV_ITEMS } from "./nav-items";

/** Wordmark-placeholder (sans + italic serif) tot de echte vector er is. */
export function Wordmark({
  invert = false,
  className,
}: {
  invert?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "font-semibold tracking-tight",
        invert ? "text-white" : "text-blauw-600",
        className,
      )}
    >
      mondzorg
      <em
        className={cx(
          "accent-serif",
          invert ? "text-brand-light" : "text-blauw-600",
        )}
      >
        werkt
      </em>
    </span>
  );
}

export function PublicShell({
  children,
  jobAnalyticsContext,
}: {
  children: React.ReactNode;
  /**
   * Alleen voor vacaturedetailpagina's: slug-loze context (taxonomierol +
   * regio) zodat het analytics-eiland public_job_viewed kan melden (fase 11).
   */
  jobAnalyticsContext?: PublicJobAnalyticsContext;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      {/* fase 11: meldt public_page_viewed éénmalig per pagina (anoniem). */}
      <PublicAnalytics jobContext={jobAnalyticsContext} />
      <a
        href="#inhoud"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-(--z-toast) focus:rounded-full focus:bg-blauw-600 focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
      >
        Naar de inhoud
      </a>

      <header className="sticky top-0 z-(--z-nav) border-b border-mw-border/70 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center rounded-lg text-xl"
            aria-label="mondzorgwerkt — naar de homepage"
          >
            <Wordmark className="text-xl" />
          </Link>

          <nav aria-label="Hoofdnavigatie" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {PUBLIC_NAV_ITEMS.map((item, i) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cx(
                      "flex min-h-11 items-center rounded-full px-4 text-[15px] font-medium",
                      "transition-colors duration-(--motion-instant) motion-reduce:transition-none",
                      i === PUBLIC_NAV_ITEMS.length - 1
                        ? "border border-mw-border-strong bg-white text-ink hover:border-blauw-400"
                        : "text-ink/80 hover:bg-ink/5 hover:text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <PublicMobileMenu items={PUBLIC_NAV_ITEMS} />
        </div>
      </header>

      <main id="inhoud" className="flex-1">
        {children}
      </main>

      {/* Footer: wordmark licht op cobalt-vlak (BRAND_TRANSLATION.md). */}
      <footer className="bg-blauw-600 text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
          <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-start">
            <div className="flex max-w-sm flex-col gap-3">
              <Wordmark invert className="text-2xl" />
              <p className="text-sm leading-relaxed text-blauw-100">
                Match- en capaciteitsplatform voor de mondzorg. Werkdagen,
                vakinhoud, technologie en ambities — uitgelegd per match.
              </p>
            </div>
            <div className="flex flex-col gap-8 sm:flex-row sm:gap-14">
              {/* fase 8: interne links naar de kennisbank op elke publieke pagina */}
              <nav aria-label="Kennisbank">
                <p className="mb-1 flex min-h-6 items-center text-mw-klein font-semibold uppercase tracking-[0.12em] text-blauw-200">
                  Kennisbank
                </p>
                <ul className="flex flex-col gap-1">
                  {KENNIS_ARTIKELEN.map((artikel) => (
                    <li key={artikel.pad}>
                      <Link
                        href={artikel.pad}
                        className="flex min-h-11 items-center rounded-lg text-[15px] font-medium text-blauw-100 underline-offset-4 hover:text-white hover:underline"
                      >
                        {artikel.kortLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <nav aria-label="Footernavigatie">
                <ul className="flex flex-col gap-1">
                  {PUBLIC_NAV_ITEMS.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="flex min-h-11 items-center rounded-lg text-[15px] font-medium text-blauw-100 underline-offset-4 hover:text-white hover:underline"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </div>
          <p className="border-t border-white/15 pt-6 text-sm text-blauw-200">
            © 2026 mondzorgwerkt
          </p>
        </div>
      </footer>
    </div>
  );
}
