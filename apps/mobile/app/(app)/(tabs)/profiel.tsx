// Profiel-tab: bekijken + per sectie aanpassen, sollicitatieoverzicht,
// notificaties en instellingen (privacy, accountverwijdering), uitloggen.

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  decodeAvailability,
  label as taxLabel,
  type ApplicationView,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { useSessie } from "@/lib/session";
import {
  Badge,
  BodyTekst,
  Kaart,
  Knop,
  Kop,
  LegeStaat,
  Scherm,
  SectieKop,
  VoortgangsBalk,
} from "@/components/ui";
import { WeekGrid } from "@/components/WeekGrid";
import { inkt, kleur, typo } from "@/theme/tokens";

export default function ProfielTab() {
  const { user, profile, uitloggen } = useSessie();
  const router = useRouter();
  const [sollicitaties, setSollicitaties] = useState<ApplicationView[]>([]);
  const [uitlogBezig, setUitlogBezig] = useState(false);

  const laad = useCallback(async () => {
    try {
      const res = await kandidaatApi.sollicitaties();
      setSollicitaties(res.applications);
    } catch {
      // stil: sollicitaties zijn secundair op dit scherm
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  if (!profile) return null;

  return (
    <Scherm onderrand={false}>
      <Kop tekst="Jouw" accent="profiel" />
      <Text style={[typo.body, { color: inkt(0.65) }]}>
        {user?.name} · {taxLabel(profile.role)} ({taxLabel(profile.experienceLevel)})
      </Text>
      <VoortgangsBalk
        waarde={profile.completenessScore}
        label={`Profiel ${profile.completenessScore} procent compleet`}
      />

      <Kaart>
        <SectieKop tekst="Werkdagen en dagdelen" />
        <WeekGrid modus="alleenLezen" availability={decodeAvailability(profile.availability)} />
        <Knop
          label="Beschikbaarheid aanpassen"
          variant="secundair"
          onPress={() => router.push("/(app)/profiel/werkweek")}
        />
      </Kaart>

      <Kaart>
        <SectieKop tekst="Uren, start en reisafstand" />
        <BodyTekst
          tekst={`${profile.hoursMin}–${profile.hoursMax} uur per week · max ${profile.maxTravelMinutes} min reizen`}
        />
        <BodyTekst
          gedempt
          tekst={
            profile.availableFrom
              ? `Beschikbaar vanaf ${new Date(profile.availableFrom).toLocaleDateString("nl-NL")}`
              : "Direct beschikbaar"
          }
        />
        <Knop
          label="Aanpassen"
          variant="secundair"
          onPress={() => router.push("/(app)/profiel/reizen_uren")}
        />
      </Kaart>

      <Kaart>
        <SectieKop tekst="Scannerervaring en specialisaties" />
        <View style={stijlen.badges}>
          {[...profile.equipmentExperience, ...profile.specializations].map((sleutel) => (
            <Badge key={sleutel} label={taxLabel(sleutel)} toon="blauw" />
          ))}
          {profile.equipmentExperience.length + profile.specializations.length === 0 ? (
            <BodyTekst gedempt tekst="Nog niets ingevuld." />
          ) : null}
        </View>
        <Knop
          label="Aanpassen"
          variant="secundair"
          onPress={() => router.push("/(app)/profiel/vakinhoud")}
        />
      </Kaart>

      <Kaart>
        <SectieKop tekst="Contract" />
        <View style={stijlen.badges}>
          {profile.contractTypes.map((vorm) => (
            <Badge key={vorm} label={taxLabel(vorm)} toon="roze" />
          ))}
        </View>
        {profile.contractTypes.includes("zzp") && profile.revenueShareMin != null ? (
          <BodyTekst gedempt tekst={`Gewenst omzetpercentage: ${profile.revenueShareMin}%`} />
        ) : null}
        <Knop
          label="Aanpassen"
          variant="secundair"
          onPress={() => router.push("/(app)/profiel/contract")}
        />
      </Kaart>

      <Kaart>
        <SectieKop tekst="Zichtbaarheid" />
        <BodyTekst
          tekst={
            profile.visibility === "visible"
              ? "Zichtbaar — praktijken met een match zien je naam."
              : profile.visibility === "anonymous"
                ? "Anoniem — jij bepaalt per praktijk wie je naam ziet."
                : "Verborgen — alleen zelf solliciteren."
          }
        />
        <Knop
          label="Aanpassen"
          variant="secundair"
          onPress={() => router.push("/(app)/profiel/zichtbaarheid")}
        />
      </Kaart>

      <SectieKop tekst="Jouw sollicitaties" />
      {sollicitaties.length === 0 ? (
        <LegeStaat titel="Nog geen sollicitaties" />
      ) : (
        sollicitaties.map((sollicitatie) => (
          <Kaart key={sollicitatie.id}>
            <Text style={[typo.h3, { color: kleur.inkt }]}>
              {sollicitatie.vacancy.title}
            </Text>
            <Text style={[typo.klein, { color: inkt(0.6) }]}>
              {sollicitatie.vacancy.organizationName} · {sollicitatie.vacancy.city}
            </Text>
            <Badge label={sollicitatieStatus(sollicitatie.status)} toon="blauw" />
            <Knop
              label="Bekijken"
              variant="ghost"
              onPress={() => router.push(`/(app)/match/${sollicitatie.vacancy.id}`)}
            />
          </Kaart>
        ))
      )}

      <SectieKop tekst="Meer" />
      <Knop
        label="Notificaties"
        variant="secundair"
        onPress={() => router.push("/(app)/notificaties")}
      />
      <Knop
        label="Notificatievoorkeuren"
        variant="secundair"
        onPress={() => router.push("/(app)/instellingen/notificaties")}
      />
      <Knop
        label="Privacy en gegevens"
        variant="secundair"
        onPress={() => router.push("/(app)/instellingen/privacy")}
      />
      <Knop
        label="Uitloggen"
        variant="ghost"
        bezig={uitlogBezig}
        onPress={async () => {
          setUitlogBezig(true);
          await uitloggen();
          router.replace("/(public)");
        }}
      />
    </Scherm>
  );
}

function sollicitatieStatus(status: string): string {
  const labels: Record<string, string> = {
    submitted: "Verstuurd",
    in_review: "In behandeling",
    interview: "Gesprek",
    offered: "Aanbod",
    hired: "Aangenomen",
    rejected: "Afgewezen",
    withdrawn: "Teruggetrokken",
  };
  return labels[status] ?? status;
}

const stijlen = StyleSheet.create({
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
