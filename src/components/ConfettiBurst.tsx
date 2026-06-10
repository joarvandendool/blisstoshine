"use client";

import { useEffect } from "react";
import confetti from "canvas-confetti";

const BLISSI_COLORS = [
  "#B23560",
  "#D66871",
  "#F0947F",
  "#DC88B9",
  "#FFEF80",
  "#B6D180",
  "#75AAE0",
  "#DD7574",
];

export function confettiBurst(intensity: "small" | "big" = "small") {
  if (intensity === "small") {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.7 },
      colors: BLISSI_COLORS,
      scalar: 0.9,
    });
    return;
  }
  // Mega burst voor mijlpalen
  const end = Date.now() + 1500;
  (function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 55,
      origin: { x: 0, y: 0.8 },
      colors: BLISSI_COLORS,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 55,
      origin: { x: 1, y: 0.8 },
      colors: BLISSI_COLORS,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({
    particleCount: 200,
    spread: 120,
    startVelocity: 45,
    origin: { y: 0.6 },
    colors: BLISSI_COLORS,
  });
}

export function ConfettiTrigger({ trigger }: { trigger: number }) {
  useEffect(() => {
    if (trigger > 0) confettiBurst("small");
  }, [trigger]);
  return null;
}
