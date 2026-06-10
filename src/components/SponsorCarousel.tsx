"use client";

import { useEffect, useState } from "react";

type Sponsor = { src: string; alt: string };

// Plaats logo's in public/sponsors/ en voeg toe aan deze lijst.
// (Later kunnen we dit autoloaden via een API route die de map leest.)
const SPONSORS: Sponsor[] = [
  // { src: "/sponsors/voorbeeld.svg", alt: "Voorbeeld B.V." },
];

const ROTATE_MS = 4500;
const VISIBLE = 5;

export function SponsorCarousel() {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (SPONSORS.length <= VISIBLE) return;
    const t = setInterval(() => setOffset((o) => (o + 1) % SPONSORS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  if (SPONSORS.length === 0) {
    return (
      <div className="text-white/60 text-sm italic">
        Sponsoren? Voeg logo&apos;s toe in <code>public/sponsors/</code> en update{" "}
        <code>SponsorCarousel.tsx</code>.
      </div>
    );
  }

  const rotated = SPONSORS.slice(offset).concat(SPONSORS.slice(0, offset)).slice(0, VISIBLE);

  return (
    <div className="flex items-center gap-10 h-16">
      {rotated.map((s, i) => (
        <img
          key={`${s.src}-${i}`}
          src={s.src}
          alt={s.alt}
          className="h-12 max-w-[180px] object-contain transition-opacity duration-700"
        />
      ))}
    </div>
  );
}
