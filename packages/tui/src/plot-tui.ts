import { spawn } from "node:child_process";
import { ProcessTerminal, TUI, matchesKey } from "./pi-tui/index.ts";
import {
	createPlotProtocolSessionHost,
	type PlotSessionHostOptions,
} from "@plot/session/session-host";
import {
	plotProtocolRequestId,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolRequestId,
	type PlotServerRecord,
} from "@plot/session/protocol";
import { PlotDashboard } from "./dashboard.js";
import { applySnapshot, emptyProjection, reduceRecord } from "./projection.js";
import type { DashboardProjection } from "./projection.js";
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
	let lastRenderFingerprint = "";
	let lastRenderAtMs = 0;
	let pendingRender: ReturnType<typeof setTimeout> | undefined;
	const renderFingerprint = () =>
		JSON.stringify({
			status: projection.status,
			frontier: projection.frontier,
			running: [...projection.running.values()].map((work) => [
				work.workKey,
				work.stage,
				work.lastEventSeq,
				work.check,
				work.tokens?.total,
			]),
			pulse: projection.pulse,
			activity: projection.activity[0]?.atMs,
			completed: projection.completed.length,
			diagnostics: projection.diagnostics,
			scheduledWakes: projection.scheduledWakes,
			clockSecond: Math.floor(Date.now() / 1000),
		});
	const render = () => {
		dashboard.setProjection(projection);
		const fingerprint = renderFingerprint();
		if (fingerprint === lastRenderFingerprint) return;
		const now = Date.now();
		const elapsed = now - lastRenderAtMs;
		const requestRender = () => {
			pendingRender = undefined;
			lastRenderFingerprint = renderFingerprint();
			lastRenderAtMs = Date.now();
			tui.requestRender();
		};
		if (elapsed >= 50) requestRender();
		else if (pendingRender === undefined)
			pendingRender = setTimeout(requestRender, 50 - elapsed);
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
			protocol: "plot.v1",
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
	const dashboard = new PlotDashboard(projection, {
		tick: () => {
			void request("tick_once").then(refresh).catch(fail);
		},
		refresh,
		toggleDebug: render,
		shutdown: () => {
			resolveStopped();
			setStatus("shutting_down");
			void request("shutdown").finally(() => tui.stop());
		},
		openUrl,
		height: () => terminal.rows,
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
			if (record.kind === "event") {
				projection = reduceRecord(projection, record);
				render();
				scheduleRefresh();
			}
		}
	})().catch(fail);
	try {
		tui.start();
		const hello = await host.protocol.hello();
		setProjection({
			...projection,
			status: "starting",
			frontier: Number(hello.lastEventSeq),
		});
		const startResponse = await request("start");
		setStatus(
			startResponse.kind === "response" && startResponse.ok
				? "running"
				: "error",
		);
		refresh();
		await stopped;
	} finally {
		if (pendingRender !== undefined) clearTimeout(pendingRender);
		tui.stop();
		await host.session.shutdown();
		await host.shutdown();
	}
};
