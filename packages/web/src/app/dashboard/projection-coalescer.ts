import type { DashboardProjection } from "@plot/control/projection";

/**
 * Coalesces a high-frequency stream of reduced projections into a bounded
 * render cadence — the pattern symphony's status dashboard uses.
 *
 * - `push` (event-driven): reduce stays per-event, but the React publish is
 *   throttled. The first change after an idle gap publishes immediately
 *   (leading edge); a burst then publishes at most once per `intervalMs`, and
 *   the trailing flush always carries the freshest projection.
 * - `replace` (snapshot/attach): publishes immediately and resets the window —
 *   these are infrequent and authoritative.
 * - Identical frontiers are never published twice (fingerprint dedup); the
 *   monotonic frontier is the content fingerprint.
 */
export interface ProjectionCoalescer {
	push(projection: DashboardProjection): void;
	replace(projection: DashboardProjection): void;
	dispose(): void;
}

export interface ProjectionCoalescerOptions {
	readonly intervalMs: number;
	readonly publish: (projection: DashboardProjection) => void;
	readonly now?: () => number;
	readonly schedule?: (fn: () => void, ms: number) => number;
	readonly cancel?: (handle: number) => void;
}

export const createProjectionCoalescer = (
	options: ProjectionCoalescerOptions,
): ProjectionCoalescer => {
	const now = options.now ?? (() => Date.now());
	const schedule =
		options.schedule ??
		((fn, ms) => window.setTimeout(fn, ms) as unknown as number);
	const cancel = options.cancel ?? ((handle) => window.clearTimeout(handle));

	let pending: DashboardProjection | undefined;
	let publishedFrontier = -1;
	let lastPublishAt = Number.NEGATIVE_INFINITY;
	let timer: number | undefined;

	const emit = (projection: DashboardProjection) => {
		publishedFrontier = projection.frontier;
		lastPublishAt = now();
		options.publish(projection);
	};

	const flush = () => {
		timer = undefined;
		const next = pending;
		pending = undefined;
		if (next === undefined || next.frontier === publishedFrontier) return;
		emit(next);
	};

	return {
		push(projection) {
			pending = projection;
			if (timer !== undefined) return; // trailing flush already armed
			const elapsed = now() - lastPublishAt;
			if (elapsed >= options.intervalMs) {
				flush(); // leading edge
				return;
			}
			timer = schedule(flush, options.intervalMs - elapsed);
		},
		replace(projection) {
			if (timer !== undefined) {
				cancel(timer);
				timer = undefined;
			}
			pending = undefined;
			emit(projection);
		},
		dispose() {
			if (timer !== undefined) {
				cancel(timer);
				timer = undefined;
			}
			pending = undefined;
		},
	};
};
