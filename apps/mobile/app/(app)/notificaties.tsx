// Notificatiecentrum: bestaande meldingen van het platform, met deep links
// naar het juiste scherm en een veilige fallback.

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { resolveDeepLink, targetToPath, type NotificationView } from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import {
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
} from "@/components/ui";
import { inkt, kleur, typo } from "@/theme/tokens";

export default function Notificaties() {
  const router = useRouter();
  const [meldingen, setMeldingen] = useState<NotificationView[] | null>(null);
  const [ongelezen, setOngelezen] = useState(0);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      const res = await kandidaatApi.notificaties();
      setMeldingen(res.notifications);
      setOngelezen(res.unreadCount);
    } catch (e) {
      setMeldingen([]);
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Notificaties laden is niet gelukt.",
      );
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Notificaties", headerBackTitle: "Terug" }}
      />
      <Kop tekst="Jouw" accent="meldingen" />
      <FoutMelding tekst={fout} />
      {ongelezen > 0 ? (
        <Knop
          label={`Alles gelezen (${ongelezen} ongelezen)`}
          variant="secundair"
          onPress={async () => {
            await kandidaatApi.allesGelezen().catch(() => {});
            await laad();
          }}
        />
      ) : null}

      {meldingen === null ? <LaadStaat /> : null}
      {meldingen?.length === 0 ? <LegeStaat titel="Geen meldingen" /> : null}

      {meldingen?.map((melding) => (
        <Pressable
          key={melding.id}
          accessibilityRole="button"
          accessibilityLabel={`${melding.title}. ${melding.body}`}
          onPress={() => router.push(targetToPath(resolveDeepLink(melding.href)) as never)}
        >
          <Kaart sterk={!melding.readAt}>
            <Text style={[typo.h3, { color: kleur.inkt }]}>
              {!melding.readAt ? "● " : ""}
              {melding.title}
            </Text>
            <Text style={[typo.klein, { color: inkt(0.65) }]}>{melding.body}</Text>
            <Text style={[typo.klein, { color: inkt(0.4) }]}>
              {new Date(melding.createdAt).toLocaleString("nl-NL")}
            </Text>
          </Kaart>
        </Pressable>
      ))}
    </Scherm>
  );
}
