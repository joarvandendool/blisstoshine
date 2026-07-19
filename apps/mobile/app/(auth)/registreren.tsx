// Registreren als kandidaat. Na succes start de onboarding direct.

import React, { useState } from "react";
import { Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useSessie } from "@/lib/session";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { FoutMelding, Kaart, Knop, Kop, Scherm, Veld } from "@/components/ui";
import { inkt, typo } from "@/theme/tokens";

export default function Registreren() {
  const { registreer } = useSessie();
  const router = useRouter();
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function verstuur() {
    if (bezig) return;
    if (wachtwoord.length < 8) {
      setFout("Wachtwoord moet minimaal 8 tekens zijn");
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      await registreer(naam.trim(), email.trim(), wachtwoord);
      router.replace("/onboarding");
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Registreren is niet gelukt. Probeer het opnieuw.",
      );
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <Stack.Screen options={{ headerTitle: "Account maken" }} />
      <Kop tekst="Vind werk dat" accent="past" />
      <Text style={[typo.body, { color: inkt(0.65) }]}>
        Met een kandidaatprofiel krijg je persoonlijke matches met uitleg —
        praktijken zien je naam pas als jij dat wilt.
      </Text>
      <Kaart>
        <Veld label="Naam" value={naam} onChangeText={setNaam} autoComplete="name" />
        <Veld
          label="E-mailadres"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <Veld
          label="Wachtwoord (minimaal 8 tekens)"
          value={wachtwoord}
          onChangeText={setWachtwoord}
          secureTextEntry
          textContentType="newPassword"
        />
        <FoutMelding tekst={fout} />
        <Knop label="Account maken" onPress={verstuur} bezig={bezig} />
        <Knop
          label="Al een account? Inloggen"
          variant="ghost"
          onPress={() => router.replace("/(auth)/inloggen")}
        />
      </Kaart>
    </Scherm>
  );
}
