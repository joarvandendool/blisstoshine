// Account health — puur domein, geen database.
//
// computeAccountHealth() vertaalt een getypeerd feitenobject (verzameld door
// src/server/account-health.ts) naar een uitlegbare, geversioneerde
// gezondheidsscore. Elke reden heeft een stabiele code, een Nederlandse
// uitleg en een impact in punten; de score is de basisscore plus de som van
// alle impacts (begrensd op 0–100). Gewichten en drempels staan hieronder als
// geëxporteerde constanten zodat wijzigingen zichtbaar en versieerbaar zijn.
//
// Alleen voor INTERN gebruik: dit domein produceert geen klantgerichte
// berichten en triggert geen automatische contractwijzigingen.

export const HEALTH_VERSION = "1.0.0";

// ---------- typen ----------

export type AccountHealthStatus =
  | "healthy"
  | "attention"
  | "at_risk"
  | "onboarding_incomplete";

export interface AccountHealthReason {
  /** Stabiele code, bv. "betaling_achterstallig". */
  code: string;
  /** Nederlandse uitleg voor het interne dashboard. */
  uitleg: string;
  /** Bijdrage aan de score in punten (positief of negatief). */
  impact: number;
}

export interface AccountHealth {
  status: AccountHealthStatus;
  /** 0–100: basisscore + som van alle reason-impacts, begrensd. */
  score: number;
  reasons: AccountHealthReason[];
  calculatedAt: Date;
  version: string;
}

/** Effectieve betaalstatus zoals de billinglaag die kent ("none" = geen abonnement). */
export type Betaalstatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trial_expired"
  | "none";

export type Gebruikstrend = "stijgend" | "stabiel" | "dalend";

/**
 * Het feitenobject waarop de gezondheid wordt berekend. Alle waarden zijn
 * vooraf verzameld (geen DB-toegang hier); null betekent "onbekend" of
 * "niet van toepassing".
 */
export interface AccountHealthInput {
  onboardingVoltooid: boolean;
  /** Dagen sinds de laatste activiteit; null = nooit activiteit gezien. */
  laatsteActiviteitDagen: number | null;
  actieveSeats: number;
  actieveLocaties: number;
  actieveVacatures: number;
  matchesBekeken30d: number;
  simulaties30d: number;
  uitnodigingen30d: number;
  /** Fractie 0–1; null = onvoldoende data. */
  responseRate: number | null;
  gesprekken90d: number;
  plaatsingen90d: number;
  bezettingsplannerGebruik30d: number;
  marktinzichtenGebruik30d: number;
  betaalstatus: Betaalstatus;
  gebruikstrend: Gebruikstrend;
  /** Dagen tot de volgende verlenging; null = geen (lopend) abonnement. */
  dagenTotVerlenging: number | null;
}

// ---------- gewichten en drempels (uitlegbaar + versieerbaar) ----------

/** Startpunt van elke score; redenen tellen hierbij op of af. */
export const HEALTH_BASE_SCORE = 50;

/** Statusdrempels op de eindscore (healthy ≥ 70, attention ≥ 40, anders at_risk). */
export const HEALTH_STATUS_THRESHOLDS = {
  healthy: 70,
  attention: 40,
} as const;

/** Drempels op de invoerfeiten. */
export const HEALTH_THRESHOLDS = {
  /** Activiteit binnen dit aantal dagen telt als "recent actief". */
  recentActiefDagen: 7,
  /** Langer dan dit aantal dagen geen activiteit telt als "lang inactief". */
  langInactiefDagen: 30,
  /** Responsrate vanaf deze fractie telt als goed. */
  goedeResponseRate: 0.5,
  /** Responsrate onder deze fractie telt als laag. */
  lageResponseRate: 0.2,
  /** Vanaf dit aantal seats telt het account als teamadoptie. */
  teamSeats: 2,
  /** Dalend gebruik binnen dit aantal dagen vóór verlenging is een risico. */
  verlengingNabijDagen: 30,
} as const;

/** Impact in punten per reden-code. */
export const HEALTH_WEIGHTS = {
  onboarding_onvolledig: -30,
  recent_actief: 10,
  lang_inactief: -20,
  actieve_vacatures: 5,
  geen_actieve_vacatures: -5,
  matches_bekeken: 5,
  uitnodigingen_verstuurd: 5,
  geen_uitnodigingen_bij_vacatures: -5,
  goede_responsrate: 5,
  lage_responsrate: -10,
  gesprekken_gepland: 5,
  plaatsingen_gerealiseerd: 10,
  simulaties_gedraaid: 4,
  bezettingsplanner_gebruikt: 5,
  marktinzichten_gebruikt: 3,
  team_actief: 4,
  betaling_achterstallig: -25,
  geen_actief_abonnement: -30,
  gebruik_stijgend: 10,
  gebruik_dalend: -15,
  dalend_voor_verlenging: -10,
} as const;

export type HealthReasonCode = keyof typeof HEALTH_WEIGHTS;

// ---------- berekening ----------

function clamp(waarde: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, waarde));
}

/**
 * Berekent de accountgezondheid uit het feitenobject. Deterministisch: bij
 * gelijke input (en gelijk `calculatedAt`) is de uitkomst identiek.
 *
 * Statusregels:
 * - onboarding niet voltooid → status "onboarding_incomplete" (overheerst);
 * - betaalstatus past_due, geen actief abonnement, of dalend gebruik vlak
 *   vóór de verlenging → minimaal "at_risk";
 * - anders bepaalt de score de status via HEALTH_STATUS_THRESHOLDS.
 */
export function computeAccountHealth(
  input: AccountHealthInput,
  calculatedAt: Date = new Date(),
): AccountHealth {
  const reasons: AccountHealthReason[] = [];
  const voegToe = (code: HealthReasonCode, uitleg: string) => {
    reasons.push({ code, uitleg, impact: HEALTH_WEIGHTS[code] });
  };

  // Onboarding
  if (!input.onboardingVoltooid) {
    voegToe(
      "onboarding_onvolledig",
      "De onboarding is nog niet afgerond — de praktijk heeft het eerste waardemoment nog niet bereikt.",
    );
  }

  // Activiteit
  if (
    input.laatsteActiviteitDagen !== null &&
    input.laatsteActiviteitDagen <= HEALTH_THRESHOLDS.recentActiefDagen
  ) {
    voegToe(
      "recent_actief",
      `Recent actief: laatste activiteit ${input.laatsteActiviteitDagen} ${input.laatsteActiviteitDagen === 1 ? "dag" : "dagen"} geleden.`,
    );
  } else if (
    input.laatsteActiviteitDagen === null ||
    input.laatsteActiviteitDagen > HEALTH_THRESHOLDS.langInactiefDagen
  ) {
    voegToe(
      "lang_inactief",
      input.laatsteActiviteitDagen === null
        ? "Nog nooit activiteit gezien in het product."
        : `Lang inactief: laatste activiteit ${input.laatsteActiviteitDagen} dagen geleden.`,
    );
  }

  // Kernfunnel: vacatures, matches, uitnodigingen
  if (input.actieveVacatures > 0) {
    voegToe(
      "actieve_vacatures",
      `${input.actieveVacatures} actieve ${input.actieveVacatures === 1 ? "vacature" : "vacatures"} gepubliceerd.`,
    );
  } else {
    voegToe("geen_actieve_vacatures", "Geen enkele actieve vacature.");
  }

  if (input.matchesBekeken30d > 0) {
    voegToe(
      "matches_bekeken",
      `Matches en kandidaatinzichten bekeken in de afgelopen 30 dagen (${input.matchesBekeken30d}×).`,
    );
  }

  if (input.uitnodigingen30d > 0) {
    voegToe(
      "uitnodigingen_verstuurd",
      `${input.uitnodigingen30d} kandidaat-uitnodigingen verstuurd in de afgelopen 30 dagen.`,
    );
  } else if (input.actieveVacatures > 0) {
    voegToe(
      "geen_uitnodigingen_bij_vacatures",
      "Wel actieve vacatures, maar geen uitnodigingen in de afgelopen 30 dagen.",
    );
  }

  // Responsiviteit richting kandidaten
  if (input.responseRate !== null) {
    if (input.responseRate >= HEALTH_THRESHOLDS.goedeResponseRate) {
      voegToe(
        "goede_responsrate",
        `Reageert goed op kandidaten (responsrate ${Math.round(input.responseRate * 100)}%).`,
      );
    } else if (input.responseRate < HEALTH_THRESHOLDS.lageResponseRate) {
      voegToe(
        "lage_responsrate",
        `Reageert nauwelijks op kandidaten (responsrate ${Math.round(input.responseRate * 100)}%).`,
      );
    }
  }

  // Uitkomsten: gesprekken en plaatsingen
  if (input.gesprekken90d > 0) {
    voegToe(
      "gesprekken_gepland",
      `${input.gesprekken90d} ${input.gesprekken90d === 1 ? "gesprek" : "gesprekken"} gepland in de afgelopen 90 dagen.`,
    );
  }
  if (input.plaatsingen90d > 0) {
    voegToe(
      "plaatsingen_gerealiseerd",
      `${input.plaatsingen90d} ${input.plaatsingen90d === 1 ? "plaatsing" : "plaatsingen"} gerealiseerd in de afgelopen 90 dagen.`,
    );
  }

  // Verdieping: simulaties, bezettingsplanner, marktinzichten, team
  if (input.simulaties30d > 0) {
    voegToe(
      "simulaties_gedraaid",
      `Match Studio-simulaties gedraaid in de afgelopen 30 dagen (${input.simulaties30d}×).`,
    );
  }
  if (input.bezettingsplannerGebruik30d > 0) {
    voegToe(
      "bezettingsplanner_gebruikt",
      "De bezettingsplanner is in de afgelopen 30 dagen gebruikt.",
    );
  }
  if (input.marktinzichtenGebruik30d > 0) {
    voegToe(
      "marktinzichten_gebruikt",
      "Marktinzichten zijn in de afgelopen 30 dagen geraadpleegd.",
    );
  }
  if (input.actieveSeats >= HEALTH_THRESHOLDS.teamSeats) {
    voegToe(
      "team_actief",
      `Meerdere teamleden actief (${input.actieveSeats} seats) — het product is in het team verankerd.`,
    );
  }

  // Betaalstatus
  if (input.betaalstatus === "past_due") {
    voegToe(
      "betaling_achterstallig",
      "De laatste betaling is mislukt (past_due) — het abonnement zit in de coulanceperiode.",
    );
  } else if (
    input.betaalstatus === "canceled" ||
    input.betaalstatus === "trial_expired" ||
    input.betaalstatus === "none"
  ) {
    voegToe(
      "geen_actief_abonnement",
      "Geen actief abonnement (beëindigd, trial verlopen of nooit gestart).",
    );
  }

  // Gebruikstrend, met extra gewicht vlak voor de verlenging
  const verlengingNabij =
    input.dagenTotVerlenging !== null &&
    input.dagenTotVerlenging <= HEALTH_THRESHOLDS.verlengingNabijDagen;
  if (input.gebruikstrend === "stijgend") {
    voegToe("gebruik_stijgend", "Het gebruik stijgt ten opzichte van de vorige periode.");
  } else if (input.gebruikstrend === "dalend") {
    voegToe("gebruik_dalend", "Het gebruik daalt ten opzichte van de vorige periode.");
    if (verlengingNabij) {
      voegToe(
        "dalend_voor_verlenging",
        `Dalend gebruik terwijl de verlenging nabij is (over ${input.dagenTotVerlenging} dagen) — verhoogd churnrisico.`,
      );
    }
  }

  const som = reasons.reduce((acc, r) => acc + r.impact, 0);
  const score = clamp(HEALTH_BASE_SCORE + som, 0, 100);

  // Statusbepaling: onboarding overheerst; daarna geforceerde risico's; daarna
  // de scoredrempels.
  let status: AccountHealthStatus;
  if (!input.onboardingVoltooid) {
    status = "onboarding_incomplete";
  } else if (
    input.betaalstatus === "past_due" ||
    input.betaalstatus === "canceled" ||
    input.betaalstatus === "trial_expired" ||
    input.betaalstatus === "none" ||
    (input.gebruikstrend === "dalend" && verlengingNabij)
  ) {
    status = "at_risk";
  } else if (score >= HEALTH_STATUS_THRESHOLDS.healthy) {
    status = "healthy";
  } else if (score >= HEALTH_STATUS_THRESHOLDS.attention) {
    status = "attention";
  } else {
    status = "at_risk";
  }

  return { status, score, reasons, calculatedAt, version: HEALTH_VERSION };
}

/** Nederlandse labels voor de statusbadges op het interne dashboard. */
export const HEALTH_STATUS_LABELS: Record<AccountHealthStatus, string> = {
  healthy: "Gezond",
  attention: "Aandacht",
  at_risk: "Risico",
  onboarding_incomplete: "Onboarding onvolledig",
};
