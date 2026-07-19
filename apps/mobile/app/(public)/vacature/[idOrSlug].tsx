// Openbaar vacaturedetail (zonder login). 410 → nette "niet meer
// beschikbaar"-weergave; CTA leidt naar registreren/inloggen of, voor een
// ingelogde kandidaat, naar het matchdetail.

import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { label as taxLabel, type PublicJobView } from "@mondzorgwerkt/api-contract";
import { publicApi } from "@/lib/endpoints";
import { ApiFout } from "@/lib/api";
import { useSessie } from "@/lib/session";
import {
  Badge,
  BodyTekst,
  FoutMelding,
  Kaart,
  Knop,
  LaadStaat,
  LegeStaat,
  Scherm,
  SectieKop,
} from "@/components/ui";
import { inkt, kleur, typo } from "@/theme/tokens";

type Staat =
  | { soort: "laden" }
  | { soort: "gevonden"; job: PublicJobView }
  | { soort: "gesloten" }
  | { soort: "fout"; melding: string };

export default function OpenbaarVacatureDetail() {
  const { idOrSlug } = useLocalSearchParams<{ idOrSlug: string }>();
  const router = useRouter();
  const { status } = useSessie();
  const [staat, setStaat] = useState<Staat>({ soort: "laden" });

  useEffect(() => {
    if (!idOrSlug) return;
    let actueel = true;
    (async () => {
      try {
        const job = (await publicApi.vacature(idOrSlug)) as PublicJobView;
        if (actueel) setStaat({ soort: "gevonden", job });
      } catch (fout) {
        if (!actueel) return;
        if (fout instanceof ApiFout && fout.status === 410) {
          setStaat({ soort: "gesloten" });
        } else if (fout instanceof ApiFout && fout.status === 404) {
          setStaat({ soort: "fout", melding: "Deze vacature bestaat niet (meer)." });
        } else {
          setStaat({
            soort: "fout",
            melding: "De vacature kon niet worden geladen. Probeer het opnieuw.",
          });
        }
      }
    })();
    return () => {
      actueel = false;
    };
  }, [idOrSlug]);

  return (
    <Scherm>
      <Stack.Screen options={{ headerShown: true, headerTitle: "Vacature", headerBackTitle: "Terug" }} />
      {staat.soort === "laden" ? <LaadStaat /> : null}

      {staat.soort === "gesloten" ? (
        <LegeStaat
          titel="Deze vacature is niet meer beschikbaar"
          tekst="De praktijk heeft de vacature gesloten of vervuld."
        />
      ) : null}

      {staat.soort === "fout" ? <FoutMelding tekst={staat.melding} /> : null}

      {staat.soort === "gevonden" ? (
        <>
          <View style={stijlen.badgeRij}>
            <Badge label={staat.job.role.label} toon="blauw" />
            {staat.job.employmentTypes.map((t) => (
              <Badge key={t} label={taxLabel(t)} toon="roze" />
            ))}
          </View>
          <Text style={[typo.h1, { color: kleur.inkt }]} accessibilityRole="header">
            {staat.job.title}
          </Text>
          <Text style={[typo.body, { color: inkt(0.65) }]}>
            {staat.job.organization.name} · {staat.job.location.city} (
            {staat.job.location.region})
          </Text>

          {staat.job.description ? (
            <Kaart>
              <BodyTekst tekst={staat.job.description} />
            </Kaart>
          ) : null}

          {staat.job.availability.length > 0 ? (
            <Kaart>
              <SectieKop tekst="Werkdagen" />
              {staat.job.availability.map((dag) => (
                <Text key={`${dag.day}-${dag.level}`} style={[typo.body, { color: kleur.inkt }]}>
                  {taxLabel(dag.day)}: {dag.dayparts.map(taxLabel).join(", ")}{" "}
                  <Text style={{ color: inkt(0.5) }}>
                    ({dag.level === "required" ? "nodig" : "gewenst"})
                  </Text>
                </Text>
              ))}
            </Kaart>
          ) : null}

          <Kaart>
            <SectieKop tekst="Voorwaarden" />
            {staat.job.hoursMin != null && staat.job.hoursMax != null ? (
              <BodyTekst tekst={`${staat.job.hoursMin}–${staat.job.hoursMax} uur per week`} />
            ) : null}
            {staat.job.salary?.minCents != null || staat.job.salary?.maxCents != null ? (
              <BodyTekst
                tekst={`Salaris: ${staat.job.salary.minCents != null ? `€${Math.round(staat.job.salary.minCents / 100)}` : "?"} – ${staat.job.salary.maxCents != null ? `€${Math.round(staat.job.salary.maxCents / 100)}` : "?"} per maand`}
              />
            ) : null}
            {staat.job.revenueShare ? (
              <BodyTekst
                tekst={`ZZP: tot ${staat.job.revenueShare.maxPercent}% omzetdeling`}
              />
            ) : null}
            {staat.job.requirements.map((eis) => (
              <Text key={eis.label} style={[typo.klein, { color: inkt(0.65) }]}>
                • {eis.label}
                {eis.level === "required" ? " (vereist)" : ""}
              </Text>
            ))}
          </Kaart>

          {status === "actief" ? (
            <Knop
              label="Bekijk jouw match en reageer"
              onPress={() => router.push(`/(app)/match/${staat.job.id}`)}
            />
          ) : (
            <>
              <Knop
                label="Maak een account om te reageren"
                onPress={() => router.push("/(auth)/registreren")}
              />
              <Knop
                label="Inloggen"
                variant="secundair"
                onPress={() => router.push("/(auth)/inloggen")}
              />
            </>
          )}
        </>
      ) : null}
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  badgeRij: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
