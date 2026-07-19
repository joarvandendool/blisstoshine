// Openbare vacaturezoeker — zonder verplichte login. Leest de bestaande
// publieke API (/api/public/v1/jobs) met filters op functie en contractvorm.

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
  Knop,
  Kop,
  LaadStaat,
  LegeStaat,
  Scherm,
} from "@/components/ui";
import { inkt, kleur, ruimte, typo } from "@/theme/tokens";

export default function OpenbaarZoeken() {
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
          : "Er ging iets mis. Probeer het later opnieuw.",
      );
    }
  }, [rol, contract]);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <Scherm scroll={false}>
      <Kop tekst="Werk dat past, in de" accent="mondzorg" />
      <Text style={[typo.body, { color: inkt(0.65) }]}>
        Bekijk open vacatures zonder account. Maak een profiel voor persoonlijke
        matches met uitleg.
      </Text>

      <View style={stijlen.chipsRij}>
        {ROLES.map((r) => (
          <Chip
            key={r}
            label={taxLabel(r)}
            geselecteerd={rol === r}
            onPress={() => setRol(rol === r ? null : r)}
          />
        ))}
      </View>
      <View style={stijlen.chipsRij}>
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
        <LaadStaat label="Vacatures laden…" />
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
          contentContainerStyle={{ gap: ruimte.s, paddingBottom: ruimte.xxl }}
          ListEmptyComponent={
            <LegeStaat
              titel="Geen vacatures gevonden"
              tekst="Pas de filters aan of probeer het later opnieuw."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title} bij ${item.organization.name} in ${item.location.city}`}
              onPress={() => router.push(`/(public)/vacature/${item.slug || item.id}`)}
            >
              <Kaart>
                <View style={stijlen.badgeRij}>
                  <Badge label={item.role.label} toon="blauw" />
                  {item.employmentTypes.map((t) => (
                    <Badge key={t} label={taxLabel(t)} toon="roze" />
                  ))}
                </View>
                <Text style={[typo.h3, { color: kleur.inkt }]}>{item.title}</Text>
                <Text style={[typo.klein, { color: inkt(0.6) }]}>
                  {item.organization.name} · {item.location.city}
                  {item.hoursMin != null && item.hoursMax != null
                    ? ` · ${item.hoursMin}–${item.hoursMax} uur`
                    : ""}
                </Text>
              </Kaart>
            </Pressable>
          )}
        />
      )}

      <View style={{ gap: ruimte.xs }}>
        <Knop
          label="Inloggen"
          variant="secundair"
          onPress={() => router.push("/(auth)/inloggen")}
        />
        <Knop
          label="Account maken voor persoonlijke matches"
          onPress={() => router.push("/(auth)/registreren")}
        />
      </View>
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  chipsRij: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badgeRij: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
