import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Inloggen — mondzorgwerkt" };

export default function InloggenPage() {
  return (
    <AuthCard
      titel="Welkom terug"
      intro="Log in om verder te gaan met je matches."
    >
      <LoginForm />
      <p className="mt-6 text-center text-sm text-ink/70">
        Nog geen account?{" "}
        <Link className="inline-block px-1 py-3.5 -my-3.5 -mx-1 font-semibold text-brand-blue underline-offset-2 hover:underline" href="/registreren">
          Registreer gratis
        </Link>
      </p>
    </AuthCard>
  );
}
