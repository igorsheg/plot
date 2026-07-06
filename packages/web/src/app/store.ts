import { atom, computed, onMount } from "nanostores";
import type { SerializedDashboardProjection } from "@plot/projection";
import type { RunRecord } from "@plot/registry/record";
import type { OperatorObservationInput } from "@plot/session/runtime";
import { recordObservation, stopRun } from "../data/api.js";
import {
	createFetcherStore,
	createMutatorStore,
	runsUrl,
} from "../data/query.js";
import { isRunLive } from "../data/run.js";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const displayName = (run: RunRecord): string =>
	run.workflowName ?? run.label ?? run.cwdName ?? run.id;

export const activeRuns = (runs: readonly RunRecord[]): readonly RunRecord[] =>
	runs.filter(isRunLive);

/**
 * The selected run may be live or stopped: look it up by id across ALL runs so
 * a past session stays selectable (read-only view). Fall back to the first
 * active run when nothing is selected yet.
 */
export const selectedRunFrom = (
	runs: readonly RunRecord[],
	active: readonly RunRecord[],
	selectedId: string | undefined,
): RunRecord | undefined =>
	runs.find((run) => run.id === selectedId) ?? active[0];

const lastSeenMs = (run: RunRecord): number => {
	const value = run.lastSeenAt ?? run.createdAt;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? 0 : ms;
};

/** Stopped runs, most-recently-seen first — the dock's "past" group. */
export const pastRuns = (runs: readonly RunRecord[]): readonly RunRecord[] =>
	runs
		.filter((run) => run.status === "stopped")
		.toSorted((a, b) => lastSeenMs(b) - lastSeenMs(a));

export const projectionUrl = (run: RunRecord): string =>
	`/api/runs/${encodeURIComponent(run.id)}/projection?seq=${run.lastSequence ?? 0}`;

/** Shared 1s wall clock; session-header and session-work read the same tick. */
export const $nowMs = atom<number>(Date.now());

onMount($nowMs, () => {
	const id = setInterval(() => $nowMs.set(Date.now()), 1000);
	return () => clearInterval(id);
});

export const $selectedRunId = atom<string | undefined>(undefined);

export const $runsQuery = createFetcherStore<readonly RunRecord[]>(runsUrl, {
	revalidateInterval: 10_000,
	revalidateOnFocus: true,
});

export const $runs = computed($runsQuery, (query) => query.data ?? []);
export const $activeRuns = computed($runs, activeRuns);
export const $pastRuns = computed($runs, pastRuns);
export const $selectedRun = computed(
	[$runs, $activeRuns, $selectedRunId],
	selectedRunFrom,
);
export const $selectedProjectionUrl = computed($selectedRun, (run) =>
	run === undefined ? null : projectionUrl(run),
);

export const $projectionQuery =
	createFetcherStore<SerializedDashboardProjection>([$selectedProjectionUrl], {
		revalidateOnFocus: true,
	});

export const $selectedProjection = computed(
	$projectionQuery,
	(query) => query.data,
);

export const $stopSelectedRun = createMutatorStore<void, void>(
	async ({ revalidate }) => {
		const run = $selectedRun.get();
		if (run === undefined) return;
		await stopRun(run.id);
		revalidate(runsUrl);
	},
);

export const selectRun = (id: string): void => {
	$selectedRunId.set(id);
};

export const stopSelectedRun = (): Promise<void> => $stopSelectedRun.mutate();

export const $actOnWork = createMutatorStore<
	Omit<OperatorObservationInput, "actor">
>(async ({ data, revalidate }) => {
	const run = $selectedRun.get();
	if (run === undefined) return;
	await recordObservation(run.id, data);
	const url = $selectedProjectionUrl.get();
	if (url !== null) revalidate(url);
});

export const $plotError = computed(
	[$runsQuery, $projectionQuery, $stopSelectedRun, $actOnWork],
	(runs, projection, stop, act) =>
		runs.error !== undefined
			? errorText(runs.error)
			: projection.error !== undefined
				? errorText(projection.error)
				: stop.error !== undefined
					? errorText(stop.error)
					: act.error !== undefined
						? errorText(act.error)
						: undefined,
);
