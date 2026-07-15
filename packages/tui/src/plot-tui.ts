import { spawn } from "node:child_process";
import { errorMessage } from "@plot/common/primitives";
import type { SessionManagerClient } from "@plot/session-manager/manager";
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
	readonly manager: SessionManagerClient;
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

const shellArgument = (value: string): string =>
	process.platform === "win32"
		? JSON.stringify(value)
		: `'${value.replaceAll("'", `'\\''`)}'`;

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
	let projection = initialProjection(options.session);
	let exitReason: "detached" | "stopped" | undefined;
	let resolveExit!: () => void;
	const exited = new Promise<void>((resolve) => {
		resolveExit = resolve;
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
	const finish = (reason: "detached" | "stopped") => {
		if (exitReason !== undefined) return;
		exitReason = reason;
		resolveExit();
		tui.stop();
	};
	let stopping = false;
	const detach = () => {
		if (stopping) return;
		finish("detached");
	};
	let stopPromise: Promise<void> | undefined;
	const stop = () => {
		if (stopping || exitReason !== undefined) return;
		stopping = true;
		setStatus("shutting_down");
		stopPromise = options.manager
			.stopSession(options.session.id)
			.then((session) => {
				if (session === undefined) throw new Error("Session not found");
				finish("stopped");
				return undefined;
			})
			.catch((error: unknown) => {
				stopping = false;
				fail(error);
			});
	};
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void options.manager.tick(options.session.id).catch(fail);
		},
		refresh,
		toggleDebug: render,
		stop,
		detach,
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
	const confirmStop = () => dashboard.handleInput("\u0003");
	process.on("SIGINT", confirmStop);
	process.once("SIGTERM", detach);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		setStatus("running");
		render();
		await exited;
	} finally {
		process.off("SIGINT", confirmStop);
		process.off("SIGTERM", detach);
		eventsStopped = true;
		eventController.abort();
		await eventIterator.return?.();
		await eventPump;
		dashboard.stopLiveUpdates();
		tui.stop();
		await stopPromise;
		if (exitReason === "detached")
			terminal.write(
				`Detached; ${options.session.workflowName} is still running and may continue using tokens.\nStop it with: plot stop ${shellArgument(options.session.workflowPath)}\n`,
			);
		else if (exitReason === "stopped")
			terminal.write(`Stopped ${options.session.workflowName}.\n`);
	}
};
