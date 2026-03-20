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

export function formatTimestamp(dt: DateTime.Utc): string {
	const d = new Date(Number(DateTime.toEpochMillis(dt)));
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${h}:${m}:${s}.${ms}`;
}
