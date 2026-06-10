"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatEuro, timeAgo } from "@/lib/format";
import type { Donation } from "@/lib/types";

export default function AdminPage() {
  const [pin, setPin] = useState("");
  const [authed, setAuthed] = useState(false);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!authed) return;
    let mounted = true;
    supabase
      .from("donations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (mounted && data) setDonations(data as Donation[]);
      });
    const channel = supabase
      .channel("admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "donations" },
        () => {
          supabase
            .from("donations")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(500)
            .then(({ data }) => data && setDonations(data as Donation[]));
        }
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [authed]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    // We testen de PIN met een dummy DELETE op een niet-bestaande id —
    // de API antwoordt 401 bij verkeerde PIN, 200 (ok) of 500 bij correcte PIN.
    const res = await fetch("/api/donations/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
      headers: { "x-admin-pin": pin },
    });
    if (res.status === 401) {
      setStatus("Verkeerde PIN");
    } else {
      setAuthed(true);
      setStatus(null);
    }
  }

  async function reset() {
    if (!window.confirm("Echt de teller resetten? Alle huidige donaties worden uit de telling gehaald.")) return;
    const res = await fetch("/api/reset", {
      method: "POST",
      headers: { "x-admin-pin": pin },
    });
    setStatus(res.ok ? "Teller gereset." : "Reset mislukt.");
  }

  async function remove(id: string) {
    if (!window.confirm("Donatie verwijderen?")) return;
    const res = await fetch(`/api/donations/${id}`, {
      method: "DELETE",
      headers: { "x-admin-pin": pin },
    });
    setStatus(res.ok ? "Verwijderd." : "Verwijderen mislukt.");
  }

  const total = donations.reduce((s, d) => s + d.amount_cents, 0);

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <form onSubmit={unlock} className="bg-white p-8 rounded-3xl shadow space-y-4 w-full max-w-sm">
          <h1 className="text-2xl font-bold text-staal">Admin</h1>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-2xl text-center tabular focus:outline-none focus:ring-2 focus:ring-framboos"
            autoFocus
          />
          {status && <p className="text-sm text-red-600">{status}</p>}
          <button className="w-full bg-framboos text-white rounded-2xl py-3 font-bold">
            Inloggen
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex justify-between items-center">
          <Link href="/" className="text-staal hover:underline text-sm">
            ← Home
          </Link>
          <h1 className="text-xl font-bold text-staal">Admin</h1>
        </header>

        <section className="bg-white rounded-3xl p-6 shadow space-y-3">
          <p className="text-sm text-gray-500 uppercase tracking-wider">Totaal nu</p>
          <p className="text-4xl font-bold text-framboos tabular">{formatEuro(total, true)}</p>
          <p className="text-sm text-gray-600">{donations.length} donaties</p>
          {status && <p className="text-sm text-staal">{status}</p>}
          <button
            onClick={reset}
            className="bg-red-600 hover:bg-red-700 text-white rounded-xl px-5 py-2 text-sm font-bold"
          >
            Reset teller (nieuwe dag)
          </button>
        </section>

        <section className="bg-white rounded-3xl p-6 shadow">
          <h2 className="font-bold text-staal mb-3">Alle donaties</h2>
          <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {donations.map((d) => (
              <li key={d.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-staal">
                    {d.first_name || "Anoniem"}{" "}
                    {!d.show_on_display && (
                      <span className="text-xs text-gray-400">(verborgen)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{timeAgo(d.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-framboos tabular">
                    {formatEuro(d.amount_cents, d.amount_cents % 100 !== 0)}
                  </span>
                  <button
                    onClick={() => remove(d.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Verwijder
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
