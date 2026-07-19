// /vacatures — openbaar vacatureoverzicht (Workstream B, fase 6).
// Server-rendered lijst uit de public-site-adapter; filters leven in de
// URL (searchParams) via een gewoon GET-formulier — werkt zonder JS.
// Rustige filterbalk (geen woud van pills), kaarthiërarchie volgens
// opdracht, paginering en een lege staat met suggesties.

import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import type { Weekday } from "@/domain/taxonomy";
import { JobCard } from "@/public-site/JobCard";
import { PublicShell } from "@/public-site/PublicShell";
import { getPublicDataSource } from "@/public-site/data/adapter";
import type {
  PublicJobFilters,
  PublicTag,
  PublicTaxonomyView,
} from "@/public-site/data/types";
import {
  heeftActieveFilters,
  jobSearchQuery,
  parseJobSearchParams,
  type ZoekParams,
} from "@/public-site/format";

export const metadata: Metadata = {
  title: "Vacatures in de mondzorg — mondzorgwerkt",
  description:
    "Openbare vacatures voor tandartsen, mondhygiënisten, assistenten en praktijkmanagers — met werkdagen, uren en vergoeding meteen zichtbaar.",
};

/* ------------------------------ filterbalk ------------------------------ */

const VELD_KLASSE =
  "h-11 w-full rounded-veld border border-ink/20 bg-white px-3 text-[15px] text-ink hover:border-ink/35 focus:border-blauw-600";

function SelectVeld({
  id,
  naam,
  label,
  opties,
  waarde,
  legeOptie,
}: {
  id: string;
  naam: string;
  label: string;
  opties: PublicTag[];
  waarde?: string;
  legeOptie: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-mw-klein font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        name={naam}
        defaultValue={waarde ?? ""}
        className={cx(VELD_KLASSE, "appearance-none")}
      >
        <option value="">{legeOptie}</option>
        {opties.map((optie) => (
          <option key={optie.key} value={optie.key}>
            {optie.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const UREN_OPTIES: PublicTag[] = [
  { key: "8", label: "8 uur" },
  { key: "16", label: "16 uur" },
  { key: "24", label: "24 uur" },
  { key: "32", label: "32 uur" },
];

function FilterBalk({
  filters,
  taxonomie,
}: {
  filters: PublicJobFilters;
  taxonomie: PublicTaxonomyView;
}) {
  const geavanceerdActief = Boolean(
    filters.hoursMin !== undefined ||
      filters.hoursMax !== undefined ||
      filters.employmentType ||
      filters.equipment ||
      filters.software ||
      filters.specialization,
  );

  return (
    <form
      method="get"
      action="/vacatures"
      aria-label="Vacatures filteren"
      className="glass-strong flex flex-col gap-4 rounded-kaart p-5 sm:p-6"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
        <SelectVeld
          id="filter-functie"
          naam="functie"
          label="Functie"
          opties={taxonomie.roles}
          waarde={filters.role}
          legeOptie="Alle functies"
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label
            htmlFor="filter-plaats"
            className="text-mw-klein font-semibold text-ink"
          >
            Plaats of regio
          </label>
          <input
            id="filter-plaats"
            name="plaats"
            type="text"
            defaultValue={filters.city ?? ""}
            placeholder="Bijv. Utrecht"
            className={cx(VELD_KLASSE, "placeholder:text-ink/50")}
          />
        </div>

        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="text-mw-klein font-semibold text-ink">
            Werkdagen
          </legend>
          <div className="mt-1.5 flex gap-1" role="group">
            {taxonomie.days.map((dag) => {
              const actief = filters.days?.includes(dag.key as Weekday);
              return (
                <label key={dag.key} className="relative">
                  <input
                    type="checkbox"
                    name="dag"
                    value={dag.key}
                    defaultChecked={actief}
                    className="peer sr-only"
                  />
                  <span
                    className={cx(
                      "flex h-11 w-9 cursor-pointer items-center justify-center rounded-(--radius-klein) border text-xs font-semibold",
                      "transition-colors duration-(--motion-fast) motion-reduce:transition-none",
                      "border-mw-border-strong bg-white text-ink hover:border-blauw-400",
                      "peer-checked:border-blauw-700 peer-checked:bg-blauw-600 peer-checked:text-white",
                      "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blauw-600",
                    )}
                  >
                    {dag.key}
                    <span className="sr-only">{dag.label}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-blauw-600 px-7 text-[15px] font-semibold text-white shadow-(--shadow-knop-blauw) transition-colors duration-(--motion-instant) hover:bg-blauw-700 motion-reduce:transition-none sm:w-auto"
          >
            Filter
          </button>
        </div>
      </div>

      <details open={geavanceerdActief} className="group">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-mw-klein font-semibold text-blauw-700 hover:underline [&::-webkit-details-marker]:hidden">
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="h-3 w-3 transition-transform duration-(--motion-fast) group-open:rotate-90 motion-reduce:transition-none"
          >
            <path
              d="M4 2.5 8 6l-4 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Meer filters
        </summary>
        <div className="mt-3 grid gap-4 border-t border-mw-border/70 pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <SelectVeld
            id="filter-urenmin"
            naam="urenMin"
            label="Uren vanaf"
            opties={UREN_OPTIES}
            waarde={
              filters.hoursMin !== undefined ? String(filters.hoursMin) : undefined
            }
            legeOptie="Geen minimum"
          />
          <SelectVeld
            id="filter-urenmax"
            naam="urenMax"
            label="Uren tot"
            opties={UREN_OPTIES}
            waarde={
              filters.hoursMax !== undefined ? String(filters.hoursMax) : undefined
            }
            legeOptie="Geen maximum"
          />
          <SelectVeld
            id="filter-contract"
            naam="contract"
            label="Contractvorm"
            opties={taxonomie.employmentTypes}
            waarde={filters.employmentType}
            legeOptie="Alle vormen"
          />
          <SelectVeld
            id="filter-apparatuur"
            naam="apparatuur"
            label="Apparatuur"
            opties={taxonomie.equipment}
            waarde={filters.equipment}
            legeOptie="Alle apparatuur"
          />
          <SelectVeld
            id="filter-software"
            naam="software"
            label="Software"
            opties={taxonomie.software}
            waarde={filters.software}
            legeOptie="Alle software"
          />
          <SelectVeld
            id="filter-specialisatie"
            naam="specialisatie"
            label="Specialisatie"
            opties={taxonomie.specializations}
            waarde={filters.specialization}
            legeOptie="Alle specialisaties"
          />
        </div>
      </details>
    </form>
  );
}

/* ------------------------------ lege staat ------------------------------ */

function LegeStaat({ taxonomie }: { taxonomie: PublicTaxonomyView }) {
  return (
    <div className="glass flex flex-col items-center gap-4 rounded-kaart-lg px-8 py-14 text-center">
      <h2 className="text-mw-kop-3 font-semibold text-ink">
        Geen vacatures gevonden met deze filters
      </h2>
      <p className="max-w-md text-[15px] leading-relaxed text-mw-text-muted">
        Probeer een bredere zoekopdracht — bijvoorbeeld zonder werkdagen of
        met een andere plaats — of bekijk alles per functie:
      </p>
      <ul className="flex flex-wrap justify-center gap-2">
        {taxonomie.roles.map((rol) => (
          <li key={rol.key}>
            <Link
              href={`/vacatures?functie=${rol.key}`}
              className="flex min-h-11 items-center rounded-full border border-mw-border-strong bg-white px-4 text-sm font-medium text-ink hover:border-blauw-400"
            >
              {rol.label}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/vacatures"
        className="flex min-h-11 items-center text-[15px] font-semibold text-blauw-700 underline-offset-4 hover:underline"
      >
        Wis alle filters
      </Link>
    </div>
  );
}

/* -------------------------------- pagina -------------------------------- */

export default async function VacaturesPagina({
  searchParams,
}: {
  searchParams: Promise<ZoekParams>;
}) {
  const params = await searchParams;
  const { filters, page } = parseJobSearchParams(params);

  const bron = getPublicDataSource();
  const [resultaat, taxonomie] = await Promise.all([
    bron.getJobs(filters, page),
    bron.getTaxonomies(),
  ]);

  const actief = heeftActieveFilters(filters);

  return (
    <PublicShell>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:py-16">
        <header className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-mw-kop-1 font-semibold tracking-tight text-ink">
            Vacatures in de mondzorg
          </h1>
          <p className="text-[16px] leading-relaxed text-mw-text-muted">
            Werkdagen, uren en vergoeding meteen zichtbaar. Maak een profiel
            om per vacature te zien hoe goed hij bij jouw week past.
          </p>
        </header>

        <FilterBalk filters={filters} taxonomie={taxonomie} />

        <div className="flex flex-col gap-5">
          <p
            role="status"
            className="text-mw-klein font-medium text-mw-text-muted"
          >
            {resultaat.total === 1
              ? "1 vacature"
              : `${resultaat.total} vacatures`}
            {actief ? " met deze filters" : ""}
          </p>

          {resultaat.items.length === 0 ? (
            <LegeStaat taxonomie={taxonomie} />
          ) : (
            <ul className="grid gap-5 md:grid-cols-2">
              {resultaat.items.map((job) => (
                <li key={job.slug} className="flex">
                  <JobCard job={job} className="w-full" />
                </li>
              ))}
            </ul>
          )}

          {resultaat.totalPages > 1 ? (
            <nav
              aria-label="Paginering"
              className="flex items-center justify-between gap-4 pt-2"
            >
              {resultaat.page > 1 ? (
                <Link
                  href={`/vacatures${jobSearchQuery(filters, resultaat.page - 1)}`}
                  className="flex min-h-11 items-center gap-1 rounded-full border border-mw-border-strong bg-white px-5 text-[15px] font-semibold text-ink hover:border-blauw-400"
                >
                  <span aria-hidden="true">←</span> Vorige
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-mw-klein font-medium tabular-nums text-mw-text-muted">
                Pagina {resultaat.page} van {resultaat.totalPages}
              </p>
              {resultaat.page < resultaat.totalPages ? (
                <Link
                  href={`/vacatures${jobSearchQuery(filters, resultaat.page + 1)}`}
                  className="flex min-h-11 items-center gap-1 rounded-full border border-mw-border-strong bg-white px-5 text-[15px] font-semibold text-ink hover:border-blauw-400"
                >
                  Volgende <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </PublicShell>
  );
}
