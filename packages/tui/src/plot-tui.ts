import { spawn } from "node:child_process";
import { basename } from "node:path";
import { ProcessTerminal, TUI, matchesKey } from "./terminal-ui.js";
import type { CreateSessionHostOptions } from "@plot/session/host";
import { openRunIpc, type RunIpcOptions } from "@plot/session/run-ipc";
import {
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
	type SessionCommand,
} from "@plot/session/protocol";
import { PlotDashboard } from "./dashboard.js";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
	type DashboardProjection,
} from "@plot/session/projection";

export interface PlotTuiOptions extends CreateSessionHostOptions {
	readonly mode?: "watch" | "oneshot";
	readonly cli?: RunIpcOptions["cli"];
}

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const withTimeout = async <A>(
	work: Promise<A>,
	ms: number,
): Promise<A | undefined> => {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<undefined>((resolve) => {
				timeout = setTimeout(() => resolve(undefined), ms);
				timeout.unref?.();
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
};

const initialProjection = (input: {
	readonly id: string;
	readonly sessionId?: string;
	readonly cwd: string;
	readonly cwdName?: string;
	readonly workflowName?: string;
	readonly workflowPath?: string;
}): DashboardProjection =>
	emptyProjection(
		input.sessionId ?? input.id,
		input.workflowName ??
			(input.workflowPath === undefined
				? "workflow"
				: basename(input.workflowPath)),
		{
			cwd: input.cwd,
			cwdName: input.cwdName ?? basename(input.cwd),
			skills: [],
			skillPaths: [],
		},
	);

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
	const runIpc = await openRunIpc({
		cwd: options.cwd,
		...(options.cli === undefined ? {} : { cli: options.cli }),
	});
	const run = await runIpc.runRegistry.spawn({
		cwd: options.cwd,
		...(options.sessionId === undefined
			? {}
			: { sessionId: options.sessionId }),
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: options.workflowPath }),
	});
	let projection = initialProjection({
		id: run.id,
		...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
		cwd: run.cwd,
		...(run.cwdName === undefined ? {} : { cwdName: run.cwdName }),
		...(run.workflowName === undefined
			? {}
			: { workflowName: run.workflowName }),
		...(run.workflowPath === undefined
			? options.workflowPath === undefined
				? {}
				: { workflowPath: options.workflowPath }
			: { workflowPath: run.workflowPath }),
	});
	let requestIndex = 0;
	let resolveStopped!: () => void;
	const stopped = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	const terminal = new ProcessTerminal();
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
	const request = async (
		command: SessionCommand,
		params?: unknown,
	): Promise<ServerRecord> => {
		const id = `tui-${++requestIndex}`;
		const record: ClientRequest = {
			protocol: sessionProtocolVersion,
			kind: "request",
			id,
			command,
			...(params === undefined ? {} : { params }),
		};
		return runIpc.runRegistry.submit(run.id, record);
	};
	let refreshInFlight = false;
	let refreshQueued = false;
	const refresh = () => {
		if (refreshInFlight) {
			refreshQueued = true;
			return;
		}
		refreshInFlight = true;
		void request("get_snapshot")
			.then((record) => {
				if (record.kind === "response" && record.ok)
					setProjection(applySnapshot(projection, record.data));
				return undefined;
			})
			.catch(fail)
			.finally(() => {
				refreshInFlight = false;
				if (refreshQueued) {
					refreshQueued = false;
					refresh();
				}
			});
	};
	let scheduledRefresh: ReturnType<typeof setTimeout> | undefined;
	const scheduleRefresh = () => {
		if (scheduledRefresh !== undefined) return;
		scheduledRefresh = setTimeout(() => {
			scheduledRefresh = undefined;
			refresh();
		}, 250);
	};
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
	let stopping = false;
	const stopTui = () => {
		if (stopping) return;
		stopping = true;
		setStatus("shutting_down");
		resolveStopped();
		tui.stop();
	};
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void request("request_tick").then(refresh).catch(fail);
		},
		refresh,
		toggleDebug: render,
		quit: stopTui,
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
	void (async () => {
		for await (const record of runIpc.runRegistry.attachRecords(run.id, 0)) {
			if (record.kind === "event") {
				projection = reduceRecord(projection, record);
				render();
				scheduleRefresh();
			}
		}
	})().catch(fail);
	process.once("SIGINT", stopTui);
	process.once("SIGTERM", stopTui);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		setStatus("running");
		refresh();
		await stopped;
	} finally {
		process.off("SIGINT", stopTui);
		process.off("SIGTERM", stopTui);
		dashboard.stopLiveUpdates();
		tui.stop();
		await withTimeout(runIpc.runRegistry.stop(run.id), 5_000);
		await withTimeout(runIpc.close(), 5_000);
	}
};
