import { spawn } from "node:child_process";
import { basename } from "node:path";
import { errorMessage, type Mutable } from "@plot/common/primitives";
import { ProcessTerminal, TUI, matchesKey } from "./terminal-ui.js";
import type { CreateSessionHostOptions } from "@plot/session/host";
import { openOrStartRunIpc, type RunIpcOptions } from "@plot/registry/ipc";
import {
	sessionProtocolVersion,
	type ClientRequest,
	type ServerRecord,
	type SessionProtocolMethod,
} from "@plot/session/protocol";
import { PlotDashboard } from "./dashboard.js";
import {
	emptyProjection,
	reduceRecord,
	type DashboardProjection,
} from "@plot/projection";

export interface PlotTuiOptions extends CreateSessionHostOptions {
	readonly mode?: "watch" | "oneshot";
	readonly cli?: RunIpcOptions["cli"];
}

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
	const runIpcOptions: Mutable<RunIpcOptions> = { cwd: options.cwd };
	if (options.cli !== undefined) runIpcOptions.cli = options.cli;
	const runIpc = await openOrStartRunIpc(runIpcOptions);
	const spawnInput: Mutable<Parameters<typeof runIpc.runRegistry.spawn>[0]> = {
		cwd: options.cwd,
	};
	if (options.sessionId !== undefined) spawnInput.sessionId = options.sessionId;
	if (options.workflowPath !== undefined)
		spawnInput.workflowPath = options.workflowPath;
	const run = await runIpc.runRegistry.spawn(spawnInput);
	const initialInput: Mutable<Parameters<typeof initialProjection>[0]> = {
		id: run.id,
		cwd: run.cwd,
	};
	if (run.sessionId !== undefined) initialInput.sessionId = run.sessionId;
	if (run.cwdName !== undefined) initialInput.cwdName = run.cwdName;
	if (run.workflowName !== undefined)
		initialInput.workflowName = run.workflowName;
	if (run.workflowPath !== undefined)
		initialInput.workflowPath = run.workflowPath;
	else if (options.workflowPath !== undefined)
		initialInput.workflowPath = options.workflowPath;
	let projection = initialProjection(initialInput);
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
		method: SessionProtocolMethod,
		params?: unknown,
	): Promise<ServerRecord> => {
		const id = `tui-${++requestIndex}`;
		const record: Mutable<ClientRequest> = {
			protocol: sessionProtocolVersion,
			kind: "request",
			id,
			method,
		};
		if (params !== undefined) record.params = params;
		return runIpc.runRegistry.submit(run.id, record);
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
			void request("session.tick").catch(fail);
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
	// TUI is intentionally live-only: durable replay/resume is owned by the web gateway continuation contract.
	void (async () => {
		for await (const record of runIpc.runRegistry.attachRecords(
			run.id,
			run.lastSequence ?? 0,
		)) {
			if (record.kind === "event") {
				projection = reduceRecord(projection, record);
				render();
			}
		}
	})().catch(fail);
	process.once("SIGINT", stopTui);
	process.once("SIGTERM", stopTui);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		setStatus("running");
		render();
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
