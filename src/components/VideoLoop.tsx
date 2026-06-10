"use client";

// Sfeer-video op het grote scherm: automatisch, zonder geluid, in een
// eindeloze loop en zonder bedieningsknoppen. Configureerbaar via
// NEXT_PUBLIC_VIDEO_ID (YouTube video-id).
const VIDEO_ID = process.env.NEXT_PUBLIC_VIDEO_ID ?? "BTbwXCihGQc";

export function VideoLoop() {
  const src =
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}` +
    `?autoplay=1&mute=1&loop=1&playlist=${VIDEO_ID}` +
    `&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0&disablekb=1&fs=0`;

  return (
    <div className="glass rounded-3xl p-2 w-full">
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black/30">
        <iframe
          src={src}
          title="Bliss to Shine sfeervideo"
          className="absolute inset-0 w-full h-full"
          frameBorder={0}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
        {/* Vangt clicks af zodat de video puur sfeer blijft (geen YouTube-UI) */}
        <div className="absolute inset-0" aria-hidden />
      </div>
    </div>
  );
}
