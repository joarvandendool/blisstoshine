const euro = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euroWithCents = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export function formatEuro(cents: number, showCents = false): string {
  const value = cents / 100;
  return showCents ? euroWithCents.format(value) : euro.format(value);
}

export function parseEuroInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9,.\-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

const tijdgeleden = new Intl.RelativeTimeFormat("nl-NL", { numeric: "auto" });

export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 10) return "zojuist";
  if (sec < 60) return `${sec} sec geleden`;
  const min = Math.round(sec / 60);
  if (min < 60) return tijdgeleden.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return tijdgeleden.format(-hr, "hour");
  return tijdgeleden.format(-Math.round(hr / 24), "day");
}
