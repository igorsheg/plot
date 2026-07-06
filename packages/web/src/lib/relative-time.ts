/**
 * Pure relative-time labels. Coarse by design: liveness reads from motion, not
 * precision. `formatRelative` never renders "0s ago" — a live tick is at least
 * "1s ago". The short/duration/countdown helpers feed the session-work right
 * edge, which carries one meaning per state (age, age · duration, or countdown).
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelative(thenMs: number, nowMs: number): string {
	const deltaMs = nowMs - thenMs;
	const seconds = Math.round(deltaMs / SECOND_MS);
	if (seconds < 45) return `${Math.max(1, seconds)}s ago`;
	const minutes = Math.round(deltaMs / MINUTE_MS);
	if (minutes < 45) return `${minutes}m ago`;
	const hours = Math.round(deltaMs / HOUR_MS);
	if (hours < 22) return `${hours}h ago`;
	const days = Math.round(deltaMs / DAY_MS);
	return `${days}d ago`;
}

/** Bare age like "3m" (no "ago"); s/m/h/d, clamped to at least "1s". */
export function formatShortAge(deltaMs: number): string {
	const seconds = Math.round(deltaMs / SECOND_MS);
	if (seconds < 45) return `${Math.max(1, seconds)}s`;
	const minutes = Math.round(deltaMs / MINUTE_MS);
	if (minutes < 45) return `${minutes}m`;
	const hours = Math.round(deltaMs / HOUR_MS);
	if (hours < 22) return `${hours}h`;
	const days = Math.round(deltaMs / DAY_MS);
	return `${days}d`;
}

/** Elapsed duration like "41s" / "3m" / "1h 4m". */
export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / SECOND_MS));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Countdown like "40s" / "1m 10s"; clamps to "now" once the deadline passes. */
export function formatCountdown(ms: number): string {
	if (ms <= 0) return "now";
	const totalSeconds = Math.ceil(ms / SECOND_MS);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
