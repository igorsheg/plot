import { atom, computed, onMount } from "nanostores";
import {
	hydrateDashboardProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type ProjectableEvent,
	type SerializedDashboardProjection,
} from "@plot/projection";
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

const jsonRecord = (value: string): Record<string, unknown> | undefined => {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed !== null && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
};

export const runEventsUrl = (run: RunRecord): string => {
	const after = run.lastSequence ?? 0;
	return `/api/runs/${encodeURIComponent(run.id)}/events?after=${after}`;
};

export const projectionEventFromSse = (
	data: string,
): ProjectableEvent | undefined => {
	const record = jsonRecord(data);
	if (record?.["kind"] !== "event") return undefined;
	const event = record["event"];
	return event !== null && typeof event === "object"
		? (event as ProjectableEvent)
		: undefined;
};

export const reduceSerializedProjection = (
	projection: SerializedDashboardProjection,
	event: ProjectableEvent,
): SerializedDashboardProjection =>
	serializeDashboardProjection(
		reduceProjectableEvent(hydrateDashboardProjection(projection), event),
	);

export const freshestProjection = (
	fetched: SerializedDashboardProjection | undefined,
	streamed: SerializedDashboardProjection | undefined,
): SerializedDashboardProjection | undefined => {
	if (fetched === undefined) return streamed;
	if (streamed === undefined) return fetched;
	return streamed.frontier >= fetched.frontier ? streamed : fetched;
};
export const projectionUrl = (run: RunRecord): string =>
	`/api/runs/${encodeURIComponent(run.id)}/projection`;

/** Shared 1s wall clock; session-header and session-work read the same tick. */
export const $nowMs = atom<number>(Date.now());

onMount($nowMs, () => {
	const id = setInterval(() => $nowMs.set(Date.now()), 1000);
	return () => clearInterval(id);
});

export const $selectedRunId = atom<string | undefined>(undefined);

const $streamedProjection = atom<SerializedDashboardProjection | undefined>(
	undefined,
);

const projectionStreamKey = (run: RunRecord | undefined): string | undefined =>
	run === undefined || !isRunLive(run) ? undefined : run.id;

onMount($streamedProjection, () => {
	if (typeof EventSource === "undefined") return undefined;
	let source: EventSource | undefined;
	let pendingEvents: ProjectableEvent[] = [];
	const flushEvents = (events: readonly ProjectableEvent[]): void => {
		const base = freshestProjection(
			$projectionQuery.get().data,
			$streamedProjection.get(),
		);
		if (base === undefined) {
			pendingEvents = [...pendingEvents, ...events];
			return;
		}
		$streamedProjection.set(events.reduce(reduceSerializedProjection, base));
	};
	const flushPendingEvents = (): void => {
		if (pendingEvents.length === 0) return;
		const events = pendingEvents;
		pendingEvents = [];
		flushEvents(events);
	};
	const unsubscribeProjection = $projectionQuery.listen(flushPendingEvents);
	const open = (run: RunRecord | undefined) => {
		source?.close();
		source = undefined;
		pendingEvents = [];
		$streamedProjection.set(undefined);
		if (run === undefined || !isRunLive(run)) return;
		source = new EventSource(runEventsUrl(run));
		const onPlot = (event: Event) => {
			const projectionEvent = projectionEventFromSse(
				(event as MessageEvent).data,
			);
			if (projectionEvent !== undefined) flushEvents([projectionEvent]);
		};
		source.addEventListener("plot", onPlot);
	};
	let sourceKey: string | undefined;
	const unsubscribe = $selectedRun.listen((run) => {
		const nextKey = projectionStreamKey(run);
		if (nextKey === sourceKey) return;
		sourceKey = nextKey;
		open(run);
	});
	const initialRun = $selectedRun.get();
	sourceKey = projectionStreamKey(initialRun);
	open(initialRun);
	return () => {
		unsubscribe();
		unsubscribeProjection();
		source?.close();
	};
});

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
	[$projectionQuery, $streamedProjection],
	(query, streamed) => freshestProjection(query.data, streamed),
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
