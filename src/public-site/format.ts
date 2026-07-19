// Presentatiehulpen voor de openbare site: bedragen, uren, werkweek en
// het vertalen van URL-searchParams naar adapterfilters. Geen Prisma,
// geen domeinservices — alleen contracttypes en de gedeelde taxonomie.

import {
  WEEKDAYS,
  emptySchedule,
  type VacancySchedule,
  type Weekday,
} from "@/domain/taxonomy";
import type {
  PublicAvailabilitySlot,
  PublicJobFilters,
  PublicJobView,
} from "./data/types";

/* ------------------------------ bedragen ------------------------------ */

const EURO = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

export function euro(cents: number): string {
  return EURO.format(Math.round(cents / 100));
}

/** "€ 3.400 – € 4.200 p/m" of "tot 45% van de omzet" of null. */
export function vergoeding(job: PublicJobView): string | null {
  if (job.salary) {
    return `${euro(job.salary.minCents)} – ${euro(job.salary.maxCents)} p/m`;
  }
  if (job.revenueShare) {
    return `tot ${job.revenueShare.maxPercent}% van de omzet`;
  }
  return null;
}

export function urenRange(job: PublicJobView): string {
  return job.hoursMin === job.hoursMax
    ? `${job.hoursMin} uur p/w`
    : `${job.hoursMin}–${job.hoursMax} uur p/w`;
}

/* ------------------------------ werkweek ------------------------------- */

/** Vertaal het publieke availability-model naar het WeekGrid-rooster. */
export function naarVacancySchedule(
  availability: PublicAvailabilitySlot[],
): VacancySchedule {
  const rooster = emptySchedule();
  for (const slot of availability) {
    for (const deel of slot.dayparts) {
      rooster[slot.day][deel] = slot.level;
    }
  }
  return rooster;
}

/** Korte tekstsamenvatting, bv. "di + do, vr in overleg". */
export function dagenSamenvatting(
  availability: PublicAvailabilitySlot[],
): string {
  const volgorde = new Map(WEEKDAYS.map((d, i) => [d, i] as const));
  const sorteer = (slots: PublicAvailabilitySlot[]) =>
    [...slots].sort(
      (a, b) => (volgorde.get(a.day) ?? 0) - (volgorde.get(b.day) ?? 0),
    );
  const nodig = sorteer(availability.filter((s) => s.level === "required"));
  const gewenst = sorteer(availability.filter((s) => s.level === "preferred"));
  const delen: string[] = [];
  if (nodig.length > 0) delen.push(nodig.map((s) => s.day).join(" + "));
  if (gewenst.length > 0) {
    delen.push(`${gewenst.map((s) => s.day).join(" + ")} in overleg`);
  }
  return delen.join(", ");
}

/* --------------------- searchParams → adapterfilters -------------------- */

export type ZoekParams = Record<string, string | string[] | undefined>;

function eerste(waarde: string | string[] | undefined): string | undefined {
  const v = Array.isArray(waarde) ? waarde[0] : waarde;
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function alle(waarde: string | string[] | undefined): string[] {
  if (waarde === undefined) return [];
  return (Array.isArray(waarde) ? waarde : [waarde]).filter(
    (v) => v.trim() !== "",
  );
}

function getal(waarde: string | undefined): number | undefined {
  if (waarde === undefined) return undefined;
  const n = Number.parseInt(waarde, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const GELDIGE_DAGEN = new Set<string>(WEEKDAYS);

/** Parseer de searchParams van /vacatures naar adapterfilters + pagina. */
export function parseJobSearchParams(params: ZoekParams): {
  filters: PublicJobFilters;
  page: number;
} {
  const dagen = alle(params.dag).filter((d): d is Weekday =>
    GELDIGE_DAGEN.has(d),
  );
  const filters: PublicJobFilters = {
    role: eerste(params.functie),
    city: eerste(params.plaats),
    days: dagen.length > 0 ? dagen : undefined,
    hoursMin: getal(eerste(params.urenMin)),
    hoursMax: getal(eerste(params.urenMax)),
    employmentType: eerste(params.contract),
    equipment: eerste(params.apparatuur),
    software: eerste(params.software),
    specialization: eerste(params.specialisatie),
  };
  return { filters, page: getal(eerste(params.pagina)) ?? 1 };
}

/** Bouw een /vacatures-querystring uit filters (voor paginering-links). */
export function jobSearchQuery(
  filters: PublicJobFilters,
  page?: number,
): string {
  const q = new URLSearchParams();
  if (filters.role) q.set("functie", filters.role);
  if (filters.city) q.set("plaats", filters.city);
  for (const dag of filters.days ?? []) q.append("dag", dag);
  if (filters.hoursMin !== undefined) q.set("urenMin", String(filters.hoursMin));
  if (filters.hoursMax !== undefined) q.set("urenMax", String(filters.hoursMax));
  if (filters.employmentType) q.set("contract", filters.employmentType);
  if (filters.equipment) q.set("apparatuur", filters.equipment);
  if (filters.software) q.set("software", filters.software);
  if (filters.specialization) q.set("specialisatie", filters.specialization);
  if (page !== undefined && page > 1) q.set("pagina", String(page));
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

/** Zijn er actieve filters (los van paginering)? */
export function heeftActieveFilters(filters: PublicJobFilters): boolean {
  return Boolean(
    filters.role ||
      filters.city ||
      (filters.days && filters.days.length > 0) ||
      filters.hoursMin !== undefined ||
      filters.hoursMax !== undefined ||
      filters.employmentType ||
      filters.equipment ||
      filters.software ||
      filters.specialization,
  );
}

/* ------------------------------- overig -------------------------------- */

const DATUM = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function datum(iso: string): string {
  return DATUM.format(new Date(iso));
}

/** Registratie-URL met next-parameter terug naar de publieke pagina. */
export function registrerenMetNext(pad: string, type?: "praktijk"): string {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  q.set("next", pad);
  return `/registreren?${q.toString()}`;
}
