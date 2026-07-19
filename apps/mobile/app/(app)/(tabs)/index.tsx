// Persoonlijke matches — de serveruitkomst, gesorteerd eligible-eerst.
// MatchShape (compact) + ScoreBadge per kaart; animatie pauzeert wanneer de
// tab niet gefocust is.

import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useIsFocused, useRouter } from "expo-router";
import { label as taxLabel, type MatchListItem } from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { inCache, uitCache } from "@/lib/cache";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { useSessie } from "@/lib/session";
import {
  FoutMelding,
  Kaart,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
  ScoreBadge,
  VoortgangsBalk,
} from "@/components/ui";
import { MatchShape } from "@/components/MatchShape";
import { shapeDimensies } from "@/lib/shape";
import { inkt, kleur, ruimte, typo } from "@/theme/tokens";

export default function MatchesTab() {
  const router = useRouter();
  const gefocust = useIsFocused();
  const { profile } = useSessie();
  const [matches, setMatches] = useState<MatchListItem[] | null>(
    uitCache<MatchListItem[]>("matches"),
  );
  const [fout, setFout] = useState<string | null>(null);
  const [verversen, setVerversen] = useState(false);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      const res = await kandidaatApi.matches();
      setMatches(res.matches);
      inCache("matches", res.matches);
    } catch (e) {
      if (matches === null) setMatches([]);
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Matches laden is niet gelukt.",
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  const geschikt = (matches ?? []).filter((match) => match.result.eligible);

  return (
    <Scherm scroll={false} onderrand={false}>
      <Kop tekst="Jouw" accent="matches" />
      {profile && profile.completenessScore < 100 ? (
        <Kaart>
          <Text style={[typo.klein, { color: inkt(0.65) }]}>
            Je profiel is {profile.completenessScore}% compleet — een completer
            profiel geeft betere matches.
          </Text>
          <VoortgangsBalk waarde={profile.completenessScore} label="Profielvolledigheid" />
        </Kaart>
      ) : null}
      <FoutMelding tekst={fout} />

      {matches === null ? (
        <LaadStaat label="Matches laden…" />
      ) : (
        <FlatList
          data={geschikt}
          keyExtractor={(item) => item.vacancyId}
          refreshControl={
            <RefreshControl
              refreshing={verversen}
              onRefresh={async () => {
                setVerversen(true);
                await laad();
                setVerversen(false);
              }}
            />
          }
          contentContainerStyle={{ gap: ruimte.s, paddingBottom: ruimte.xl }}
          ListEmptyComponent={
            <LegeStaat
              titel="Nog geen passende matches"
              tekst="Zodra er een vacature past bij jouw werkweek en voorkeuren, zie je die hier."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title} bij ${item.organizationName} in ${item.city}, match van ${item.result.score} procent`}
              onPress={() => router.push(`/(app)/match/${item.vacancyId}`)}
            >
              <Kaart>
                <View style={stijlen.rij}>
                  <MatchShape
                    score={item.result.score}
                    dimensions={shapeDimensies(item.result)}
                    size="compact"
                    showScore={false}
                    actief={gefocust}
                  />
                  <View style={{ flex: 1, gap: 6 }}>
                    <Text style={[typo.h3, { color: kleur.inkt }]}>{item.title}</Text>
                    <Text style={[typo.klein, { color: inkt(0.6) }]}>
                      {item.organizationName} · {item.city} · {item.hoursMin}–
                      {item.hoursMax} uur ·{" "}
                      {item.contractTypes.map(taxLabel).join(", ")}
                    </Text>
                    <ScoreBadge score={item.result.score} label={item.result.label} />
                  </View>
                </View>
              </Kaart>
            </Pressable>
          )}
        />
      )}
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  rij: { flexDirection: "row", gap: 12, alignItems: "center" },
});
