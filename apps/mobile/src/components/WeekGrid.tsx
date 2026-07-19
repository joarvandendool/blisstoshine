// WeekGrid — duidelijke dag- en dagdeelweergave, geport van
// src/components/WeekGrid.tsx (web). 7 dagen × 3 dagdelen; status wordt
// NOOIT alleen met kleur weergegeven (altijd symbool + legenda). Cellen
// cyclen bij tikken: voorkeur → beschikbaar → niet. Tikdoelen ≥44pt.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  DAYPARTS,
  WEEKDAYS,
  label as taxLabel,
  type AvailabilityLevel,
  type CandidateAvailability,
  type VacancySchedule,
  type Weekday,
} from "@mondzorgwerkt/api-contract";
import { inkt, kleur, radius, typo } from "@/theme/tokens";

type Modus = "kandidaat" | "alleenLezen" | "overlay";

const DAG_KORT: Record<Weekday, string> = {
  ma: "Ma",
  di: "Di",
  wo: "Wo",
  do: "Do",
  vr: "Vr",
  za: "Za",
  zo: "Zo",
};

const VOLGENDE: Record<AvailabilityLevel, AvailabilityLevel> = {
  preferred: "available",
  available: "unavailable",
  unavailable: "preferred",
};

function celStijl(niveau: AvailabilityLevel) {
  switch (niveau) {
    case "preferred":
      return { bg: kleur.blauw600, tekst: kleur.wit, symbool: "★" };
    case "available":
      return { bg: kleur.cloud, tekst: kleur.blauw900, symbool: "✓" };
    case "unavailable":
      return { bg: "rgba(255,255,255,0.5)", tekst: inkt(0.4), symbool: "–" };
  }
}

type OverlayStand = "match" | "deels" | "mismatch" | "nietGevraagd";

function overlayStand(
  eis: "required" | "preferred" | null,
  niveau: AvailabilityLevel,
): OverlayStand {
  if (!eis) return "nietGevraagd";
  if (niveau === "preferred") return "match";
  if (niveau === "available") return eis === "required" ? "match" : "deels";
  return "mismatch";
}

function overlayStijl(stand: OverlayStand) {
  switch (stand) {
    case "match":
      return { bg: kleur.blauw600, tekst: kleur.wit, symbool: "✓" };
    case "deels":
      return { bg: kleur.roze100, tekst: kleur.roze800, symbool: "◐" };
    case "mismatch":
      return { bg: kleur.rood50, tekst: kleur.rood700, symbool: "✕" };
    case "nietGevraagd":
      return { bg: "rgba(255,255,255,0.4)", tekst: inkt(0.3), symbool: "–" };
  }
}

const NIVEAU_LABEL: Record<AvailabilityLevel, string> = {
  preferred: "voorkeur",
  available: "beschikbaar",
  unavailable: "niet beschikbaar",
};

export function WeekGrid({
  modus,
  availability,
  schedule,
  onWijzig,
}: {
  modus: Modus;
  availability: CandidateAvailability;
  /** Alleen voor overlay: het gevraagde rooster van de vacature. */
  schedule?: VacancySchedule;
  onWijzig?: (dag: Weekday, dagdeel: (typeof DAYPARTS)[number], niveau: AvailabilityLevel) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={stijlen.rij}>
        <View style={stijlen.dagdeelKolom} />
        {WEEKDAYS.map((dag) => (
          <Text
            key={dag}
            style={[
              stijlen.dagKop,
              (dag === "za" || dag === "zo") && { opacity: 0.6 },
            ]}
          >
            {DAG_KORT[dag]}
          </Text>
        ))}
      </View>

      {DAYPARTS.map((dagdeel) => (
        <View key={dagdeel} style={stijlen.rij}>
          <Text style={[stijlen.dagdeelKolom, typo.klein, { color: inkt(0.6) }]}>
            {taxLabel(dagdeel)}
          </Text>
          {WEEKDAYS.map((dag) => {
            const niveau = availability[dag][dagdeel];
            const interactief = modus === "kandidaat" && onWijzig;

            let stijl: { bg: string; tekst: string; symbool: string };
            let a11y: string;
            if (modus === "overlay" && schedule) {
              const stand = overlayStand(schedule[dag][dagdeel], niveau);
              stijl = overlayStijl(stand);
              const standTekst =
                stand === "match"
                  ? "past"
                  : stand === "deels"
                    ? "past deels"
                    : stand === "mismatch"
                      ? "past niet"
                      : "niet gevraagd";
              a11y = `${taxLabel(dag)} ${taxLabel(dagdeel)}: ${standTekst}`;
            } else {
              stijl = celStijl(niveau);
              a11y = `${taxLabel(dag)} ${taxLabel(dagdeel)}: ${NIVEAU_LABEL[niveau]}`;
            }

            return (
              <Pressable
                key={dag}
                disabled={!interactief}
                accessibilityRole={interactief ? "button" : undefined}
                accessibilityLabel={a11y}
                accessibilityHint={
                  interactief ? "Tik om te wisselen tussen voorkeur, beschikbaar en niet beschikbaar" : undefined
                }
                onPress={
                  interactief
                    ? () => onWijzig(dag, dagdeel, VOLGENDE[niveau])
                    : undefined
                }
                style={({ pressed }) => [
                  stijlen.cel,
                  { backgroundColor: stijl.bg },
                  (dag === "za" || dag === "zo") && { opacity: 0.85 },
                  pressed && { transform: [{ scale: 0.94 }] },
                ]}
              >
                <Text style={{ color: stijl.tekst, fontSize: 15, fontWeight: "600" }}>
                  {stijl.symbool}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <Legenda modus={modus} />
    </View>
  );
}

function Legenda({ modus }: { modus: Modus }) {
  const items =
    modus === "overlay"
      ? [
          { symbool: "✓", tekst: "Past", bg: kleur.blauw600, kleurTekst: kleur.wit },
          { symbool: "◐", tekst: "Past deels", bg: kleur.roze100, kleurTekst: kleur.roze800 },
          { symbool: "✕", tekst: "Past niet", bg: kleur.rood50, kleurTekst: kleur.rood700 },
          { symbool: "–", tekst: "Niet gevraagd", bg: "rgba(255,255,255,0.5)", kleurTekst: inkt(0.4) },
        ]
      : [
          { symbool: "★", tekst: "Voorkeur", bg: kleur.blauw600, kleurTekst: kleur.wit },
          { symbool: "✓", tekst: "Beschikbaar", bg: kleur.cloud, kleurTekst: kleur.blauw900 },
          { symbool: "–", tekst: "Niet beschikbaar", bg: "rgba(255,255,255,0.5)", kleurTekst: inkt(0.4) },
        ];
  return (
    <View style={stijlen.legenda}>
      {items.map((item) => (
        <View key={item.tekst} style={stijlen.legendaItem}>
          <View style={[stijlen.legendaBol, { backgroundColor: item.bg }]}>
            <Text style={{ color: item.kleurTekst, fontSize: 10, fontWeight: "600" }}>
              {item.symbool}
            </Text>
          </View>
          <Text style={[typo.klein, { color: inkt(0.6) }]}>{item.tekst}</Text>
        </View>
      ))}
    </View>
  );
}

const stijlen = StyleSheet.create({
  rij: { flexDirection: "row", gap: 4, alignItems: "center" },
  dagdeelKolom: { width: 64 },
  dagKop: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(10,13,28,0.55)",
  },
  cel: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.cel,
    alignItems: "center",
    justifyContent: "center",
  },
  legenda: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 4,
  },
  legendaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendaBol: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
