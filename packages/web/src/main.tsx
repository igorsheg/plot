import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchSessions } from "./api.js";
import { PlotCanvas } from "./flow-canvas.js";
import type { PlotSessionRegistration } from "./registration.js";
import { useSessionLiveEvents } from "./live-events.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

function App() {
	const [sessions, setSessions] = useState<readonly PlotSessionRegistration[]>(
		[],
	);
	const [error, setError] = useState<string>();
	const sortedSessions = useMemo(
		() =>
			sessions.toSorted(
				(left, right) =>
					Date.parse(right.heartbeatAt) - Date.parse(left.heartbeatAt),
			),
		[sessions],
	);
	const live = useSessionLiveEvents(sortedSessions);

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
		const interval = setInterval(() => void load(), 1_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	return (
		<div className="app">
			<header className="toolbar">
				<strong>Plot Canvas</strong>
				<span>{sortedSessions.length} running session(s)</span>
				{error ? <span className="error">{error}</span> : null}
				{sortedSessions.length === 0 && !error ? (
					<span>Start another terminal with plot tui/run.</span>
				) : null}
			</header>
			<main className="canvas">
				<PlotCanvas sessions={sortedSessions} live={live} />
			</main>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
