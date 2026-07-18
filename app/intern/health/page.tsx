// Account health (/intern/health): per organisatie de gezondheidsstatus,
// score, top-redenen, laatste activiteit en verlengdatum — uitsluitend voor
// intern gebruik (geen klantgerichte berichten, geen automatische acties).
// Herberekenen gebeurt via een server action met de knop "Herbereken".
//
// AUTORISATIE: naast de /intern-layout doet ook deze pagina zelf
// requirePlatformAdmin() (defense-in-depth, zelfde patroon als /intern).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import {
  HEALTH_STATUS_LABELS,
  HEALTH_VERSION,
  type AccountHealthStatus,
} from "@/domain/health";
import {
  listAccountHealth,
  recomputeAllAccountHealth,
} from "@/server/account-health";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";

export const dynamic = "force-dynamic";

const TIJD_FORMAT = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const STATUS_KLASSEN: Record<AccountHealthStatus, string> = {
  healthy: "bg-brand-light text-blauw-900",
  attention: "bg-ink/8 text-ink",
  at_risk: "bg-roze-100 text-roze-800",
  onboarding_incomplete: "bg-white/70 text-ink/70 border border-ink/15",
};

function StatusBadge({ status }: { status: AccountHealthStatus | null }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-ink/8 px-3 py-1 text-xs font-semibold text-ink/60">
        nog niet berekend
      </span>
    );
  }
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        STATUS_KLASSEN[status],
      )}
    >
      {HEALTH_STATUS_LABELS[status]}
    </span>
  );
}

const TH_KLASSE =
  "py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60";
const TD_KLASSE = "py-2.5 pr-3 align-top";

/** De drie zwaarst wegende redenen (absolute impact), voor de tabel. */
function topRedenen(reasons: { code: string; uitleg: string; impact: number }[]) {
  return [...reasons]
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 3);
}

export default async function InternHealthPagina() {
  // Defense-in-depth naast de layout, zelfde patroon als app/intern/page.tsx.
  try {
    await requirePlatformAdmin();
  } catch (fout) {
    if (fout instanceof AuthzError) {
      if (fout.status === 401) redirect("/inloggen");
      return null; // de layout toont de 403-melding
    }
    throw fout;
  }

  async function herberekenAction() {
    "use server";
    await requirePlatformAdmin();
    await recomputeAllAccountHealth();
    revalidatePath("/intern/health");
  }

  const rijen = await listAccountHealth();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Account"
        accent="health"
        description={`Uitlegbare gezondheidsscore per organisatie (versie ${HEALTH_VERSION}) — uitsluitend voor intern gebruik, zonder automatische acties richting klanten.`}
        actions={
          <form action={herberekenAction}>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blauw-600 px-5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blauw-700 motion-reduce:transition-none"
            >
              Herbereken
            </button>
          </form>
        }
      />

      {rijen.length === 0 ? (
        <EmptyState
          title="Nog geen organisaties"
          description="Zodra er actieve organisaties zijn, verschijnt hier hun gezondheidsbeeld."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm text-ink">
            <caption className="sr-only">
              Accountgezondheid per organisatie: status, score, belangrijkste
              redenen, laatste activiteit en verlengdatum
            </caption>
            <thead>
              <tr className="border-b border-ink/10">
                <th scope="col" className={TH_KLASSE}>
                  Organisatie
                </th>
                <th scope="col" className={TH_KLASSE}>
                  Status
                </th>
                <th scope="col" className={TH_KLASSE}>
                  Score
                </th>
                <th scope="col" className={TH_KLASSE}>
                  Belangrijkste redenen
                </th>
                <th scope="col" className={TH_KLASSE}>
                  Laatste activiteit
                </th>
                <th scope="col" className={TH_KLASSE}>
                  Verlenging
                </th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((rij) => (
                <tr
                  key={rij.organizationId}
                  className="border-b border-ink/5 last:border-b-0"
                >
                  <th scope="row" className={cx(TD_KLASSE, "text-left font-medium")}>
                    <div className="flex flex-col">
                      <span>{rij.naam}</span>
                      <span className="text-xs font-normal text-ink/50">
                        {rij.slug}
                      </span>
                    </div>
                  </th>
                  <td className={TD_KLASSE}>
                    <StatusBadge status={rij.status} />
                  </td>
                  <td className={cx(TD_KLASSE, "tabular-nums font-semibold")}>
                    {rij.score === null ? (
                      <span className="font-medium italic text-ink/50">—</span>
                    ) : (
                      rij.score
                    )}
                  </td>
                  <td className={cx(TD_KLASSE, "max-w-md")}>
                    {rij.reasons.length === 0 ? (
                      <span className="italic text-ink/50">
                        nog geen redenen — herbereken
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {topRedenen(rij.reasons).map((reden) => (
                          <li key={reden.code} className="leading-snug text-ink/80">
                            <span
                              className={cx(
                                "mr-1.5 font-semibold tabular-nums",
                                reden.impact < 0 ? "text-roze-800" : "text-blauw-900",
                              )}
                            >
                              {reden.impact > 0 ? `+${reden.impact}` : reden.impact}
                            </span>
                            {reden.uitleg}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={cx(TD_KLASSE, "whitespace-nowrap text-ink/70")}>
                    {rij.laatsteActiviteit
                      ? TIJD_FORMAT.format(rij.laatsteActiviteit)
                      : "geen"}
                  </td>
                  <td className={cx(TD_KLASSE, "whitespace-nowrap text-ink/70")}>
                    {rij.verlengdatum ? TIJD_FORMAT.format(rij.verlengdatum) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-sm leading-relaxed text-ink/60">
        De score is de basisscore (50) plus de som van alle redenen, begrensd op
        0–100. Berekende snapshots worden bewaard (AccountHealthSnapshot) zodat
        het verloop later terug te kijken is. Laatste berekening:{" "}
        {rijen.some((r) => r.calculatedAt)
          ? TIJD_FORMAT.format(
              new Date(
                Math.max(
                  ...rijen
                    .filter((r) => r.calculatedAt)
                    .map((r) => r.calculatedAt!.getTime()),
                ),
              ),
            )
          : "nog niet uitgevoerd"}
        .
      </p>
    </div>
  );
}
