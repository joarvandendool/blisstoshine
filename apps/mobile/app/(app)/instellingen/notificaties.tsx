// Notificatievoorkeuren: per type in-app, e-mail en push. Pushmeldingen
// vragen eerst expliciete systeemtoestemming (opt-in).

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { Stack } from "expo-router";
import {
  CANDIDATE_NOTIFICATION_TYPES,
  type NotificationPreferenceView,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { meldPushAan } from "@/lib/push";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { BodyTekst, FoutMelding, Kaart, Knop, Kop, LaadStaat, Scherm } from "@/components/ui";
import { inkt, kleur, typo } from "@/theme/tokens";

const TYPE_LABELS: Record<string, string> = {
  invitation_received: "Nieuwe uitnodiging",
  interview_proposed: "Gesprek voorgesteld",
  interview_confirmed: "Gesprek bevestigd",
  strong_match_found: "Sterke nieuwe match",
  all: "Alles",
};

export default function NotificatieVoorkeuren() {
  const [voorkeuren, setVoorkeuren] = useState<NotificationPreferenceView[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [pushGeactiveerd, setPushGeactiveerd] = useState<boolean | null>(null);

  const laad = useCallback(async () => {
    try {
      const res = await kandidaatApi.notificatieVoorkeuren();
      setVoorkeuren(
        res.preferences.filter((p) =>
          (CANDIDATE_NOTIFICATION_TYPES as readonly string[]).includes(p.type),
        ),
      );
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Voorkeuren laden is niet gelukt.",
      );
      setVoorkeuren([]);
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  async function zet(
    voorkeur: NotificationPreferenceView,
    kanaal: "inApp" | "email" | "push",
    waarde: boolean,
  ) {
    const bijgewerkt = { ...voorkeur, [kanaal]: waarde };
    setVoorkeuren(
      (huidig) => huidig?.map((p) => (p.type === voorkeur.type ? bijgewerkt : p)) ?? null,
    );
    try {
      await kandidaatApi.bewaarNotificatieVoorkeur(bijgewerkt);
    } catch {
      setFout("Opslaan is niet gelukt. Probeer het opnieuw.");
      await laad();
    }
  }

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Notificatievoorkeuren", headerBackTitle: "Terug" }}
      />
      <Kop tekst="Notificatie-" accent="voorkeuren" />
      <BodyTekst
        gedempt
        tekst="Kies per melding hoe je die wilt ontvangen. Pushmeldingen bevatten nooit persoonlijke details — die zie je pas in de app."
      />

      <Kaart>
        <BodyTekst tekst="Pushmeldingen op dit toestel" />
        {pushGeactiveerd === true ? (
          <BodyTekst gedempt tekst="Actief — je ontvangt pushmeldingen volgens onderstaande voorkeuren." />
        ) : (
          <Knop
            label="Pushmeldingen inschakelen"
            onPress={async () => {
              const aan = await meldPushAan().catch(() => false);
              setPushGeactiveerd(aan);
              if (!aan) {
                setFout(
                  "Pushmeldingen zijn niet ingeschakeld. Controleer de toestemming in de iOS-instellingen.",
                );
              }
            }}
          />
        )}
      </Kaart>

      <FoutMelding tekst={fout} />
      {voorkeuren === null ? <LaadStaat /> : null}

      {voorkeuren?.map((voorkeur) => (
        <Kaart key={voorkeur.type}>
          <Text style={[typo.h3, { color: kleur.inkt }]}>
            {TYPE_LABELS[voorkeur.type] ?? voorkeur.type}
          </Text>
          {(
            [
              ["inApp", "In de app"],
              ["email", "E-mail"],
              ["push", "Push"],
            ] as const
          ).map(([kanaal, label]) => (
            <View key={kanaal} style={stijlen.rij}>
              <Text style={[typo.body, { color: inkt(0.75) }]}>{label}</Text>
              <Switch
                value={voorkeur[kanaal]}
                onValueChange={(waarde) => zet(voorkeur, kanaal, waarde)}
                accessibilityLabel={`${TYPE_LABELS[voorkeur.type] ?? voorkeur.type} via ${label}`}
                trackColor={{ true: kleur.blauw600, false: undefined }}
              />
            </View>
          ))}
        </Kaart>
      ))}
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  rij: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 44,
  },
});
