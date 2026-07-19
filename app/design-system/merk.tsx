// Merk-sectie van /design-system: wordmark (tekstplaceholder tot de echte
// vector beschikbaar is) en de flat blob-'m', zelf hertekend als inline SVG
// op basis van de gidsbeschrijving (BRAND_TRANSLATION.md): een organische
// lowercase 'm' uit twee zachte, boonvormige lobben — geen extern asset,
// geen tandvorm.

import { cx } from "@/components/ui";

/** Wordmark: "mondzorg" sans + "werkt" italic serif, één woord. */
export function Wordmark({
  invert = false,
  className,
}: {
  /** true = licht op blauw vlak (footer-variant). */
  invert?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "text-3xl font-semibold tracking-tight",
        invert ? "text-white" : "text-blauw-600",
        className,
      )}
    >
      mondzorg
      <em className={cx("accent-serif", invert ? "text-brand-light" : "text-blauw-600")}>
        werkt
      </em>
    </span>
  );
}

/**
 * Flat blob-'m': twee organische, boonvormige lobben die samen een
 * lowercase 'm' vormen. Getekend als één pad met ronde uiteinden zodat de
 * lobben "oppervlaktespanning" houden. Kleurgebruik uitsluitend binnen de
 * merkparen (cobalt op cloud of andersom).
 */
export function BlobM({
  invert = false,
  size = 96,
  className,
}: {
  /** true = cloud-'m' op cobalt vlak. */
  invert?: boolean;
  size?: number;
  className?: string;
}) {
  const vlak = invert ? "#0120ec" : "#cddfee";
  const vorm = invert ? "#cddfee" : "#0120ec";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label="Beeldmerk: blob-m van mondzorgwerkt"
      className={className}
    >
      <rect width="96" height="96" rx="24" fill={vlak} />
      {/* twee zachte lobben: linker- en rechterboog van de 'm', met ronde
          poten — bewust licht asymmetrisch zodat hij organisch blijft */}
      <path
        d="M25 70 L25 49 C25 38.5 32.5 33 40 36.5 C45.5 39 48 44 48 51 L48 70 M48 54 C48 43 55.5 37.5 63 41 C68.5 43.5 71 48.5 71 55.5 L71 70"
        fill="none"
        stroke={vorm}
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Merk() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="glass-strong flex flex-col gap-6 rounded-kaart p-8">
        <h3 className="text-mw-kop-3 font-semibold">Wordmark</h3>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-center rounded-kaart bg-brand-light px-6 py-10">
            <Wordmark />
          </div>
          <div className="flex items-center justify-center rounded-kaart bg-blauw-600 px-6 py-10">
            <Wordmark invert />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-mw-text-muted">
          Tekstplaceholder met de fallback-fonts (Archivo / Playfair Display)
          tot de originele vector beschikbaar is. Nooit in roze, nooit met
          schaduw, gradient of aangepaste spatiëring; kies altijd de variant
          met het hoogste contrast op de ondergrond.
        </p>
      </div>

      <div className="glass-strong flex flex-col gap-6 rounded-kaart p-8">
        <h3 className="text-mw-kop-3 font-semibold">Beeldmerk: blob-&lsquo;m&rsquo; (flat)</h3>
        <div className="flex flex-wrap items-center justify-center gap-8 py-4">
          <BlobM size={120} />
          <BlobM size={120} invert />
          <div className="flex items-end gap-4">
            <BlobM size={56} />
            <BlobM size={36} />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-mw-text-muted">
          Eigen hertekening (inline SVG) van de gidsbeschrijving: twee zachte,
          boonvormige lobben die een lowercase &lsquo;m&rsquo; vormen. Flat is
          het werkpaard (favicon, avatarfallback, lege staten); de
          glass-versie is uitsluitend een heldenobject, maximaal één per
          pagina. Vrije ruimte: minimaal één lobhoogte rondom; niet roteren,
          spiegelen of herkleuren buiten de merkparen.
        </p>
      </div>
    </div>
  );
}
