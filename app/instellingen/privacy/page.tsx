// Privacy & gegevens (/instellingen/privacy) — AVG-rechten voor de ingelogde
// gebruiker: inzage (overzicht per categorie), export (JSON-download),
// correctie (verwijzing naar de profielpagina's), toestemmingen (sectie
// "Gedeelde gegevens": actieve consents inzien en per rij intrekken, art. 7)
// en verwijdering (twee-staps bevestiging met directe anonimisering; zie
// src/server/privacy.ts voor de afwegingen).

import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthzError, firstOrganizationOf, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listActiveConsents } from "@/server/pipeline";
import { gegevensOverzicht } from "@/server/privacy";
import { AppShell, type AppShellNavItem } from "@/components/AppShell";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { trekConsentInAction, verwijderAccountAction } from "./actions";

export default async function PrivacyPagina({
  searchParams,
}: {
  searchParams: Promise<{
    verwijderen?: string;
    fout?: string;
    intrekken?: string;
    ingetrokken?: string;
  }>;
}) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (fout) {
    if (fout instanceof AuthzError) redirect("/inloggen");
    throw fout;
  }
  const { verwijderen, fout, intrekken, ingetrokken } = await searchParams;
  const toonBevestiging = verwijderen === "1";

  const [profiel, lidmaatschap, categorieen, consents] = await Promise.all([
    prisma.candidateProfile.findUnique({
      where: { userId: user.id },
      select: { status: true },
    }),
    firstOrganizationOf(user.id),
    gegevensOverzicht(user.id),
    listActiveConsents(user.id),
  ]);

  const isKandidaat = profiel !== null;
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
    { href: "/instellingen/privacy", label: "Privacy" },
  ];

  return (
    <AppShell nav={nav} userName={user.name} areaLabel="Instellingen">
      <div className="flex flex-col gap-8">
        <PageHeader
          title="Privacy &"
          accent="gegevens"
          description="Bekijk welke gegevens we van je bewaren, download een kopie, of verwijder je account. Vragen? Mail privacy@mondzorgwerkt.nl."
        />

        {/* Inzage */}
        <Card strong>
          <h2 className="text-lg font-semibold text-ink">Welke gegevens bewaren we?</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[24rem] text-left text-sm text-ink">
              <thead>
                <tr className="border-b border-ink/10">
                  <th scope="col" className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                    Categorie
                  </th>
                  <th scope="col" className="py-2 pr-3 text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                    Wat
                  </th>
                  <th scope="col" className="py-2 text-right text-xs font-semibold uppercase tracking-[0.08em] text-ink/60">
                    Aantal
                  </th>
                </tr>
              </thead>
              <tbody>
                {categorieen.map((categorie) => (
                  <tr key={categorie.categorie} className="border-b border-ink/5 last:border-b-0">
                    <td className="py-3 pr-3 font-medium">{categorie.categorie}</td>
                    <td className="py-3 pr-3 text-ink/70">{categorie.omschrijving}</td>
                    <td className="py-3 text-right tabular-nums">{categorie.aantal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink/60">
            Daarnaast bewaren we een geanonimiseerd journaal van matches en
            trajecten als bedrijfsadministratie; dat is na verwijdering van je
            account niet meer tot jou herleidbaar.
          </p>
        </Card>

        {/* Export */}
        <Card>
          <h2 className="text-lg font-semibold text-ink">Download je gegevens</h2>
          <p className="mt-2 text-sm text-ink/70">
            Eén JSON-bestand met al je eigen gegevens: account, profiel,
            sollicitaties, uitnodigingen, toestemmingen en
            notificatievoorkeuren. Zonder gegevens van anderen.
          </p>
          <div className="mt-4">
            <a href="/instellingen/privacy/export" download>
              <Button type="button" variant="secondary">
                Download als JSON
              </Button>
            </a>
          </div>
        </Card>

        {/* Gedeelde gegevens — actieve toestemmingen inzien en intrekken */}
        <Card>
          <h2 className="text-lg font-semibold text-ink">Gedeelde gegevens</h2>
          <p className="mt-2 text-sm text-ink/70">
            Praktijken waarmee je je naam en contactgegevens deelt. Intrekken
            kan altijd; de praktijk ziet daarna weer alleen je geanonimiseerde
            profiel.
          </p>
          {ingetrokken === "1" ? (
            <p role="status" className="mt-3 rounded-lg bg-blauw-50 px-4 py-2 text-sm font-semibold text-blauw-900">
              De toestemming is ingetrokken.
            </p>
          ) : null}
          {!isKandidaat ? (
            <p className="mt-4 text-sm text-ink/60">
              Je hebt geen kandidaatprofiel, dus er zijn geen gedeelde
              kandidaatgegevens.
            </p>
          ) : consents.length === 0 ? (
            <p className="mt-4 text-sm text-ink/60">
              Je deelt je gegevens op dit moment met geen enkele praktijk.
              Toestemming geef je per uitnodiging op{" "}
              <Link href="/kandidaat/uitnodigingen" className="font-semibold text-blauw-900 underline">
                de uitnodigingenpagina
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-4 flex flex-col divide-y divide-ink/5">
              {consents.map((consent) => {
                const bevestigIntrekken = intrekken === consent.id;
                const datum = consent.grantedAt.toLocaleDateString("nl-NL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                });
                return (
                  <li key={consent.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {consent.organizationName}
                          {consent.vacancyTitle ? (
                            <span className="font-normal text-ink/70">
                              {" "}
                              — {consent.vacancyTitle}
                            </span>
                          ) : (
                            <span className="font-normal text-ink/70">
                              {" "}
                              — hele praktijk
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink/60">
                          Gedeeld sinds {datum}
                        </p>
                      </div>
                      {!bevestigIntrekken ? (
                        <Link
                          href={`/instellingen/privacy?intrekken=${consent.id}`}
                          scroll={false}
                        >
                          <Button type="button" variant="secondary">
                            Intrekken
                          </Button>
                        </Link>
                      ) : null}
                    </div>
                    {bevestigIntrekken ? (
                      <form
                        action={trekConsentInAction}
                        className="flex flex-wrap items-center gap-3 rounded-lg bg-roze-500/10 px-4 py-3"
                      >
                        <input type="hidden" name="organizationId" value={consent.organizationId} />
                        {consent.vacancyId ? (
                          <input type="hidden" name="vacancyId" value={consent.vacancyId} />
                        ) : null}
                        <p className="text-sm text-ink">
                          Toestemming voor{" "}
                          <span className="font-semibold">{consent.organizationName}</span>{" "}
                          intrekken?
                        </p>
                        <div className="flex items-center gap-3">
                          <Button type="submit" variant="danger">
                            Ja, intrekken
                          </Button>
                          <Link
                            href="/instellingen/privacy"
                            scroll={false}
                            className="text-sm font-semibold text-ink/70 underline"
                          >
                            Annuleren
                          </Link>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Correctie + toestemmingen */}
        <Card>
          <h2 className="text-lg font-semibold text-ink">Corrigeren en toestemmingen</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-ink/70">
            <li>
              Gegevens aanpassen doe je zelf:{" "}
              {isKandidaat ? (
                <Link href="/kandidaat/profiel" className="font-semibold text-blauw-900 underline">
                  je kandidaatprofiel
                </Link>
              ) : lidmaatschap ? (
                <Link
                  href={`/praktijk/${lidmaatschap.organization.slug}`}
                  className="font-semibold text-blauw-900 underline"
                >
                  je praktijkomgeving
                </Link>
              ) : (
                <span>je profielpagina</span>
              )}
              . Klopt iets niet dat je zelf niet kunt wijzigen? Mail
              privacy@mondzorgwerkt.nl.
            </li>
            {isKandidaat ? (
              <li>
                Toestemming om je naam en contactgegevens met een praktijk te
                delen geef je per uitnodiging op{" "}
                <Link href="/kandidaat/uitnodigingen" className="font-semibold text-blauw-900 underline">
                  de uitnodigingenpagina
                </Link>
                ; intrekken doe je hierboven bij “Gedeelde gegevens”.
              </li>
            ) : null}
            <li>
              Notificatievoorkeuren beheer je bij{" "}
              <Link href="/instellingen/notificaties" className="font-semibold text-blauw-900 underline">
                notificaties
              </Link>
              .
            </li>
          </ul>
        </Card>

        {/* Verwijdering — twee-staps */}
        <Card className="border border-roze-500/40">
          <h2 className="text-lg font-semibold text-ink">Account verwijderen</h2>
          <p className="mt-2 text-sm text-ink/70">
            Dit anonimiseert je account per direct: je naam en e-mailadres
            worden gewist, je kandidaatprofiel wordt verwijderd, alle
            toestemmingen worden ingetrokken en je wordt uitgelogd. Dit kan
            niet ongedaan worden gemaakt. Een geanonimiseerd journaal van
            eerdere trajecten blijft bestaan als bedrijfsadministratie.
          </p>

          {!toonBevestiging ? (
            <div className="mt-4">
              <Link href="/instellingen/privacy?verwijderen=1">
                <Button type="button" variant="danger">
                  Ik wil mijn account verwijderen
                </Button>
              </Link>
            </div>
          ) : (
            <form action={verwijderAccountAction} className="mt-4 flex flex-col gap-4">
              {fout === "bevestiging" ? (
                <p role="alert" className="rounded-lg bg-roze-500/10 px-4 py-2 text-sm font-semibold text-roze-700">
                  Typ het woord “verwijderen” om te bevestigen.
                </p>
              ) : null}
              <label htmlFor="bevestiging" className="text-sm font-medium text-ink">
                Typ <span className="font-mono font-semibold">verwijderen</span> om
                definitief te bevestigen
              </label>
              <Input
                id="bevestiging"
                name="bevestiging"
                autoComplete="off"
                placeholder="verwijderen"
                required
                className="max-w-xs"
              />
              <div className="flex items-center gap-3">
                <Button type="submit" variant="danger">
                  Verwijder mijn account definitief
                </Button>
                <Link href="/instellingen/privacy" className="text-sm font-semibold text-ink/70 underline">
                  Annuleren
                </Link>
              </div>
            </form>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
