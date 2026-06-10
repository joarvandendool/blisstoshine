"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatEuro, timeAgo } from "@/lib/format";
import type { Donation } from "@/lib/types";
import { CountUp } from "@/components/CountUp";
import { confettiBurst } from "@/components/ConfettiBurst";
import { playDing, playMilestone, unlockAudio } from "@/components/MilestoneSound";
import { QrCode } from "@/components/QrCode";
import { SponsorCarousel } from "@/components/SponsorCarousel";
import { FestiveBackdrop } from "@/components/FestiveBackdrop";
import { LogoLockup } from "@/components/Logo";
import { FloatingDonations } from "@/components/FloatingDonations";
import { MilestoneOverlay } from "@/components/MilestoneOverlay";
import { PhotoCollage } from "@/components/PhotoCollage";

const DEFAULT_GOAL = Number(process.env.NEXT_PUBLIC_GOAL_CENTS ?? 1_000_000);
const QR_URL =
  process.env.NEXT_PUBLIC_QR_TARGET_URL ??
  "https://blisstoshine.nl/steun-ons/herinneringen/";
const MILESTONES = [25, 50, 75, 100];

const DEMO_NAMES = [
  "Anna", "Tom", "Sophie", "Lars", "Emma", "Daan", "Lotte", "Sem",
  "Julia", "Finn", "Noa", "Bram", "Eva", "Lucas", "Fleur", "Familie de Vries",
];
const DEMO_AMOUNTS = [500, 1000, 1000, 2500, 2500, 5000, 5000, 10000, 25000];

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function DisplayPage() {
  const [donations, setDonations] = useState<Donation[]>([]);
  const [goalCents, setGoalCents] = useState(DEFAULT_GOAL);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [, setTick] = useState(0);

  const lastMilestoneRef = useRef(0);
  const [milestoneHit, setMilestoneHit] = useState<number | null>(null);
  const readyRef = useRef(false);

  // float-popup state
  const [floatSignal, setFloatSignal] = useState(0);
  const [floatName, setFloatName] = useState("Anoniem");
  const [floatAmount, setFloatAmount] = useState(0);

  const triggerNewDonation = useCallback(
    (name: string, amountCents: number) => {
      setFloatName(name);
      setFloatAmount(amountCents);
      setFloatSignal((s) => s + 1);
      confettiBurst("small");
      if (!muted) playDing();
    },
    [muted]
  );

  // Detecteer ?demo=1 na mount (geen Suspense nodig)
  useEffect(() => {
    if (typeof window !== "undefined") {
      setDemo(new URLSearchParams(window.location.search).has("demo"));
    }
  }, []);

  // "x sec geleden" verversen
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  // ---- DATA: echte modus (Supabase) ----
  useEffect(() => {
    if (demo) return;
    let mounted = true;

    async function load() {
      const { data: settings } = await supabase
        .from("settings")
        .select("goal_cents, reset_at")
        .eq("id", 1)
        .maybeSingle();
      const resetAt = settings?.reset_at as string | null | undefined;
      if (settings?.goal_cents) setGoalCents(settings.goal_cents as number);

      let q = supabase
        .from("donations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (resetAt) q = q.gte("created_at", resetAt);

      const { data, error } = await q;
      if (!mounted) return;
      if (error) {
        setError(error.message);
        return;
      }
      setError(null);
      setDonations((data as Donation[]) ?? []);
      readyRef.current = true;
    }
    load();

    const channel = supabase
      .channel("display-donations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "donations" },
        (payload) => {
          const d = payload.new as Donation;
          setDonations((curr) =>
            curr.some((x) => x.id === d.id) ? curr : [d, ...curr].slice(0, 300)
          );
          if (readyRef.current) {
            triggerNewDonation(d.show_on_display ? d.first_name || "Anoniem" : "Anoniem", d.amount_cents);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "donations" },
        (payload) => {
          const old = payload.old as Donation;
          setDonations((curr) => curr.filter((x) => x.id !== old.id));
        }
      )
      .on("system", { event: "*" }, () => load())
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [demo, triggerNewDonation]);

  // ---- DATA: demo-modus (simulatie) ----
  useEffect(() => {
    if (!demo) return;
    readyRef.current = false;
    setGoalCents(DEFAULT_GOAL);
    // begin met een paar donaties
    const seed: Donation[] = Array.from({ length: 6 }).map((_, i) => ({
      id: `seed-${i}`,
      first_name: randomOf(DEMO_NAMES),
      amount_cents: randomOf(DEMO_AMOUNTS),
      message: null,
      show_on_display: true,
      source: "invoer" as const,
      created_at: new Date(Date.now() - i * 60000).toISOString(),
    }));
    setDonations(seed);
    readyRef.current = true;

    const iv = setInterval(() => {
      const name = randomOf(DEMO_NAMES);
      const amount = randomOf(DEMO_AMOUNTS);
      const d: Donation = {
        id: `demo-${Date.now()}`,
        first_name: name,
        amount_cents: amount,
        message: null,
        show_on_display: true,
        source: "invoer",
        created_at: new Date().toISOString(),
      };
      setDonations((curr) => [d, ...curr].slice(0, 300));
      triggerNewDonation(name, amount);
    }, 3500);

    return () => clearInterval(iv);
  }, [demo, triggerNewDonation]);

  const total = useMemo(
    () => donations.reduce((s, d) => s + d.amount_cents, 0),
    [donations]
  );
  const donorCount = donations.length;
  const percent = Math.min(100, (total / goalCents) * 100);

  // Mijlpaal-detectie
  useEffect(() => {
    for (const m of MILESTONES) {
      if (percent >= m && lastMilestoneRef.current < m) {
        lastMilestoneRef.current = m;
        setMilestoneHit(m);
        confettiBurst("big");
        if (!muted) playMilestone(m);
      }
    }
  }, [percent, muted]);

  function toggleMute() {
    if (muted) unlockAudio();
    setMuted((m) => !m);
  }

  const ticker = donations.filter((d) => d.show_on_display).slice(0, 12);
  const reached = MILESTONES.reduce((acc, m) => (percent >= m ? m : acc), 0);

  return (
    <main className="min-h-screen text-white overflow-hidden relative">
      <FestiveBackdrop />
      <FloatingDonations signal={floatSignal} name={floatName} amountCents={floatAmount} />
      <MilestoneOverlay milestone={milestoneHit} totalCents={total} />

      {/* Status / demo / mute */}
      <div className="absolute top-6 right-6 z-20 flex items-center gap-3">
        {demo && (
          <span className="bg-blissi-geel text-staal-dark px-3 py-1 rounded-full text-xs font-bold">
            DEMO
          </span>
        )}
        {error && (
          <span className="bg-red-500/90 px-3 py-1 rounded-full text-xs">
            Verbinding hapert…
          </span>
        )}
        <button
          onClick={toggleMute}
          className="glass rounded-full w-12 h-12 text-xl"
          title={muted ? "Geluid aan" : "Geluid uit"}
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 p-8 lg:p-12 min-h-screen">
        {/* HOOFD */}
        <section className="col-span-12 lg:col-span-9 flex flex-col">
          <header className="flex items-center justify-between mb-4">
            <LogoLockup />
            <div className="glass rounded-3xl px-6 py-3 text-center anim-float">
              <p className="text-xs uppercase tracking-widest text-white/80">
                Donateurs
              </p>
              <p className="text-5xl font-bold tabular">{donorCount}</p>
            </div>
          </header>

          {/* MEGA COUNTER */}
          <div className="flex-1 flex flex-col justify-center items-center text-center py-4">
            <p className="uppercase tracking-[0.5em] text-base text-blissi-geel mb-2 anim-float">
              ✨ samen opgehaald ✨
            </p>
            <div className="anim-count-pop" key={total}>
              <div className="text-[8.5rem] lg:text-[12rem] xl:text-[14rem] font-bold leading-none tabular glow-text shimmer-text">
                <CountUp value={total} format={(n) => formatEuro(n)} />
              </div>
            </div>
            <p className="text-2xl lg:text-3xl mt-2 text-white/90">
              op weg naar <span className="font-bold text-blissi-geel">{formatEuro(goalCents)}</span>
            </p>

            {/* PROGRESS BAR met zon-rijder */}
            <div className="w-full max-w-5xl mt-8">
              <div className="relative">
                <div className="h-12 glass rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blissi-geel via-zalm to-blissi-roze transition-all duration-1000 ease-out relative"
                    style={{ width: `${Math.max(percent, 2)}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
                  </div>
                </div>
                {/* milestone-vlaggetjes */}
                {MILESTONES.slice(0, 3).map((m) => (
                  <div
                    key={m}
                    className="absolute top-0 h-12 flex items-center"
                    style={{ left: `${m}%` }}
                  >
                    <div
                      className={`w-1 h-8 rounded-full ${
                        percent >= m ? "bg-white" : "bg-white/40"
                      }`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-base mt-3 px-1">
                {MILESTONES.map((m) => (
                  <span
                    key={m}
                    className={
                      percent >= m
                        ? "font-bold text-blissi-geel"
                        : "text-white/50"
                    }
                  >
                    {percent >= m ? "★ " : ""}
                    {m}%
                  </span>
                ))}
              </div>
              <p className="text-center text-2xl mt-4">
                <span className="font-bold tabular text-blissi-geel">
                  {percent.toFixed(1)}%
                </span>{" "}
                van het doel gehaald
                {reached > 0 && (
                  <span className="ml-3 text-white">· {reached}% mijlpaal ✨</span>
                )}
              </p>
            </div>
          </div>

          {/* TICKER (doorlopend) */}
          <div className="mt-6 glass rounded-2xl py-4 overflow-hidden">
            <div className="flex items-center gap-3 px-4">
              <span className="shrink-0 uppercase tracking-widest text-xs text-blissi-geel font-bold">
                Zojuist ❤
              </span>
              <div className="overflow-hidden flex-1">
                {ticker.length === 0 ? (
                  <p className="text-white/70">
                    Wees jij de eerste die tekent — scan de code!
                  </p>
                ) : (
                  <div className="marquee-track gap-10">
                    {[...ticker, ...ticker].map((d, i) => (
                      <span key={i} className="inline-flex items-center gap-2">
                        <span className="font-semibold">{d.first_name || "Anoniem"}</span>
                        <span className="text-blissi-geel font-bold tabular">
                          {formatEuro(d.amount_cents, d.amount_cents % 100 !== 0)}
                        </span>
                        <span className="text-white/50 text-sm">· {timeAgo(d.created_at)}</span>
                        <span className="text-blissi-roze">✦</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ZIJBALK: QR + foto's */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col items-center justify-center gap-6">
          <div className="glass rounded-3xl p-6 flex flex-col items-center gap-4 anim-float">
            <p className="text-center text-xl font-bold">
              Ook doneren?
            </p>
            <QrCode url={QR_URL} size={240} />
            <p className="text-center text-sm text-white/85">
              Scan & teken mee<br />of kom langs onze stand
            </p>
          </div>
          <PhotoCollage />
        </aside>

        {/* SPONSORS */}
        <footer className="col-span-12 flex items-center justify-center pt-2">
          <SponsorCarousel />
        </footer>
      </div>
    </main>
  );
}
