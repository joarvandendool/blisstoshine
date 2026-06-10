import Link from "next/link";
import { FestiveBackdrop } from "@/components/FestiveBackdrop";
import { LogoLockup } from "@/components/Logo";

export default function Home() {
  return (
    <main className="min-h-screen text-white flex items-center justify-center px-6 relative overflow-hidden">
      <FestiveBackdrop />
      <div className="max-w-2xl text-center space-y-8 anim-fade-in">
        <div className="flex justify-center">
          <LogoLockup />
        </div>
        <h1 className="text-5xl md:text-7xl font-bold leading-tight glow-text">
          Donatie-teller
        </h1>
        <p className="text-xl md:text-2xl text-white/90">
          Samen voor <span className="font-bold text-blissi-geel">€10.000</span> op de
          Bliss&nbsp;to&nbsp;Shine&nbsp;Day.
        </p>

        <div className="pt-6 grid sm:grid-cols-2 gap-4">
          <Link
            href="/display"
            className="glass block rounded-2xl px-8 py-6 font-bold text-lg hover:scale-[1.03] transition"
          >
            📺 Open groot scherm →
          </Link>
          <Link
            href="/invoer"
            className="block bg-white text-framboos rounded-2xl px-8 py-6 font-bold text-lg shadow-lg hover:scale-[1.03] transition"
          >
            ✍️ Donatie invoeren →
          </Link>
        </div>
        <p className="text-white/70 text-sm pt-2">
          Tip: open het grote scherm met{" "}
          <code className="bg-white/10 px-2 py-0.5 rounded">/display?demo=1</code> voor
          een voorproefje.
        </p>
      </div>
    </main>
  );
}
