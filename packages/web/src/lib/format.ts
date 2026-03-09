import { DateTime } from "effect";

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatTokens(n: number): string {
  return compactNumber.format(n).toLowerCase();
}

export function formatTimeAgo(dt: DateTime.Utc | string): string {
  const epochMs =
    typeof dt === "string" ? new Date(dt).getTime() : Number(DateTime.toEpochMillis(dt));
  const diff = (Date.now() - epochMs) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}
