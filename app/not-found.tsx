// Globale 404 in merkstem (Workstream B, fase 12). Vervangt de kale
// standaard-_not-found: mét landmarks (header/main/footer via PublicShell),
// een h1, en werkende routes terug het product in. Statisch, geen client-JS.

import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/public-site/PublicShell";

export const metadata: Metadata = {
  title: "Pagina niet gevonden — mondzorgwerkt",
};

export default function NietGevonden() {
  return (
    <PublicShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 lg:py-28">
        <p className="text-mw-micro font-semibold uppercase tracking-[0.14em] text-blauw-700">
          Foutcode 404
        </p>
        <h1 className="max-w-xl text-mw-kop-1 font-semibold tracking-tight text-ink">
          Deze pagina bestaat niet{" "}
          <em className="accent-serif text-blauw-600">meer</em>
        </h1>
        <p className="max-w-md text-[16px] leading-relaxed text-mw-text-muted">
          De link is verlopen of verkeerd getypt. Geen zorgen — alles wat
          werkt, staat hieronder.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/vacatures"
            className="inline-flex min-h-12 items-center rounded-full bg-blauw-600 px-7 text-base font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-(--motion-instant) hover:bg-blauw-700 motion-reduce:transition-none"
          >
            Bekijk vacatures
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center rounded-full border border-mw-border-strong bg-white px-7 text-base font-semibold text-ink transition-colors duration-(--motion-instant) hover:border-blauw-400 motion-reduce:transition-none"
          >
            Naar de homepage
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
