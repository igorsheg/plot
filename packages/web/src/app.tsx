import { createContext, use, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchSessions } from "./api.js";
import { PlotCanvas } from "./flow-canvas.js";
import { useSessionLiveEvents, type SessionLiveMap } from "./live-events.js";
import type { PlotSessionRegistration } from "./registration.js";

interface PlotAppState {
	readonly sessions: readonly PlotSessionRegistration[];
	readonly live: SessionLiveMap;
	readonly error?: string | undefined;
}

interface PlotAppContextValue {
	readonly state: PlotAppState;
	readonly actions: { readonly reload: () => Promise<void> };
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
				state: { sessions: sortedSessions, live, error },
				actions: { reload },
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
		state: { sessions, live },
	} = usePlotApp();
	return (
		<main className="canvas">
			<PlotCanvas sessions={sessions} live={live} />
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
