"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatEuro, timeAgo } from "@/lib/format";
import type { Donation } from "@/lib/types";
import { CountUp } from "@/components/CountUp";
import { confettiBurst } from "@/components/ConfettiBurst";
import { playDing, playMilestone, unlockAudio } from "@/components/MilestoneSound";
import { QrCode } from "@/components/QrCode";
import { SponsorCarousel } from "@/components/SponsorCarousel";

const GOAL_CENTS = Number(process.env.NEXT_PUBLIC_GOAL_CENTS ?? 1_000_000);
const QR_URL =
  process.env.NEXT_PUBLIC_QR_TARGET_URL ??
  "https://blisstoshine.nl/steun-ons/herinneringen/";

const MILESTONES = [25, 50, 75, 100];

export default function DisplayPage() {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const lastMilestoneRef = useRef<number>(0);

  // Tick voor "x seconden geleden"
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // Eerste load + realtime
  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data, error } = await supabase
        .from("donations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (!mounted) return;
      if (error) {
        setError(error.message);
        return;
      }
      setError(null);
      setDonations((data as Donation[]) ?? []);
    }
    load();

    const channel = supabase
      .channel("display-donations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "donations" },
        (payload) => {
          const d = payload.new as Donation;
          setDonations((curr) => [d, ...curr].slice(0, 200));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "donations" },
        (payload) => {
          const old = payload.old as Donation;
          setDonations((curr) => curr.filter((d) => d.id !== old.id));
        }
      )
      .on("system", { event: "*" }, () => {
        // Bij reconnect alles opnieuw laden
        load();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const total = useMemo(
    () => donations.reduce((sum, d) => sum + d.amount_cents, 0),
    [donations]
  );
  const donorCount = donations.length;
  const percent = Math.min(100, (total / GOAL_CENTS) * 100);

  // Reageer op nieuwe donaties: confetti + geluid + mijlpaal-check
  const prevCountRef = useRef(donorCount);
  useEffect(() => {
    if (donorCount > prevCountRef.current) {
      confettiBurst("small");
      if (!muted) playDing();
    }
    prevCountRef.current = donorCount;
  }, [donorCount, muted]);

  // Mijlpaal-detectie
  useEffect(() => {
    for (const m of MILESTONES) {
      if (percent >= m && lastMilestoneRef.current < m) {
        lastMilestoneRef.current = m;
        confettiBurst("big");
        if (!muted) playMilestone(m);
      }
    }
  }, [percent, muted]);

  function toggleMute() {
    if (muted) unlockAudio();
    setMuted((m) => !m);
  }

  const tickerDonations = donations.filter((d) => d.show_on_display).slice(0, 10);
  const reachedMilestone = MILESTONES.reduce(
    (acc, m) => (percent >= m ? m : acc),
    0
  );

  return (
    <main className="min-h-screen hero-gradient text-white overflow-hidden relative">
      {/* Status / Mute */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        {error && (
          <span className="bg-red-500/90 px-3 py-1 rounded-full text-xs">
            Verbinding hapert…
          </span>
        )}
        <button
          onClick={toggleMute}
          className="bg-white/10 hover:bg-white/20 backdrop-blur rounded-full w-12 h-12 text-xl border border-white/20"
          title={muted ? "Geluid aan" : "Geluid uit"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 p-8 lg:p-12 min-h-screen">
        {/* === HOOFD KOLOM: counter + balk + ticker === */}
        <section className="col-span-12 lg:col-span-9 flex flex-col">
          <header className="flex items-center justify-between mb-6">
            <div>
              <p className="uppercase tracking-[0.4em] text-sm opacity-80">
                Bliss to Shine Day
              </p>
              <h1 className="text-3xl lg:text-4xl font-bold mt-1">
                ook met kanker mag je stralen
              </h1>
            </div>
            <div className="text-right">
              <p className="text-sm opacity-80 uppercase tracking-widest">Donateurs</p>
              <p className="text-5xl font-bold tabular">{donorCount}</p>
            </div>
          </header>

          {/* MEGA COUNTER */}
          <div className="flex-1 flex flex-col justify-center items-center text-center">
            <p className="uppercase tracking-[0.4em] text-sm opacity-80 mb-4">
              Ingezamelde donaties
            </p>
            <div className="text-[10rem] lg:text-[13rem] font-bold leading-none tabular drop-shadow-2xl">
              <CountUp value={total} format={(n) => formatEuro(n)} />
            </div>
            <p className="text-2xl lg:text-3xl mt-4 opacity-90">
              van het doel van{" "}
              <span className="font-bold">{formatEuro(GOAL_CENTS)}</span>
            </p>

            {/* PROGRESS BAR */}
            <div className="w-full max-w-4xl mt-8">
              <div className="h-10 bg-white/15 rounded-full overflow-hidden border border-white/30 backdrop-blur">
                <div
                  className="h-full bg-gradient-to-r from-blissi-geel via-zalm to-blissi-roze transition-all duration-1000 ease-out shadow-inner relative"
                  style={{ width: `${percent}%` }}
                >
                  <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
                </div>
              </div>
              <div className="flex justify-between text-sm mt-2 opacity-80">
                {MILESTONES.map((m) => (
                  <span
                    key={m}
                    className={
                      percent >= m ? "font-bold text-blissi-geel" : "opacity-60"
                    }
                  >
                    {m}%
                  </span>
                ))}
              </div>
              <p className="text-center text-xl mt-4">
                <span className="font-bold tabular">{percent.toFixed(1)}%</span>{" "}
                gehaald
                {reachedMilestone > 0 && (
                  <span className="ml-3 text-blissi-geel">
                    ✨ {reachedMilestone}% bereikt!
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* TICKER */}
          <div className="mt-8 bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/20">
            <p className="uppercase tracking-widest text-xs opacity-80 mb-2">
              Zojuist gedoneerd
            </p>
            {tickerDonations.length === 0 ? (
              <p className="opacity-70">
                Nog geen donaties — wees jij de eerste die tekent!
              </p>
            ) : (
              <ul className="flex gap-6 overflow-hidden">
                {tickerDonations.map((d) => (
                  <li
                    key={d.id}
                    className="animate-slide-up whitespace-nowrap flex items-center gap-2"
                  >
                    <span className="font-semibold">
                      {d.first_name || "Anoniem"}
                    </span>
                    <span className="text-blissi-geel font-bold tabular">
                      {formatEuro(d.amount_cents, d.amount_cents % 100 !== 0)}
                    </span>
                    <span className="text-xs opacity-70">
                      · {timeAgo(d.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* === ZIJBALK: QR + uitleg === */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col items-center justify-center gap-6 bg-white/10 backdrop-blur rounded-3xl p-6 border border-white/20">
          <p className="text-center text-lg font-semibold">
            Ook doneren?<br />Scan de code
          </p>
          <QrCode url={QR_URL} size={260} />
          <p className="text-center text-sm opacity-90">
            of meld je bij de Bliss to Shine stand
          </p>
        </aside>

        {/* === SPONSORS === */}
        <footer className="col-span-12 flex items-center justify-center pt-4">
          <SponsorCarousel />
        </footer>
      </div>
    </main>
  );
}
