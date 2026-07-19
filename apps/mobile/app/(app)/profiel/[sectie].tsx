// Profielsectie bewerken. Eén dynamisch scherm per sectie (werkweek,
// reizen_uren, vakinhoud, contract, zichtbaarheid) — dezelfde stap-API als
// de onboarding, met prefill uit het actuele profiel. Wijzigingen zijn pas
// zichtbaar na serverbevestiging.

import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  CONTRACT_TYPES,
  EQUIPMENT,
  SOFTWARE,
  SPECIALIZATIONS,
  decodeAvailability,
  label as taxLabel,
  type CandidateAvailability,
  type ProfileStepRequest,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { useSessie } from "@/lib/session";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { verwijderUitCache } from "@/lib/cache";
import {
  Chip,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  Scherm,
  SectieKop,
  Veld,
} from "@/components/ui";
import { WeekGrid } from "@/components/WeekGrid";
import { inkt, typo } from "@/theme/tokens";

const TITELS: Record<string, { kop: string; accent: string }> = {
  werkweek: { kop: "Jouw", accent: "werkweek" },
  reizen_uren: { kop: "Uren en", accent: "reisafstand" },
  vakinhoud: { kop: "Vakinhoud en", accent: "specialisaties" },
  contract: { kop: "Contract en", accent: "voorwaarden" },
  zichtbaarheid: { kop: "Jouw", accent: "zichtbaarheid" },
};

export default function ProfielSectieBewerken() {
  const { sectie } = useLocalSearchParams<{ sectie: string }>();
  const { profile, zetProfiel } = useSessie();
  const router = useRouter();

  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const [beschikbaarheid, setBeschikbaarheid] = useState<CandidateAvailability>(
    decodeAvailability(profile?.availability ?? null),
  );
  const [postcode, setPostcode] = useState(profile?.postcode ?? "");
  const [reistijd, setReistijd] = useState(String(profile?.maxTravelMinutes ?? 30));
  const [urenMin, setUrenMin] = useState(String(profile?.hoursMin ?? ""));
  const [urenMax, setUrenMax] = useState(String(profile?.hoursMax ?? ""));
  const [startdatum, setStartdatum] = useState(
    profile?.availableFrom ? profile.availableFrom.slice(0, 10) : "",
  );
  const [scannerErvaring, setScannerErvaring] = useState<string[]>(
    profile?.equipmentExperience ?? [],
  );
  const [specialisaties, setSpecialisaties] = useState<string[]>(
    profile?.specializations ?? [],
  );
  const [software, setSoftware] = useState<string[]>(profile?.softwareSkills ?? []);
  const [contracten, setContracten] = useState<string[]>(profile?.contractTypes ?? []);
  const [omzetPct, setOmzetPct] = useState(
    profile?.revenueShareMin != null ? String(profile.revenueShareMin) : "",
  );
  const [zichtbaarheid, setZichtbaarheid] = useState<"visible" | "anonymous" | "hidden">(
    profile?.visibility ?? "anonymous",
  );

  if (!profile || !sectie || !(sectie in TITELS)) {
    router.replace("/(app)/(tabs)/profiel");
    return null;
  }

  const wissel = (lijst: string[], zet: (v: string[]) => void, waarde: string) =>
    zet(lijst.includes(waarde) ? lijst.filter((v) => v !== waarde) : [...lijst, waarde]);

  function bouwInvoer(): ProfileStepRequest | null {
    switch (sectie) {
      case "werkweek":
        return { stepName: "profiel_werkweek", availability: beschikbaarheid };
      case "reizen_uren": {
        const min = Number(urenMin);
        const max = Number(urenMax);
        const reis = Number(reistijd);
        if (!postcode || !min || !max || max < min || !reis) return null;
        return {
          stepName: "profiel_reizen_uren",
          postcode,
          maxTravelMinutes: reis,
          hoursMin: min,
          hoursMax: max,
          availableFrom: startdatum ? `${startdatum}T00:00:00.000Z` : null,
        };
      }
      case "vakinhoud":
        return {
          stepName: "profiel_vakinhoud",
          equipmentExperience: scannerErvaring,
          specializations: specialisaties,
          softwareSkills: software,
        };
      case "contract": {
        if (contracten.length === 0) return null;
        const pct = omzetPct === "" ? null : Number(omzetPct);
        if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) return null;
        return {
          stepName: "profiel_contract",
          contractTypes: contracten,
          revenueShareMin: contracten.includes("zzp") ? pct : null,
        };
      }
      case "zichtbaarheid":
        return { stepName: "profiel_zichtbaarheid", visibility: zichtbaarheid };
      default:
        return null;
    }
  }

  const invoer = bouwInvoer();

  async function bewaar() {
    if (!invoer || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await kandidaatApi.bewaarStap(invoer);
      zetProfiel(res.profile);
      verwijderUitCache("matches");
      router.back();
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Opslaan is niet gelukt.",
      );
    } finally {
      setBezig(false);
    }
  }

  const titel = TITELS[sectie];

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Profiel aanpassen", headerBackTitle: "Terug" }}
      />
      <Kop tekst={titel.kop} accent={titel.accent} />

      {sectie === "werkweek" ? (
        <Kaart>
          <WeekGrid
            modus="kandidaat"
            availability={beschikbaarheid}
            onWijzig={(dag, dagdeel, niveau) =>
              setBeschikbaarheid((huidig) => ({
                ...huidig,
                [dag]: { ...huidig[dag], [dagdeel]: niveau },
              }))
            }
          />
        </Kaart>
      ) : null}

      {sectie === "reizen_uren" ? (
        <Kaart>
          <Veld label="Postcode" value={postcode} onChangeText={setPostcode} autoCapitalize="characters" />
          <Veld
            label="Maximale reistijd (minuten)"
            value={reistijd}
            onChangeText={setReistijd}
            keyboardType="number-pad"
          />
          <View style={stijlen.rij}>
            <View style={{ flex: 1 }}>
              <Veld label="Uren (min)" value={urenMin} onChangeText={setUrenMin} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Veld label="Uren (max)" value={urenMax} onChangeText={setUrenMax} keyboardType="number-pad" />
            </View>
          </View>
          <Veld
            label="Beschikbaar vanaf (JJJJ-MM-DD, leeg = direct)"
            value={startdatum}
            onChangeText={setStartdatum}
            autoCapitalize="none"
          />
        </Kaart>
      ) : null}

      {sectie === "vakinhoud" ? (
        <>
          <SectieKop tekst="Apparatuur / scanners" />
          <View style={stijlen.chips}>
            {EQUIPMENT.map((item) => (
              <Chip
                key={item}
                label={taxLabel(item)}
                geselecteerd={scannerErvaring.includes(item)}
                onPress={() => wissel(scannerErvaring, setScannerErvaring, item)}
              />
            ))}
          </View>
          <SectieKop tekst="Specialisaties" />
          <View style={stijlen.chips}>
            {SPECIALIZATIONS.map((item) => (
              <Chip
                key={item}
                label={taxLabel(item)}
                geselecteerd={specialisaties.includes(item)}
                onPress={() => wissel(specialisaties, setSpecialisaties, item)}
              />
            ))}
          </View>
          <SectieKop tekst="Software" />
          <View style={stijlen.chips}>
            {SOFTWARE.map((item) => (
              <Chip
                key={item}
                label={taxLabel(item)}
                geselecteerd={software.includes(item)}
                onPress={() => wissel(software, setSoftware, item)}
              />
            ))}
          </View>
        </>
      ) : null}

      {sectie === "contract" ? (
        <>
          <View style={stijlen.chips}>
            {CONTRACT_TYPES.map((vorm) => (
              <Chip
                key={vorm}
                label={taxLabel(vorm)}
                geselecteerd={contracten.includes(vorm)}
                onPress={() => wissel(contracten, setContracten, vorm)}
              />
            ))}
          </View>
          {contracten.includes("zzp") ? (
            <Kaart>
              <Veld
                label="Gewenst omzetpercentage bij zzp (0–100)"
                value={omzetPct}
                onChangeText={setOmzetPct}
                keyboardType="number-pad"
              />
            </Kaart>
          ) : null}
        </>
      ) : null}

      {sectie === "zichtbaarheid" ? (
        <>
          {(
            [
              ["anonymous", "Anoniem"],
              ["visible", "Zichtbaar"],
              ["hidden", "Verborgen"],
            ] as const
          ).map(([sleutel, label]) => (
            <Chip
              key={sleutel}
              label={label}
              geselecteerd={zichtbaarheid === sleutel}
              onPress={() => setZichtbaarheid(sleutel)}
            />
          ))}
          <Text style={[typo.klein, { color: inkt(0.55) }]}>
            Toestemmingen die je eerder gaf, beheer je onder Privacy en gegevens.
          </Text>
        </>
      ) : null}

      <FoutMelding tekst={fout} />
      <Knop label="Opslaan" onPress={bewaar} bezig={bezig} uitgeschakeld={!invoer} />
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rij: { flexDirection: "row", gap: 12 },
});
