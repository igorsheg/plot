import { createContext, use, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
	fetchSessionProjection,
	fetchSessions,
	parsePlotEventRecord,
	sessionEventsUrl,
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
import { useSessionLiveEvents, type SessionLiveMap } from "./live-events.js";
import { applyProjectionEvent } from "./projection-live.js";
import type { PlotSessionRegistration } from "./registration.js";

interface PlotDetailEntry {
	readonly error?: string | undefined;
	readonly loading: boolean;
	readonly projection?: WebDashboardProjection | undefined;
}

interface PlotAppState {
	readonly sessions: readonly PlotSessionRegistration[];
	readonly live: SessionLiveMap;
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
	};
	readonly meta: { readonly pollMs: number };
}

const PlotAppContext = createContext<PlotAppContextValue | null>(null);

const usePlotApp = (): PlotAppContextValue => {
	const value = use(PlotAppContext);
	if (value === null) throw new Error("PlotAppContext missing");
	return value;
};

const sortSessions = (sessions: readonly PlotSessionRegistration[]) =>
	sessions.toSorted(
		(left, right) =>
			Date.parse(right.heartbeatAt) - Date.parse(left.heartbeatAt),
	);

function PlotAppProvider({ children }: { readonly children: ReactNode }) {
	const pollMs = 1_000;
	const [sessions, setSessions] = useState<readonly PlotSessionRegistration[]>(
		[],
	);
	const [error, setError] = useState<string>();
	const [openDetailKeys, setOpenDetailKeys] = useState<readonly string[]>([]);
	const [details, setDetails] = useState<
		Readonly<Record<string, PlotDetailEntry>>
	>({});
	const sortedSessions = useMemo(() => sortSessions(sessions), [sessions]);
	const live = useSessionLiveEvents(sortedSessions);

	const reload = async () => {
		try {
			setSessions(await fetchSessions());
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
				const projection = await fetchSessionProjection(key);
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
				const next = await fetchSessions();
				if (!cancelled) {
					setSessions(next);
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
			const source = new EventSource(
				sessionEventsUrl(key, projection.frontier),
			);
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
					sessions: sortedSessions,
					live,
					details,
					openDetailKeys,
					error,
				},
				actions: { closeDetail, openDetail, reload },
				meta: { pollMs },
			}}
		>
			{children}
		</PlotAppContext>
	);
}

function PlotToolbar() {
	const {
		actions: { reload },
		state: { sessions },
	} = usePlotApp();
	return (
		<header className="toolbar">
			<div className="plot-app-toolbar">
				<div className="plot-app-toolbar-title">
					<strong>Plot Canvas</strong>
					<span>{sessions.length} running session(s)</span>
				</div>
				<Group aria-label="Fleet actions">
					<Button size="sm" variant="outline" onClick={() => void reload()}>
						Refresh
					</Button>
				</Group>
			</div>
		</header>
	);
}

function PlotCanvasRegion() {
	const {
		actions: { closeDetail, openDetail, reload },
		state: { details, error, live, openDetailKeys, sessions },
	} = usePlotApp();
	if (sessions.length === 0) {
		return (
			<main className="canvas canvas-empty">
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No running Plot sessions</EmptyTitle>
						<EmptyDescription>
							Start another terminal with plot tui/run.
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
				sessions={sessions}
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
