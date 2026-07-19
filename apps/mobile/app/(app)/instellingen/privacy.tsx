// Privacy en gegevens: privacyverklaring (welke gegevens, waarom, hoe
// intrekken, wat wordt verwijderd, wat wettelijk bewaard blijft), het
// gegevensoverzicht (AVG art. 15), actieve toestemmingen (intrekbaar) en de
// start van accountverwijdering.

import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import type { ConsentView, PrivacyCategoryView } from "@mondzorgwerkt/api-contract";
import { kandidaatApi } from "@/lib/endpoints";
import { ApiFout, NetwerkFout } from "@/lib/api";
import {
  BodyTekst,
  FoutMelding,
  Kaart,
  Knop,
  Kop,
  LaadStaat,
  Scherm,
  SectieKop,
} from "@/components/ui";
import { inkt, kleur, typo } from "@/theme/tokens";

export default function PrivacyInstellingen() {
  const router = useRouter();
  const [categorieen, setCategorieen] = useState<PrivacyCategoryView[] | null>(null);
  const [consents, setConsents] = useState<ConsentView[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [intrekkenBezig, setIntrekkenBezig] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setFout(null);
    try {
      const [overzicht, consentRes] = await Promise.all([
        kandidaatApi.privacyOverzicht(),
        kandidaatApi.consents(),
      ]);
      setCategorieen(overzicht.categories);
      setConsents(consentRes.consents);
    } catch (e) {
      setCategorieen([]);
      setFout(
        e instanceof ApiFout || e instanceof NetwerkFout
          ? e.message
          : "Gegevens laden is niet gelukt.",
      );
    }
  }, []);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <Scherm>
      <Stack.Screen
        options={{ headerShown: true, headerTitle: "Privacy en gegevens", headerBackTitle: "Terug" }}
      />
      <Kop tekst="Privacy en" accent="gegevens" />

      <Kaart>
        <SectieKop tekst="Privacyverklaring" />
        <BodyTekst tekst="Welke gegevens verzamelen we?" />
        <Text style={[typo.klein, { color: inkt(0.65) }]}>
          Je account (naam, e-mailadres), je kandidaatprofiel (functie, ervaring,
          postcode, werkweek, uren, reisafstand, startdatum, apparatuur- en
          scannerervaring, specialisaties, contractvoorkeur en zzp-omzetpercentage),
          je sollicitaties, uitnodigingen, gesprekken, toestemmingen en meldingen.
        </Text>
        <BodyTekst tekst="Waarom?" />
        <Text style={[typo.klein, { color: inkt(0.65) }]}>
          Uitsluitend om jou te matchen met vacatures in de mondzorg en om je
          sollicitaties en gesprekken af te handelen. We verkopen geen gegevens en
          gebruiken geen advertentietracking; analytics zijn gepseudonimiseerd en
          bevatten geen naam of e-mailadres.
        </Text>
        <BodyTekst tekst="Hoe trek je toestemming in?" />
        <Text style={[typo.klein, { color: inkt(0.65) }]}>
          Praktijken zien je naam alleen na jouw expliciete toestemming (of als je
          profiel op zichtbaar staat, of wanneer je zelf solliciteert). Hieronder
          trek je gegeven toestemmingen per praktijk in; je zichtbaarheid pas je aan
          via je profiel.
        </Text>
        <BodyTekst tekst="Wat wordt verwijderd — en wat blijft?" />
        <Text style={[typo.klein, { color: inkt(0.65) }]}>
          Bij accountverwijdering worden je naam en e-mailadres geanonimiseerd, je
          profiel en meldingen verwijderd en al je toestemmingen ingetrokken; ook
          alle app-sessies en pushtokens vervallen. Geanonimiseerde
          matchvastleggingen en het besluitenjournaal blijven als wettelijk/
          administratief vereiste bedrijfsadministratie bestaan — zonder naam of
          contactgegevens.
        </Text>
      </Kaart>

      <FoutMelding tekst={fout} />

      <SectieKop tekst="Welke gegevens bewaren we van jou?" />
      {categorieen === null ? <LaadStaat /> : null}
      {categorieen && categorieen.length > 0 ? (
        <Kaart>
          {categorieen.map((categorie) => (
            <Text key={categorie.categorie} style={[typo.body, { color: kleur.inkt }]}>
              {categorie.categorie}: {categorie.aantal}
              {"\n"}
              <Text style={[typo.klein, { color: inkt(0.55) }]}>
                {categorie.omschrijving}
              </Text>
            </Text>
          ))}
        </Kaart>
      ) : null}

      <SectieKop tekst="Actieve toestemmingen" />
      {consents.length === 0 ? (
        <BodyTekst gedempt tekst="Je hebt op dit moment geen actieve toestemmingen." />
      ) : (
        consents.map((consent) => (
          <Kaart key={consent.id}>
            <BodyTekst
              tekst={`${consent.organizationName}${consent.vacancyTitle ? ` — ${consent.vacancyTitle}` : " (hele organisatie)"}`}
            />
            <Text style={[typo.klein, { color: inkt(0.5) }]}>
              Gegeven op {new Date(consent.grantedAt).toLocaleDateString("nl-NL")}
            </Text>
            <Knop
              label="Toestemming intrekken"
              variant="secundair"
              bezig={intrekkenBezig === consent.id}
              onPress={async () => {
                setIntrekkenBezig(consent.id);
                try {
                  await kandidaatApi.trekConsentIn({
                    organizationId: consent.organizationId,
                    vacancyId: consent.vacancyId ?? undefined,
                  });
                  await laad();
                } catch (e) {
                  setFout(
                    e instanceof ApiFout || e instanceof NetwerkFout
                      ? e.message
                      : "Intrekken is niet gelukt.",
                  );
                } finally {
                  setIntrekkenBezig(null);
                }
              }}
            />
          </Kaart>
        ))
      )}

      <SectieKop tekst="Account" />
      <Knop
        label="Account verwijderen…"
        variant="gevaar"
        onPress={() => router.push("/(app)/instellingen/account-verwijderen")}
      />
    </Scherm>
  );
}
