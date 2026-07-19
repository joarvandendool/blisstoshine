// Inloggen. Foutmeldingen komen letterlijk van de server (rate limiting en
// lockout inbegrepen); succes routeert op profielstatus.

import React, { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useSessie } from "@/lib/session";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { FoutMelding, Kaart, Knop, Kop, Scherm, Veld } from "@/components/ui";

export default function Inloggen() {
  const { login } = useSessie();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [wachtwoord, setWachtwoord] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  async function verstuur() {
    if (bezig) return;
    setBezig(true);
    setFout(null);
    try {
      await login(email.trim(), wachtwoord);
      router.replace("/");
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Inloggen is niet gelukt. Probeer het opnieuw.",
      );
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <Stack.Screen options={{ headerTitle: "Inloggen" }} />
      <Kop tekst="Welkom" accent="terug" />
      <Kaart>
        <Veld
          label="E-mailadres"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Veld
          label="Wachtwoord"
          value={wachtwoord}
          onChangeText={setWachtwoord}
          secureTextEntry
          textContentType="password"
        />
        <FoutMelding tekst={fout} />
        <Knop label="Inloggen" onPress={verstuur} bezig={bezig} />
        <Knop
          label="Nog geen account? Registreren"
          variant="ghost"
          onPress={() => router.replace("/(auth)/registreren")}
        />
      </Kaart>
    </Scherm>
  );
}
