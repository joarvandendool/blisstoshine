"use client";

// PaywallNotice — herbruikbare, nette vergrendelkaart voor functies die niet
// in het huidige abonnement zitten.
//
// - De children blijven zichtbaar als begrijpelijke preview, maar gedempt en
//   geblurd (en niet bedienbaar), zodat duidelijk is WAT er wordt ontgrendeld.
// - De uitleg is uitkomstgericht: welke uitkomst levert het ontgrendelen op
//   ("Zie welke aanpassing je kandidatenpool vergroot"), geen featurelijst.
// - De knop linkt naar /praktijk/[slug]/abonnement?benodigd=<key>, waar de
//   abonnementspagina het passende plan aanbeveelt.
// - Bij mount wordt éénmalig paywall_viewed gemeld via POST /api/events
//   (server-side gevalideerd; membership wordt daar geverifieerd).
// - Bewust GEEN nep-schaarste of aftellers — alleen eerlijke uitleg.

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ENTITLEMENT_LABELS, type EntitlementKey } from "@/domain/entitlements";
import { cx } from "@/components/ui";

export interface PaywallNoticeProps {
  /** Praktijk-slug voor de link naar de abonnementspagina. */
  slug: string;
  /** De ontbrekende entitlement-sleutel (gaat mee als ?benodigd=…). */
  benodigd: EntitlementKey;
  /**
   * De uitkomst die ontgrendelen oplevert, uitkomstgericht geformuleerd,
   * bv. "Zie welke aanpassing je kandidatenpool vergroot".
   */
  uitkomst: string;
  /** Kop van de kaart; standaard afgeleid van het entitlement-label. */
  titel?: string;
  /** Organisatie-id voor het paywall_viewed-event (membership wordt server-side geverifieerd). */
  organizationId?: string;
  /** De vergrendelde inhoud als preview (gedempt/geblurd, niet bedienbaar). */
  children?: ReactNode;
  className?: string;
}

export function PaywallNotice({
  slug,
  benodigd,
  uitkomst,
  titel,
  organizationId,
  children,
  className,
}: PaywallNoticeProps) {
  // Eénmalig per mount; de ref overleeft de dubbele effect-run van React
  // Strict Mode, zodat er niet twee events worden gestuurd.
  const gemeld = useRef(false);
  useEffect(() => {
    if (gemeld.current) return;
    gemeld.current = true;
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        name: "paywall_viewed",
        ...(organizationId ? { organizationId } : {}),
        context: { benodigd },
      }),
    }).catch(() => {
      // Analytics faalt nooit hard richting de gebruiker.
    });
  }, [benodigd, organizationId]);

  const label = ENTITLEMENT_LABELS[benodigd];
  const kop =
    titel ??
    `${label.charAt(0).toUpperCase()}${label.slice(1)} zit niet in je huidige plan`;

  return (
    <div className={cx("relative", className)}>
      {/* preview: zichtbaar maar gedempt, geblurd en niet bedienbaar */}
      {children ? (
        <div
          aria-hidden="true"
          // inert i.p.v. alleen pointer-events: ook toetsenbordfocus blijft
          // buiten de vergrendelde preview.
          inert
          className="pointer-events-none select-none opacity-60 blur-[3px]"
        >
          {children}
        </div>
      ) : null}

      {/* vergrendelkaart, gecentreerd over de preview (of op zichzelf) */}
      <div
        className={cx(
          children
            ? "absolute inset-0 flex items-center justify-center p-4"
            : "flex",
        )}
      >
        <div className="glass-strong flex w-full max-w-md flex-col items-center gap-3 rounded-kaart p-6 text-center">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-light/70 text-blauw-700"
          >
            <svg
              viewBox="0 0 20 20"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="4" y="9" width="12" height="8" rx="2" />
              <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
            </svg>
          </span>
          <h3 className="text-base font-semibold text-ink">{kop}</h3>
          <p className="text-sm leading-relaxed text-ink/70">{uitkomst}</p>
          <Link
            href={`/praktijk/${slug}/abonnement?benodigd=${benodigd}`}
            className={cx(
              "mt-1 inline-flex items-center justify-center rounded-full bg-blauw-600 px-6 py-2.5",
              "text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw)",
              "transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none",
            )}
          >
            Bekijk je upgrademogelijkheden
          </Link>
        </div>
      </div>
    </div>
  );
}

export default PaywallNotice;
