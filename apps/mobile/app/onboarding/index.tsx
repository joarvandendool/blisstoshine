// Kandidaat-onboarding in zes stappen. Elke stap wordt direct server-side
// opgeslagen (PUT /profile/step) — afbreken en later hervatten kan altijd:
// de flow leest de bestaande profielwaarden terug. De laatste stap
// (zichtbaarheid) activeert het profiel en biedt pushmeldingen aan.

import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  CONTRACT_TYPES,
  EQUIPMENT,
  EXPERIENCE_LEVELS,
  ROLES,
  SOFTWARE,
  SPECIALIZATIONS,
  decodeAvailability,
  emptyAvailability,
  label as taxLabel,
  type CandidateAvailability,
  type ProfileStepRequest,
  type Weekday,
} from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { useSessie } from "@/lib/session";
import { ApiFout, NetwerkFout } from "@/lib/api";
import { meldPushAan } from "@/lib/push";
import {
  BodyTekst,
  Chip,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  Scherm,
  SectieKop,
  Veld,
  VoortgangsBalk,
} from "@/components/ui";
import { WeekGrid } from "@/components/WeekGrid";
import { inkt, typo } from "@/theme/tokens";

const STAPPEN = [
  "functie",
  "werkweek",
  "reizen_uren",
  "vakinhoud",
  "contract",
  "zichtbaarheid",
] as const;
type Stap = (typeof STAPPEN)[number];

export default function Onboarding() {
  const { profile, zetProfiel } = useSessie();
  const router = useRouter();

  const [stapIndex, setStapIndex] = useState(0);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  // Hervatten: bestaande profielwaarden als startpunt.
  const [rol, setRol] = useState(profile?.role || "");
  const [ervaring, setErvaring] = useState(profile?.experienceLevel || "");
  const [beschikbaarheid, setBeschikbaarheid] = useState<CandidateAvailability>(
    profile ? decodeAvailability(profile.availability) : emptyAvailability(),
  );
  const [postcode, setPostcode] = useState(profile?.postcode ?? "");
  const [reistijd, setReistijd] = useState(String(profile?.maxTravelMinutes ?? 30));
  const [urenMin, setUrenMin] = useState(
    profile && profile.hoursMin > 0 ? String(profile.hoursMin) : "",
  );
  const [urenMax, setUrenMax] = useState(
    profile && profile.hoursMax > 0 ? String(profile.hoursMax) : "",
  );
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

  const stap: Stap = STAPPEN[stapIndex];
  const voortgang = Math.round(((stapIndex + 1) / STAPPEN.length) * 100);

  const wissel = (lijst: string[], zet: (v: string[]) => void, waarde: string) =>
    zet(lijst.includes(waarde) ? lijst.filter((v) => v !== waarde) : [...lijst, waarde]);

  const stapInvoer = useMemo((): ProfileStepRequest | null => {
    switch (stap) {
      case "functie":
        if (!rol || !ervaring) return null;
        return { stepName: "functie", role: rol, experienceLevel: ervaring };
      case "werkweek":
        return { stepName: "werkweek", availability: beschikbaarheid };
      case "reizen_uren": {
        const min = Number(urenMin);
        const max = Number(urenMax);
        const reis = Number(reistijd);
        if (!postcode || !min || !max || max < min || !reis) return null;
        return {
          stepName: "reizen_uren",
          postcode,
          maxTravelMinutes: reis,
          hoursMin: min,
          hoursMax: max,
          availableFrom: startdatum ? `${startdatum}T00:00:00.000Z` : null,
        };
      }
      case "vakinhoud":
        return {
          stepName: "vakinhoud",
          equipmentExperience: scannerErvaring,
          specializations: specialisaties,
          softwareSkills: software,
        };
      case "contract": {
        if (contracten.length === 0) return null;
        const pct = omzetPct === "" ? null : Number(omzetPct);
        if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) return null;
        return {
          stepName: "contract",
          contractTypes: contracten,
          revenueShareMin: contracten.includes("zzp") ? pct : null,
        };
      }
      case "zichtbaarheid":
        return { stepName: "zichtbaarheid", visibility: zichtbaarheid };
    }
  }, [
    stap,
    rol,
    ervaring,
    beschikbaarheid,
    postcode,
    reistijd,
    urenMin,
    urenMax,
    startdatum,
    scannerErvaring,
    specialisaties,
    software,
    contracten,
    omzetPct,
    zichtbaarheid,
  ]);

  async function volgende() {
    if (!stapInvoer || bezig) return;
    setBezig(true);
    setFout(null);
    try {
      const res = await kandidaatApi.bewaarStap(stapInvoer);
      if (stap === "zichtbaarheid") {
        const geactiveerd = await kandidaatApi.activeer();
        zetProfiel(geactiveerd.profile);
        // Push is opt-in en mag falen zonder de flow te blokkeren.
        await meldPushAan().catch(() => {});
        router.replace("/(app)/(tabs)");
        return;
      }
      zetProfiel(res.profile);
      setStapIndex((index) => index + 1);
    } catch (e) {
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Opslaan is niet gelukt. Probeer het opnieuw.",
      );
    } finally {
      setBezig(false);
    }
  }

  return (
    <Scherm>
      <VoortgangsBalk waarde={voortgang} label={`Stap ${stapIndex + 1} van ${STAPPEN.length}`} />

      {stap === "functie" ? (
        <>
          <Kop tekst="Wat is je" accent="functie?" />
          <SectieKop tekst="Functie" />
          <View style={stijlen.chips}>
            {ROLES.map((r) => (
              <Chip key={r} label={taxLabel(r)} geselecteerd={rol === r} onPress={() => setRol(r)} />
            ))}
          </View>
          <SectieKop tekst="Ervaring" />
          <View style={stijlen.chips}>
            {EXPERIENCE_LEVELS.map((niveau) => (
              <Chip
                key={niveau}
                label={taxLabel(niveau)}
                geselecteerd={ervaring === niveau}
                onPress={() => setErvaring(niveau)}
              />
            ))}
          </View>
        </>
      ) : null}

      {stap === "werkweek" ? (
        <>
          <Kop tekst="Stel je ideale" accent="werkweek samen" />
          <BodyTekst
            gedempt
            tekst="Tik op een dagdeel om te wisselen: voorkeur, beschikbaar of niet beschikbaar."
          />
          <Kaart>
            <WeekGrid
              modus="kandidaat"
              availability={beschikbaarheid}
              onWijzig={(dag: Weekday, dagdeel, niveau) =>
                setBeschikbaarheid((huidig) => ({
                  ...huidig,
                  [dag]: { ...huidig[dag], [dagdeel]: niveau },
                }))
              }
            />
          </Kaart>
        </>
      ) : null}

      {stap === "reizen_uren" ? (
        <>
          <Kop tekst="Uren, start en" accent="reisafstand" />
          <Kaart>
            <Veld
              label="Postcode (bv. 3511 AB)"
              value={postcode}
              onChangeText={setPostcode}
              autoCapitalize="characters"
            />
            <Veld
              label="Maximale reistijd (minuten)"
              value={reistijd}
              onChangeText={setReistijd}
              keyboardType="number-pad"
            />
            <View style={stijlen.rij}>
              <View style={{ flex: 1 }}>
                <Veld
                  label="Uren per week (min)"
                  value={urenMin}
                  onChangeText={setUrenMin}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Veld
                  label="Uren per week (max)"
                  value={urenMax}
                  onChangeText={setUrenMax}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Veld
              label="Beschikbaar vanaf (JJJJ-MM-DD, leeg = direct)"
              value={startdatum}
              onChangeText={setStartdatum}
              autoCapitalize="none"
            />
          </Kaart>
        </>
      ) : null}

      {stap === "vakinhoud" ? (
        <>
          <Kop tekst="Scannerervaring en" accent="specialisaties" />
          <SectieKop tekst="Apparatuur waarmee je werkt" />
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
          <SectieKop tekst="Praktijksoftware" />
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

      {stap === "contract" ? (
        <>
          <Kop tekst="Contract en" accent="voorwaarden" />
          <SectieKop tekst="Contractvormen" />
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
              <Text style={[typo.klein, { color: inkt(0.55) }]}>
                Behandelaren werken met een deel van de omzet, niet met een uurtarief.
              </Text>
            </Kaart>
          ) : null}
        </>
      ) : null}

      {stap === "zichtbaarheid" ? (
        <>
          <Kop tekst="Wie mag je naam" accent="zien?" />
          <BodyTekst
            gedempt
            tekst="Je beslist zelf wanneer een praktijk je naam en contactgegevens ziet. Dit kun je altijd aanpassen."
          />
          {(
            [
              ["anonymous", "Anoniem", "Praktijken zien je profiel zonder naam; jij geeft per praktijk toestemming."],
              ["visible", "Zichtbaar", "Praktijken met een match zien je naam direct."],
              ["hidden", "Verborgen", "Onvindbaar voor praktijken; alleen zelf solliciteren."],
            ] as const
          ).map(([sleutel, titel, uitleg]) => (
            <Kaart key={sleutel}>
              <Chip
                label={titel}
                geselecteerd={zichtbaarheid === sleutel}
                onPress={() => setZichtbaarheid(sleutel)}
              />
              <Text style={[typo.klein, { color: inkt(0.6) }]}>{uitleg}</Text>
            </Kaart>
          ))}
        </>
      ) : null}

      <FoutMelding tekst={fout} />
      <Knop
        label={stap === "zichtbaarheid" ? "Profiel activeren" : "Volgende"}
        onPress={volgende}
        bezig={bezig}
        uitgeschakeld={!stapInvoer}
      />
      {stapIndex > 0 ? (
        <Knop label="Vorige" variant="ghost" onPress={() => setStapIndex((index) => index - 1)} />
      ) : null}
    </Scherm>
  );
}

const stijlen = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rij: { flexDirection: "row", gap: 12 },
});
