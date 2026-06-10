"use client";

// Decoratieve, levende achtergrond voor het grote scherm:
// drijvende kleurvlekken (aurora), draaiende "shine"-stralen en
// fonkelende sterretjes. Puur visueel, vangt geen clicks.

const SPARKLES = [
  { top: "12%", left: "8%", size: 14, delay: "0s" },
  { top: "22%", left: "78%", size: 10, delay: "0.6s" },
  { top: "35%", left: "30%", size: 8, delay: "1.2s" },
  { top: "18%", left: "55%", size: 12, delay: "0.3s" },
  { top: "48%", left: "88%", size: 9, delay: "1.6s" },
  { top: "62%", left: "12%", size: 13, delay: "0.9s" },
  { top: "72%", left: "40%", size: 8, delay: "2.1s" },
  { top: "80%", left: "70%", size: 11, delay: "0.4s" },
  { top: "58%", left: "60%", size: 7, delay: "1.9s" },
  { top: "30%", left: "92%", size: 10, delay: "1.1s" },
  { top: "88%", left: "22%", size: 9, delay: "0.7s" },
  { top: "8%", left: "38%", size: 8, delay: "2.4s" },
  { top: "44%", left: "48%", size: 7, delay: "1.4s" },
  { top: "66%", left: "85%", size: 12, delay: "0.2s" },
];

function Sparkle({
  top,
  left,
  size,
  delay,
}: {
  top: string;
  left: string;
  size: number;
  delay: string;
}) {
  return (
    <svg
      className="absolute anim-twinkle"
      style={{ top, left, width: size, height: size, animationDelay: delay }}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M12 0c.6 5.4 3 7.8 8.4 8.4-5.4.6-7.8 3-8.4 8.4-.6-5.4-3-7.8-8.4-8.4C9 7.8 11.4 5.4 12 0z"
        fill="#FFF6C8"
      />
    </svg>
  );
}

export function FestiveBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden festival-bg">
      {/* Aurora-vlekken */}
      <div className="absolute -top-32 -left-24 w-[42rem] h-[42rem] rounded-full bg-blissi-roze/40 blur-3xl anim-drift" />
      <div className="absolute top-1/4 -right-32 w-[40rem] h-[40rem] rounded-full bg-zalm/40 blur-3xl anim-drift-slow" />
      <div className="absolute -bottom-40 left-1/4 w-[46rem] h-[46rem] rounded-full bg-blissi-blauw/30 blur-3xl anim-drift" />
      <div className="absolute top-1/3 left-1/3 w-[30rem] h-[30rem] rounded-full bg-blissi-geel/20 blur-3xl anim-drift-slow" />

      {/* Draaiende stralenkrans, gecentreerd achter de teller */}
      <div
        className="absolute left-1/2 top-1/2 w-[120vmax] h-[120vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.07] anim-spin-slower"
        style={{
          background:
            "repeating-conic-gradient(from 0deg, #fff 0deg 6deg, transparent 6deg 12deg)",
          maskImage: "radial-gradient(circle, #000 0%, transparent 60%)",
          WebkitMaskImage: "radial-gradient(circle, #000 0%, transparent 60%)",
        }}
      />

      {/* Sterretjes */}
      {SPARKLES.map((s, i) => (
        <Sparkle key={i} {...s} />
      ))}
    </div>
  );
}
