// Notificatievoorkeuren (/instellingen/notificaties): per notificatietype
// toggles voor in-app en e-mail. Werkt voor kandidaat én praktijkgebruiker
// (requireUser); opslaan gebeurt via een server action die uitsluitend
// setPreference uit de notificatielaag aanroept, met de userId uit de sessie.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthzError, firstOrganizationOf, requireUser } from "@/lib/authz";
import {
  NOTIFICATION_TYPES,
  getPreferences,
  setPreference,
  type NotificationType,
} from "@/lib/notifications";
import { prisma } from "@/lib/db";
import { AppShell, type AppShellNavItem } from "@/components/AppShell";
import { Button, Card, PageHeader } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Nederlandse labels per notificatietype                              */
/* ------------------------------------------------------------------ */

const TYPE_LABELS: Record<NotificationType, string> = {
  invitation_received: "Nieuwe uitnodiging",
  invitation_interested: "Kandidaat toont interesse",
  interview_proposed: "Gesprek voorgesteld",
  interview_confirmed: "Gesprek bevestigd",
  no_response_reminder: "Herinnering bij geen reactie",
  vacancy_expiring: "Vacature verloopt bijna",
  strong_match_found: "Nieuwe sterke match",
};

/* ------------------------------------------------------------------ */
/* Server action: alle voorkeuren opslaan via setPreference            */
/* ------------------------------------------------------------------ */

async function bewaarVoorkeuren(formData: FormData): Promise<void> {
  "use server";
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }
  for (const type of NOTIFICATION_TYPES) {
    await setPreference(user.id, type, {
      inApp: formData.get(`${type}:inApp`) === "on",
      email: formData.get(`${type}:email`) === "on",
    });
  }
  revalidatePath("/instellingen/notificaties");
  redirect("/instellingen/notificaties?opgeslagen=1");
}

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */

export default async function NotificatieVoorkeurenPagina({
  searchParams,
}: {
  searchParams: Promise<{ opgeslagen?: string }>;
}) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }
  const { opgeslagen } = await searchParams;

  // Terugnavigatie naar de eigen omgeving: kandidaat, praktijk of intern.
  const [profiel, lidmaatschap, voorkeuren] = await Promise.all([
    prisma.candidateProfile.findUnique({
      where: { userId: user.id },
      select: { status: true },
    }),
    firstOrganizationOf(user.id),
    getPreferences(user.id),
  ]);
  const terugHref =
    profiel?.status === "active"
      ? "/kandidaat"
      : lidmaatschap
        ? `/praktijk/${lidmaatschap.organization.slug}`
        : user.isPlatformAdmin
          ? "/intern"
          : "/";
  const nav: AppShellNavItem[] = [
    { href: terugHref, label: "Mijn overzicht" },
    { href: "/instellingen/notificaties", label: "Notificaties" },
  ];

  // Standaard staan beide kanalen aan; een "all"-rij geldt als fallback voor
  // types zonder eigen rij (zelfde voorrangsregel als de notificatielaag).
  const allesRij = voorkeuren.find((v) => v.type === "all");
  function kanalenVoor(type: NotificationType): { inApp: boolean; email: boolean } {
    const rij = voorkeuren.find((v) => v.type === type) ?? allesRij;
    return rij
      ? { inApp: rij.inApp, email: rij.email }
      : { inApp: true, email: true };
  }

  const CHECKBOX_KLASSE =
    "h-5 w-5 rounded border-ink/30 accent-blauw-600";

  return (
    <AppShell
      nav={nav}
      userName={user.name}
      areaLabel="Instellingen"
    >
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Notificatie"
          accent="voorkeuren"
          description="Bepaal per soort melding of je die in de app en per e-mail wilt ontvangen. Standaard staan beide kanalen aan."
        />

        {opgeslagen === "1" ? (
          <p
            role="status"
            className="rounded-full bg-brand-light px-4 py-2 text-sm font-semibold text-blauw-900"
          >
            Je voorkeuren zijn opgeslagen.
          </p>
        ) : null}

        <Card strong>
          <form action={bewaarVoorkeuren} className="flex flex-col gap-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-left text-sm text-ink">
                <thead>
                  <tr className="border-b border-ink/10">
                    <th
                      scope="col"
                      className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60"
                    >
                      Soort melding
                    </th>
                    <th
                      scope="col"
                      className="py-2 pr-3 text-center text-xs font-semibold uppercase tracking-[0.08em] text-ink/60"
                    >
                      In de app
                    </th>
                    <th
                      scope="col"
                      className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-ink/60"
                    >
                      E-mail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_TYPES.map((type) => {
                    const kanalen = kanalenVoor(type);
                    return (
                      <tr
                        key={type}
                        className="border-b border-ink/5 last:border-b-0"
                      >
                        <td className="py-3.5 pr-3 font-medium">
                          {TYPE_LABELS[type]}
                        </td>
                        <td className="py-3.5 pr-3 text-center">
                          <input
                            type="checkbox"
                            name={`${type}:inApp`}
                            defaultChecked={kanalen.inApp}
                            aria-label={`${TYPE_LABELS[type]} — in de app`}
                            className={CHECKBOX_KLASSE}
                          />
                        </td>
                        <td className="py-3.5 text-center">
                          <input
                            type="checkbox"
                            name={`${type}:email`}
                            defaultChecked={kanalen.email}
                            aria-label={`${TYPE_LABELS[type]} — per e-mail`}
                            className={CHECKBOX_KLASSE}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink/60">
                E-mails worden in de beta nog niet echt verzonden.
              </p>
              <Button type="submit">Voorkeuren opslaan</Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
