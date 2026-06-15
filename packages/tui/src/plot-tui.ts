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
import { PlotDashboard } from "./dashboard.js";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
	type DashboardProjection,
} from "@plot/control/projection";
import { runtimeIdentityFrom } from "./runtime-identity.js";

export interface PlotTuiOptions extends PlotSessionHostOptions {}

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
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
			void request("close_session", { sessionId: options.sessionId }).finally(
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
		await host.session.shutdown();
		await host.shutdown();
	}
};
