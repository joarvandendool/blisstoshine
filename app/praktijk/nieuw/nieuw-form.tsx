"use client";

// Formulier voor de praktijk-start: verzorgd, mobile-first en met dezelfde
// samenstel-taal als de kandidaat-onboarding (chips voor kenmerken, veel
// witruimte, één primaire actie). Validatie gebeurt licht op de client en
// definitief in de server action (maakPraktijkAction).

import { useState, useTransition } from "react";
import { Button, Chip, Field, Input, Select, cx } from "@/components/ui";
import {
  CULTURE,
  EQUIPMENT,
  PATIENT_POPULATION,
  SOFTWARE,
  SPECIALIZATIONS,
  label,
} from "@/domain/taxonomy";
import { maakPraktijkAction } from "./actions";

const POSTCODE_PATROON = /^[1-9][0-9]{3}\s?([A-Za-z]{2})?$/;
const KVK_PATROON = /^[0-9]{8}$/;
const KAMER_OPTIES = Array.from({ length: 12 }, (_, i) => i + 1);

interface FormWaarden {
  name: string;
  kvkNumber: string;
  locationName: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  phone: string;
  treatmentRooms: number;
  traits: string[];
  equipment: string[];
  software: string[];
  specializations: string[];
  patientPopulation: string[];
}

const BEGIN: FormWaarden = {
  name: "",
  kvkNumber: "",
  locationName: "",
  street: "",
  houseNumber: "",
  postcode: "",
  city: "",
  phone: "",
  treatmentRooms: 3,
  traits: [],
  equipment: [],
  software: [],
  specializations: [],
  patientPopulation: [],
};

function toggleIn(lijst: string[], sleutel: string): string[] {
  return lijst.includes(sleutel)
    ? lijst.filter((s) => s !== sleutel)
    : [...lijst, sleutel];
}

/** Meerkeuze-chipgroep op basis van taxonomiesleutels. */
function ChipGroep({
  opties,
  waarde,
  onToggle,
  groepLabel,
}: {
  opties: readonly string[];
  waarde: string[];
  onToggle: (sleutel: string) => void;
  groepLabel: string;
}) {
  return (
    <div role="group" aria-label={groepLabel} className="flex flex-wrap gap-2">
      {opties.map((sleutel) => (
        <Chip
          key={sleutel}
          selected={waarde.includes(sleutel)}
          onClick={() => onToggle(sleutel)}
        >
          {label(sleutel)}
        </Chip>
      ))}
    </div>
  );
}

function Sectie({
  titel,
  intro,
  children,
  className,
}: {
  titel: string;
  intro?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("glass-strong flex flex-col gap-5 rounded-kaart-lg p-6", className)}>
      <div>
        <h2 className="text-lg font-semibold text-ink">{titel}</h2>
        {intro ? <p className="mt-1 text-sm leading-relaxed text-ink/70">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Clientvalidatie vóór verzenden — de server valideert daarna nogmaals. */
function valideer(w: FormWaarden): string | null {
  if (w.name.trim().length < 2) return "Vul de naam van je praktijk in.";
  if (w.kvkNumber.trim() !== "" && !KVK_PATROON.test(w.kvkNumber.trim())) {
    return "Een KvK-nummer bestaat uit 8 cijfers.";
  }
  if (!POSTCODE_PATROON.test(w.postcode.trim())) {
    return "Vul een geldige postcode in, bijvoorbeeld 3511 AB.";
  }
  if (w.city.trim().length < 2) return "Vul de plaatsnaam in.";
  return null;
}

export interface NieuwPraktijkFormProps {
  /** Lengte van de proefperiode in dagen (TRIAL_DAYS uit de servercontext). */
  trialDagen: number;
}

export function NieuwPraktijkForm({ trialDagen }: NieuwPraktijkFormProps) {
  const [waarden, setWaarden] = useState<FormWaarden>(BEGIN);
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  const zet = <K extends keyof FormWaarden>(veld: K, waarde: FormWaarden[K]) =>
    setWaarden((w) => ({ ...w, [veld]: waarde }));

  function verstuur() {
    setFout(null);
    const melding = valideer(waarden);
    if (melding) {
      setFout(melding);
      return;
    }
    startTransition(async () => {
      const naarNull = (tekst: string): string | null =>
        tekst.trim() === "" ? null : tekst.trim();
      const res = await maakPraktijkAction({
        name: waarden.name,
        kvkNumber: naarNull(waarden.kvkNumber),
        locationName: naarNull(waarden.locationName),
        street: naarNull(waarden.street),
        houseNumber: naarNull(waarden.houseNumber),
        postcode: waarden.postcode.trim().toUpperCase(),
        city: waarden.city,
        phone: naarNull(waarden.phone),
        treatmentRooms: waarden.treatmentRooms,
        traits: waarden.traits,
        equipment: waarden.equipment,
        software: waarden.software,
        specializations: waarden.specializations,
        patientPopulation: waarden.patientPopulation,
      });
      // Bij succes stuurt de server action door naar het dashboard; alleen
      // fouten bereiken deze regel.
      if (res && !res.ok) setFout(res.fout);
    });
  }

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        verstuur();
      }}
    >
      <Sectie
        titel="Je praktijk"
        intro="Deze gegevens vormen de basis van je praktijkprofiel."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Praktijknaam" htmlFor="praktijknaam" required className="sm:col-span-2">
            <Input
              id="praktijknaam"
              autoComplete="organization"
              placeholder="bijv. Tandartspraktijk De Waalkade"
              value={waarden.name}
              onChange={(e) => zet("name", e.target.value)}
            />
          </Field>
          <Field
            label="KvK-nummer"
            htmlFor="kvk"
            hint="Optioneel — 8 cijfers."
          >
            <Input
              id="kvk"
              inputMode="numeric"
              placeholder="bijv. 34123456"
              value={waarden.kvkNumber}
              onChange={(e) => zet("kvkNumber", e.target.value)}
            />
          </Field>
          <Field
            label="Locatienaam"
            htmlFor="locatienaam"
            hint="Optioneel — standaard gebruiken we de praktijknaam."
          >
            <Input
              id="locatienaam"
              placeholder="bijv. Vestiging Centrum"
              value={waarden.locationName}
              onChange={(e) => zet("locationName", e.target.value)}
            />
          </Field>
        </div>
      </Sectie>

      <Sectie
        titel="Adres en bereikbaarheid"
        intro="Met de postcode rekenen we reistijden voor kandidaten — zo zien zij meteen of je praktijk binnen bereik ligt."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Straat" htmlFor="straat">
            <Input
              id="straat"
              autoComplete="address-line1"
              placeholder="bijv. Oudegracht"
              value={waarden.street}
              onChange={(e) => zet("street", e.target.value)}
            />
          </Field>
          <Field label="Huisnummer" htmlFor="huisnummer">
            <Input
              id="huisnummer"
              placeholder="bijv. 214"
              value={waarden.houseNumber}
              onChange={(e) => zet("houseNumber", e.target.value)}
            />
          </Field>
          <Field label="Postcode" htmlFor="postcode" required>
            <Input
              id="postcode"
              autoComplete="postal-code"
              placeholder="3511 AB"
              value={waarden.postcode}
              onChange={(e) => zet("postcode", e.target.value)}
            />
          </Field>
          <Field label="Plaats" htmlFor="plaats" required>
            <Input
              id="plaats"
              autoComplete="address-level2"
              placeholder="bijv. Utrecht"
              value={waarden.city}
              onChange={(e) => zet("city", e.target.value)}
            />
          </Field>
          <Field label="Telefoonnummer" htmlFor="telefoon" hint="Optioneel.">
            <Input
              id="telefoon"
              type="tel"
              autoComplete="tel"
              placeholder="bijv. 030 231 44 55"
              value={waarden.phone}
              onChange={(e) => zet("phone", e.target.value)}
            />
          </Field>
          <Field label="Behandelkamers" htmlFor="kamers" required>
            <Select
              id="kamers"
              value={String(waarden.treatmentRooms)}
              onChange={(e) => zet("treatmentRooms", Number(e.target.value))}
            >
              {KAMER_OPTIES.map((aantal) => (
                <option key={aantal} value={aantal}>
                  {aantal} {aantal === 1 ? "behandelkamer" : "behandelkamers"}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sectie>

      <Sectie
        titel="Zo werkt jullie praktijk"
        intro="Alles hieronder is optioneel, maar hoe meer je aangeeft, hoe scherper kandidaten zien of ze bij jullie passen."
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Kenmerken van de praktijk</h3>
            <ChipGroep
              opties={CULTURE}
              waarde={waarden.traits}
              onToggle={(s) => zet("traits", toggleIn(waarden.traits, s))}
              groepLabel="Praktijkkenmerken"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Apparatuur</h3>
            <ChipGroep
              opties={EQUIPMENT}
              waarde={waarden.equipment}
              onToggle={(s) => zet("equipment", toggleIn(waarden.equipment, s))}
              groepLabel="Apparatuur"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Software</h3>
            <ChipGroep
              opties={SOFTWARE}
              waarde={waarden.software}
              onToggle={(s) => zet("software", toggleIn(waarden.software, s))}
              groepLabel="Software"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Specialisaties</h3>
            <ChipGroep
              opties={SPECIALIZATIONS}
              waarde={waarden.specializations}
              onToggle={(s) => zet("specializations", toggleIn(waarden.specializations, s))}
              groepLabel="Specialisaties"
            />
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[15px] font-semibold text-ink">Patiëntgroepen</h3>
            <ChipGroep
              opties={PATIENT_POPULATION}
              waarde={waarden.patientPopulation}
              onToggle={(s) =>
                zet("patientPopulation", toggleIn(waarden.patientPopulation, s))
              }
              groepLabel="Patiëntgroepen"
            />
          </div>
        </div>
      </Sectie>

      {fout ? (
        <p role="alert" className="rounded-veld bg-roze-100 px-4 py-3 text-sm font-medium text-roze-800">
          {fout}
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Button type="submit" size="lg" disabled={bezig} className="w-full sm:w-auto sm:self-start">
          {bezig ? "Praktijk aanmaken…" : "Start je praktijkomgeving"}
        </Button>
        <p className="text-sm leading-relaxed text-ink/60">
          Je proefperiode van {trialDagen} dagen start direct — gratis en zonder
          betaalgegevens. Je kunt meteen je eerste vacature plaatsen.
        </p>
      </div>
    </form>
  );
}
