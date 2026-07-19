// Reduced motion: alle ambient animatie (MatchShape-drift, zweving) staat
// uit wanneer de gebruiker "Verminder beweging" heeft ingeschakeld. De
// statische compositie is altijd correct — motion voegt alleen sfeer toe.

import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [verminderd, setVerminderd] = useState(false);
  useEffect(() => {
    let actueel = true;
    AccessibilityInfo.isReduceMotionEnabled().then((aan) => {
      if (actueel) setVerminderd(aan);
    });
    const abonnement = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setVerminderd,
    );
    return () => {
      actueel = false;
      abonnement.remove();
    };
  }, []);
  return verminderd;
}
