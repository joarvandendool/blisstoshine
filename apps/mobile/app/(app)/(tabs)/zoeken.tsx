// Zoeken-tab: dezelfde openbare vacaturezoeker, maar het detail leidt voor
// een ingelogde kandidaat direct naar het matchdetail.

import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CONTRACT_TYPES,
  ROLES,
  label as taxLabel,
  type PublicJobSummary,
} from "@mondzorgwerkt/api-contract";
import { publicApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import {
  Badge,
  Chip,
  FoutMelding,
  Kaart,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
} from "@/components/ui";
import { inkt, kleur, ruimte, typo } from "@/theme/tokens";

export default function ZoekenTab() {
  const router = useRouter();
  const [rol, setRol] = useState<string | null>(null);
  const [contract, setContract] = useState<string | null>(null);
  const [items, setItems] = useState<PublicJobSummary[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [verversen, setVerversen] = useState(false);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      const res = await publicApi.zoekVacatures({
        role: rol ?? undefined,
        employmentType: contract ?? undefined,
      });
      setItems(res.items);
    } catch (e) {
      setItems([]);
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Zoeken is niet gelukt.",
      );
    }
  }, [rol, contract]);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <Scherm scroll={false} onderrand={false}>
      <Kop tekst="Alle" accent="vacatures" />
      <View style={stijlen.chips}>
        {ROLES.map((r) => (
          <Chip
            key={r}
            label={taxLabel(r)}
            geselecteerd={rol === r}
            onPress={() => setRol(rol === r ? null : r)}
          />
        ))}
      </View>
      <View style={stijlen.chips}>
        {CONTRACT_TYPES.map((c) => (
          <Chip
            key={c}
            label={taxLabel(c)}
            geselecteerd={contract === c}
            onPress={() => setContract(contract === c ? null : c)}
          />
        ))}
      </View>
      <FoutMelding tekst={fout} />
      {items === null ? (
        <LaadStaat />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
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
          ListEmptyComponent={<LegeStaat titel="Geen vacatures gevonden" />}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title} bij ${item.organization.name} in ${item.location.city}`}
              onPress={() => router.push(`/(app)/match/${item.id}`)}
            >
              <Kaart>
                <View style={stijlen.chips}>
                  <Badge label={item.role.label} toon="blauw" />
                  {item.employmentTypes.map((t) => (
                    <Badge key={t} label={taxLabel(t)} toon="roze" />
                  ))}
                </View>
                <Text style={[typo.h3, { color: kleur.inkt }]}>{item.title}</Text>
                <Text style={[typo.klein, { color: inkt(0.6) }]}>
                  {item.organization.name} · {item.location.city}
                </Text>
              </Kaart>
            </Pressable>
          )}
        />
      )}
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
