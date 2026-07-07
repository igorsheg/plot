import { atom, computed } from "nanostores";
import type { RunRecord } from "@plot/registry/record";
import { createFetcherStore } from "../data/query.js";
import { isRunLive } from "../data/run.js";
import { runsUrl } from "../data/routes.js";

export const displayName = (run: RunRecord): string =>
	run.workflowName ?? run.label ?? run.cwdName ?? run.id;

export const activeRuns = (runs: readonly RunRecord[]): readonly RunRecord[] =>
	runs.filter(isRunLive);

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

export const pastRuns = (runs: readonly RunRecord[]): readonly RunRecord[] =>
	runs
		.filter((run) => run.status === "stopped")
		.toSorted((a, b) => lastSeenMs(b) - lastSeenMs(a));

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

export const selectRun = (id: string): void => {
	$selectedRunId.set(id);
};
