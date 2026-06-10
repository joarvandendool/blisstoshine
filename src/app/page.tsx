import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen hero-gradient text-white flex items-center justify-center px-6">
      <div className="max-w-2xl text-center space-y-8">
        <p className="uppercase tracking-[0.3em] text-sm opacity-80">
          Stichting Bliss to Shine
        </p>
        <h1 className="text-5xl md:text-7xl font-bold leading-tight">
          Donatie-teller
        </h1>
        <p className="text-xl md:text-2xl opacity-90">
          Samen voor <span className="font-bold">€10.000</span> op de
          Bliss&nbsp;to&nbsp;Shine&nbsp;Day.
        </p>
        <p className="italic opacity-80">&ldquo;ook met kanker mag je stralen&rdquo;</p>

        <div className="pt-8 grid sm:grid-cols-2 gap-4">
          <Link
            href="/display"
            className="block bg-white text-framboos rounded-2xl px-8 py-6 font-bold text-lg shadow-lg hover:scale-[1.02] transition"
          >
            Open groot scherm →
          </Link>
          <Link
            href="/invoer"
            className="block bg-staal hover:bg-staal-dark rounded-2xl px-8 py-6 font-bold text-lg shadow-lg hover:scale-[1.02] transition"
          >
            Donatie invoeren →
          </Link>
        </div>
      </div>
    </main>
  );
}
