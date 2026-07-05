import { nanoquery, type Fetcher, type KeyInput } from "@nanostores/query";
import { atom, computed } from "nanostores";
import { workLabel } from "@plot/session/projection";
import {
	fetchRunProjectionUrl,
	fetchRuns,
	stopRun,
	type WebDashboardProjection,
} from "../data/api.js";
import { isRunLive, type PlotRun } from "../data/run.js";

const runsUrl = "/api/runs";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

export const displayName = (run: PlotRun): string =>
	run.workflowName ?? run.label ?? run.cwdName ?? run.id;

export const activeRuns = (runs: readonly PlotRun[]): readonly PlotRun[] =>
	runs.filter(isRunLive);

export const selectedRunFrom = (
	runs: readonly PlotRun[],
	selectedId: string | undefined,
): PlotRun | undefined => runs.find((run) => run.id === selectedId) ?? runs[0];

export type StatusTone = "error" | "info" | "secondary" | "success" | "warning";

export const statusTone = (status: string): StatusTone => {
	switch (status) {
		case "done":
		case "idle":
		case "stopped":
		case "succeeded":
			return "success";
		case "blocked":
		case "error":
		case "failed":
			return "error";
		case "draining":
		case "paused":
		case "pending":
		case "shutting_down":
		case "starting":
		case "waiting":
			return "warning";
		case "running":
			return "info";
		default:
			return "secondary";
	}
};

export const dockGlyph = (run: PlotRun): string =>
	displayName(run).slice(0, 2).toUpperCase();

export const activeWork = (
	projection: WebDashboardProjection,
): readonly WebWork[] =>
	Object.values(projection.work).filter((work) => work.status !== "done");

export const projectionUrl = (run: PlotRun): string =>
	`/api/runs/${encodeURIComponent(run.id)}/projection?seq=${run.lastSequence ?? 0}`;

type WebWork = WebDashboardProjection["work"][string];
type WebAttempt = WebDashboardProjection["attempts"][string];

const attemptFor = (
	projection: WebDashboardProjection,
	work: WebWork,
): WebAttempt | undefined =>
	work.currentRunId === undefined
		? undefined
		: projection.attempts[work.currentRunId];

export const attemptActivity = (
	work: WebWork,
	attempt: WebAttempt | undefined,
): string =>
	work.blockedReason ??
	attempt?.streams.tool ??
	attempt?.streams.message ??
	attempt?.streams.thinking ??
	attempt?.activity ??
	work.subtitle ??
	work.status;

export interface BriefWorkItem {
	readonly activity: string;
	readonly key: string;
	readonly label: string;
	readonly status: string;
	readonly tone: StatusTone;
}

export interface BriefRecentItem {
	readonly key: string;
	readonly label: string;
	readonly message: string;
	readonly status: string;
	readonly tone: StatusTone;
}

export interface SessionBriefView {
	readonly attention: readonly BriefWorkItem[];
	readonly diagnostics: readonly string[];
	readonly now: readonly BriefWorkItem[];
	readonly recent: readonly BriefRecentItem[];
}

export const workNeedsAttention = (work: WebWork): boolean =>
	work.status === "blocked" ||
	work.status === "failed" ||
	(work.operatorActions?.length ?? 0) > 0;

const briefWorkItem = (
	projection: WebDashboardProjection,
	work: WebWork,
): BriefWorkItem => ({
	activity: attemptActivity(work, attemptFor(projection, work)),
	key: work.workKey,
	label: workLabel(work),
	status: work.status,
	tone: statusTone(work.status),
});

export const sessionBrief = (
	projection: WebDashboardProjection,
): SessionBriefView => {
	const work = activeWork(projection);
	return {
		attention: work
			.filter(workNeedsAttention)
			.map((item) => briefWorkItem(projection, item)),
		diagnostics: projection.diagnostics.slice(0, 3),
		now: work
			.filter((item) => !workNeedsAttention(item))
			.slice(0, 4)
			.map((item) => briefWorkItem(projection, item)),
		recent: projection.completed.slice(0, 5).map((item) => ({
			key: `${item.workKey}:${item.runId ?? "run"}:${item.atMs}`,
			label: item.label,
			message: item.message,
			status: item.status,
			tone: statusTone(item.status),
		})),
	};
};

const queryFetcher: Fetcher<unknown> = async (urlPart) => {
	const url = String(urlPart);
	const { pathname } = new URL(url, "http://plot.local");
	if (pathname === runsUrl) return fetchRuns();
	if (/^\/api\/runs\/[^/]+\/projection$/.test(pathname)) {
		return fetchRunProjectionUrl(url);
	}
	throw new Error(`unknown web query: ${url}`);
};

const [createFetcherStore, createMutatorStore] = nanoquery({
	fetcher: queryFetcher,
	onErrorRetry: null,
});

export const $selectedRunId = atom<string | undefined>(undefined);

export const $runsQuery = createFetcherStore<readonly PlotRun[]>(runsUrl, {
	revalidateInterval: 10_000,
	revalidateOnFocus: true,
});

export const $runs = computed($runsQuery, (query) => query.data ?? []);
export const $activeRuns = computed($runs, activeRuns);
export const $selectedRun = computed(
	[$activeRuns, $selectedRunId],
	selectedRunFrom,
);
export const $selectedProjectionUrl = computed($selectedRun, (run) =>
	run === undefined ? undefined : projectionUrl(run),
);

export const $projectionQuery = createFetcherStore<WebDashboardProjection>(
	[$selectedProjectionUrl] as unknown as KeyInput,
	{ revalidateOnFocus: true },
);

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

export const refreshSessions = (): void => {
	$runsQuery.revalidate();
	$projectionQuery.revalidate();
};

export const stopSelectedRun = (): Promise<void> => $stopSelectedRun.mutate();

export const $plotError = computed(
	[$runsQuery, $projectionQuery, $stopSelectedRun],
	(runs, projection, stop) =>
		runs.error !== undefined
			? errorText(runs.error)
			: projection.error !== undefined
				? errorText(projection.error)
				: stop.error !== undefined
					? errorText(stop.error)
					: undefined,
);

export interface SessionHeaderView {
	readonly kicker: string;
	readonly live: boolean;
	readonly settledCount: number;
	readonly title: string;
	readonly workCount: number;
}

export const $sessionHeader = computed(
	[$selectedRun, $selectedProjection],
	(run, projection): SessionHeaderView | undefined => {
		if (run === undefined) return undefined;
		return {
			kicker: `${run.cwdName ?? projection?.runtime.cwdName ?? "session"} · ${run.status}`,
			live: isRunLive(run),
			settledCount: projection?.completed.length ?? 0,
			title: projection?.workflowName ?? displayName(run),
			workCount: projection === undefined ? 0 : activeWork(projection).length,
		};
	},
);

export const $sessionBrief = computed(
	$selectedProjection,
	(projection): SessionBriefView | undefined =>
		projection === undefined ? undefined : sessionBrief(projection),
);

export { workLabel };
