"use client";

import { useEffect, useState } from "react";
import { QrCode } from "./QrCode";

const HANDLE = process.env.NEXT_PUBLIC_IG_HANDLE ?? "blisstoshine";
const PROFILE_URL = `https://www.instagram.com/${HANDLE}/`;

type IgData = {
  configured: boolean;
  username?: string;
  followers?: number | null;
  mediaCount?: number | null;
  media?: { id: string; permalink: string; image: string }[];
  error?: string;
};

const nf = new Intl.NumberFormat("nl-NL");

function IgGlyph({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.7" r="1.2" fill="currentColor" />
    </svg>
  );
}

// Toont volgers + recente posts. Roept onFollowers aan bij elke meting,
// zodat het scherm een viering kan tonen bij een nieuwe volger.
export function InstagramPanel({
  onFollowers,
}: {
  onFollowers?: (count: number) => void;
}) {
  const [data, setData] = useState<IgData | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const r = await fetch("/api/instagram", { cache: "no-store" });
        const j = (await r.json()) as IgData;
        if (!mounted) return;
        setData(j);
        if (typeof j.followers === "number" && onFollowers) onFollowers(j.followers);
      } catch {
        /* stil falen — scherm blijft staan */
      }
    }
    load();
    const iv = setInterval(load, 30000);
    return () => {
      mounted = false;
      clearInterval(iv);
    };
  }, [onFollowers]);

  const live = data?.configured && (data.followers != null || (data.media?.length ?? 0) > 0);
  const posts = (data?.media ?? []).slice(0, 6);

  return (
    <div className="glass rounded-3xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <IgGlyph />
          <span className="font-bold">@{data?.username ?? HANDLE}</span>
        </div>
        {live && data?.followers != null && (
          <div className="text-right leading-none">
            <p className="text-2xl font-bold text-white tabular">{nf.format(data.followers)}</p>
            <p className="text-[10px] uppercase tracking-wider text-white/70">volgers</p>
          </div>
        )}
      </div>

      {live && posts.length > 0 ? (
        <div className="grid grid-cols-3 gap-1.5">
          {posts.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={p.image}
              alt=""
              className="aspect-square w-full object-cover rounded-lg"
            />
          ))}
        </div>
      ) : (
        // Fallback: QR naar profiel + oproep
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-xl p-1.5 shrink-0">
            <QrCode url={PROFILE_URL} size={92} />
          </div>
          <div className="text-white/90 text-sm">
            <p className="font-semibold">Volg ons op Instagram</p>
            <p className="text-white/70">Scan & blijf op de hoogte van alle Shine-momenten ✨</p>
          </div>
        </div>
      )}
    </div>
  );
}
