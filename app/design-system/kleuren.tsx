// Kleur & contrast-sectie van /design-system. De contrastratio's worden
// hier berekend (WCAG-relatieve luminantie) zodat het specimen altijd de
// werkelijke waarden toont — geen handmatig bijgehouden getallen.

import { cx } from "@/components/ui";

/* -------------------------- contrastmeting --------------------------- */

function luminantie(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(voor: string, achter: string): number {
  const l1 = luminantie(voor);
  const l2 = luminantie(achter);
  const [hoog, laag] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hoog + 0.05) / (laag + 0.05);
}

function formatteer(ratio: number): string {
  return `${(Math.round(ratio * 100) / 100).toFixed(2).replace(".", ",")}:1`;
}

/* ------------------------------ specimen ----------------------------- */

const WIT = "#ffffff";
const CANVAS = "#f4f8fc";

interface KleurRij {
  token: string;
  hex: string;
  rol: string;
  /** Achtergrond waartegen de contrastwaarde gemeten wordt. */
  tegen: string;
  tegenNaam: string;
  /** true: dit token draagt tekst en moet ≥ 4,5:1 halen. */
  isTekst: boolean;
}

const MERKKLEUREN: KleurRij[] = [
  {
    token: "--color-mw-cloud",
    hex: "#cddfee",
    rol: "Atmosfeer & canvasvlakken — nooit voor tekst",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: false,
  },
  {
    token: "--color-mw-cobalt",
    hex: "#0120ec",
    rol: "Dé actiekleur: knoppen, links, focus, data-primair",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: true,
  },
  {
    token: "--color-mw-rose",
    hex: "#ed6ca5",
    rol: "Menselijk accent — alleen tint, rand of detail; nooit vlak onder witte tekst",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: false,
  },
  {
    token: "--color-mw-rose-text",
    hex: "#c0246a",
    rol: "Toegankelijke roze-variant voor tekst en accenten",
    tegen: CANVAS,
    tegenNaam: "canvas",
    isTekst: true,
  },
];

const NEUTRALEN: KleurRij[] = [
  { token: "--color-mw-canvas", hex: CANVAS, rol: "Paginakleur", tegen: WIT, tegenNaam: "wit", isTekst: false },
  { token: "--color-mw-surface-1", hex: "#ffffff", rol: "Kaarten en velden", tegen: CANVAS, tegenNaam: "canvas", isTekst: false },
  { token: "--color-mw-surface-2", hex: "#e9f1f8", rol: "Verdiepte vlakken, skeletons", tegen: WIT, tegenNaam: "wit", isTekst: false },
  { token: "--color-mw-text", hex: "#0a0d1c", rol: "Primaire tekst", tegen: CANVAS, tegenNaam: "canvas", isTekst: true },
  { token: "--color-mw-text-muted", hex: "#46506b", rol: "Secundaire tekst", tegen: CANVAS, tegenNaam: "canvas", isTekst: true },
  { token: "--color-mw-border", hex: "#d7e0ea", rol: "Standaardranden", tegen: WIT, tegenNaam: "wit", isTekst: false },
  { token: "--color-mw-border-strong", hex: "#b6c3d4", rol: "Nadrukkelijke randen, lege grid-cellen", tegen: WIT, tegenNaam: "wit", isTekst: false },
  { token: "--color-mw-disabled", hex: "#e4eaf2", rol: "Disabled vlakken (vrijgesteld van AA)", tegen: WIT, tegenNaam: "wit", isTekst: false },
];

const STATUS: Array<KleurRij & { bg: string; bgToken: string }> = [
  {
    token: "--color-mw-success",
    hex: "#0c6b3d",
    rol: "Succes — tekst en iconen",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: true,
    bg: "#e3f4ea",
    bgToken: "--color-mw-success-bg",
  },
  {
    token: "--color-mw-warning",
    hex: "#8a5a0b",
    rol: "Waarschuwing — tekst en iconen",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: true,
    bg: "#fbf0da",
    bgToken: "--color-mw-warning-bg",
  },
  {
    token: "--color-mw-error",
    hex: "#b42318",
    rol: "Fout — bewust rood, nooit merkroze",
    tegen: WIT,
    tegenNaam: "wit",
    isTekst: true,
    bg: "#fdecea",
    bgToken: "--color-mw-error-bg",
  },
];

function ContrastBadge({ ratio, isTekst }: { ratio: number; isTekst: boolean }) {
  const haaltAA = ratio >= 4.5;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        isTekst
          ? haaltAA
            ? "bg-mw-success-bg text-mw-success"
            : "bg-mw-error-bg text-mw-error"
          : "bg-mw-surface-2 text-mw-text-muted",
      )}
    >
      {formatteer(ratio)}
      {isTekst ? <span>{haaltAA ? "AA" : "faalt"}</span> : null}
    </span>
  );
}

function KleurKaart(rij: KleurRij) {
  const ratio = contrast(rij.hex, rij.tegen);
  return (
    <div className="flex items-center gap-4 rounded-kaart border border-mw-border bg-white p-4">
      <div
        aria-hidden="true"
        className="h-14 w-14 shrink-0 rounded-veld border border-ink/10"
        style={{ backgroundColor: rij.hex }}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <code className="text-xs font-semibold text-ink">{rij.token}</code>
          <code className="text-xs text-mw-text-muted">{rij.hex}</code>
          <ContrastBadge ratio={ratio} isTekst={rij.isTekst} />
          <span className="text-[11px] text-mw-text-muted">op {rij.tegenNaam}</span>
        </div>
        <p className="text-xs leading-relaxed text-mw-text-muted">{rij.rol}</p>
      </div>
    </div>
  );
}

export function Kleuren() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-3 lg:grid-cols-2">
        {MERKKLEUREN.map((rij) => (
          <KleurKaart key={rij.token} {...rij} />
        ))}
      </div>

      {/* de roze regel expliciet gedemonstreerd */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-kaart px-4 py-6 text-center"
          style={{ backgroundColor: "#ed6ca5" }}
        >
          <span className="font-semibold text-white">Wit op roze</span>
          <span className="rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-mw-error">
            {formatteer(contrast(WIT, "#ed6ca5"))} — verboden
          </span>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-kaart border border-mw-border bg-white px-4 py-6 text-center">
          <span className="font-semibold text-mw-rose-text">mw-rose-text op wit</span>
          <span className="rounded-full bg-mw-success-bg px-2 py-0.5 text-[11px] font-semibold text-mw-success">
            {formatteer(contrast("#c0246a", WIT))} — AA
          </span>
        </div>
        <div className="flex flex-col items-center justify-center gap-1 rounded-kaart border-2 border-roze-300 bg-roze-50 px-4 py-6 text-center">
          <span className="font-semibold text-ink">Roze als tint & rand</span>
          <span className="text-[11px] text-mw-text-muted">
            zo wél: achtergrondtint + rand, ink-tekst
          </span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {NEUTRALEN.map((rij) => (
          <KleurKaart key={rij.token} {...rij} />
        ))}
      </div>

      {/* status met bijbehorende achtergrondtinten */}
      <div className="grid gap-3 lg:grid-cols-3">
        {STATUS.map((rij) => (
          <div
            key={rij.token}
            className="flex flex-col gap-3 rounded-kaart border border-mw-border bg-white p-4"
          >
            <KleurKaart {...rij} />
            <div
              className="flex items-center justify-between gap-2 rounded-veld px-4 py-3"
              style={{ backgroundColor: rij.bg }}
            >
              <span className="text-sm font-semibold" style={{ color: rij.hex }}>
                Tekst op {rij.bgToken.replace("--color-mw-", "")}
              </span>
              <ContrastBadge ratio={contrast(rij.hex, rij.bg)} isTekst />
            </div>
            <p className="text-[11px] text-mw-text-muted">
              Wit op {rij.token.replace("--color-mw-", "")}:{" "}
              {formatteer(contrast(WIT, rij.hex))} (AA voor knoppen).
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
