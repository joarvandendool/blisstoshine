// UI-primitieven — de native vertaling van src/components/ui.tsx van de
// webapp: glass-kaarten, pill-knoppen en -chips, ScoreBadge en rustige
// voortgang. Alle tikdoelen ≥48pt; status nooit alleen met kleur (icoon of
// tekst ernaast); volledige VoiceOver-labels.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MATCH_LABEL_TEKST } from "@mondzorgwerkt/api-contract";
import { inkt, kleur, radius, ruimte, schaduw, tikdoel, typo } from "@/theme/tokens";

/* ------------------------------- Scherm -------------------------------- */

export function Scherm({
  children,
  scroll = true,
  onderrand = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  onderrand?: boolean;
}) {
  const inhoud = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: ruimte.m, paddingBottom: ruimte.xxl, gap: ruimte.m }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1, padding: ruimte.m, gap: ruimte.m }}>{children}</View>
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: kleur.oppervlak }}
      edges={onderrand ? ["top", "left", "right", "bottom"] : ["top", "left", "right"]}
    >
      {inhoud}
    </SafeAreaView>
  );
}

/* -------------------------------- Kaart -------------------------------- */

export function Kaart({
  children,
  sterk = false,
  style,
}: {
  children: React.ReactNode;
  sterk?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        stijlen.kaart,
        sterk ? stijlen.kaartSterk : null,
        sterk ? schaduw.glassSterk : schaduw.glass,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* -------------------------------- Koppen ------------------------------- */

/**
 * Editorial kop: laatste woord in cursieve serif — de "mondzorgwerkt"-
 * typografieconventie (accent-serif in globals.css).
 */
export function Kop({ tekst, accent }: { tekst: string; accent?: string }) {
  return (
    <Text style={[typo.h1, { color: kleur.inkt }]} accessibilityRole="header">
      {tekst}
      {accent ? (
        <Text style={[typo.serifItalic, { color: kleur.blauw600, fontWeight: "700" }]}>
          {" "}
          {accent}
        </Text>
      ) : null}
    </Text>
  );
}

export function SectieKop({ tekst }: { tekst: string }) {
  return (
    <Text style={[typo.eyebrow, { color: inkt(0.55), marginTop: ruimte.s }]}>
      {tekst}
    </Text>
  );
}

export function BodyTekst({
  tekst,
  gedempt = false,
}: {
  tekst: string;
  gedempt?: boolean;
}) {
  return (
    <Text style={[typo.body, { color: gedempt ? inkt(0.6) : kleur.inkt }]}>{tekst}</Text>
  );
}

/* -------------------------------- Knoppen ------------------------------ */

export function Knop({
  label,
  onPress,
  variant = "primair",
  bezig = false,
  uitgeschakeld = false,
  toegankelijkheidsHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "primair" | "secundair" | "roze" | "gevaar" | "ghost";
  bezig?: boolean;
  uitgeschakeld?: boolean;
  toegankelijkheidsHint?: string;
}) {
  const nietActief = uitgeschakeld || bezig;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={toegankelijkheidsHint}
      accessibilityState={{ disabled: nietActief, busy: bezig }}
      disabled={nietActief}
      onPress={onPress}
      style={({ pressed }) => [
        stijlen.knop,
        variant === "primair" && [{ backgroundColor: kleur.blauw600 }, schaduw.knopBlauw],
        variant === "roze" && { backgroundColor: kleur.roze500 },
        variant === "secundair" && {
          backgroundColor: kleur.wit,
          borderWidth: 1,
          borderColor: inkt(0.12),
        },
        variant === "gevaar" && { backgroundColor: kleur.rood700 },
        variant === "ghost" && { backgroundColor: "transparent" },
        pressed && !nietActief && { transform: [{ scale: 0.98 }], opacity: 0.92 },
        nietActief && { opacity: 0.5 },
      ]}
    >
      {bezig ? (
        <ActivityIndicator
          color={variant === "secundair" || variant === "ghost" ? kleur.blauw600 : kleur.wit}
        />
      ) : (
        <Text
          style={[
            stijlen.knopTekst,
            (variant === "secundair" || variant === "ghost") && { color: kleur.blauw700 },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* ------------------------------ Chip & Badge --------------------------- */

export function Chip({
  label,
  geselecteerd,
  onPress,
}: {
  label: string;
  geselecteerd: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: geselecteerd }}
      onPress={onPress}
      style={({ pressed }) => [
        stijlen.chip,
        geselecteerd
          ? { backgroundColor: kleur.blauw600 }
          : { backgroundColor: kleur.wit, borderWidth: 1, borderColor: inkt(0.14) },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          typo.klein,
          { fontWeight: "500" },
          geselecteerd ? { color: kleur.wit } : { color: kleur.inkt },
        ]}
      >
        {geselecteerd ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

export function Badge({
  label,
  toon = "neutraal",
}: {
  label: string;
  toon?: "blauw" | "roze" | "groen" | "amber" | "rood" | "neutraal";
}) {
  const kleuren: Record<string, { bg: string; tekst: string }> = {
    blauw: { bg: kleur.cloud, tekst: kleur.blauw900 },
    roze: { bg: kleur.roze100, tekst: kleur.roze800 },
    groen: { bg: kleur.groen100, tekst: kleur.groen800 },
    amber: { bg: kleur.amber100, tekst: kleur.amber800 },
    rood: { bg: kleur.rood100, tekst: kleur.rood700 },
    neutraal: { bg: inkt(0.08), tekst: kleur.inkt },
  };
  const c = kleuren[toon];
  return (
    <View style={[stijlen.badge, { backgroundColor: c.bg }]}>
      <Text style={[typo.klein, { color: c.tekst, fontWeight: "500" }]}>{label}</Text>
    </View>
  );
}

/** Scorebadge — zelfde labelteksten en kleurrollen als de webapp. */
export function ScoreBadge({ score, label }: { score: number; label: string }) {
  const tekst = MATCH_LABEL_TEKST[label] ?? label;
  const stijl =
    label === "excellent"
      ? { bg: kleur.blauw600, tekst: kleur.wit }
      : label === "good"
        ? { bg: kleur.cloud, tekst: kleur.blauw900 }
        : label === "partial"
          ? { bg: kleur.roze100, tekst: kleur.roze800 }
          : label === "low"
            ? { bg: inkt(0.08), tekst: kleur.inkt }
            : { bg: kleur.wit, tekst: inkt(0.6) };
  return (
    <View
      accessibilityLabel={`${tekst}${label !== "ineligible" ? `, ${score} procent` : ""}`}
      style={[
        stijlen.badge,
        { backgroundColor: stijl.bg },
        label === "ineligible" && { borderWidth: 1, borderColor: inkt(0.14) },
      ]}
    >
      <Text style={[typo.klein, { color: stijl.tekst, fontWeight: "600" }]}>
        {label !== "ineligible" ? `${score}% · ` : ""}
        {tekst}
      </Text>
    </View>
  );
}

/* ------------------------------ Voortgang ------------------------------ */

export function VoortgangsBalk({
  waarde,
  label,
}: {
  waarde: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, waarde));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? `${pct} procent`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={stijlen.voortgangSpoor}
    >
      <View style={[stijlen.voortgangVulling, { width: `${pct}%` }]} />
    </View>
  );
}

/* -------------------------------- Velden ------------------------------- */

export function Veld({
  label,
  ...props
}: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={[typo.klein, { color: inkt(0.7), fontWeight: "500" }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={inkt(0.35)}
        style={stijlen.veld}
        {...props}
      />
    </View>
  );
}

/* ------------------------------ Leeg & fout ----------------------------- */

export function LegeStaat({
  titel,
  tekst,
}: {
  titel: string;
  tekst?: string;
}) {
  return (
    <Kaart style={{ alignItems: "center", gap: 8, paddingVertical: ruimte.xl }}>
      <Text style={[typo.h3, { color: kleur.inkt, textAlign: "center" }]}>{titel}</Text>
      {tekst ? (
        <Text style={[typo.klein, { color: inkt(0.6), textAlign: "center" }]}>{tekst}</Text>
      ) : null}
    </Kaart>
  );
}

export function FoutMelding({ tekst }: { tekst: string | null }) {
  if (!tekst) return null;
  return (
    <View accessibilityLiveRegion="polite" style={stijlen.fout}>
      <Text style={[typo.klein, { color: kleur.rood700 }]}>{tekst}</Text>
    </View>
  );
}

export function LaadStaat({ label = "Laden…" }: { label?: string }) {
  return (
    <View style={{ padding: ruimte.xl, alignItems: "center", gap: ruimte.s }}>
      <ActivityIndicator color={kleur.blauw600} size="large" />
      <Text style={[typo.klein, { color: inkt(0.5) }]}>{label}</Text>
    </View>
  );
}

/* ------------------------------- stijlen -------------------------------- */

const stijlen = StyleSheet.create({
  kaart: {
    backgroundColor: "rgba(255,255,255,0.85)",
    borderColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderRadius: radius.kaart,
    padding: ruimte.l,
    gap: 10,
  },
  kaartSterk: {
    backgroundColor: kleur.wit,
  },
  knop: {
    minHeight: tikdoel,
    borderRadius: radius.pill,
    paddingHorizontal: ruimte.l,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  knopTekst: {
    color: kleur.wit,
    fontSize: 16,
    fontWeight: "600",
  },
  chip: {
    minHeight: 40,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  voortgangSpoor: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(205,223,238,0.7)",
    overflow: "hidden",
  },
  voortgangVulling: {
    height: 8,
    borderRadius: 4,
    backgroundColor: kleur.blauw600,
  },
  veld: {
    minHeight: tikdoel,
    borderRadius: radius.veld,
    borderWidth: 1,
    borderColor: "rgba(10,13,28,0.14)",
    backgroundColor: kleur.wit,
    paddingHorizontal: 14,
    fontSize: 16,
    color: kleur.inkt,
  },
  fout: {
    backgroundColor: kleur.rood50,
    borderRadius: radius.veld,
    padding: 12,
  },
});
