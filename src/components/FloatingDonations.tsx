"use client";

import { useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/format";

export type FloatItem = {
  key: number;
  name: string;
  amountCents: number;
  left: number; // vw
};

// Toont bij elke nieuwe donatie een grote "+€50 ✨ van Anna" die omhoog
// zweeft en vervaagt. Trigger via de `signal`-prop (verhoog bij elke donatie).
export function FloatingDonations({
  signal,
  name,
  amountCents,
}: {
  signal: number;
  name: string;
  amountCents: number;
}) {
  const [items, setItems] = useState<FloatItem[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (signal === 0 || signal === seen.current) return;
    seen.current = signal;
    const key = signal;
    const left = 30 + Math.random() * 40; // tussen 30vw en 70vw
    setItems((curr) => [...curr, { key, name, amountCents, left }]);
    const t = setTimeout(() => {
      setItems((curr) => curr.filter((i) => i.key !== key));
    }, 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal]);

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {items.map((it) => (
        <div
          key={it.key}
          className="absolute bottom-[28%] anim-rise"
          style={{ left: `${it.left}vw` }}
        >
          <div className="glass rounded-full px-7 py-4 flex items-center gap-3 -translate-x-1/2">
            <span className="text-4xl">✨</span>
            <div className="leading-tight">
              <p className="text-3xl font-bold text-white glow-text tabular">
                +{formatEuro(it.amountCents, it.amountCents % 100 !== 0)}
              </p>
              <p className="text-white/85 text-sm">van {it.name}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
