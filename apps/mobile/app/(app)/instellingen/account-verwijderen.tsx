// Accountverwijdering starten vanuit de app (App Store-vereiste). Twee
// stappen met het typwoord "verwijderen" — dezelfde bevestiging als de
// webapp. Na bevestiging door de server: alles lokaal wissen en terug naar
// het openbare deel.

import React, { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { useSessie } from "@/lib/session";
import {
  BodyTekst,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  Scherm,
  Veld,
} from "@/components/ui";

export default function AccountVerwijderen() {
  const router = useRouter();
  const { uitloggen } = useSessie();
  const [bevestiging, setBevestiging] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function verwijder() {
    if (bezig || bevestiging.trim().toLowerCase() !== "verwijderen") return;
    setBezig(true);
    setFout(null);
    try {
      await kandidaatApi.verwijderAccount();
      // Server heeft bevestigd: sessies zijn ingetrokken. Lokaal opruimen.
      await uitloggen();
      router.replace("/(public)");
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Verwijderen is niet gelukt. Probeer het later opnieuw.",
      );
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Account verwijderen", headerBackTitle: "Terug" }}
      />
      <Kop tekst="Account" accent="verwijderen" />
      <Kaart>
        <BodyTekst tekst="Dit kan niet ongedaan worden gemaakt." />
        <BodyTekst
          gedempt
          tekst="Je naam en e-mailadres worden geanonimiseerd, je profiel en meldingen verwijderd, al je toestemmingen ingetrokken en alle sessies en pushtokens vervallen. Geanonimiseerde matchvastleggingen blijven als bedrijfsadministratie bestaan, zonder naam of contactgegevens."
        />
        <Veld
          label={'Typ "verwijderen" om te bevestigen'}
          value={bevestiging}
          onChangeText={setBevestiging}
          autoCapitalize="none"
        />
        <FoutMelding tekst={fout} />
        <Knop
          label="Verwijder mijn account definitief"
          variant="gevaar"
          onPress={verwijder}
          bezig={bezig}
          uitgeschakeld={bevestiging.trim().toLowerCase() !== "verwijderen"}
        />
        <Knop label="Annuleren" variant="ghost" onPress={() => router.back()} />
      </Kaart>
    </Scherm>
  );
}
