import { spawn } from "node:child_process";
import { ProcessTerminal, TUI, matchesKey } from "./pi-tui/index.ts";
import {
	createPlotProtocolSessionHost,
	type PlotSessionHostOptions,
} from "@plot/session/session-host";
import {
	plotProtocolRequestId,
	plotProtocolVersion,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolRequestId,
	type PlotServerRecord,
} from "@plot/session/protocol";
import {
	connectLocalControlClient,
	localPlotServerRunning,
	type LocalControlClient,
} from "@plot/session/local-control-client";
import { PlotDashboard } from "./dashboard.js";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
	type DashboardProjection,
	type RuntimeIdentityProjection,
} from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { runtimeIdentityFrom } from "./runtime-identity.js";

export interface PlotTuiOptions extends PlotSessionHostOptions {
	readonly noServer?: boolean;
	readonly homeDir?: string;
	readonly serverDir?: string;
}

export interface PlotTuiControlAttachment {
	readonly client: LocalControlClient;
	readonly projection: DashboardProjection;
	readonly sessionId: string;
	readonly detach: () => Promise<void>;
}

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const summaryRuntime = (
	summary: PlotSessionSummary,
): RuntimeIdentityProjection => ({
	cwd: summary.cwd,
	cwdName: summary.cwdName,
	workflowPath: summary.workflowPath,
	skills: [],
	skillPaths: [],
});

const sessionsFrom = (data: unknown): readonly PlotSessionSummary[] =>
	isRecord(data) && Array.isArray(data["sessions"])
		? (data["sessions"] as readonly PlotSessionSummary[])
		: [];

const openSessionParamsFrom = (options: PlotTuiOptions) => ({
	sessionId: options.sessionId,
	mode: "watch" as const,
	role: "controller" as const,
	cwd: options.cwd,
	...(options.workflowPath === undefined
		? {}
		: { workflowPath: options.workflowPath }),
	...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
	...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
	...(options.sessionDir === undefined
		? {}
		: { sessionDir: options.sessionDir }),
	...(options.requestQueueCapacity === undefined
		? {}
		: { requestQueueCapacity: options.requestQueueCapacity }),
	...(options.eventCapacity === undefined
		? {}
		: { eventCapacity: options.eventCapacity }),
	...(options.replayCapacity === undefined
		? {}
		: { replayCapacity: options.replayCapacity }),
	...(options.tickIntervalMs === undefined
		? {}
		: { tickIntervalMs: options.tickIntervalMs }),
	...(options.maxRunDurationMs === undefined
		? {}
		: { maxRunDurationMs: options.maxRunDurationMs }),
	...(options.agentSessionOverrides === undefined
		? {}
		: { agentSessionOverrides: options.agentSessionOverrides }),
});

export const openAndAttachPlotTuiSession = async (
	options: PlotTuiOptions,
): Promise<PlotTuiControlAttachment> => {
	const client = await connectLocalControlClient({
		cwd: options.cwd,
		// The TUI never starts its own server — `plot web` owns the server. It only
		// attaches to one that is already running (runPlotTui probes first).
		autostart: false,
		...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
		...(options.serverDir === undefined
			? {}
			: { serverDir: options.serverDir }),
	});
	let list = await client.request("list_sessions", {});
	let summary = sessionsFrom(list.data).find(
		(session) => session.id === options.sessionId,
	);
	if (summary === undefined) {
		const opened = await client.openSession(openSessionParamsFrom(options));
		summary = isRecord(opened.data)
			? (opened.data["session"] as PlotSessionSummary | undefined)
			: undefined;
		list = await client.request("list_sessions", {});
		summary ??= sessionsFrom(list.data).find(
			(session) => session.id === options.sessionId,
		);
	}
	const attached = await client.attachSession({
		sessionId: options.sessionId,
		role: "controller",
		afterSequence: 0,
	});
	const base = emptyProjection(
		options.sessionId,
		summary?.workflowName ?? options.sessionId,
		summary === undefined
			? { cwd: options.cwd, cwdName: options.cwd, skills: [], skillPaths: [] }
			: summaryRuntime(summary),
	);
	return {
		client,
		sessionId: options.sessionId,
		projection: {
			...applySnapshot(base, { snapshot: attached.snapshot }),
			frontier: attached.lastSequence,
			status: "running",
		},
		detach: async () => {
			await client.detachSession({ sessionId: options.sessionId });
		},
	};
};

const runPlotTuiInProcess = async (options: PlotTuiOptions): Promise<void> => {
	const host = await createPlotProtocolSessionHost(options);
	let projection: DashboardProjection = emptyProjection(
		options.sessionId,
		String(
			host.workflow.runtime.name ?? host.workflow.config["name"] ?? "workflow",
		),
		runtimeIdentityFrom({ workflow: host.workflow, cwd: options.cwd }),
	);
	let requestIndex = 0;
	let resolveStopped!: () => void;
	const stopped = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	const pending = new Map<
		PlotProtocolRequestId,
		(record: PlotServerRecord) => void
	>();
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
		command: PlotCommand,
		params?: unknown,
	): Promise<PlotServerRecord> => {
		const id = plotProtocolRequestId(`tui-${++requestIndex}`);
		const record: PlotClientRecord = {
			protocol: plotProtocolVersion,
			kind: "request",
			id,
			command,
			...(params === undefined ? {} : { params }),
		};
		const response = new Promise<PlotServerRecord>((resolve) =>
			pending.set(id, resolve),
		);
		if (!(await host.protocol.submit(record))) pending.delete(id);
		return response;
	};
	let refreshInFlight = false;
	let refreshQueued = false;
	const refresh = () => {
		if (refreshInFlight) {
			refreshQueued = true;
			return;
		}
		refreshInFlight = true;
		void request("get_snapshot", { sessionId: options.sessionId })
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
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void request("request_tick", { sessionId: options.sessionId })
				.then(refresh)
				.catch(fail);
		},
		refresh,
		toggleDebug: render,
		shutdown: () => {
			resolveStopped();
			setStatus("shutting_down");
			void request("detach_session", { sessionId: options.sessionId }).finally(
				() => tui.stop(),
			);
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
	void (async () => {
		for await (const record of host.protocol.output()) {
			if (record.kind === "response" && record.id !== undefined)
				pending.get(record.id)?.(record);
			if (record.kind === "response" && record.id !== undefined)
				pending.delete(record.id);
			if (record.kind === "session_event") {
				projection = reduceRecord(projection, record);
				render();
				scheduleRefresh();
			}
		}
	})().catch(fail);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		const welcome = await host.protocol.welcome();
		setProjection({
			...projection,
			status: "starting",
			frontier: 0,
		});
		void welcome;
		await host.session.start();
		const attachResponse = await request("attach_session", {
			sessionId: options.sessionId,
			role: "controller",
			afterSequence: 0,
		});
		setStatus(
			attachResponse.kind === "response" && attachResponse.ok
				? "running"
				: "error",
		);
		refresh();
		await stopped;
	} finally {
		dashboard.stopLiveUpdates();
		tui.stop();
		await request("detach_session", { sessionId: options.sessionId }).catch(
			() => undefined,
		);
		await host.session.shutdown();
		await host.shutdown();
	}
};

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
	// `plot web` owns the server. The TUI attaches to a running Local Plot Server
	// if one exists (e.g. started by `plot web`); otherwise — or with the explicit
	// --no-server escape hatch — it runs an in-process session instead of starting
	// a competing server of its own.
	if (
		options.noServer ||
		!(await localPlotServerRunning({
			cwd: options.cwd,
			...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
			...(options.serverDir === undefined
				? {}
				: { serverDir: options.serverDir }),
		}))
	)
		return runPlotTuiInProcess(options);
	const attachment = await openAndAttachPlotTuiSession(options);
	let projection = attachment.projection;
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
	let refreshInFlight = false;
	let refreshQueued = false;
	const refresh = () => {
		if (refreshInFlight) {
			refreshQueued = true;
			return;
		}
		refreshInFlight = true;
		void attachment.client
			.request("get_snapshot", { sessionId: options.sessionId })
			.then((record) => setProjection(applySnapshot(projection, record.data)))
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
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void attachment.client
				.request("request_tick", { sessionId: options.sessionId })
				.then(refresh)
				.catch(fail);
		},
		refresh,
		toggleDebug: render,
		shutdown: () => {
			resolveStopped();
			setStatus("shutting_down");
			void attachment.detach().finally(() => tui.stop());
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
	void (async () => {
		for await (const record of attachment.client.records()) {
			if (
				record.kind === "session_event" &&
				record.sessionId === options.sessionId
			) {
				projection = reduceRecord(projection, record);
				render();
				scheduleRefresh();
			}
		}
	})().catch(fail);
	try {
		dashboard.startLiveUpdates();
		tui.start();
		setStatus("running");
		refresh();
		await stopped;
	} finally {
		dashboard.stopLiveUpdates();
		tui.stop();
		await attachment.detach().catch(() => undefined);
		attachment.client.close();
	}
};
