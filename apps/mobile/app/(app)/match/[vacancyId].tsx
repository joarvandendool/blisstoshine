// Uitlegbaar matchdetail: MatchShape-hero, categoriescores, sterke punten,
// aandachtspunten en kansen — allemaal letterlijk de serveruitleg. Vanaf
// hier solliciteren (of terugtrekken); succes pas na serverbevestiging.

import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import {
  MATCH_CATEGORIES,
  MATCH_CATEGORY_LABELS,
  label as taxLabel,
  type MatchDetail,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { verwijderUitCache } from "@/lib/cache";
import { shapeDimensies } from "@/lib/shape";
import {
  Badge,
  BodyTekst,
  FoutMelding,
  Kaart,
  Knop,
  LaadStaat,
  LegeStaat,
  Scherm,
  ScoreBadge,
  SectieKop,
  Veld,
  VoortgangsBalk,
} from "@/components/ui";
import { MatchShape } from "@/components/MatchShape";
import { WeekGrid } from "@/components/WeekGrid";
import { decodeAvailability } from "@mondzorgwerkt/api-contract";
import { useSessie } from "@/lib/session";
import { inkt, kleur, typo } from "@/theme/tokens";

type Staat =
  | { soort: "laden" }
  | { soort: "weg"; melding: string }
  | { soort: "ok"; match: MatchDetail };

export default function MatchDetailScherm() {
  const { vacancyId } = useLocalSearchParams<{ vacancyId: string }>();
  const router = useRouter();
  const gefocust = useIsFocused();
  const { profile } = useSessie();
  const [staat, setStaat] = useState<Staat>({ soort: "laden" });
  const [motivatie, setMotivatie] = useState("");
  const [bezig, setBezig] = useState(false);
  const [actieFout, setActieFout] = useState<string | null>(null);
  const [gelukt, setGelukt] = useState(false);

  const laad = useCallback(async () => {
    if (!vacancyId) return;
    try {
      const res = await kandidaatApi.matchDetail(vacancyId);
      setStaat({ soort: "ok", match: res.match });
    } catch (fout) {
      if (fout instanceof ApiFout && (fout.status === 404 || fout.status === 410)) {
        setStaat({
          soort: "weg",
          melding:
            fout.status === 410
              ? "Deze vacature is niet meer beschikbaar."
              : "Deze vacature bestaat niet (meer).",
        });
      } else {
        setStaat({
          soort: "weg",
          melding:
            fout instanceof NetwerkFout
              ? fout.message
              : "De match kon niet worden geladen. Probeer het opnieuw.",
        });
      }
    }
  }, [vacancyId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  async function solliciteer() {
    if (staat.soort !== "ok" || bezig) return;
    setBezig(true);
    setActieFout(null);
    try {
      await kandidaatApi.solliciteer({
        vacancyId: staat.match.vacancyId,
        motivation: motivatie.trim() || undefined,
      });
      // Succes pas ná serverbevestiging (201).
      setGelukt(true);
      verwijderUitCache("matches");
      await laad();
    } catch (fout) {
      if (fout instanceof ApiFout && fout.status === 409) {
        // Al gesolliciteerd (bv. eerder verzoek kwam tóch aan): staat herladen.
        setGelukt(true);
        await laad();
      } else if (fout instanceof NetwerkFout) {
        // Uitkomst onbekend: NIET blind opnieuw versturen — eerst herladen.
        setActieFout(
          "We konden je sollicitatie niet bevestigen door een netwerkprobleem. We hebben de status opnieuw geladen — controleer hieronder of je sollicitatie is aangekomen.",
        );
        await laad();
      } else {
        setActieFout(
          fout instanceof ApiFout ? fout.message : "Solliciteren is niet gelukt.",
        );
        await laad();
      }
    } finally {
      setBezig(false);
    }
  }

  async function trekTerug() {
    if (staat.soort !== "ok" || !staat.match.application || bezig) return;
    setBezig(true);
    setActieFout(null);
    try {
      await kandidaatApi.trekTerug(staat.match.application.id, {});
      verwijderUitCache("matches");
      await laad();
    } catch (fout) {
      setActieFout(
        fout instanceof ApiFout || fout instanceof NetwerkFout
          ? fout.message
          : "Terugtrekken is niet gelukt.",
      );
      await laad();
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Match", headerBackTitle: "Terug" }}
      />

      {staat.soort === "laden" ? <LaadStaat label="Match laden…" /> : null}
      {staat.soort === "weg" ? (
        <>
          <LegeStaat titel={staat.melding} tekst="Bekijk je andere matches." />
          <Knop label="Naar matches" onPress={() => router.replace("/(app)/(tabs)")} />
        </>
      ) : null}

      {staat.soort === "ok" ? (
        <>
          <View style={{ alignItems: "center" }}>
            <MatchShape
              score={staat.match.result.score}
              dimensions={shapeDimensies(staat.match.result)}
              size="hero"
              actief={gefocust}
            />
            <ScoreBadge
              score={staat.match.result.score}
              label={staat.match.result.label}
            />
          </View>

          <Text style={[typo.h2, { color: kleur.inkt }]} accessibilityRole="header">
            {staat.match.title}
          </Text>
          <Text style={[typo.body, { color: inkt(0.65) }]}>
            {staat.match.organizationName} · {staat.match.city} · {staat.match.hoursMin}–
            {staat.match.hoursMax} uur · {staat.match.contractTypes.map(taxLabel).join(", ")}
          </Text>
          <BodyTekst tekst={staat.match.result.summary} />

          {profile ? (
            <Kaart>
              <SectieKop tekst="Jouw week naast deze vacature" />
              <WeekGrid
                modus="overlay"
                availability={decodeAvailability(profile.availability)}
                schedule={staat.match.schedule}
              />
            </Kaart>
          ) : null}

          <Kaart>
            <SectieKop tekst="Waarom deze score" />
            {MATCH_CATEGORIES.map((categorie) => (
              <View key={categorie} style={{ gap: 4 }}>
                <View style={stijlen.categorieRij}>
                  <Text style={[typo.klein, { color: kleur.inkt }]}>
                    {MATCH_CATEGORY_LABELS[categorie]}
                  </Text>
                  <Text style={[typo.klein, { color: inkt(0.55) }]}>
                    {staat.match.result.categoryScores[categorie]}%
                  </Text>
                </View>
                <VoortgangsBalk
                  waarde={staat.match.result.categoryScores[categorie]}
                  label={`${MATCH_CATEGORY_LABELS[categorie]}: ${staat.match.result.categoryScores[categorie]} procent`}
                />
              </View>
            ))}
          </Kaart>

          {staat.match.result.strengths.length > 0 ? (
            <Kaart>
              <SectieKop tekst="Sterke punten" />
              {staat.match.result.strengths.map((reden, i) => (
                <Text key={`${reden.code}-${i}`} style={[typo.body, { color: kleur.inkt }]}>
                  ✓ {reden.message}
                </Text>
              ))}
            </Kaart>
          ) : null}

          {staat.match.result.attentionPoints.length > 0 ? (
            <Kaart>
              <SectieKop tekst="Aandachtspunten" />
              {staat.match.result.attentionPoints.map((reden, i) => (
                <Text key={`${reden.code}-${i}`} style={[typo.body, { color: inkt(0.75) }]}>
                  ⚠ {reden.message}
                </Text>
              ))}
            </Kaart>
          ) : null}

          {staat.match.result.opportunities.length > 0 ? (
            <Kaart>
              <SectieKop tekst="Wat deze match nog sterker maakt" />
              {staat.match.result.opportunities.map((kans, i) => (
                <View key={`${kans.code}-${i}`} style={{ gap: 4 }}>
                  <Text style={[typo.body, { color: kleur.inkt, fontWeight: "500" }]}>
                    {kans.title}
                  </Text>
                  <Text style={[typo.klein, { color: inkt(0.6) }]}>{kans.explanation}</Text>
                  <Badge label={`stijgt naar ${kans.projectedScore}%`} toon="roze" />
                </View>
              ))}
            </Kaart>
          ) : null}

          <FoutMelding tekst={actieFout} />

          {staat.match.application ? (
            <Kaart sterk>
              <Badge
                label={`Sollicitatie: ${statusTekst(staat.match.application.status)}`}
                toon={staat.match.application.status === "withdrawn" ? "neutraal" : "groen"}
              />
              {gelukt ? (
                <BodyTekst tekst="Je sollicitatie is bevestigd door de server. De praktijk ziet je reactie." />
              ) : null}
              {!["hired", "rejected", "withdrawn"].includes(
                staat.match.application.status,
              ) ? (
                <Knop
                  label="Sollicitatie terugtrekken"
                  variant="secundair"
                  onPress={trekTerug}
                  bezig={bezig}
                />
              ) : null}
            </Kaart>
          ) : staat.match.result.eligible ? (
            <Kaart sterk>
              <SectieKop tekst="Reageren" />
              <Veld
                label="Motivatie (optioneel)"
                value={motivatie}
                onChangeText={setMotivatie}
                multiline
                numberOfLines={3}
              />
              <Knop
                label="Solliciteer op deze vacature"
                onPress={solliciteer}
                bezig={bezig}
                toegankelijkheidsHint="Verstuurt je sollicitatie naar de praktijk"
              />
            </Kaart>
          ) : (
            <LegeStaat
              titel="Solliciteren is nu niet mogelijk"
              tekst={
                staat.match.result.hardMismatchReasons[0]?.message ??
                "Deze vacature past niet bij je profiel."
              }
            />
          )}
        </>
      ) : null}
    </Scherm>
  );
}

function statusTekst(status: string): string {
  const labels: Record<string, string> = {
    submitted: "verstuurd",
    in_review: "in behandeling",
    interview: "gesprek",
    offered: "aanbod",
    hired: "aangenomen",
    rejected: "afgewezen",
    withdrawn: "teruggetrokken",
  };
  return labels[status] ?? status;
}

const stijlen = StyleSheet.create({
  categorieRij: { flexDirection: "row", justifyContent: "space-between" },
});
