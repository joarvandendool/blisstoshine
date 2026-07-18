"use client";

// Team & locaties — clientkant. Drie secties:
// 1. Ledenlijst met rol + locatietoewijzing (multi-select) en uitnodigen;
// 2. Locatiebeheer (toevoegen/bewerken) met entitlement-melding bij de limiet;
// 3. Locatievergelijking (compacte tabel, server-berekend).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SectionHeading,
  Select,
  cx,
} from "@/components/ui";
import {
  bewerkLocatieAction,
  deactiveerLidAction,
  nodigLidUitAction,
  voegLocatieToeAction,
  wijzigLidAction,
  type ActieResultaat,
} from "./actions";

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface TeamLid {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  /** Leeg = alle locaties. */
  locationIds: string[];
  isSelf: boolean;
}

export interface TeamLocatie {
  id: string;
  name: string;
  city: string;
  postcode: string;
  street: string | null;
  houseNumber: string | null;
  phone: string | null;
  treatmentRooms: number;
}

export interface LocatieVergelijkRij {
  locationId: string;
  name: string;
  city: string;
  activeVacancies: number;
  /** null = geen gewenste bezetting ingesteld. */
  coveragePct: number | null;
  openGaps: number;
}

export interface TeamClientProps {
  slug: string;
  leden: TeamLid[];
  locaties: TeamLocatie[];
  vergelijking: LocatieVergelijkRij[];
  /** max_locations-limiet (null = onbeperkt). */
  locatieLimiet: number | null;
  crossLocationMatching: boolean;
  planCode: string | null;
}

const ROL_LABELS: Record<string, string> = {
  owner: "Eigenaar",
  admin: "Beheerder",
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  viewer: "Kijker",
  billing_manager: "Facturatiebeheer",
};

const KIESBARE_ROLLEN = [
  "admin",
  "recruiter",
  "hiring_manager",
  "viewer",
  "billing_manager",
  "owner",
] as const;

/* ------------------------------------------------------------------ */
/* Hoofdcomponent                                                      */
/* ------------------------------------------------------------------ */

export function TeamClient({
  slug,
  leden,
  locaties,
  vergelijking,
  locatieLimiet,
  crossLocationMatching,
  planCode,
}: TeamClientProps) {
  return (
    <div className="flex flex-col gap-10">
      <LedenSectie slug={slug} leden={leden} locaties={locaties} />
      <UitnodigSectie slug={slug} locaties={locaties} />
      <LocatieSectie slug={slug} locaties={locaties} locatieLimiet={locatieLimiet} />
      <VergelijkSectie
        vergelijking={vergelijking}
        crossLocationMatching={crossLocationMatching}
        planCode={planCode}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locatie-multiselect (checkbox-chips)                                */
/* ------------------------------------------------------------------ */

function LocatieKiezer({
  locaties,
  selectie,
  onChange,
  idPrefix,
}: {
  locaties: TeamLocatie[];
  selectie: string[];
  onChange: (volgend: string[]) => void;
  idPrefix: string;
}) {
  const alle = selectie.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={alle}
        onClick={() => onChange([])}
        className={cx(
          "rounded-full border px-3 py-1 text-xs font-medium",
          alle
            ? "border-blauw-600 bg-blauw-600 text-white"
            : "border-ink/15 bg-white/70 text-ink hover:bg-white",
        )}
      >
        Alle locaties
      </button>
      {locaties.map((locatie) => {
        const aan = selectie.includes(locatie.id);
        return (
          <button
            key={`${idPrefix}-${locatie.id}`}
            type="button"
            aria-pressed={aan}
            onClick={() =>
              onChange(
                aan ? selectie.filter((id) => id !== locatie.id) : [...selectie, locatie.id],
              )
            }
            className={cx(
              "rounded-full border px-3 py-1 text-xs font-medium",
              aan
                ? "border-blauw-600 bg-blauw-600 text-white"
                : "border-ink/15 bg-white/70 text-ink hover:bg-white",
            )}
          >
            {locatie.name}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ledenlijst                                                          */
/* ------------------------------------------------------------------ */

function LedenSectie({
  slug,
  leden,
  locaties,
}: {
  slug: string;
  leden: TeamLid[];
  locaties: TeamLocatie[];
}) {
  return (
    <section aria-labelledby="leden-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Leden"
        title="Wie werkt er in"
        accent="dit account?"
        description="Rollen bepalen wat iemand mag; een locatietoewijzing beperkt de toegang tot die locaties (leeg = alle locaties)."
      />
      <h2 id="leden-titel" className="sr-only">
        Ledenlijst
      </h2>
      <ul className="flex flex-col gap-4">
        {leden.map((lid) => (
          <li key={lid.membershipId}>
            <LidKaart slug={slug} lid={lid} locaties={locaties} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LidKaart({
  slug,
  lid,
  locaties,
}: {
  slug: string;
  lid: TeamLid;
  locaties: TeamLocatie[];
}) {
  const router = useRouter();
  const [rol, setRol] = useState(lid.role);
  const [locatieIds, setLocatieIds] = useState<string[]>(lid.locationIds);
  const [fout, setFout] = useState<string | null>(null);
  const [opgeslagen, setOpgeslagen] = useState(false);
  const [bezig, startTransition] = useTransition();

  const gewijzigd =
    rol !== lid.role ||
    locatieIds.length !== lid.locationIds.length ||
    locatieIds.some((id) => !lid.locationIds.includes(id));

  const verwerk = (res: ActieResultaat): void => {
    if (!res.ok) {
      setFout(res.fout);
      return;
    }
    setOpgeslagen(true);
    router.refresh();
  };

  const opslaan = (): void => {
    setFout(null);
    setOpgeslagen(false);
    startTransition(async () => {
      verwerk(await wijzigLidAction(slug, { membershipId: lid.membershipId, role: rol, locationIds: locatieIds }));
    });
  };

  const deactiveer = (): void => {
    setFout(null);
    startTransition(async () => {
      verwerk(await deactiveerLidAction(slug, lid.membershipId));
    });
  };

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-base font-semibold text-ink">
            {lid.name}
            {lid.isSelf ? <span className="ml-2 text-sm font-normal text-ink/50">(jij)</span> : null}
          </h3>
          <span className="truncate text-sm text-ink/60">{lid.email}</span>
        </div>
        <Badge tone={lid.status === "active" ? "blauw" : "neutraal"}>
          {lid.status === "active" ? "Actief" : "Uitgenodigd"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Rol" htmlFor={`rol-${lid.membershipId}`} className="w-full sm:w-56">
          <Select
            id={`rol-${lid.membershipId}`}
            value={rol}
            onChange={(e) => setRol(e.target.value)}
          >
            {KIESBARE_ROLLEN.map((r) => (
              <option key={r} value={r}>
                {ROL_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Locaties</span>
          <LocatieKiezer
            idPrefix={lid.membershipId}
            locaties={locaties}
            selectie={locatieIds}
            onChange={setLocatieIds}
          />
        </div>
      </div>

      {fout ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {fout}
        </p>
      ) : null}
      {opgeslagen && !fout ? (
        <p role="status" className="text-sm font-medium text-emerald-800">
          Opgeslagen.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={opslaan} disabled={bezig || !gewijzigd}>
          {bezig ? "Opslaan …" : "Wijzigingen opslaan"}
        </Button>
        {!lid.isSelf ? (
          <Button size="sm" variant="ghost" onClick={deactiveer} disabled={bezig}>
            Deactiveer
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Uitnodigen                                                          */
/* ------------------------------------------------------------------ */

function UitnodigSectie({ slug, locaties }: { slug: string; locaties: TeamLocatie[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState("recruiter");
  const [locatieIds, setLocatieIds] = useState<string[]>([]);
  const [fout, setFout] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);
  const [bezig, startTransition] = useTransition();

  const nodigUit = (): void => {
    setFout(null);
    setSucces(false);
    startTransition(async () => {
      const res = await nodigLidUitAction(slug, { email, role: rol, locationIds: locatieIds });
      if (!res.ok) {
        setFout(res.upgradeHint ? `${res.fout} ${res.upgradeHint}` : res.fout);
        return;
      }
      setSucces(true);
      setEmail("");
      setLocatieIds([]);
      router.refresh();
    });
  };

  return (
    <section aria-labelledby="uitnodig-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Uitnodigen"
        title="Voeg een collega"
        accent="toe"
        description="De collega heeft al een account op Mondzorgwerkt; je nodigt uit op e-mailadres. Teamleden tellen mee in de limiet van je abonnement."
      />
      <h2 id="uitnodig-titel" className="sr-only">
        Collega uitnodigen
      </h2>
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="E-mailadres" htmlFor="uitnodig-email" className="w-full sm:w-72" required>
            <Input
              id="uitnodig-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="collega@praktijk.nl"
            />
          </Field>
          <Field label="Rol" htmlFor="uitnodig-rol" className="w-full sm:w-56">
            <Select id="uitnodig-rol" value={rol} onChange={(e) => setRol(e.target.value)}>
              {KIESBARE_ROLLEN.map((r) => (
                <option key={r} value={r}>
                  {ROL_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="pb-1">
            <Button onClick={nodigUit} disabled={bezig || email.trim().length < 5}>
              {bezig ? "Uitnodigen …" : "Nodig uit"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Locaties</span>
          <LocatieKiezer
            idPrefix="uitnodig"
            locaties={locaties}
            selectie={locatieIds}
            onChange={setLocatieIds}
          />
        </div>
        {fout ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {fout}
          </p>
        ) : null}
        {succes && !fout ? (
          <p role="status" className="text-sm font-medium text-emerald-800">
            Collega toegevoegd — die kan direct inloggen en aan de slag.
          </p>
        ) : null}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Locatiebeheer                                                       */
/* ------------------------------------------------------------------ */

interface LocatieFormWaarden {
  name: string;
  postcode: string;
  city: string;
  street: string;
  houseNumber: string;
  phone: string;
  treatmentRooms: string;
}

function legeLocatie(): LocatieFormWaarden {
  return { name: "", postcode: "", city: "", street: "", houseNumber: "", phone: "", treatmentRooms: "1" };
}

function LocatieSectie({
  slug,
  locaties,
  locatieLimiet,
}: {
  slug: string;
  locaties: TeamLocatie[];
  locatieLimiet: number | null;
}) {
  const limietBereikt = locatieLimiet !== null && locaties.length >= locatieLimiet;

  return (
    <section aria-labelledby="locaties-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Locaties"
        title="Locaties van je"
        accent="organisatie"
        description={
          locatieLimiet === null
            ? "Je abonnement heeft geen locatielimiet."
            : `Je abonnement staat maximaal ${locatieLimiet} ${locatieLimiet === 1 ? "locatie" : "locaties"} toe (nu ${locaties.length}).`
        }
      />
      <h2 id="locaties-titel" className="sr-only">
        Locatiebeheer
      </h2>

      {limietBereikt ? (
        <Card role="note" className="border border-amber-300 bg-amber-50/80">
          <p className="text-sm text-amber-900">
            Je zit op de locatielimiet van je huidige abonnement. Upgrade naar een hoger plan
            (bijvoorbeeld Multi-locatie) om meer locaties toe te voegen.
          </p>
        </Card>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2">
        {locaties.map((locatie) => (
          <li key={locatie.id}>
            <LocatieKaart slug={slug} locatie={locatie} />
          </li>
        ))}
        <li>
          <NieuweLocatieKaart slug={slug} uitgeschakeld={limietBereikt} />
        </li>
      </ul>
    </section>
  );
}

function LocatieFormVelden({
  waarden,
  onChange,
  idPrefix,
}: {
  waarden: LocatieFormWaarden;
  onChange: (volgend: LocatieFormWaarden) => void;
  idPrefix: string;
}) {
  const zet = (veld: keyof LocatieFormWaarden, waarde: string): void =>
    onChange({ ...waarden, [veld]: waarde });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Naam" htmlFor={`${idPrefix}-naam`} required>
        <Input id={`${idPrefix}-naam`} value={waarden.name} onChange={(e) => zet("name", e.target.value)} />
      </Field>
      <Field label="Postcode" htmlFor={`${idPrefix}-postcode`} required>
        <Input
          id={`${idPrefix}-postcode`}
          value={waarden.postcode}
          onChange={(e) => zet("postcode", e.target.value)}
          placeholder="3511 AB"
        />
      </Field>
      <Field label="Plaats" htmlFor={`${idPrefix}-plaats`}>
        <Input id={`${idPrefix}-plaats`} value={waarden.city} onChange={(e) => zet("city", e.target.value)} />
      </Field>
      <Field label="Telefoon" htmlFor={`${idPrefix}-telefoon`}>
        <Input id={`${idPrefix}-telefoon`} value={waarden.phone} onChange={(e) => zet("phone", e.target.value)} />
      </Field>
      <Field label="Straat" htmlFor={`${idPrefix}-straat`}>
        <Input id={`${idPrefix}-straat`} value={waarden.street} onChange={(e) => zet("street", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nr." htmlFor={`${idPrefix}-nr`}>
          <Input id={`${idPrefix}-nr`} value={waarden.houseNumber} onChange={(e) => zet("houseNumber", e.target.value)} />
        </Field>
        <Field label="Kamers" htmlFor={`${idPrefix}-kamers`}>
          <Input
            id={`${idPrefix}-kamers`}
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={waarden.treatmentRooms}
            onChange={(e) => zet("treatmentRooms", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

function LocatieKaart({ slug, locatie }: { slug: string; locatie: TeamLocatie }) {
  const router = useRouter();
  const [bewerken, setBewerken] = useState(false);
  const [waarden, setWaarden] = useState<LocatieFormWaarden>({
    name: locatie.name,
    postcode: locatie.postcode,
    city: locatie.city,
    street: locatie.street ?? "",
    houseNumber: locatie.houseNumber ?? "",
    phone: locatie.phone ?? "",
    treatmentRooms: String(locatie.treatmentRooms),
  });
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  const opslaan = (): void => {
    setFout(null);
    startTransition(async () => {
      const res = await bewerkLocatieAction(slug, {
        id: locatie.id,
        name: waarden.name,
        postcode: waarden.postcode,
        city: waarden.city || undefined,
        street: waarden.street || undefined,
        houseNumber: waarden.houseNumber || undefined,
        phone: waarden.phone || undefined,
        treatmentRooms: Number.parseInt(waarden.treatmentRooms, 10) || 1,
      });
      if (!res.ok) {
        setFout(res.upgradeHint ? `${res.fout} ${res.upgradeHint}` : res.fout);
        return;
      }
      setBewerken(false);
      router.refresh();
    });
  };

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-base font-semibold text-ink">{locatie.name}</h3>
          <span className="text-sm text-ink/60">
            {locatie.city} · {locatie.postcode} · {locatie.treatmentRooms}{" "}
            {locatie.treatmentRooms === 1 ? "kamer" : "kamers"}
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setBewerken((b) => !b)}>
          {bewerken ? "Sluit" : "Bewerken"}
        </Button>
      </div>
      {bewerken ? (
        <div className="flex flex-col gap-3">
          <LocatieFormVelden idPrefix={`loc-${locatie.id}`} waarden={waarden} onChange={setWaarden} />
          {fout ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {fout}
            </p>
          ) : null}
          <div>
            <Button size="sm" onClick={opslaan} disabled={bezig}>
              {bezig ? "Opslaan …" : "Locatie opslaan"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function NieuweLocatieKaart({ slug, uitgeschakeld }: { slug: string; uitgeschakeld: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [waarden, setWaarden] = useState<LocatieFormWaarden>(legeLocatie());
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, startTransition] = useTransition();

  const voegToe = (): void => {
    setFout(null);
    startTransition(async () => {
      const res = await voegLocatieToeAction(slug, {
        name: waarden.name,
        postcode: waarden.postcode,
        city: waarden.city || undefined,
        street: waarden.street || undefined,
        houseNumber: waarden.houseNumber || undefined,
        phone: waarden.phone || undefined,
        treatmentRooms: Number.parseInt(waarden.treatmentRooms, 10) || 1,
      });
      if (!res.ok) {
        // Entitlement-melding: limiet bereikt → upgradehint tonen.
        setFout(res.upgradeHint ? `${res.fout} ${res.upgradeHint}` : res.fout);
        return;
      }
      setOpen(false);
      setWaarden(legeLocatie());
      router.refresh();
    });
  };

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">Locatie toevoegen</h3>
        <Button size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Sluit" : "Nieuw"}
        </Button>
      </div>
      {uitgeschakeld ? (
        <p className="text-sm text-ink/60">
          Je zit op de locatielimiet van je abonnement — toevoegen geeft een upgrademelding.
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-col gap-3">
          <LocatieFormVelden idPrefix="loc-nieuw" waarden={waarden} onChange={setWaarden} />
          {fout ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {fout}
            </p>
          ) : null}
          <div>
            <Button size="sm" onClick={voegToe} disabled={bezig || waarden.name.trim().length < 2}>
              {bezig ? "Toevoegen …" : "Voeg locatie toe"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Locatievergelijking                                                 */
/* ------------------------------------------------------------------ */

function VergelijkSectie({
  vergelijking,
  crossLocationMatching,
  planCode,
}: {
  vergelijking: LocatieVergelijkRij[];
  crossLocationMatching: boolean;
  planCode: string | null;
}) {
  if (vergelijking.length === 0) return null;
  return (
    <section aria-labelledby="vergelijk-titel" className="flex flex-col gap-4">
      <SectionHeading
        eyebrow="Vergelijking"
        title="Hoe staan je locaties"
        accent="ervoor?"
        description="Actieve vacatures, dekkingspercentage van de gewenste bezetting en open gaten per locatie — dezelfde berekening als de bezettingsplanner."
      />
      <h2 id="vergelijk-titel" className="sr-only">
        Locatievergelijking
      </h2>
      <Card className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-ink/60">
                <th scope="col" className="py-1.5 pr-3">Locatie</th>
                <th scope="col" className="py-1.5 pr-3">Actieve vacatures</th>
                <th scope="col" className="py-1.5 pr-3">Dekking</th>
                <th scope="col" className="py-1.5">Open gaten</th>
              </tr>
            </thead>
            <tbody>
              {vergelijking.map((rij) => (
                <tr key={rij.locationId} className="border-t border-ink/10">
                  <td className="py-2 pr-3 font-medium text-ink">
                    {rij.name} <span className="font-normal text-ink/50">— {rij.city}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-ink/80">{rij.activeVacancies}</td>
                  <td className="py-2 pr-3 tabular-nums text-ink/80">
                    {rij.coveragePct === null ? "geen minimum ingesteld" : `${rij.coveragePct}%`}
                  </td>
                  <td className="py-2 tabular-nums text-ink/80">{rij.openGaps}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink/50">
          {crossLocationMatching
            ? "Cross-locatiematching is actief: de kandidatenpool geldt voor al je locaties samen."
            : `Cross-locatiematching zit niet in je huidige abonnement${planCode ? ` (${planCode})` : ""} — kandidaten worden per locatie gematcht.`}
        </p>
      </Card>
    </section>
  );
}
