"use client";

// Klein client-eiland in PublicShell (fase 11): meldt public_page_viewed
// éénmalig per pagina(navigatie) en — op vacaturedetailpagina's —
// public_job_viewed. Privacy: geen slugs of vrije identifiers; alleen
// route-type, taxonomierol/regio en de geclassificeerde bron.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { eersteTouchBron } from "./attribution";
import { verstuurPubliekEvent } from "./track-public-event";

/** Route → categorische route-type (geen padsegmenten/slugs in het event). */
function routeType(pathname: string): string {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/vacatures/")) return "vacature_detail";
  if (pathname === "/vacatures") return "vacatures";
  if (pathname.startsWith("/praktijken/")) return "praktijk";
  if (
    pathname.startsWith("/functies/") ||
    pathname.startsWith("/specialisaties/") ||
    pathname.startsWith("/technologie/") ||
    pathname.startsWith("/salaris/") ||
    pathname.startsWith("/arbeidsmarkt/")
  ) {
    return "kennis";
  }
  return "overig";
}

/** Slug-loze vacaturecontext: alleen taxonomierol + regio. */
export interface PublicJobAnalyticsContext {
  rol: string;
  regio: string;
}

// Module-niveau zodat React Strict Mode (dubbel effect) en herrenders
// niet tot dubbele events leiden: éénmalig per pathname.
let laatstGemeldPad: string | null = null;

export function PublicAnalytics({
  jobContext,
}: {
  jobContext?: PublicJobAnalyticsContext;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || laatstGemeldPad === pathname) return;
    laatstGemeldPad = pathname;

    const bron = eersteTouchBron();
    verstuurPubliekEvent("public_page_viewed", {
      bron,
      route_type: routeType(pathname),
    });
    if (jobContext) {
      verstuurPubliekEvent("public_job_viewed", {
        bron,
        rol: jobContext.rol,
        regio: jobContext.regio,
      });
    }
  }, [pathname, jobContext]);

  return null;
}
