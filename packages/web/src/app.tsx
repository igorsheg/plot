import { createContext, use, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
	fetchSessionProjection,
	fetchSessions,
	type WebDashboardProjection,
} from "./api.js";
import { PlotCanvas } from "./flow-canvas.js";
import { useSessionLiveEvents, type SessionLiveMap } from "./live-events.js";
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
		state: { sessions, error },
	} = usePlotApp();
	return (
		<header className="toolbar">
			<strong>Plot Canvas</strong>
			<span>{sessions.length} running session(s)</span>
			{error ? <span className="error">{error}</span> : null}
			{sessions.length === 0 && !error ? (
				<span>Start another terminal with plot tui/run.</span>
			) : null}
		</header>
	);
}

function PlotCanvasRegion() {
	const {
		actions: { closeDetail, openDetail },
		state: { details, live, openDetailKeys, sessions },
	} = usePlotApp();
	return (
		<main className="canvas">
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
