"use client";

// CTA-link die bij een klik public_apply_clicked of public_register_clicked
// meldt (fase 11), mét eerste-touch-bron zodat de funnel
// bron → registratie → activatie meetbaar is. Navigatie blijft een gewone
// <Link>; het event gaat fire-and-forget met keepalive mee.

import Link from "next/link";
import { eersteTouchBron } from "./attribution";
import {
  verstuurPubliekEvent,
  type PublicEventContext,
} from "./track-public-event";

export function TrackedLink({
  event,
  context,
  href,
  className,
  children,
}: {
  event: "public_apply_clicked" | "public_register_clicked";
  /** Slug-loze context: rol/regio/route_type — bron wordt hier aangevuld. */
  context?: Omit<PublicEventContext, "bron">;
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        verstuurPubliekEvent(event, { bron: eersteTouchBron(), ...context });
      }}
    >
      {children}
    </Link>
  );
}
