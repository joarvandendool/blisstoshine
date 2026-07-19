// Uitnodigingen + gesprekken. Openen markeert uitnodigingsnotificaties als
// gezien (idempotent). Beantwoorden: interesse (met expliciete consentkeuze)
// of afwijzen met reden. Alleen openstaande uitnodigingen zijn te
// beantwoorden; een al beantwoorde geeft server-side 409.

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  FEEDBACK_REASON_CODES,
  FEEDBACK_REASON_LABELS,

  type InterviewView,
  type InvitationView,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import {
  Badge,
  BodyTekst,
  Chip,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
  SectieKop,
} from "@/components/ui";
import { inkt, kleur, typo } from "@/theme/tokens";

export default function UitnodigingenTab() {
  const router = useRouter();
  const [uitnodigingen, setUitnodigingen] = useState<InvitationView[] | null>(null);
  const [gesprekken, setGesprekken] = useState<InterviewView[]>([]);
  const [fout, setFout] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      const [uitRes, gesprekRes] = await Promise.all([
        kandidaatApi.uitnodigingen(),
        kandidaatApi.gesprekken(),
      ]);
      setUitnodigingen(uitRes.invitations);
      setGesprekken(gesprekRes.interviews);
      // Best effort: notificaties als gezien markeren.
      void kandidaatApi.uitnodigingenGezien().catch(() => {});
    } catch (e) {
      setUitnodigingen([]);
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Uitnodigingen laden is niet gelukt.",
      );
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <Scherm onderrand={false}>
      <Kop tekst="Jouw" accent="uitnodigingen" />
      <FoutMelding tekst={fout} />
      {uitnodigingen === null ? <LaadStaat /> : null}

      {gesprekken.length > 0 ? (
        <>
          <SectieKop tekst="Gesprekken" />
          {gesprekken.map((gesprek) => (
            <Kaart key={gesprek.id}>
              <Badge
                label={gesprek.status === "confirmed" ? "Gesprek bevestigd" : "Gesprek voorgesteld"}
                toon={gesprek.status === "confirmed" ? "groen" : "blauw"}
              />
              <Text style={[typo.h3, { color: kleur.inkt }]}>{gesprek.vacancyTitle}</Text>
              <Text style={[typo.klein, { color: inkt(0.6) }]}>
                {gesprek.organizationName} · {gesprek.city}
              </Text>
              {gesprek.status === "confirmed" && gesprek.chosenSlot ? (
                <BodyTekst tekst={`Gepland: ${datumTekst(gesprek.chosenSlot)}`} />
              ) : (
                <Knop
                  label="Kies een moment"
                  onPress={() => router.push(`/(app)/gesprek/${gesprek.id}`)}
                />
              )}
            </Kaart>
          ))}
        </>
      ) : null}

      {uitnodigingen !== null ? (
        <>
          <SectieKop tekst="Uitnodigingen" />
          {uitnodigingen.length === 0 ? (
            <LegeStaat
              titel="Nog geen uitnodigingen"
              tekst="Praktijken die jouw profiel interessant vinden, nodigen je hier uit."
            />
          ) : (
            uitnodigingen.map((uitnodiging) => (
              <UitnodigingKaart
                key={uitnodiging.id}
                uitnodiging={uitnodiging}
                naVerwerking={laad}
              />
            ))
          )}
        </>
      ) : null}
    </Scherm>
  );
}

function UitnodigingKaart({
  uitnodiging,
  naVerwerking,
}: {
  uitnodiging: InvitationView;
  naVerwerking: () => Promise<void>;
}) {
  const router = useRouter();
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [afwijzen, setAfwijzen] = useState(false);
  const [reden, setReden] = useState<string | null>(null);
  const [deelContact, setDeelContact] = useState(false);

  async function beantwoord(accepted: boolean) {
    if (bezig) return;
    setBezig(true);
    setFout(null);
    try {
      await kandidaatApi.beantwoordUitnodiging(uitnodiging.id, {
        accepted,
        shareContact: accepted ? deelContact : undefined,
        reasonCode: !accepted && reden ? (reden as never) : undefined,
      });
      await naVerwerking();
    } catch (e) {
      if (e instanceof ApiFout && e.status === 409) {
        // Al beantwoord (bv. op een ander apparaat): staat herladen.
        await naVerwerking();
      } else {
        setFout(
          e instanceof ApiFout || e instanceof NetwerkFout
            ? e.message
            : "Beantwoorden is niet gelukt.",
        );
      }
    } finally {
      setBezig(false);
    }
  }

  const open = uitnodiging.status === "sent";

  return (
    <Kaart>
      <Badge
        label={statusTekst(uitnodiging.status)}
        toon={
          uitnodiging.status === "sent"
            ? "blauw"
            : uitnodiging.status === "accepted"
              ? "groen"
              : "neutraal"
        }
      />
      <Text style={[typo.h3, { color: kleur.inkt }]}>{uitnodiging.vacancy.title}</Text>
      <Text style={[typo.klein, { color: inkt(0.6) }]}>
        {uitnodiging.vacancy.organizationName} · {uitnodiging.vacancy.city}
        {uitnodiging.snapshotScore != null ? ` · match ${uitnodiging.snapshotScore}%` : ""}
      </Text>
      {uitnodiging.message ? <BodyTekst gedempt tekst={`“${uitnodiging.message}”`} /> : null}

      <Knop
        label="Bekijk de vacature en jouw match"
        variant="ghost"
        onPress={() => router.push(`/(app)/match/${uitnodiging.vacancy.id}`)}
      />

      {open && !afwijzen ? (
        <>
          <View style={stijlen.consentRij}>
            <Switch
              value={deelContact}
              onValueChange={setDeelContact}
              accessibilityLabel="Deel mijn naam en contactgegevens met deze praktijk"
              trackColor={{ true: kleur.blauw600, false: undefined }}
            />
            <Text style={[typo.klein, { color: inkt(0.7), flex: 1 }]}>
              Deel mijn naam en contactgegevens met deze praktijk (toestemming —
              altijd intrekbaar via Privacy)
            </Text>
          </View>
          <FoutMelding tekst={fout} />
          <Knop label="Ik heb interesse" onPress={() => beantwoord(true)} bezig={bezig} />
          <Knop label="Afwijzen…" variant="secundair" onPress={() => setAfwijzen(true)} />
        </>
      ) : null}

      {open && afwijzen ? (
        <>
          <SectieKop tekst="Waarom past dit niet? (optioneel)" />
          <View style={stijlen.chips}>
            {FEEDBACK_REASON_CODES.map((code) => (
              <Chip
                key={code}
                label={FEEDBACK_REASON_LABELS[code]}
                geselecteerd={reden === code}
                onPress={() => setReden(reden === code ? null : code)}
              />
            ))}
          </View>
          <FoutMelding tekst={fout} />
          <Knop label="Uitnodiging afwijzen" variant="gevaar" onPress={() => beantwoord(false)} bezig={bezig} />
          <Knop label="Terug" variant="ghost" onPress={() => setAfwijzen(false)} />
        </>
      ) : null}
    </Kaart>
  );
}

function statusTekst(status: string): string {
  const labels: Record<string, string> = {
    sent: "Nieuw",
    accepted: "Interesse getoond",
    declined: "Afgewezen",
    expired: "Verlopen",
  };
  return labels[status] ?? status;
}

function datumTekst(iso: string): string {
  const datum = new Date(iso);
  return datum.toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const stijlen = StyleSheet.create({
  consentRij: { flexDirection: "row", alignItems: "center", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
