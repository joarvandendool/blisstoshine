"use client";

// Mobiel menu van de publieke navigatie — klein client-eiland.
// Toegankelijk: echte <button> met aria-expanded/aria-controls, targets
// ≥ 44px, sluit na navigatie, paneel overlapt (absolute) zodat er geen
// layout shift ontstaat. Motion beperkt tot een korte fade (tokens).

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { PublicNavItem } from "./nav-items";

export function PublicMobileMenu({ items }: { items: PublicNavItem[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Sluit bij navigatie en bij klikken buiten het paneel.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "flex h-11 w-11 items-center justify-center rounded-full text-ink",
          "transition-colors duration-(--motion-instant) motion-reduce:transition-none",
          "hover:bg-ink/5 active:bg-ink/10",
        )}
      >
        <span className="sr-only">{open ? "Menu sluiten" : "Menu openen"}</span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
          className="h-5 w-5"
        >
          {open ? (
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          ) : (
            <path
              d="M3 6h14M3 10h14M3 14h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className={cx(
          "absolute right-0 top-[calc(100%+0.5rem)] z-(--z-dropdown) w-64",
          "glass-strong rounded-kaart p-2 shadow-(--shadow-glass-strong)",
        )}
      >
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(
                  "flex min-h-11 items-center rounded-xl px-4 text-[15px] font-medium text-ink",
                  "transition-colors duration-(--motion-instant) motion-reduce:transition-none",
                  "hover:bg-brand-light/50",
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
