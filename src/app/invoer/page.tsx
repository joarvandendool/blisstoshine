"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatEuro, parseEuroInput, timeAgo } from "@/lib/format";
import type { Donation } from "@/lib/types";
import { SunMark } from "@/components/Logo";

type Stage = "form" | "confirm" | "saving" | "saved" | "error";

export default function InvoerPage() {
  const [stage, setStage] = useState<Stage>("form");
  const [firstName, setFirstName] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [showOnDisplay, setShowOnDisplay] = useState(true);
  const [recent, setRecent] = useState<Donation[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [justSaved, setJustSaved] = useState<Donation | null>(null);
  const [, setTick] = useState(0);

  // re-render elke 5 sec voor "x seconden geleden"
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Laatste 5 donaties met realtime updates
  useEffect(() => {
    let mounted = true;
    supabase
      .from("donations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (mounted && data) setRecent(data as Donation[]);
      });

    const channel = supabase
      .channel("invoer-recent")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "donations" },
        (payload) => {
          setRecent((curr) => [payload.new as Donation, ...curr].slice(0, 5));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "donations" },
        (payload) => {
          setRecent((curr) => curr.filter((d) => d.id !== (payload.old as Donation).id));
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const cents = parseEuroInput(amount);

  function handleNext() {
    if (!cents) {
      setErrorMsg("Vul een geldig bedrag in");
      return;
    }
    setErrorMsg("");
    setStage("confirm");
  }

  async function handleSubmit() {
    if (!cents) return;
    setStage("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/donations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim() || null,
          amount_cents: cents,
          message: message.trim() || null,
          show_on_display: showOnDisplay,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Onbekende fout");
      }
      const { donation } = (await res.json()) as { donation: Donation };
      setJustSaved(donation);
      setStage("saved");
      // Reset velden
      setFirstName("");
      setAmount("");
      setMessage("");
      setShowOnDisplay(true);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Onbekende fout");
      setStage("error");
    }
  }

  async function handleUndo(id: string) {
    const pin = window.prompt("Vrijwilligers-PIN om te verwijderen:");
    if (!pin) return;
    const res = await fetch(`/api/donations/${id}`, {
      method: "DELETE",
      headers: { "x-admin-pin": pin },
    });
    if (!res.ok) {
      alert("Verwijderen mislukt — controleer PIN");
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-orange-50 p-4 sm:p-6">
      <div className="max-w-md mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="text-staal hover:underline text-sm">
            ← Home
          </Link>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-widest text-framboos font-semibold">
              Bliss to Shine · invoer
            </p>
            <SunMark size={32} />
          </div>
        </header>

        {/* === FORMULIER === */}
        {stage === "form" && (
          <section className="bg-white rounded-3xl shadow-lg p-6 space-y-5">
            <h1 className="text-2xl font-bold text-staal">Nieuwe donatie</h1>

            <label className="block">
              <span className="text-sm font-medium text-staal">Voornaam (optioneel)</span>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Anoniem"
                maxLength={60}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-framboos"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-staal">Bedrag in euro</span>
              <div className="relative mt-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-gray-400">
                  €
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full rounded-xl border border-gray-200 pl-10 pr-4 py-4 text-3xl font-bold tabular focus:outline-none focus:ring-2 focus:ring-framboos"
                  autoFocus
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[5, 10, 25, 50, 100, 250].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setAmount(String(n))}
                    className="px-3 py-1 rounded-full bg-rose-50 border border-rose-100 text-framboos text-sm hover:bg-rose-100"
                  >
                    €{n}
                  </button>
                ))}
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-staal">
                Bericht (optioneel)
              </span>
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={200}
                className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-framboos"
              />
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnDisplay}
                onChange={(e) => setShowOnDisplay(e.target.checked)}
                className="w-5 h-5 accent-framboos"
              />
              <span className="text-sm text-gray-700">
                Naam mag op het grote scherm verschijnen
              </span>
            </label>

            {errorMsg && (
              <p className="text-sm text-red-600">{errorMsg}</p>
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={!cents}
              className="w-full bg-framboos hover:bg-framboos-dark disabled:opacity-40 text-white rounded-2xl py-4 text-lg font-bold shadow"
            >
              Volgende →
            </button>
          </section>
        )}

        {/* === BEVESTIGEN === */}
        {stage === "confirm" && cents && (
          <section className="bg-white rounded-3xl shadow-lg p-6 space-y-5 text-center">
            <p className="uppercase text-xs tracking-widest text-gray-500">Klopt dit?</p>
            <p className="text-7xl font-bold text-framboos tabular">
              {formatEuro(cents, cents % 100 !== 0)}
            </p>
            <p className="text-staal text-lg">
              van <span className="font-semibold">{firstName.trim() || "Anoniem"}</span>
            </p>
            {message && (
              <p className="italic text-gray-600">&ldquo;{message}&rdquo;</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setStage("form")}
                className="flex-1 bg-gray-100 hover:bg-gray-200 rounded-2xl py-4 font-bold"
              >
                Terug
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 bg-framboos hover:bg-framboos-dark text-white rounded-2xl py-4 font-bold shadow"
              >
                Bevestigen ✓
              </button>
            </div>
          </section>
        )}

        {/* === OPSLAAN === */}
        {stage === "saving" && (
          <section className="bg-white rounded-3xl shadow-lg p-10 text-center">
            <p className="text-staal animate-pulse">Bezig met opslaan…</p>
          </section>
        )}

        {/* === GELUKT === */}
        {stage === "saved" && justSaved && (
          <section className="bg-gradient-to-br from-blissi-geel to-blissi-groen rounded-3xl shadow-lg p-8 text-center space-y-4">
            <p className="text-6xl">✨</p>
            <p className="text-2xl font-bold text-staal-dark">Dankjewel!</p>
            <p className="text-staal-dark">
              {formatEuro(justSaved.amount_cents, justSaved.amount_cents % 100 !== 0)}{" "}
              van {justSaved.first_name || "Anoniem"} toegevoegd.
            </p>
            <button
              onClick={() => setStage("form")}
              className="w-full bg-staal hover:bg-staal-dark text-white rounded-2xl py-4 font-bold mt-2"
            >
              Nog een donatie invoeren
            </button>
          </section>
        )}

        {/* === FOUT === */}
        {stage === "error" && (
          <section className="bg-red-50 border border-red-200 rounded-3xl p-6 space-y-3">
            <p className="font-bold text-red-700">Oeps, er ging iets mis</p>
            <p className="text-sm text-red-600">{errorMsg}</p>
            <button
              onClick={() => setStage("confirm")}
              className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl py-3 font-bold"
            >
              Opnieuw proberen
            </button>
          </section>
        )}

        {/* === RECENTE DONATIES === */}
        <section className="bg-white/70 backdrop-blur rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-staal mb-2 uppercase tracking-wider">
            Laatste donaties
          </h2>
          {recent.length === 0 ? (
            <p className="text-xs text-gray-500">Nog geen donaties.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recent.map((d) => (
                <li
                  key={d.id}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-staal truncate">
                      {d.first_name || "Anoniem"}
                    </p>
                    <p className="text-xs text-gray-500">{timeAgo(d.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-framboos tabular">
                      {formatEuro(d.amount_cents, d.amount_cents % 100 !== 0)}
                    </span>
                    <button
                      onClick={() => handleUndo(d.id)}
                      className="text-xs text-gray-400 hover:text-red-600"
                      title="Verwijderen (PIN nodig)"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
