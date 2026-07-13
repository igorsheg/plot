import { spawn } from "node:child_process";
import { errorMessage } from "@plot/common/primitives";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import {
	emptyProjection,
	reduceProjectableEvent,
	type DashboardProjection,
} from "@plot/projection";
import { basename } from "node:path";
import { PlotDashboard } from "./dashboard.js";
import { ProcessTerminal, TUI, matchesKey } from "./terminal-ui.js";

export interface PlotTuiOptions {
	readonly manager: SessionManagerRuntime;
	readonly session: SessionSummary;
	readonly terminal?: ProcessTerminal;
}

const initialProjection = (session: SessionSummary): DashboardProjection =>
	emptyProjection(session.id, session.workflowName, {
		cwd: session.projectPath,
		cwdName: basename(session.projectPath),
		skills: [],
		skillPaths: [],
	});

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
	let projection = initialProjection(options.session);
	let resolveDetached!: () => void;
	const detached = new Promise<void>((resolve) => {
		resolveDetached = resolve;
	});
	const terminal = options.terminal ?? new ProcessTerminal();
	const tui = new TUI(terminal);
	const render = () => {
		dashboard.setProjection(projection);
		tui.requestRender();
	};
	const setProjection = (next: DashboardProjection) => {
		projection = next;
		render();
	};
	const setStatus = (status: DashboardProjection["status"]) => {
		setProjection({ ...projection, status });
	};
	const fail = (error: unknown) => {
		setProjection({
			...projection,
			status: "error",
			diagnostics: [errorMessage(error), ...projection.diagnostics].slice(0, 5),
		});
	};
	const refresh = () => render();
	const openUrl = (url: string) => {
		if (!/^https?:\/\//.test(url)) return;
		const command =
			process.platform === "darwin"
				? "open"
				: process.platform === "win32"
					? "start"
					: "xdg-open";
		try {
			spawn(command, [url], { stdio: "ignore", detached: true }).unref();
		} catch (error) {
			fail(error);
		}
	};
	let detaching = false;
	const detach = () => {
		if (detaching) return;
		detaching = true;
		resolveDetached();
		tui.stop();
	};
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void options.manager.tick(options.session.id).catch(fail);
		},
		refresh,
		toggleDebug: render,
		quit: detach,
		sourceAction: (input) => {
			void options.manager
				.startSourceAction(options.session.id, input)
				.catch(fail);
		},
		cancelSourceAction: (actionRunId) => {
			void options.manager
				.cancelSourceAction(options.session.id, actionRunId)
				.catch(fail);
		},
		openUrl,
		height: () => terminal.rows,
		requestRender: () => tui.requestRender(),
	});
	tui.addChild(dashboard);
	tui.setFocus(dashboard);
	tui.addInputListener((data) => {
		if (matchesKey(data, "ctrl+c")) {
			dashboard.handleInput(data);
			return { consume: true };
		}
		return undefined;
	});
	const eventController = new AbortController();
	const sessionEvents = options.manager.events(
		options.session.id,
		0,
		eventController.signal,
	);
	const eventIterator = sessionEvents[Symbol.asyncIterator]();
	let eventsStopped = false;
	const eventPump = (async () => {
		for (;;) {
			// eslint-disable-next-line no-await-in-loop -- Session events are ordered.
			const next = await eventIterator.next();
			if (next.done) return;
			const event = next.value;
			if (
				event.kind === "session_event" &&
				event.event.type === "source_interaction_open_url"
			)
				openUrl(event.event.url);
			projection = reduceProjectableEvent(projection, event);
			render();
		}
	})().catch((error) => {
		if (!eventsStopped) fail(error);
	});
	process.once("SIGINT", detach);
	process.once("SIGTERM", detach);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		setStatus("running");
		render();
		await detached;
	} finally {
		process.off("SIGINT", detach);
		process.off("SIGTERM", detach);
		eventsStopped = true;
		eventController.abort();
		await eventIterator.return?.();
		await eventPump;
		dashboard.stopLiveUpdates();
		tui.stop();
	}
};
