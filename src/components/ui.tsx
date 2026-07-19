// UI-primitieven van Mondzorgwerkt — server-compatibel (geen client hooks).
// Interactie (onClick e.d.) wordt aangeleverd door client-componenten die
// deze primitives gebruiken. Stijltaal: veel wit, frosted glass, ronde
// pill-vormen, ink-tekst (WCAG AA) en italic serif als editorial accent.

import type {
  ComponentPropsWithRef,
  ReactNode,
} from "react";
import type { MatchLabel } from "@/domain/matching";

/* ------------------------------------------------------------------ */
/* cx — eenvoudige className-merge zonder externe dependencies         */
/* ------------------------------------------------------------------ */

export function cx(
  ...delen: Array<string | false | null | undefined>
): string {
  return delen.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */
/* Iconen (inline SVG, decoratief — altijd aria-hidden)                */
/* ------------------------------------------------------------------ */

function VinkjeIcoon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={cx("h-3.5 w-3.5 shrink-0", className)}
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const KNOP_VARIANTEN: Record<ButtonVariant, string> = {
  primary:
    "bg-blauw-600 text-white shadow-(--shadow-knop-blauw) hover:bg-blauw-700 active:bg-blauw-800",
  secondary:
    "glass text-ink hover:bg-white/90",
  ghost:
    "bg-transparent text-ink hover:bg-ink/5",
  /* Statuskleur uit de mw-tokens: wit op error = 6,6:1 (AA). Bewust rood,
     nooit merkroze — merk en status blijven gescheiden. */
  danger:
    "bg-mw-error text-white shadow-[0_10px_30px_rgb(180_35_24/0.25)] hover:bg-mw-error-strong active:bg-mw-error-strong",
};

const KNOP_MATEN: Record<ButtonSize, string> = {
  sm: "px-4 py-2 text-sm gap-1.5",
  md: "px-6 py-2.5 text-[15px] gap-2",
  lg: "px-8 py-3.5 text-base gap-2",
};

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center rounded-full font-semibold",
        "transition-[background-color,box-shadow,transform] duration-150",
        "motion-safe:hover:-translate-y-px motion-reduce:transition-none",
        "disabled:pointer-events-none disabled:opacity-50",
        KNOP_VARIANTEN[variant],
        KNOP_MATEN[size],
        className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export interface CardProps extends ComponentPropsWithRef<"div"> {
  /** Sterkere, minder transparante glass-variant. */
  strong?: boolean;
}

export function Card({ strong = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        strong ? "glass-strong" : "glass",
        "rounded-kaart p-6",
        className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Chip — selecteerbaar; geselecteerde staat toont vinkje ÉN kleur     */
/* ------------------------------------------------------------------ */

export interface ChipProps extends ComponentPropsWithRef<"button"> {
  selected?: boolean;
}

export function Chip({
  selected = false,
  className,
  children,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium",
        "transition-colors duration-(--motion-fast) motion-reduce:transition-none",
        "disabled:pointer-events-none disabled:border-transparent disabled:bg-mw-disabled disabled:text-mw-disabled-text disabled:shadow-none",
        selected
          ? "border border-blauw-700 bg-blauw-600 text-white shadow-(--shadow-knop-blauw) hover:bg-blauw-700"
          : "border border-mw-border-strong bg-white/80 text-ink backdrop-blur hover:border-blauw-400 hover:bg-white",
        className,
      )}
      {...rest}
    >
      {selected ? <VinkjeIcoon /> : null}
      <span>{children}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type BadgeTone = "blauw" | "roze" | "neutraal" | "wit";

const BADGE_TONEN: Record<BadgeTone, string> = {
  blauw: "bg-brand-light text-blauw-900",
  roze: "bg-roze-100 text-roze-800",
  neutraal: "bg-ink/8 text-ink",
  wit: "bg-white/80 text-ink border border-ink/10",
};

export interface BadgeProps extends ComponentPropsWithRef<"span"> {
  tone?: BadgeTone;
}

export function Badge({ tone = "blauw", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
        BADGE_TONEN[tone],
        className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* ScoreBadge — matchscore + Nederlands label per matchniveau          */
/* ------------------------------------------------------------------ */

const SCORE_STIJLEN: Record<MatchLabel, { tekst: string; klasse: string }> = {
  excellent: {
    tekst: "Uitstekende match",
    klasse: "bg-blauw-600 text-white shadow-(--shadow-knop-blauw)",
  },
  good: {
    tekst: "Goede match",
    klasse: "bg-brand-light text-blauw-900",
  },
  partial: {
    tekst: "Gedeeltelijke match",
    klasse: "bg-roze-100 text-roze-800",
  },
  low: {
    tekst: "Beperkte match",
    klasse: "bg-ink/8 text-ink",
  },
  ineligible: {
    tekst: "Geen match mogelijk",
    klasse: "bg-white text-ink border border-ink/15",
  },
};

export interface ScoreBadgeProps {
  score: number;
  label: MatchLabel;
  className?: string;
}

export function ScoreBadge({ score, label, className }: ScoreBadgeProps) {
  const stijl = SCORE_STIJLEN[label];
  const rond = Math.round(Math.min(100, Math.max(0, score)));
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold",
        stijl.klasse,
        className,
      )}
    >
      {label !== "ineligible" ? (
        <span className="tabular-nums">{rond}%</span>
      ) : null}
      <span>{stijl.tekst}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Formulier: Field, Input, Select, Textarea                           */
/* ------------------------------------------------------------------ */

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** Nederlandse foutmelding; wordt rood en met alert-rol getoond. */
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-semibold text-ink"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-mw-rose-text">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-sm text-ink/70">{hint}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-mw-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Contrastrijke basis voor invoervelden: wit vlak, ink-tekst, duidelijke rand. */
const VELD_BASIS = cx(
  "w-full rounded-veld border border-ink/20 bg-white px-4 py-3 text-[15px] text-ink",
  "placeholder:text-ink/50",
  "transition-colors duration-150 motion-reduce:transition-none",
  "hover:border-ink/35 focus:border-blauw-600",
  "aria-[invalid=true]:border-mw-error",
  "disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink/60",
);

export type InputProps = ComponentPropsWithRef<"input">;

export function Input({ className, ...rest }: InputProps) {
  return <input className={cx(VELD_BASIS, className)} {...rest} />;
}

export type SelectProps = ComponentPropsWithRef<"select">;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select className={cx(VELD_BASIS, "appearance-none pr-10", className)} {...rest}>
      {children}
    </select>
  );
}

export type TextareaProps = ComponentPropsWithRef<"textarea">;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cx(VELD_BASIS, "resize-y", className)}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* ProgressBar                                                         */
/* ------------------------------------------------------------------ */

export interface ProgressBarProps {
  /** Huidige waarde (0..max). */
  value: number;
  max?: number;
  /** Toegankelijk label, bv. "Profiel compleet". */
  label: string;
  showValue?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  className,
}: ProgressBarProps) {
  const begrensd = Math.min(max, Math.max(0, value));
  const procent = max > 0 ? (begrensd / max) * 100 : 0;
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={begrensd}
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-light/70"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-blauw-500 to-blauw-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${procent}%` }}
        />
      </div>
      {showValue ? (
        <span className="text-sm font-semibold tabular-nums text-ink">
          {Math.round(procent)}%
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat — groot getal met serif-accent                                 */
/* ------------------------------------------------------------------ */

export interface StatProps {
  value: string | number;
  /** Serif-italic accent achter het getal, bv. "%" of "+". */
  suffix?: string;
  label: string;
  accent?: "blauw" | "roze";
  className?: string;
}

export function Stat({
  value,
  suffix,
  label,
  accent = "blauw",
  className,
}: StatProps) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <div className="text-4xl font-semibold tracking-tight text-ink">
        <span className="tabular-nums">{value}</span>
        {suffix ? (
          <em
            className={cx(
              "font-serif italic font-bold",
              accent === "roze" ? "text-mw-rose-text" : "text-blauw-600",
            )}
          >
            {suffix}
          </em>
        ) : null}
      </div>
      <div className="text-sm font-medium text-ink/70">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cx(
        "glass flex flex-col items-center gap-3 rounded-kaart-lg px-8 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light/70 text-blauw-700"
        >
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="max-w-md text-[15px] leading-relaxed text-ink/70">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton & LoadingState — laadstaten (audit-P2 #5)                  */
/* ------------------------------------------------------------------ */

export interface SkeletonProps {
  /** Extra klassen voor maatvoering, bv. "h-4 w-40" of "h-24 w-full". */
  className?: string;
}

/** Eén laadvlak. Pulseert alleen bij prefers-reduced-motion:
 *  no-preference (zie .skeleton in globals.css); anders statisch. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div aria-hidden="true" className={cx("skeleton", className ?? "h-4 w-full")} />
  );
}

export interface LoadingStateProps {
  /** Toegankelijke omschrijving, bv. "Matches laden". */
  label?: string;
  /** Aantal skeleton-regels onder de kop (default 3). */
  lines?: number;
  className?: string;
}

/** Kaartvormige laadstaat: skeleton-kop + regels, met status-rol zodat
 *  screenreaders het laden melden. */
export function LoadingState({
  label = "Bezig met laden",
  lines = 3,
  className,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx("glass flex flex-col gap-3 rounded-kaart p-6", className)}
    >
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <Skeleton
          key={i}
          className={cx("h-4", i === lines - 1 ? "w-3/5" : "w-full")}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ErrorState — foutstaat in merkstem (audit-P2 #5)                    */
/* ------------------------------------------------------------------ */

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  /** Herstelactie, bv. een "Probeer opnieuw"-knop. */
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  title = "Er ging iets mis",
  description = "Probeer het opnieuw. Blijft het misgaan, neem dan contact met ons op.",
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx(
        "glass-strong flex flex-col items-center gap-3 rounded-kaart-lg border border-mw-error/20 px-8 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-mw-error-bg text-mw-error"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true" focusable="false">
          <path
            d="M10 3.2 17.5 16H2.5L10 3.2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M10 8v3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="10" cy="13.9" r="0.9" fill="currentColor" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="max-w-md text-[15px] leading-relaxed text-mw-text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SectionHeading — met italic serif accentwoord                       */
/* ------------------------------------------------------------------ */

export interface SectionHeadingProps {
  /** Kleine kicker boven de titel, bv. "Match Studio". */
  eyebrow?: string;
  title: string;
  /** Accentwoord dat in italic serif achter de titel komt. */
  accent?: string;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  accent,
  description,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cx(
        "flex max-w-2xl flex-col gap-3",
        align === "center" && "mx-auto items-center text-center",
        className,
      )}
    >
      {eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-blauw-700">
          {eyebrow}
        </span>
      ) : null}
      <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {title}
        {accent ? (
          <>
            {" "}
            <em className="font-serif italic font-bold text-blauw-600">
              {accent}
            </em>
          </>
        ) : null}
      </h2>
      {description ? (
        <p className="text-[17px] leading-relaxed text-ink/70">{description}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageHeader                                                          */
/* ------------------------------------------------------------------ */

export interface PageHeaderProps {
  title: string;
  /** Accentwoord in italic serif achter de titel. */
  accent?: string;
  description?: ReactNode;
  /** Acties rechts, bv. een primaire knop. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  accent,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-[2.5rem] sm:leading-tight">
          {title}
          {accent ? (
            <>
              {" "}
              <em className="font-serif italic font-bold text-blauw-600">
                {accent}
              </em>
            </>
          ) : null}
        </h1>
        {description ? (
          <p className="text-[16px] leading-relaxed text-ink/70">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
