import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Registreren — mondzorgwerkt" };

export default async function RegistrerenPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const accountType = type === "praktijk" ? "praktijk" : "kandidaat";
  return (
    <AuthCard
      titel={accountType === "praktijk" ? "Praktijkaccount aanmaken" : "Maak je gratis profiel"}
      intro={
        accountType === "praktijk"
          ? "Vind kandidaten die passen bij jouw praktijk en werkweek."
          : "Stel je ideale werkweek samen en ontdek praktijken die echt bij je passen."
      }
    >
      <RegisterForm accountType={accountType} />
      <p className="mt-6 text-center text-sm text-ink/70">
        {accountType === "praktijk" ? (
          <>
            Ben je mondzorgprofessional?{" "}
            <Link className="inline-block px-1 py-3.5 -my-3.5 -mx-1 font-semibold text-brand-blue underline-offset-2 hover:underline" href="/registreren?type=kandidaat">
              Maak een kandidaatprofiel
            </Link>
          </>
        ) : (
          <>
            Werf je voor een praktijk?{" "}
            <Link className="inline-block px-1 py-3.5 -my-3.5 -mx-1 font-semibold text-brand-blue underline-offset-2 hover:underline" href="/registreren?type=praktijk">
              Start als praktijk
            </Link>
          </>
        )}
      </p>
      <p className="mt-2 text-center text-sm text-ink/70">
        Al een account?{" "}
        <Link className="inline-block px-1 py-3.5 -my-3.5 -mx-1 font-semibold text-brand-blue underline-offset-2 hover:underline" href="/inloggen">
          Inloggen
        </Link>
      </p>
    </AuthCard>
  );
}
