"use client";

import { useEffect, useState } from "react";

// Ronddraaiende ronde foto's (Bliss to Shine-stijl).
// Zet echte foto's in /public/photos/ en vul ze hier in:
//   const PHOTOS = [{ src: "/photos/dag1.jpg", alt: "Shine Day" }, ...]
// Zolang de lijst leeg is tonen we vrolijke illustratie-tegels als fallback,
// zodat het scherm ook zonder foto's al feestelijk oogt.
type Photo = { src: string; alt: string };
const PHOTOS: Photo[] = [];

const FALLBACK = [
  { emoji: "🌻", word: "samen", from: "#DC88B9", to: "#B23560" },
  { emoji: "💛", word: "stralen", from: "#FFEF80", to: "#F0947F" },
  { emoji: "🤝", word: "warmte", from: "#75AAE0", to: "#1A5380" },
  { emoji: "🎈", word: "hoop", from: "#B6D180", to: "#75AAE0" },
  { emoji: "⭐", word: "bliss", from: "#F0947F", to: "#DC88B9" },
  { emoji: "🌈", word: "shine", from: "#D66871", to: "#FFEF80" },
];

const VISIBLE = 3;
const ROTATE_MS = 4000;

export function PhotoCollage() {
  const [offset, setOffset] = useState(0);
  const usingFallback = PHOTOS.length === 0;
  const pool = usingFallback ? FALLBACK : PHOTOS;

  useEffect(() => {
    if (pool.length <= VISIBLE) return;
    const t = setInterval(() => setOffset((o) => (o + 1) % pool.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [pool.length]);

  const tiles = Array.from({ length: Math.min(VISIBLE, pool.length) }, (_, i) =>
    pool[(offset + i) % pool.length]
  );

  return (
    <div className="flex items-center gap-4">
      {tiles.map((tile, i) => (
        <div
          key={i}
          className="relative w-24 h-24 lg:w-28 lg:h-28 rounded-full overflow-hidden border-4 border-white/70 shadow-xl anim-float"
          style={{ animationDelay: `${i * 0.4}s` }}
        >
          {usingFallback ? (
            <div
              className="w-full h-full flex flex-col items-center justify-center text-white"
              style={{
                background: `linear-gradient(135deg, ${
                  (tile as (typeof FALLBACK)[number]).from
                }, ${(tile as (typeof FALLBACK)[number]).to})`,
              }}
            >
              <span className="text-3xl">
                {(tile as (typeof FALLBACK)[number]).emoji}
              </span>
              <span className="text-xs font-semibold mt-0.5">
                {(tile as (typeof FALLBACK)[number]).word}
              </span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(tile as Photo).src}
              alt={(tile as Photo).alt}
              className="w-full h-full object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
}
