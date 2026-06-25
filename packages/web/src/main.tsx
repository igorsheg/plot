import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	Tldraw,
	createShapeId,
	toRichText,
	type Editor,
	type TLShapePartial,
} from "tldraw";
// oxlint-disable-next-line import/no-unassigned-import
import "tldraw/tldraw.css";
import {
	parsePlotSessionRegistrations,
	type PlotSessionRegistration,
} from "./registration.js";
// oxlint-disable-next-line import/no-unassigned-import
import "./style.css";

const safeId = (value: string) =>
	value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);

const cardText = (session: PlotSessionRegistration) =>
	[
		session.workflowName,
		`${session.cwdName} · ${session.sessionId}`,
		`last: ${session.lastEventType ?? "registered"} #${session.lastSequence}`,
		`pid: ${session.pid}`,
		session.cwd,
	].join("\n");

const shapeIdsFor = (session: PlotSessionRegistration) => {
	const key = safeId(session.key);
	return {
		card: createShapeId(`plot-${key}-card`),
		text: createShapeId(`plot-${key}-text`),
	};
};

const sessionShapes = (
	sessions: readonly PlotSessionRegistration[],
): TLShapePartial[] =>
	sessions.flatMap((session, index) => {
		const column = index % 3;
		const row = Math.floor(index / 3);
		const x = column * 460;
		const y = row * 260;
		const ids = shapeIdsFor(session);
		return [
			{
				id: ids.card,
				type: "geo",
				x,
				y,
				meta: { plot: "session" },
				props: {
					geo: "rectangle",
					w: 400,
					h: 190,
					color: "blue",
					fill: "semi",
					dash: "solid",
					size: "m",
				},
			},
			{
				id: ids.text,
				type: "text",
				x: x + 20,
				y: y + 20,
				meta: { plot: "session" },
				props: {
					richText: toRichText(cardText(session)),
					color: "black",
					font: "sans",
					size: "m",
					textAlign: "start",
					autoSize: false,
					scale: 1,
					w: 360,
				},
			},
		] as TLShapePartial[];
	});

const syncCanvas = (
	editor: Editor,
	sessions: readonly PlotSessionRegistration[],
) => {
	const shapes = sessionShapes(sessions);
	const wanted = new Set(shapes.map((shape) => shape.id));
	const stale = editor
		.getCurrentPageShapes()
		.filter(
			(shape) => shape.meta["plot"] === "session" && !wanted.has(shape.id),
		)
		.map((shape) => shape.id);
	if (stale.length > 0) editor.deleteShapes(stale);
	for (const shape of shapes) {
		if (editor.getShape(shape.id)) editor.updateShapes([shape]);
		else editor.createShapes([shape]);
	}
	if (shapes.length > 0) editor.zoomToFit();
};

function App() {
	const [editor, setEditor] = useState<Editor>();
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

	useEffect(() => {
		if (editor) syncCanvas(editor, sortedSessions);
	}, [editor, sortedSessions]);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const response = await fetch("/api/sessions");
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const next = parsePlotSessionRegistrations(await response.json());
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
				<Tldraw onMount={setEditor} />
			</main>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
