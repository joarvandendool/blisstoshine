// Gesprek bevestigen: kandidaat kiest één van de voorgestelde momenten.
// Deep-linkdoel (gesprek/:id) — bestaat het gesprek niet meer, dan volgt een
// veilige fallback naar de uitnodigingen-tab.

import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { InterviewView } from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import {
  BodyTekst,
  Chip,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
} from "@/components/ui";
import { inkt, typo } from "@/theme/tokens";

export default function GesprekScherm() {
  const { interviewId } = useLocalSearchParams<{ interviewId: string }>();
  const router = useRouter();
  const [gesprek, setGesprek] = useState<InterviewView | null | undefined>(undefined);
  const [slot, setSlot] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    try {
      const res = await kandidaatApi.gesprekken();
      setGesprek(res.interviews.find((i) => i.id === interviewId) ?? null);
    } catch {
      setGesprek(null);
    }
  }, [interviewId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  async function bevestig() {
    if (!gesprek || !slot || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      await kandidaatApi.bevestigGesprek(gesprek.id, { chosenSlot: slot });
      await laad();
    } catch (e) {
      if (e instanceof ApiFout && e.status === 409) {
        await laad(); // al bevestigd (ander apparaat) — staat tonen
      } else {
        setFout(
          e instanceof ApiFout || e instanceof NetwerkFout
            ? e.message
            : "Bevestigen is niet gelukt.",
        );
      }
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <Stack.Screen options={{ headerShown: true, headerTitle: "Gesprek", headerBackTitle: "Terug" }} />
      {gesprek === undefined ? <LaadStaat /> : null}

      {gesprek === null ? (
        <>
          <LegeStaat
            titel="Dit gesprek bestaat niet meer"
            tekst="Bekijk je uitnodigingen voor de actuele stand."
          />
          <Knop
            label="Naar uitnodigingen"
            onPress={() => router.replace("/(app)/(tabs)/uitnodigingen")}
          />
        </>
      ) : null}

      {gesprek ? (
        <>
          <Kop tekst="Plan je" accent="gesprek" />
          <Text style={[typo.h3, { color: inkt(0.85) }]}>{gesprek.vacancyTitle}</Text>
          <Text style={[typo.klein, { color: inkt(0.6) }]}>
            {gesprek.organizationName} · {gesprek.city}
          </Text>
          {gesprek.message ? <BodyTekst gedempt tekst={`“${gesprek.message}”`} /> : null}

          {gesprek.status === "confirmed" && gesprek.chosenSlot ? (
            <Kaart sterk>
              <BodyTekst tekst={`Bevestigd: ${datumTekst(gesprek.chosenSlot)}`} />
            </Kaart>
          ) : gesprek.status === "proposed" ? (
            <Kaart>
              {gesprek.slots.map((optie) => (
                <Chip
                  key={optie.startsAt}
                  label={`${datumTekst(optie.startsAt)} (${optie.durationMinutes} min)`}
                  geselecteerd={slot === optie.startsAt}
                  onPress={() => setSlot(optie.startsAt)}
                />
              ))}
              <FoutMelding tekst={fout} />
              <Knop
                label="Bevestig dit moment"
                onPress={bevestig}
                bezig={bezig}
                uitgeschakeld={!slot}
              />
            </Kaart>
          ) : (
            <LegeStaat titel="Dit gesprek is niet meer actief" />
          )}
        </>
      ) : null}
    </Scherm>
  );
}

function datumTekst(iso: string): string {
  return new Date(iso).toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
