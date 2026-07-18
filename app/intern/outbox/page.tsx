// Dev-outbox (/intern/outbox): inzage in OutboxEmail-rijen voor platform-
// admins. In de beta worden e-mails niet echt verzonden; deze pagina toont
// wat er verzonden zóu worden. Klik op een onderwerp om de volledige body te
// bekijken (via ?id= — puur server-side, geen client JS nodig).
//
// AUTORISATIE: naast de /intern-layout doet ook deze pagina zelf
// requirePlatformAdmin() (defense-in-depth, zelfde patroon als /intern).

import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthzError, requirePlatformAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";

const TIJD_FORMAT = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_LABELS: Record<string, string> = {
  pending: "wachtend",
  sent: "verzonden",
  failed: "mislukt",
};

const STATUS_KLASSEN: Record<string, string> = {
  pending: "bg-ink/8 text-ink",
  sent: "bg-brand-light text-blauw-900",
  failed: "bg-roze-100 text-roze-800",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        STATUS_KLASSEN[status] ?? "bg-ink/8 text-ink",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const TH_KLASSE =
  "py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60";
const TD_KLASSE = "py-2.5 pr-3 align-top";

export default async function OutboxPagina({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
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

  const { id } = await searchParams;
  const emails = await prisma.outboxEmail.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const geselecteerd = id ? emails.find((e) => e.id === id) ?? null : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Development-"
        accent="outbox"
        description="Alle e-mails die het platform zou versturen, ter controle tijdens de private beta."
      />

      <p
        role="note"
        className="rounded-kaart bg-roze-100 px-5 py-4 text-sm font-medium leading-relaxed text-roze-800"
      >
        Development-outbox — e-mails worden in de beta niet echt verzonden; een
        productieprovider haakt hier later in.
      </p>

      {geselecteerd ? (
        <Card strong className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">
                {geselecteerd.subject}
              </h2>
              <p className="text-sm text-ink/70">
                Aan: <span className="font-medium">{geselecteerd.toEmail}</span>
                {" — "}
                {TIJD_FORMAT.format(geselecteerd.createdAt)}
              </p>
            </div>
            <StatusBadge status={geselecteerd.status} />
          </div>
          <pre className="whitespace-pre-wrap rounded-veld border border-ink/10 bg-white px-4 py-3 font-sans text-sm leading-relaxed text-ink">
            {geselecteerd.body}
          </pre>
          <div>
            <Link
              href="/intern/outbox"
              className="text-sm font-semibold text-blauw-700 hover:underline"
            >
              Sluit voorbeeld
            </Link>
          </div>
        </Card>
      ) : null}

      {emails.length === 0 ? (
        <EmptyState
          title="Nog geen e-mails in de outbox"
          description="Zodra het platform een notificatie met e-mailkanaal verstuurt, verschijnt de e-mail hier."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm text-ink">
              <thead>
                <tr className="border-b border-ink/10">
                  <th scope="col" className={TH_KLASSE}>
                    Aan
                  </th>
                  <th scope="col" className={TH_KLASSE}>
                    Onderwerp
                  </th>
                  <th scope="col" className={TH_KLASSE}>
                    Status
                  </th>
                  <th scope="col" className={cx(TH_KLASSE, "pr-0")}>
                    Tijd
                  </th>
                </tr>
              </thead>
              <tbody>
                {emails.map((email) => (
                  <tr
                    key={email.id}
                    className={cx(
                      "border-b border-ink/5 last:border-b-0",
                      email.id === id && "bg-brand-light/30",
                    )}
                  >
                    <td className={cx(TD_KLASSE, "text-ink/80")}>
                      {email.toEmail}
                    </td>
                    <td className={cx(TD_KLASSE, "font-medium")}>
                      <Link
                        href={`/intern/outbox?id=${email.id}`}
                        className="text-blauw-700 hover:underline"
                        aria-label={`Bekijk e-mail: ${email.subject}`}
                      >
                        {email.subject}
                      </Link>
                    </td>
                    <td className={TD_KLASSE}>
                      <StatusBadge status={email.status} />
                    </td>
                    <td className={cx(TD_KLASSE, "pr-0 whitespace-nowrap tabular-nums")}>
                      {TIJD_FORMAT.format(email.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
