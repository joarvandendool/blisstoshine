// MiniWeek — compacte, prominente werkdagen-weergave voor vacaturekaarten.
// De kaarthiërarchie zet de werkdagen bewust vóór uren en salaris
// (opdracht fase 6): dit is het onderscheidende datapunt van het platform.
// Server-compatibel (geen hooks). Betekenis nooit alleen met kleur:
// gevulde/omrande/gestippelde cellen + tekstsamenvatting + aria-label.

import { WEEKDAYS, label } from "@/domain/taxonomy";
import { cx } from "@/components/ui";
import type { PublicAvailabilitySlot } from "./data/types";
import { dagenSamenvatting } from "./format";

export function MiniWeek({
  availability,
  className,
}: {
  availability: PublicAvailabilitySlot[];
  className?: string;
}) {
  const perDag = new Map(availability.map((slot) => [slot.day, slot.level]));

  const nodig = availability
    .filter((s) => s.level === "required")
    .map((s) => label(s.day).toLowerCase());
  const gewenst = availability
    .filter((s) => s.level === "preferred")
    .map((s) => label(s.day).toLowerCase());
  const ariaDelen: string[] = [];
  if (nodig.length > 0) ariaDelen.push(`nodig op ${nodig.join(", ")}`);
  if (gewenst.length > 0) ariaDelen.push(`gewenst op ${gewenst.join(", ")}`);

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <div
        role="img"
        aria-label={`Werkdagen: ${ariaDelen.join("; ") || "geen dagen opgegeven"}.`}
        className="flex gap-1"
      >
        {WEEKDAYS.map((dag) => {
          const niveau = perDag.get(dag);
          return (
            <span
              key={dag}
              aria-hidden="true"
              className={cx(
                "flex h-9 min-w-0 flex-1 items-center justify-center rounded-(--radius-klein) text-xs font-semibold",
                niveau === "required" &&
                  "bg-blauw-600 text-white",
                niveau === "preferred" &&
                  "border border-roze-300 bg-roze-100 text-roze-800",
                niveau === undefined &&
                  "border border-dashed border-mw-border bg-white/60 text-ink/40",
              )}
            >
              {dag}
            </span>
          );
        })}
      </div>
      <p aria-hidden="true" className="text-mw-klein font-medium text-mw-text-muted">
        {dagenSamenvatting(availability) || "Werkdagen in overleg"}
      </p>
    </div>
  );
}
