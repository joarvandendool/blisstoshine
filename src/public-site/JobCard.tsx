// JobCard — openbare vacaturekaart (homepage-strook + /vacatures).
// Hiërarchie exact volgens fase 6: functie > praktijk > locatie >
// WERKDAGEN (mini-week prominenter dan tekst) > uren > salaris óf
// omzetpercentage > tags > CTA's. Server component.

import Link from "next/link";
import { Badge, cx } from "@/components/ui";
import type { PublicJobView, PublicTag } from "./data/types";
import { MiniWeek } from "./MiniWeek";
import { registrerenMetNext, urenRange, vergoeding } from "./format";

/** Max. tags op de kaart: apparatuur + specialisaties, rustig gehouden. */
function kaartTags(job: PublicJobView): PublicTag[] {
  return [...job.specializations, ...job.equipment].slice(0, 3);
}

export function JobCard({
  job,
  className,
}: {
  job: PublicJobView;
  className?: string;
}) {
  const pad = `/vacatures/${job.slug}`;
  const beloning = vergoeding(job);
  const tags = kaartTags(job);

  return (
    <article
      className={cx(
        "glass flex flex-col gap-4 rounded-kaart p-6",
        "transition-shadow duration-(--motion-base) motion-reduce:transition-none hover:shadow-(--shadow-glass-strong)",
        className,
      )}
    >
      {/* 1. functie > 2. praktijk > 3. locatie */}
      <div className="flex flex-col gap-1">
        <h3 className="break-words text-mw-kop-3 font-semibold text-ink">
          <Link
            href={pad}
            className="rounded-md underline-offset-4 hover:underline"
          >
            {job.title}
          </Link>
        </h3>
        <p className="text-mw-klein font-medium text-ink/80">
          {job.organization.name}
        </p>
        <p className="text-mw-klein text-mw-text-muted">
          {job.location.city} · {job.location.region}
        </p>
      </div>

      {/* 4. werkdagen — prominenter dan de tekstregels eronder */}
      <MiniWeek availability={job.availability} />

      {/* 5. uren, 6. salaris of omzetpercentage */}
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-1.5">
          <dt className="sr-only">Uren per week</dt>
          <dd className="text-[15px] font-semibold tabular-nums text-ink">
            {urenRange(job)}
          </dd>
        </div>
        {beloning ? (
          <div className="flex items-baseline gap-1.5">
            <dt className="sr-only">
              {job.revenueShare ? "Omzetpercentage" : "Salaris"}
            </dt>
            <dd className="text-[15px] font-semibold tabular-nums text-blauw-700">
              {beloning}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline gap-1.5">
          <dt className="sr-only">Contractvorm</dt>
          <dd className="text-mw-klein text-mw-text-muted">
            {job.employmentTypes.map((t) => t.label).join(" / ")}
          </dd>
        </div>
      </dl>

      {/* 7. tags */}
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Kenmerken">
          {tags.map((t) => (
            <li key={t.key}>
              <Badge tone="neutraal">{t.label}</Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {/* 8. CTA's */}
      <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink/8 pt-4">
        <Link
          href={pad}
          className="flex min-h-11 items-center gap-1 rounded-md text-[15px] font-semibold text-blauw-700 underline-offset-4 hover:underline"
        >
          Bekijk vacature
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href={registrerenMetNext(pad)}
          className={cx(
            "flex min-h-11 items-center rounded-full border border-mw-border-strong bg-white px-4 text-sm font-semibold text-ink",
            "transition-colors duration-(--motion-instant) motion-reduce:transition-none hover:border-blauw-400",
          )}
        >
          Bereken mijn match
        </Link>
      </div>
    </article>
  );
}
