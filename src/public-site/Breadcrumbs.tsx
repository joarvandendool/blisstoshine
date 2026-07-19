// Zichtbaar kruimelpad + BreadcrumbList-JSON-LD in één component (fase 9).
// Server component. Het laatste item is de huidige pagina (geen link,
// aria-current). Items zonder href (bv. een categorie zonder indexpagina)
// worden als platte tekst getoond.

import Link from "next/link";
import { breadcrumbJsonLd } from "./seo";
import { JsonLd } from "./JsonLd";

export interface Kruimel {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: Kruimel[] }) {
  return (
    <nav aria-label="Kruimelpad">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-mw-klein">
        {items.map((item, i) => {
          const laatste = i === items.length - 1;
          return (
            <li
              key={`${item.label}-${i}`}
              // fase 12: max-w-full + anywhere — extreem lange titels (laatste
              // kruimel) breken binnen de rij i.p.v. horizontaal te overflowen
              className="flex min-w-0 max-w-full items-center gap-1.5 [overflow-wrap:anywhere]"
            >
              {i > 0 ? (
                <span aria-hidden="true" className="text-mw-text-muted">
                  ›
                </span>
              ) : null}
              {item.href && !laatste ? (
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center rounded-md font-semibold text-blauw-700 underline-offset-4 hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={laatste ? "page" : undefined}
                  className={
                    laatste
                      ? "flex min-h-11 items-center font-medium text-mw-text-muted"
                      : "flex min-h-11 items-center text-mw-text-muted"
                  }
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <JsonLd data={breadcrumbJsonLd(items)} />
    </nav>
  );
}
