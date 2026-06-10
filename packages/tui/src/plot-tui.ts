import {
	ProcessTerminal,
	TUI,
	matchesKey,
	truncateToWidth,
	type Component,
} from "@earendil-works/pi-tui";
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

export interface PlotTuiOptions extends PlotSessionHostOptions {}

interface TuiState {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly status:
		| "starting"
		| "idle"
		| "running"
		| "shutting_down"
		| "stopped"
		| "error";
	readonly lastEventSeq: number;
	readonly runningCount: number;
	readonly completionCount: number;
	readonly diagnosticCount: number;
	readonly latestMessage: string;
	readonly runningRows: readonly string[];
	readonly diagnostics: readonly string[];
	readonly recentEvents: readonly string[];
}

const ansi = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};
const color = (value: string, code: string) => `${code}${value}${ansi.reset}`;
const line = (value: string, width: number) => truncateToWidth(value, width);
const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);
const emptyState = (sessionId: string, workflowName: string): TuiState => ({
	sessionId,
	workflowName,
	status: "starting",
	lastEventSeq: 0,
	runningCount: 0,
	completionCount: 0,
	diagnosticCount: 0,
	latestMessage: "starting Plot…",
	runningRows: [],
	diagnostics: [],
	recentEvents: [],
});
const eventSummary = (
	record: Extract<PlotServerRecord, { kind: "event" }>,
): string => {
	const event = record.event as {
		readonly type?: string;
		readonly event?: { readonly type?: string };
		readonly sessionId?: string;
	};
	if (event.type === "plot_agent_event" && event.event?.type)
		return event.event.type;
	return event.type ?? "event";
};
const formatDiagnostic = (value: unknown): string => {
	const d = value as {
		readonly level?: string;
		readonly phase?: string;
		readonly message?: string;
	};
	return `${d.level ?? "diagnostic"}/${d.phase ?? "unknown"}: ${d.message ?? JSON.stringify(value)}`;
};
const snapshotState = (state: TuiState, data: unknown): TuiState => {
	const snapshot = (
		data as {
			readonly snapshot?: {
				readonly running?: Map<string, unknown>;
				readonly completions?: readonly unknown[];
				readonly diagnostics?: readonly unknown[];
			};
		}
	).snapshot;
	if (!snapshot) return state;
	const running =
		snapshot.running instanceof Map ? [...snapshot.running.values()] : [];
	const completions = snapshot.completions ?? [];
	const diagnostics = snapshot.diagnostics ?? [];
	return {
		...state,
		status: state.status === "starting" ? "idle" : state.status,
		runningCount: running.length,
		completionCount: completions.length,
		diagnosticCount: diagnostics.length,
		runningRows: running.map((run) => {
			const r = run as {
				readonly sourceId?: string;
				readonly workKey?: string;
				readonly runId?: string;
			};
			return `${r.runId ?? "run"}  ${r.sourceId ?? "source"}  ${r.workKey ?? "work"}`;
		}),
		diagnostics: diagnostics.slice(-5).map(formatDiagnostic),
	};
};

class PlotDashboard implements Component {
	private state: TuiState;
	private readonly actions: {
		readonly start: () => void;
		readonly tick: () => void;
		readonly refresh: () => void;
		readonly quit: () => void;
	};

	constructor(state: TuiState, actions: PlotDashboard["actions"]) {
		this.state = state;
		this.actions = actions;
	}

	setState(state: TuiState): void {
		this.state = state;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		if (matchesKey(data, "q") || matchesKey(data, "ctrl+c"))
			this.actions.quit();
		else if (matchesKey(data, "s")) this.actions.start();
		else if (matchesKey(data, "r")) this.actions.tick();
		else if (matchesKey(data, "g")) this.actions.refresh();
	}

	render(width: number): string[] {
		const s = this.state;
		const statusColor =
			s.status === "error"
				? ansi.red
				: s.status === "running"
					? ansi.green
					: ansi.cyan;
		const rows = [
			color("╭─ PLOT STATUS", ansi.bold),
			`│ ${color("Session:", ansi.bold)} ${color(s.sessionId, ansi.cyan)}  ${color("Workflow:", ansi.bold)} ${s.workflowName}`,
			`│ ${color("Status:", ansi.bold)} ${color(s.status, statusColor)}  ${color("Frontier:", ansi.bold)} ${s.lastEventSeq}`,
			`│ ${color("Work:", ansi.bold)} running ${color(String(s.runningCount), ansi.green)} | completed ${color(String(s.completionCount), ansi.yellow)} | diagnostics ${color(String(s.diagnosticCount), s.diagnosticCount > 0 ? ansi.red : ansi.gray)}`,
			`│ ${color("Latest:", ansi.bold)} ${s.latestMessage}`,
			"├─ Running",
			...(s.runningRows.length === 0
				? [color("│ none", ansi.gray)]
				: s.runningRows.map((row) => `│ ${row}`)),
			"├─ Diagnostics",
			...(s.diagnostics.length === 0
				? [color("│ none", ansi.gray)]
				: s.diagnostics.map((row) => `│ ${color(row, ansi.red)}`)),
			"├─ Recent events",
			...(s.recentEvents.length === 0
				? [color("│ none", ansi.gray)]
				: s.recentEvents.map((row) => `│ ${row}`)),
			color("╰─ keys: s start · r tick · g refresh · q quit", ansi.dim),
		];
		return rows.map((row) => line(row, width));
	}
}

export const runPlotTui = async (options: PlotTuiOptions): Promise<void> => {
	const host = await createPlotProtocolSessionHost(options);
	let state = emptyState(
		options.sessionId,
		String(
			host.workflow.runtime.name ?? host.workflow.config["name"] ?? "workflow",
		),
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
		dashboard.setState(state);
		tui.requestRender();
	};
	const setState = (next: TuiState) => {
		state = next;
		render();
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
	const refresh = () => {
		void request("get_snapshot")
			.then((record) => {
				if (record.kind === "response" && record.ok)
					setState(snapshotState(state, record.data));
				return undefined;
			})
			.catch((error) =>
				setState({
					...state,
					status: "error",
					latestMessage: errorMessage(error),
				}),
			);
	};
	const dashboard = new PlotDashboard(state, {
		start: () => {
			setState({
				...state,
				status: "running",
				latestMessage: "starting session…",
			});
			void request("start")
				.then(refresh)
				.catch((error) =>
					setState({
						...state,
						status: "error",
						latestMessage: errorMessage(error),
					}),
				);
		},
		tick: () => {
			setState({ ...state, latestMessage: "ticking…" });
			void request("tick_once")
				.then(refresh)
				.catch((error) =>
					setState({
						...state,
						status: "error",
						latestMessage: errorMessage(error),
					}),
				);
		},
		refresh,
		quit: () => {
			resolveStopped();
			setState({
				...state,
				status: "shutting_down",
				latestMessage: "shutting down…",
			});
			void request("shutdown").finally(() => tui.stop());
		},
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
				const summary = eventSummary(record);
				state = {
					...state,
					lastEventSeq: Number(record.sequence),
					latestMessage: summary,
					recentEvents: [
						`#${record.sequence} ${summary}`,
						...state.recentEvents,
					].slice(0, 8),
				};
				render();
			}
		}
	})().catch((error) =>
		setState({ ...state, status: "error", latestMessage: errorMessage(error) }),
	);
	try {
		tui.start();
		const hello = await host.protocol.hello();
		setState({
			...state,
			status: "idle",
			lastEventSeq: Number(hello.lastEventSeq),
			latestMessage: "ready",
		});
		refresh();
		await stopped;
	} finally {
		tui.stop();
		await host.session.shutdown();
		await host.shutdown();
	}
};
