// Laadstaat van /vacatures: skeletons die de ruimte van de filterbalk en
// de vacaturekaarten reserveren zodat er geen layout shift optreedt
// (audit-P2 #5). Pulseert alleen zonder prefers-reduced-motion.

import { Skeleton } from "@/components/ui";
import { PublicShell } from "@/public-site/PublicShell";

function KaartSkeleton() {
  return (
    <div className="glass flex w-full flex-col gap-4 rounded-kaart p-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
      </div>
      {/* mini-week */}
      <div className="flex gap-1">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-9 flex-1" />
        ))}
      </div>
      <Skeleton className="h-5 w-2/3" />
      <div className="flex gap-1.5">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-auto flex items-center gap-5 border-t border-ink/8 pt-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-11 w-40 rounded-full" />
      </div>
    </div>
  );
}

export default function VacaturesLaden() {
  return (
    <PublicShell>
      <div
        role="status"
        aria-live="polite"
        className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:py-16"
      >
        <span className="sr-only">Vacatures laden…</span>
        <div className="flex max-w-2xl flex-col gap-3">
          <Skeleton className="h-10 w-80 max-w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        {/* filterbalk */}
        <div className="glass-strong flex flex-col gap-4 rounded-kaart p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto]">
            <Skeleton className="h-[4.5rem] w-full" />
            <Skeleton className="h-[4.5rem] w-full" />
            <Skeleton className="h-[4.5rem] w-64 max-w-full" />
            <Skeleton className="h-11 w-28 self-end rounded-full" />
          </div>
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <KaartSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
