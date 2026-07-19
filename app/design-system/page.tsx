// /design-system — interne referentiepagina van het Mondzorgwerkt-
// designsysteem (Workstream B, fase 3+4). Alleen voor dev/intern gebruik:
// geen login vereist, maar met robots-noindex zodat de route nooit in
// zoekmachines belandt. Toont tokens, merk, typografie, alle
// ui-componenten in al hun states, het werkweekgrid, patronen
// (dialoog/drawer/tooltip), motion en de Match Shape v2.

import type { Metadata } from "next";
import { Merk } from "./merk";
import { Kleuren } from "./kleuren";
import { Typografie } from "./typografie";
import { ComponentenDemo } from "./componenten-demo";
import { PatronenDemo } from "./patronen-demo";
import { ShapeDemo } from "./shape-demo";

export const metadata: Metadata = {
  title: "Designsysteem — mondzorgwerkt (intern)",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

const SECTIES = [
  ["merk", "Merk"],
  ["kleur", "Kleur & contrast"],
  ["typografie", "Typografie"],
  ["tokens", "Tokens"],
  ["componenten", "Componenten"],
  ["werkweek", "Werkweek"],
  ["patronen", "Patronen"],
  ["shape", "Match Shape"],
] as const;

export default function DesignSystemPagina() {
  return (
    <div className="min-h-screen bg-mw-canvas text-mw-text">
      <header className="border-b border-mw-border bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-4">
          {/* fase 12: h1 (elke pagina precies één) */}
          <h1 className="text-lg font-semibold tracking-tight">
            mondzorg
            <em className="accent-serif text-blauw-600">werkt</em>
            <span className="ml-3 text-sm font-medium text-mw-text-muted">
              designsysteem · intern · fase 3+4
            </span>
          </h1>
          <nav aria-label="Secties" className="flex flex-wrap gap-x-2 gap-y-1">
            {SECTIES.map(([id, naam]) => (
              <a
                key={id}
                href={`#${id}`}
                className="flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-mw-text-muted underline-offset-4 hover:text-blauw-700 hover:underline"
              >
                {naam}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-12">
        <section id="merk" aria-labelledby="merk-kop" className="flex flex-col gap-6">
          <SectieKop id="merk-kop" nummer="01" titel="Merk" />
          <Merk />
        </section>

        <section id="kleur" aria-labelledby="kleur-kop" className="flex flex-col gap-6">
          <SectieKop
            id="kleur-kop"
            nummer="02"
            titel="Kleur & contrast"
            uitleg="Drie merkkleuren met strikte rollen plus gecontroleerde neutrale en semantische tokens. Elke tekstkleur toont de gemeten WCAG-contrastratio tegen zijn achtergrond; alles onder 4,5:1 mag nooit tekst dragen. Roze staat nooit als vlak onder witte tekst (audit-P1): voor tekst en accenten bestaat de toegankelijke variant mw-rose-text."
          />
          <Kleuren />
        </section>

        <section id="typografie" aria-labelledby="typografie-kop" className="flex flex-col gap-6">
          <SectieKop
            id="typografie-kop"
            nummer="03"
            titel="Typografie"
            uitleg="Archivo (stand-in voor Aktiv Grotesk Ex) draagt alle UI; Playfair Display italic (stand-in voor Abril Display ExtraBoldItalic) is het schaarse editorial accent — maximaal één keer per view. Tokens verwijzen naar rollen, niet naar fontnamen."
          />
          <Typografie />
        </section>

        <section id="tokens" aria-labelledby="tokens-kop" className="flex flex-col gap-6">
          <SectieKop
            id="tokens-kop"
            nummer="04"
            titel="Overige tokens"
            uitleg="Spacing (4px-basis), radii, schaduwen, blur-niveaus, motion (duur + easing uit MOTION_SYSTEM.md), z-index-schaal en breakpoints. Componenten verwijzen altijd naar tokens, nooit naar losse waardes."
          />
          <TokensOverzicht />
        </section>

        <section id="componenten" aria-labelledby="componenten-kop" className="flex flex-col gap-6">
          <SectieKop
            id="componenten-kop"
            nummer="05"
            titel="Componenten"
            uitleg="Alle ui-primitieven in hun states: default, hover, focus, disabled en error. Focus is overal de globale cobalt-ring (tab er doorheen om hem te zien)."
          />
          <ComponentenDemo />
        </section>

        <section id="patronen" aria-labelledby="patronen-kop" className="flex flex-col gap-6">
          <SectieKop
            id="patronen-kop"
            nummer="06"
            titel="Werkweek, patronen & motion"
            uitleg="Het werkweekgrid in alle modes (inclusief het responsive kantelen onder 640px), dialoog- en drawer-patronen, tooltips, een klein charts-specimen en het motion-systeem met reduced-motion-gedrag."
          />
          <PatronenDemo />
        </section>

        <section id="shape" aria-labelledby="shape-kop" className="flex flex-col gap-6">
          <SectieKop
            id="shape-kop"
            nummer="07"
            titel="Match Shape v2"
            uitleg="Twee originele transparante vormen: de kandidaat (vloeibaar, roze/cloud) en de praktijk (stabiel, cobalt/cloud). Afstand en overlap volgen de score 0–100; de vijf dimensies moduleren rotatie, ronding en schaal. In de overlap ligt een licht iriserend accent: hoe meer overlap, hoe sterker de match."
          />
          <ShapeDemo />
        </section>
      </main>

      <footer className="border-t border-mw-border py-8 text-center text-sm text-mw-text-muted">
        Interne referentie — niet geïndexeerd. Bron: docs/design/*.md.
      </footer>
    </div>
  );
}

/* ------------------------------ hulpjes ------------------------------ */

function SectieKop({
  id,
  nummer,
  titel,
  uitleg,
}: {
  id: string;
  nummer: string;
  titel: string;
  uitleg?: string;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-blauw-700">
        {nummer}
      </span>
      <h2 id={id} className="text-mw-kop-2 font-semibold tracking-tight">
        {titel}
      </h2>
      {uitleg ? (
        <p className="text-mw-klein leading-relaxed text-mw-text-muted">{uitleg}</p>
      ) : null}
    </div>
  );
}

/* --------------------- statisch tokens-overzicht ---------------------- */

function TokensOverzicht() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* spacing */}
      <div className="glass-strong rounded-kaart p-6">
        <h3 className="mb-4 text-mw-kop-3 font-semibold">Spacing (--mw-space-1…9)</h3>
        <div className="flex flex-col gap-2">
          {[
            ["--mw-space-1", "4"],
            ["--mw-space-2", "8"],
            ["--mw-space-3", "12"],
            ["--mw-space-4", "16"],
            ["--mw-space-5", "24"],
            ["--mw-space-6", "32"],
            ["--mw-space-7", "48"],
            ["--mw-space-8", "64"],
            ["--mw-space-9", "96"],
          ].map(([token, px]) => (
            <div key={token} className="flex items-center gap-3">
              <code className="w-32 shrink-0 text-xs text-mw-text-muted">{token}</code>
              <div
                className="h-3 rounded-sm bg-blauw-600"
                style={{ width: `var(${token})` }}
                aria-hidden="true"
              />
              <span className="text-xs tabular-nums text-mw-text-muted">{px}px</span>
            </div>
          ))}
        </div>
      </div>

      {/* radii + shadows + blur */}
      <div className="glass-strong rounded-kaart p-6">
        <h3 className="mb-4 text-mw-kop-3 font-semibold">Radii, schaduw & blur</h3>
        <div className="flex flex-wrap items-end gap-4">
          {[
            ["--radius-klein", "8px"],
            ["--radius-veld", "14px"],
            ["--radius-kaart", "24px"],
            ["--radius-kaart-lg", "28px"],
            ["--radius-kaart-xl", "36px"],
          ].map(([token, px]) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <div
                className="h-16 w-16 border border-mw-border-strong bg-white"
                style={{ borderRadius: `var(${token})` }}
                aria-hidden="true"
              />
              <code className="text-[10px] text-mw-text-muted">{px}</code>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-4">
          {[
            ["--shadow-mw-1", "mw-1 (klein)"],
            ["--shadow-mw-2", "mw-2"],
            ["--shadow-glass", "glass"],
            ["--shadow-zweef", "zweef"],
          ].map(([token, naam]) => (
            <div key={token} className="flex flex-col items-center gap-2">
              <div
                className="h-14 w-20 rounded-kaart bg-white"
                style={{ boxShadow: `var(${token})` }}
                aria-hidden="true"
              />
              <code className="text-[10px] text-mw-text-muted">{naam}</code>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-mw-text-muted">
          Blur-niveaus: <code>--blur-mw-1</code> 8px (kleine overlays),{" "}
          <code>--blur-mw-2</code> 18px (glass), <code>--blur-mw-3</code> 26px
          (glass-strong/dialogen). Glass draagt tekst alleen bij minimaal 0,72
          wit-opaciteit.
        </p>
      </div>

      {/* motion */}
      <div className="glass-strong rounded-kaart p-6">
        <h3 className="mb-4 text-mw-kop-3 font-semibold">Motion-tokens</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {[
            ["--motion-instant", "80 ms — hover, pressed, toggles"],
            ["--motion-fast", "160 ms — chips, checkboxes, focus"],
            ["--motion-base", "240 ms — uitklappen, fades, kaartstaten"],
            ["--motion-slow", "400 ms — sheets, dialogen, score-updates"],
            ["--motion-hero", "700 ms — Match Shape-morph (max 1 per pagina)"],
            ["--ease-out", "cubic-bezier(0.16, 1, 0.3, 1) — verschijnen"],
            ["--ease-in-out", "cubic-bezier(0.65, 0, 0.35, 1) — A → B"],
            ["--ease-exit", "cubic-bezier(0.4, 0, 1, 1) — verdwijnen"],
          ].map(([token, uitleg]) => (
            <div key={token} className="contents">
              <dt>
                <code className="text-xs text-blauw-700">{token}</code>
              </dt>
              <dd className="text-xs text-mw-text-muted">{uitleg}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-mw-text-muted">
          Bij <code>prefers-reduced-motion: reduce</code> zakken base/slow/hero
          naar 160 ms en worden morphs cross-fades; componenten gebruiken
          daarnaast <code>motion-reduce:transition-none</code>.
        </p>
      </div>

      {/* z-index + breakpoints */}
      <div className="glass-strong rounded-kaart p-6">
        <h3 className="mb-4 text-mw-kop-3 font-semibold">Z-index & breakpoints</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {[
            ["--z-nav", "40 — vaste navigatie"],
            ["--z-dropdown", "50 — menu's, selects"],
            ["--z-overlay", "60 — dim-laag achter dialogen"],
            ["--z-dialog", "70 — dialogen en drawers"],
            ["--z-toast", "80 — meldingen"],
            ["--z-tooltip", "90 — tooltips (altijd bovenop)"],
          ].map(([token, uitleg]) => (
            <div key={token} className="contents">
              <dt>
                <code className="text-xs text-blauw-700">{token}</code>
              </dt>
              <dd className="text-xs text-mw-text-muted">{uitleg}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-mw-text-muted">
          Breakpoints (Tailwind-defaults, geen override): sm 640 · md 768 ·
          lg 1024 · xl 1280 · 2xl 1536. Mobiel-eerst; het werkweekgrid kantelt
          onder sm naar dagen-als-rijen (zie sectie 06).
        </p>
      </div>
    </div>
  );
}
