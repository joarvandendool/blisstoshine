// Officieel Bliss to Shine logo. Standaard geladen vanaf de eigen site;
// te overschrijven met NEXT_PUBLIC_LOGO_URL of door /public/logo.png te
// vullen en de URL hieronder op "/logo.png" te zetten.
export const LOGO_URL =
  process.env.NEXT_PUBLIC_LOGO_URL ??
  "https://blisstoshine.nl/wp-content/uploads/bliss_to_shine_logo.png";

// Logo op een witte, afgeronde kaart — goed leesbaar op de donkere,
// kleurrijke achtergrond van het grote scherm.
export function LogoCard({
  className = "",
  imgClass = "h-12 lg:h-16",
}: {
  className?: string;
  imgClass?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl px-5 py-3 shadow-lg inline-flex items-center ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_URL} alt="Bliss to Shine" className={`${imgClass} w-auto object-contain`} />
    </div>
  );
}

// Kale logo-afbeelding (voor lichte achtergronden, bv. het invoerscherm).
export function BrandLogo({ className = "h-8" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_URL} alt="Bliss to Shine" className={`${className} w-auto object-contain`} />;
}

// Logo-kaart + pay-off, voor koppen op donkere achtergrond.
export function LogoLockup() {
  return (
    <div className="flex items-center gap-4">
      <LogoCard imgClass="h-12 lg:h-16" />
      <p className="text-white/90 text-sm lg:text-lg italic hidden sm:block">
        ook met kanker mag je stralen
      </p>
    </div>
  );
}
