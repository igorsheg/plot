import { createContext, use, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
	createRun,
	fetchRunProjection,
	fetchRuns,
	parsePlotEventRecord,
	runEventsUrl,
	type WebDashboardProjection,
} from "./api.js";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Button } from "./components/ui/button.js";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import { Group } from "./components/ui/group.js";
import { PlotCanvas } from "./flow-canvas.js";
import { useRunLiveEvents, type RunLiveMap } from "./live-events.js";
import { applyProjectionEvent } from "./projection-live.js";
import type { PlotRun } from "./run.js";

interface PlotDetailEntry {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
}

interface PlotAppState {
	readonly runs: readonly PlotRun[];
	readonly live: RunLiveMap;
	readonly details: Readonly<Record<string, PlotDetailEntry>>;
	readonly openDetailKeys: readonly string[];
	readonly error?: string | undefined;
}

interface PlotAppContextValue {
	readonly state: PlotAppState;
	readonly actions: {
		readonly closeDetail: (key: string) => void;
		readonly openDetail: (key: string) => void;
		readonly reload: () => Promise<void>;
		readonly spawn: (input: {
			readonly cwd?: string;
			readonly workflowPath?: string;
		}) => Promise<void>;
	};
	readonly meta: { readonly pollMs: number };
}

const PlotAppContext = createContext<PlotAppContextValue | null>(null);

const usePlotApp = (): PlotAppContextValue => {
	const value = use(PlotAppContext);
	if (value === null) throw new Error("PlotAppContext missing");
	return value;
};

const sortRuns = (runs: readonly PlotRun[]) =>
	runs.toSorted((left, right) => {
		const project = left.cwd.localeCompare(right.cwd);
		if (project !== 0) return project;
		return (
			Date.parse(right.lastSeenAt ?? right.createdAt) -
			Date.parse(left.lastSeenAt ?? left.createdAt)
		);
	});

function PlotAppProvider({ children }: { readonly children: ReactNode }) {
	const pollMs = 1_000;
	const [runs, setRuns] = useState<readonly PlotRun[]>([]);
	const [error, setError] = useState<string>();
	const [openDetailKeys, setOpenDetailKeys] = useState<readonly string[]>([]);
	const [details, setDetails] = useState<
		Readonly<Record<string, PlotDetailEntry>>
	>({});
	const sortedRuns = useMemo(() => sortRuns(runs), [runs]);
	const live = useRunLiveEvents(sortedRuns);

	const reload = async () => {
		try {
			setRuns(await fetchRuns());
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const spawn = async (input: {
		readonly cwd?: string;
		readonly workflowPath?: string;
	}) => {
		try {
			const run = await createRun(input);
			setRuns((current) => sortRuns([run, ...current]));
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const openDetail = (key: string) => {
		setOpenDetailKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
		setDetails((previous) => ({
			...previous,
			[key]: { loading: true, projection: previous[key]?.projection },
		}));
		void (async () => {
			try {
				const projection = await fetchRunProjection(key);
				setDetails((previous) => ({
					...previous,
					[key]: { loading: false, projection },
				}));
			} catch (caught) {
				setDetails((previous) => ({
					...previous,
					[key]: {
						error: caught instanceof Error ? caught.message : String(caught),
						loading: false,
						projection: previous[key]?.projection,
					},
				}));
			}
		})();
	};

	const closeDetail = (key: string) => {
		setOpenDetailKeys((keys) => keys.filter((item) => item !== key));
	};

	const detailStreamSignature = openDetailKeys
		.filter((key) => details[key]?.projection !== undefined)
		.toSorted()
		.join("\0");

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const next = await fetchRuns();
				if (!cancelled) {
					setRuns(next);
					setError(undefined);
				}
			} catch (caught) {
				if (!cancelled)
					setError(caught instanceof Error ? caught.message : String(caught));
			}
		};
		void load();
		const interval = setInterval(() => void load(), pollMs);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		const sources = openDetailKeys.flatMap((key) => {
			const projection = details[key]?.projection;
			if (projection === undefined) return [];
			const source = new EventSource(runEventsUrl(key, projection.frontier));
			source.addEventListener("plot", (message) => {
				const record = parsePlotEventRecord(
					JSON.parse(message.data) as unknown,
				);
				if (record === undefined) return;
				setDetails((previous) => {
					const current = previous[key];
					if (current?.projection === undefined) return previous;
					return {
						...previous,
						[key]: {
							...current,
							projection: applyProjectionEvent(current.projection, record),
						},
					};
				});
			});
			return [source];
		});
		return () => {
			for (const source of sources) source.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one stream per opened detail; reducer owns frontier movement.
	}, [detailStreamSignature]);

	return (
		<PlotAppContext
			value={{
				state: {
					runs: sortedRuns,
					live,
					details,
					openDetailKeys,
					error,
				},
				actions: { closeDetail, openDetail, reload, spawn },
				meta: { pollMs },
			}}
		>
			{children}
		</PlotAppContext>
	);
}

function PlotToolbar() {
	const [cwd, setCwd] = useState("");
	const [workflowPath, setWorkflowPath] = useState("");
	const {
		actions: { reload, spawn },
		state: { runs },
	} = usePlotApp();
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		void spawn({
			...(cwd.trim() === "" ? {} : { cwd: cwd.trim() }),
			...(workflowPath.trim() === ""
				? {}
				: { workflowPath: workflowPath.trim() }),
		});
	};
	return (
		<header className="toolbar">
			<div className="plot-app-toolbar">
				<div className="plot-app-toolbar-title">
					<strong>Plot Dashboard</strong>
					<span>{runs.length} run(s)</span>
				</div>
				<div className="plot-app-toolbar-actions">
					<form className="plot-run-spawn-form" onSubmit={onSubmit}>
						<input
							aria-label="Project cwd"
							placeholder="cwd (blank = gateway cwd)"
							value={cwd}
							onChange={(event) => setCwd(event.currentTarget.value)}
						/>
						<input
							aria-label="Workflow path"
							placeholder="workflow (optional)"
							value={workflowPath}
							onChange={(event) => setWorkflowPath(event.currentTarget.value)}
						/>
						<Button size="sm" type="submit">
							Spawn
						</Button>
					</form>
					<Group aria-label="Run actions">
						<Button size="sm" variant="outline" onClick={() => void reload()}>
							Refresh
						</Button>
					</Group>
				</div>
			</div>
		</header>
	);
}

function PlotCanvasRegion() {
	const {
		actions: { closeDetail, openDetail, reload },
		state: { details, error, runs, live, openDetailKeys },
	} = usePlotApp();
	if (runs.length === 0) {
		return (
			<main className="canvas canvas-empty">
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No Plot runs</EmptyTitle>
						<EmptyDescription>
							Start one from this dashboard or run `plot tui --workflow
							WORKFLOW.md`.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						{error ? (
							<Alert variant="error">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						) : null}
						<Button variant="outline" onClick={() => void reload()}>
							Refresh
						</Button>
					</EmptyContent>
				</Empty>
			</main>
		);
	}
	return (
		<main className="canvas">
			{error ? (
				<Alert className="plot-canvas-alert" variant="error">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			<PlotCanvas
				details={details}
				live={live}
				onCloseDetail={closeDetail}
				onOpenDetail={openDetail}
				openDetailKeys={openDetailKeys}
				runs={runs}
			/>
		</main>
	);
}

function PlotAppFrame({ children }: { readonly children: ReactNode }) {
	return <div className="app">{children}</div>;
}

export function PlotApp() {
	return (
		<PlotAppProvider>
			<PlotAppFrame>
				<PlotToolbar />
				<PlotCanvasRegion />
			</PlotAppFrame>
		</PlotAppProvider>
	);
}
