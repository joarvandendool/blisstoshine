"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, registerAction, type AuthFormState } from "./actions";

export function AuthCard({
  titel,
  intro,
  children,
}: {
  titel: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-surface px-4 py-12">
      <div aria-hidden className="orb absolute -top-32 -left-32 h-96 w-96 opacity-50" style={{ background: "radial-gradient(circle at 35% 35%, #ed6ca5, transparent 70%)", filter: "blur(70px)", borderRadius: "50%" }} />
      <div aria-hidden className="absolute -right-40 top-10 h-[28rem] w-[28rem] opacity-50" style={{ background: "radial-gradient(circle at 60% 40%, #6b8cff, #cddfee 70%)", filter: "blur(70px)", borderRadius: "50%" }} />
      <div className="relative w-full max-w-md rounded-3xl border border-white/80 bg-white/70 p-8 shadow-[0_20px_60px_rgba(1,32,236,0.08)] backdrop-blur-xl">
        <Link href="/" className="text-xl font-semibold tracking-tight text-ink">
          mondzorg<em className="font-serif italic">werkt</em>
        </Link>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">{titel}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">{intro}</p>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

const inputClass =
  "w-full rounded-xl border border-ink/15 bg-white px-4 py-3 text-base text-ink placeholder:text-ink/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue";

function FormError({ state }: { state: AuthFormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-xl bg-brand-pink/10 px-4 py-3 text-sm font-medium text-[#a52d63]">
      {state.error}
    </p>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        E-mailadres
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Wachtwoord
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-brand-blue px-6 py-3.5 text-base font-semibold text-white shadow-[0_10px_30px_rgba(1,32,236,0.25)] transition hover:-translate-y-px disabled:opacity-60"
      >
        {pending ? "Bezig met inloggen…" : "Inloggen"}
      </button>
    </form>
  );
}

export function RegisterForm({ accountType }: { accountType: "kandidaat" | "praktijk" }) {
  const [state, action, pending] = useActionState(registerAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <input type="hidden" name="accountType" value={accountType} />
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        {accountType === "praktijk" ? "Je naam" : "Volledige naam"}
        <input name="name" autoComplete="name" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        E-mailadres
        <input name="email" type="email" autoComplete="email" required className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
        Wachtwoord
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={inputClass}
        />
        <span className="text-xs font-normal text-ink/60">Minimaal 8 tekens</span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-full bg-brand-blue px-6 py-3.5 text-base font-semibold text-white shadow-[0_10px_30px_rgba(1,32,236,0.25)] transition hover:-translate-y-px disabled:opacity-60"
      >
        {pending
          ? "Account aanmaken…"
          : accountType === "praktijk"
            ? "Start als praktijk"
            : "Maak gratis profiel"}
      </button>
    </form>
  );
}
