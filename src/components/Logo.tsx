// Gestileerd "Bliss to Shine" logo-lockup met een stralende zon.
// Vervang dit door het echte logo zodra je het in /public/logo.svg zet
// (zie LogoImage hieronder voor automatische fallback).

export function SunMark({ size = 64 }: { size?: number }) {
  const rays = Array.from({ length: 12 });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="anim-glow"
      aria-hidden
    >
      <g className="anim-spin-slow" style={{ transformOrigin: "50px 50px" }}>
        {rays.map((_, i) => (
          <rect
            key={i}
            x="48"
            y="4"
            width="4"
            height="16"
            rx="2"
            fill="#FFEF80"
            transform={`rotate(${i * 30} 50 50)`}
          />
        ))}
      </g>
      <circle cx="50" cy="50" r="24" fill="#FFEF80" />
      <circle cx="50" cy="50" r="24" fill="url(#sunGrad)" />
      <defs>
        <radialGradient id="sunGrad" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0%" stopColor="#FFF7C2" />
          <stop offset="100%" stopColor="#F0947F" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function LogoLockup() {
  return (
    <div className="flex items-center gap-4">
      <SunMark size={72} />
      <div className="leading-none">
        <p className="text-3xl lg:text-4xl font-bold text-white tracking-tight">
          Bliss <span className="text-blissi-geel">to</span> Shine
        </p>
        <p className="text-white/80 text-sm lg:text-base mt-1 italic">
          ook met kanker mag je stralen
        </p>
      </div>
    </div>
  );
}
