"use client";

// NotificationBell — belletje in de AppShell-bovenbalk met ongelezen-badge.
// Klik opent een paneel met de laatste meldingen; "Alles gelezen" markeert
// alles via POST /api/notificaties. Data komt van GET /api/notificaties
// (requireUser — uitsluitend eigen meldingen). Bewust geen agressieve
// polling: één keer laden bij mount en verversen bij het openen van het
// paneel is genoeg voor de beta.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";
import type {
  NotificatieWire,
  NotificatiesWire,
} from "../../app/api/notificaties/route";

/* ------------------------------------------------------------------ */
/* Relatieve tijd in het Nederlands, bv. "2 uur geleden"               */
/* ------------------------------------------------------------------ */

function tijdGeleden(isoTijd: string, nu = Date.now()): string {
  const verschilMs = Math.max(0, nu - new Date(isoTijd).getTime());
  const minuten = Math.floor(verschilMs / 60_000);
  if (minuten < 1) return "zojuist";
  if (minuten === 1) return "1 minuut geleden";
  if (minuten < 60) return `${minuten} minuten geleden`;
  const uren = Math.floor(minuten / 60);
  if (uren === 1) return "1 uur geleden";
  if (uren < 24) return `${uren} uur geleden`;
  const dagen = Math.floor(uren / 24);
  if (dagen === 1) return "gisteren";
  if (dagen < 7) return `${dagen} dagen geleden`;
  return new Date(isoTijd).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/* Bel-icoon (decoratief)                                              */
/* ------------------------------------------------------------------ */

function BelIcoon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      className="h-5 w-5"
    >
      <path
        d="M10 2.5a5 5 0 0 0-5 5v2.9c0 .5-.2 1-.5 1.4l-1 1.4c-.5.7 0 1.7.9 1.7h11.2c.9 0 1.4-1 .9-1.7l-1-1.4a2.4 2.4 0 0 1-.5-1.4V7.5a5 5 0 0 0-5-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.2 16.9a1.9 1.9 0 0 0 3.6 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [ongelezen, setOngelezen] = useState(0);
  const [meldingen, setMeldingen] = useState<NotificatieWire[]>([]);
  const [laden, setLaden] = useState(false);
  const [foutmelding, setFoutmelding] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const laadMeldingen = useCallback(async (metSpinner: boolean) => {
    if (metSpinner) setLaden(true);
    setFoutmelding(null);
    try {
      const respons = await fetch("/api/notificaties", { cache: "no-store" });
      if (!respons.ok) throw new Error(`status ${respons.status}`);
      const data = (await respons.json()) as NotificatiesWire;
      setOngelezen(data.unreadCount);
      setMeldingen(data.meldingen);
    } catch {
      setFoutmelding("Meldingen konden niet worden geladen.");
    } finally {
      if (metSpinner) setLaden(false);
    }
  }, []);

  // Eén keer laden bij mount (voor de badge); daarna alleen bij openen.
  useEffect(() => {
    void laadMeldingen(false);
  }, [laadMeldingen]);

  // Paneel sluiten bij klik buiten het paneel of op Escape.
  useEffect(() => {
    if (!open) return;
    function opKlik(gebeurtenis: MouseEvent) {
      if (!wrapperRef.current?.contains(gebeurtenis.target as Node)) {
        setOpen(false);
      }
    }
    function opToets(gebeurtenis: KeyboardEvent) {
      if (gebeurtenis.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", opKlik);
    document.addEventListener("keydown", opToets);
    return () => {
      document.removeEventListener("mousedown", opKlik);
      document.removeEventListener("keydown", opToets);
    };
  }, [open]);

  async function toggleOpen() {
    const gaatOpen = !open;
    setOpen(gaatOpen);
    if (gaatOpen) void laadMeldingen(true);
  }

  async function allesGelezen() {
    try {
      const respons = await fetch("/api/notificaties", { method: "POST" });
      if (!respons.ok) throw new Error(`status ${respons.status}`);
      setOngelezen(0);
      setMeldingen((huidige) =>
        huidige.map((m) => ({
          ...m,
          readAt: m.readAt ?? new Date().toISOString(),
        })),
      );
    } catch {
      setFoutmelding("Markeren als gelezen is niet gelukt.");
    }
  }

  const belLabel =
    ongelezen > 0 ? `Meldingen, ${ongelezen} ongelezen` : "Meldingen";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={belLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(
          "relative inline-flex h-11 w-11 items-center justify-center rounded-full",
          "border border-ink/10 bg-white/70 text-ink backdrop-blur",
          "transition-colors duration-150 hover:bg-white motion-reduce:transition-none",
        )}
      >
        <BelIcoon />
        {ongelezen > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-roze-600 px-1 text-[11px] font-bold leading-none text-white"
          >
            {ongelezen > 9 ? "9+" : ongelezen}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Meldingen"
          className="glass-strong absolute right-0 z-50 mt-2 flex w-88 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-kaart"
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink/5 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Meldingen</h2>
            <button
              type="button"
              onClick={allesGelezen}
              disabled={ongelezen === 0}
              className="text-sm font-semibold text-blauw-700 hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Alles gelezen
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {laden ? (
              <p className="px-4 py-6 text-sm text-ink/60">
                Meldingen laden…
              </p>
            ) : foutmelding ? (
              <p role="alert" className="px-4 py-6 text-sm font-medium text-red-700">
                {foutmelding}
              </p>
            ) : meldingen.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink/60">
                Nog geen meldingen. Zodra er iets gebeurt rond je matches en
                gesprekken, zie je het hier.
              </p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {meldingen.map((melding) => {
                  const inhoud = (
                    <>
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={cx(
                            "text-sm text-ink",
                            melding.readAt ? "font-medium" : "font-semibold",
                          )}
                        >
                          {melding.title}
                        </span>
                        {!melding.readAt ? (
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blauw-600"
                          />
                        ) : null}
                      </span>
                      <span className="block text-sm leading-snug text-ink/70">
                        {melding.body}
                      </span>
                      <span className="block text-xs font-medium text-ink/50">
                        {tijdGeleden(melding.createdAt)}
                      </span>
                    </>
                  );
                  const rijKlasse = cx(
                    "flex flex-col gap-1 px-4 py-3",
                    !melding.readAt && "bg-brand-light/30",
                  );
                  return (
                    <li key={melding.id}>
                      {melding.href ? (
                        <Link
                          href={melding.href}
                          onClick={() => setOpen(false)}
                          className={cx(rijKlasse, "hover:bg-ink/5")}
                        >
                          {inhoud}
                        </Link>
                      ) : (
                        <div className={rijKlasse}>{inhoud}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-ink/5 px-4 py-2.5">
            <Link
              href="/instellingen/notificaties"
              onClick={() => setOpen(false)}
              className="text-sm font-semibold text-blauw-700 hover:underline"
            >
              Notificatievoorkeuren
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NotificationBell;
