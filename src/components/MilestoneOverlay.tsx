"use client";

import { useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

const MESSAGES: Record<number, { title: string; emoji: string }> = {
  25: { title: "Kwart van het doel!", emoji: "🎉" },
  50: { title: "Halverwege!", emoji: "💛" },
  75: { title: "Driekwart — bijna daar!", emoji: "🌟" },
  100: { title: "DOEL BEHAALD!", emoji: "🏆" },
};

// Full-screen viering wanneer een mijlpaal (25/50/75/100%) wordt bereikt.
// Verschijnt ~5,5s en vervaagt dan vanzelf.
export function MilestoneOverlay({
  milestone,
  totalCents,
}: {
  milestone: number | null;
  totalCents: number;
}) {
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!milestone) return;
    setShown(milestone);
    const t = setTimeout(() => setShown(null), 5500);
    return () => clearTimeout(t);
  }, [milestone]);

  if (!shown) return null;
  const msg = MESSAGES[shown] ?? { title: `${shown}%`, emoji: "✨" };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center anim-fade-in">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative text-center anim-zoom-bounce px-8">
        <p className="text-[9rem] leading-none mb-4">{msg.emoji}</p>
        <h2 className="text-7xl lg:text-8xl font-bold text-white glow-text">
          {msg.title}
        </h2>
        <p className="mt-6 text-4xl text-blissi-geel font-bold tabular">
          {formatEuro(totalCents)} opgehaald
        </p>
        <p className="mt-4 text-2xl text-white/90 italic">
          ook met kanker mag je stralen
        </p>
      </div>
    </div>
  );
}
