import {
	type Component,
	TUI,
	ProcessTerminal,
	Text,
	Spacer,
	matchesKey,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { DateTime } from "effect";
import type {
	AgentRuntimeEvent,
	IssueDetail,
	IssueEventLog,
	RefreshResult,
	RuntimeSnapshot,
	SseStatus,
} from "@plot/sdk";
import { Columns, Lines, Panel } from "./layout.js";

interface RuntimeApi {
	triggerRefresh: () => Promise<RefreshResult>;
	getIssue: (identifier: string) => Promise<IssueDetail>;
	getEventLog: (identifier: string) => Promise<IssueEventLog>;
	connectSnapshots: (
		handleSnapshot: (snapshot: RuntimeSnapshot) => void,
		handleStatus: (status: SseStatus) => void,
	) => () => void;
	connectEvents: (
		handleEvent: (event: AgentRuntimeEvent) => void,
	) => () => void;
}

type PaneFocus = "issues" | "events";
type RailEntry =
	| {
			kind: "running";
			identifier: string;
			issueId: string;
			primary: string;
			secondary: string;
	  }
	| {
			kind: "retrying";
			identifier: string;
			issueId: string;
			primary: string;
			secondary: string;
	  };

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return `${h}h ${m}m`;
}

function timeAgo(epochMs: number): string {
	const diff = (Date.now() - epochMs) / 1000;
	if (diff < 60) return `${Math.round(diff)}s ago`;
	if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
	return `${Math.round(diff / 3600)}h ago`;
}

function truncate(s: string, max: number): string {
	if (visibleWidth(s) <= max) return s;
	return s.slice(0, Math.max(0, max - 1)) + "…";
}

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;

function fg(code: string, text: string): string {
	return `${ESC}${code}m${text}${RESET}`;
}

function bold(text: string): string {
	return `${BOLD}${text}${RESET}`;
}

const C = {
	green: "32",
	yellow: "33",
	red: "31",
	blue: "34",
	cyan: "36",
	magenta: "35",
	muted: "90",
};

function toEpochMs(dt: DateTime.Utc): number {
	return DateTime.toEpochMillis(dt);
}

function formatClock(dt: DateTime.Utc): string {
	return new Date(toEpochMs(dt)).toISOString().slice(11, 19);
}

function formatIso(dt: DateTime.Utc): string {
	return new Date(toEpochMs(dt)).toISOString();
}

function summarizeReasonCounts(reasons: Record<string, number>): string {
	const parts = Object.entries(reasons)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([reason, count]) => `${reason} ${count}`);
	return parts.length > 0 ? parts.join(" · ") : "none";
}

function phaseStr(session: {
	phase: string;
	activeTools: ReadonlyArray<{ toolName: string }>;
}): string {
	switch (session.phase) {
		case "thinking":
			return fg(C.yellow, "thinking…");
		case "tool_execution": {
			const tool = session.activeTools[session.activeTools.length - 1];
			return fg(C.cyan, `${tool?.toolName ?? "exec"}…`);
		}
		case "compacting":
			return fg(C.magenta, "compacting…");
		case "retrying":
			return fg(C.red, "retrying…");
		default:
			return fg(C.muted, "idle");
	}
}

function eventSummary(event: AgentRuntimeEvent): string {
	const pieces: string[] = [event.event];
	if (event.toolName) pieces.push(event.toolName);
	else if (event.message)
		pieces.push(truncate(event.message.replace(/\s+/g, " "), 48));
	return pieces.join(" · ");
}

function eventListFromState(): readonly AgentRuntimeEvent[] {
	if (currentEventLog) return currentEventLog.events;
	if (currentIssueDetail) return currentIssueDetail.eventTail;
	return [];
}

function padLabel(label: string, width: number): string {
	const diff = width - visibleWidth(label);
	return diff > 0 ? label + " ".repeat(diff) : label;
}

class DashboardBody implements Component {
	invalidate() {
		workRailPane.invalidate();
		eventListPane.invalidate();
		eventDetailPane.invalidate();
		opsPane.invalidate();
	}

	render(width: number): string[] {
		const workPanel = new Panel(workRailPane, "work", {
			active: focusPane === "issues",
		});
		const tracePanel = new Panel(eventListPane, "trace", {
			active: focusPane === "events",
		});
		const detailPanel = new Panel(eventDetailPane, "detail");
		const opsPanel = new Panel(opsPane, "ops");
		const workspace = new Columns(
			[tracePanel, detailPanel],
			[
				{ kind: "flex", weight: 3 },
				{ kind: "fixed", width: 38 },
			],
			1,
		);
		const body = new Columns(
			opsVisible ? [workPanel, workspace, opsPanel] : [workPanel, workspace],
			opsVisible
				? [
						{ kind: "fixed", width: 30 },
						{ kind: "flex", weight: 1 },
						{ kind: "fixed", width: 34 },
					]
				: [
						{ kind: "fixed", width: 30 },
						{ kind: "flex", weight: 1 },
					],
			1,
		);
		return body.render(width);
	}
}

function getRailEntries(): RailEntry[] {
	if (!currentState) return [];
	const running = [...currentState.running]
		.sort((a, b) => {
			const aAt = a.session.lastEventAt ? toEpochMs(a.session.lastEventAt) : 0;
			const bAt = b.session.lastEventAt ? toEpochMs(b.session.lastEventAt) : 0;
			return bAt - aAt;
		})
		.map<RailEntry>((entry) => ({
			kind: "running",
			identifier: entry.issueIdentifier,
			issueId: entry.issueId,
			primary: `${entry.issueIdentifier} ${fg(C.blue, entry.state)}`,
			secondary: `${phaseStr(entry.session)} · t${entry.session.turnCount} · ${formatTokens(entry.session.totalTokens)} · ${entry.session.lastEventAt ? timeAgo(toEpochMs(entry.session.lastEventAt)) : "idle"}`,
		}));
	const retrying = currentState.retrying.map<RailEntry>((entry) => ({
		kind: "retrying",
		identifier: entry.identifier,
		issueId: entry.issueId,
		primary: `${entry.identifier} ${fg(C.red, `attempt ${entry.attempt}`)}`,
		secondary: `${timeAgo(toEpochMs(entry.dueAt))}${entry.error ? ` · ${truncate(entry.error, 28)}` : ""}`,
	}));
	return [...running, ...retrying];
}

function getSelectedRailIndex(entries = getRailEntries()): number {
	if (entries.length === 0) return -1;
	const index = entries.findIndex(
		(entry) => entry.identifier === selectedIssueIdentifier,
	);
	return index === -1 ? 0 : index;
}

function ensureSelection() {
	const entries = getRailEntries();
	if (entries.length === 0) {
		selectedIssueIdentifier = null;
		selectedEventIndex = 0;
		return;
	}
	if (
		!selectedIssueIdentifier ||
		!entries.some((entry) => entry.identifier === selectedIssueIdentifier)
	) {
		selectedIssueIdentifier = entries[0]!.identifier;
		currentIssueDetail = null;
		currentIssueDetailIdentifier = null;
		currentEventLog = null;
		currentEventLogIdentifier = null;
		selectedEventIndex = 0;
	}
}

function selectIssue(delta: number) {
	const entries = getRailEntries();
	if (entries.length === 0) return false;
	const currentIndex = getSelectedRailIndex(entries);
	const nextIndex = Math.max(
		0,
		Math.min(entries.length - 1, currentIndex + delta),
	);
	const next = entries[nextIndex];
	if (!next || next.identifier === selectedIssueIdentifier) return false;
	selectedIssueIdentifier = next.identifier;
	currentIssueDetail = null;
	currentIssueDetailIdentifier = null;
	currentEventLog = null;
	currentEventLogIdentifier = null;
	selectedEventIndex = 0;
	return true;
}

function selectEvent(delta: number) {
	const events = eventListFromState();
	if (events.length === 0) return false;
	const nextIndex = Math.max(
		0,
		Math.min(events.length - 1, selectedEventIndex + delta),
	);
	if (nextIndex === selectedEventIndex) return false;
	selectedEventIndex = nextIndex;
	return true;
}

function refreshIssueDetail(api: RuntimeApi, requestRender?: () => void) {
	if (!selectedIssueIdentifier) {
		currentIssueDetail = null;
		currentIssueDetailIdentifier = null;
		return;
	}
	if (currentIssueDetailIdentifier === selectedIssueIdentifier) return;
	currentIssueDetail = null;
	currentIssueDetailIdentifier = selectedIssueIdentifier;
	const requestId = ++issueDetailRequestId;
	void api
		.getIssue(selectedIssueIdentifier)
		.then((detail) => {
			if (requestId !== issueDetailRequestId) return detail;
			currentIssueDetail = detail;
			updateEventList();
			updateEventDetail();
			requestRender?.();
			return detail;
		})
		.catch(() => {
			if (requestId !== issueDetailRequestId) return null;
			currentIssueDetail = null;
			updateEventList();
			updateEventDetail();
			requestRender?.();
			return null;
		});
}

function refreshEventLog(api: RuntimeApi, requestRender?: () => void) {
	if (!selectedIssueIdentifier) {
		currentEventLog = null;
		currentEventLogIdentifier = null;
		selectedEventIndex = 0;
		return;
	}
	if (currentEventLogIdentifier === selectedIssueIdentifier) return;
	currentEventLog = null;
	currentEventLogIdentifier = selectedIssueIdentifier;
	const requestId = ++eventLogRequestId;
	void api
		.getEventLog(selectedIssueIdentifier)
		.then((log) => {
			if (requestId !== eventLogRequestId) return log;
			currentEventLog = log;
			selectedEventIndex = Math.max(0, log.events.length - 1);
			updateEventList();
			updateEventDetail();
			requestRender?.();
			return log;
		})
		.catch(() => {
			if (requestId !== eventLogRequestId) return null;
			currentEventLog = null;
			selectedEventIndex = Math.max(0, eventListFromState().length - 1);
			updateEventList();
			updateEventDetail();
			requestRender?.();
			return null;
		});
}

function mergeRuntimeEvent(event: AgentRuntimeEvent) {
	if (!currentEventLog || currentEventLog.issueId !== event.issueId) return;
	const previous = currentEventLog.events;
	const shouldFollowTail =
		selectedEventIndex >= Math.max(0, previous.length - 1);
	const nextEvents =
		event.event === "notification" &&
		previous.length > 0 &&
		previous[previous.length - 1]?.event === "notification"
			? [
					...previous.slice(0, -1),
					{
						...previous[previous.length - 1]!,
						timestamp: event.timestamp,
						message:
							(previous[previous.length - 1]!.message ?? "") +
							(event.message ?? ""),
					} as AgentRuntimeEvent,
				]
			: [...previous, event];
	currentEventLog = {
		...currentEventLog,
		events: nextEvents,
	} as IssueEventLog;
	if (shouldFollowTail) {
		selectedEventIndex = Math.max(0, nextEvents.length - 1);
	}
}

let focusPane: PaneFocus = "issues";
let opsVisible = true;
let selectedIssueIdentifier: string | null = null;
let selectedEventIndex = 0;
let currentState: RuntimeSnapshot | null = null;
let currentIssueDetail: IssueDetail | null = null;
let currentIssueDetailIdentifier: string | null = null;
let currentEventLog: IssueEventLog | null = null;
let currentEventLogIdentifier: string | null = null;
let issueDetailRequestId = 0;
let eventLogRequestId = 0;
let sseStatus: SseStatus = "connecting";

let headerText: Text;
let footerText: Text;
let workRailPane: Lines;
let eventListPane: Lines;
let eventDetailPane: Lines;
let opsPane: Lines;

function updateHeader() {
	const runningCount = currentState?.counts.running ?? 0;
	const retryingCount = currentState?.counts.retrying ?? 0;
	const dot = sseStatus === "connected" ? fg(C.green, "●") : fg(C.red, "●");
	const parts = [
		`${bold("plot")} ${dot} ${fg(C.muted, sseStatus)}`,
		`${bold(String(runningCount))} active`,
		retryingCount > 0 ? `${bold(String(retryingCount))} retrying` : null,
		currentState
			? `tokens ${fg(C.yellow, formatTokens(currentState.codexTotals.totalTokens))}`
			: null,
		currentState
			? `up ${fg(C.magenta, formatDuration(currentState.codexTotals.secondsRunning))}`
			: null,
	].filter(Boolean);
	headerText.setText(parts.join(" │ "));
}

function updateWorkRail() {
	const entries = getRailEntries();
	const lines: string[] = [];
	if (entries.length === 0) {
		lines.push(fg(C.muted, "no active work"));
		workRailPane.setLines(lines);
		return;
	}
	for (const [index, entry] of entries.entries()) {
		const selected = entry.identifier === selectedIssueIdentifier;
		const prefix = selected ? fg(C.cyan, "›") : fg(C.muted, " ");
		if (entry.kind === "retrying" && index === currentState?.running.length) {
			lines.push(fg(C.muted, "retrying"));
		}
		lines.push(`${prefix} ${entry.primary}`);
		lines.push(`  ${fg(C.muted, entry.secondary)}`);
		lines.push("");
	}
	workRailPane.setLines(lines);
}

function updateEventList() {
	const events = eventListFromState();
	const lines = [
		selectedIssueIdentifier
			? fg(C.muted, `${selectedIssueIdentifier} · ${events.length} events`)
			: fg(C.muted, "select an issue"),
		"",
	];
	if (!selectedIssueIdentifier) {
		lines.push(fg(C.muted, "select an issue to inspect"));
		eventListPane.setLines(lines);
		return;
	}
	if (!currentEventLog && !currentIssueDetail) {
		lines.push(fg(C.muted, "loading trace…"));
		eventListPane.setLines(lines);
		return;
	}
	if (events.length === 0) {
		lines.push(fg(C.muted, "no events yet"));
		eventListPane.setLines(lines);
		return;
	}
	for (const [index, event] of events.entries()) {
		const selected = index === selectedEventIndex;
		const prefix = selected ? fg(C.cyan, "›") : fg(C.muted, " ");
		const clock = fg(C.muted, formatClock(event.timestamp));
		lines.push(`${prefix} ${clock} ${eventSummary(event)}`);
	}
	eventListPane.setLines(lines);
}

function updateEventDetail() {
	const events = eventListFromState();
	const event = events[selectedEventIndex] ?? null;
	const lines = [""];
	if (!selectedIssueIdentifier) {
		lines.push(fg(C.muted, "select an issue to inspect"));
		eventDetailPane.setLines(lines);
		return;
	}
	if (!event) {
		lines.push(fg(C.muted, "select an event to inspect"));
		if (currentIssueDetail) {
			lines.push("");
			lines.push(`${fg(C.muted, "status")} ${currentIssueDetail.status}`);
			lines.push(
				`${fg(C.muted, "workspace")} ${currentIssueDetail.workspacePath ?? "—"}`,
			);
		}
		eventDetailPane.setLines(lines);
		return;
	}
	lines.push(`${event.event}`);
	lines.push(fg(C.muted, formatIso(event.timestamp)));
	lines.push("");
	if (event.message) lines.push(`${fg(C.muted, "message")} ${event.message}`);
	if (event.toolName) lines.push(`${fg(C.muted, "tool")} ${event.toolName}`);
	if (event.toolCallId)
		lines.push(`${fg(C.muted, "call")} ${event.toolCallId}`);
	if (event.sessionId)
		lines.push(`${fg(C.muted, "session")} ${truncate(event.sessionId, 18)}`);
	if (event.isError !== undefined) {
		lines.push(
			`${fg(C.muted, "error")} ${event.isError ? fg(C.red, "true") : fg(C.green, "false")}`,
		);
	}
	if (event.usage) {
		lines.push(
			`${fg(C.muted, "tokens")} in ${fg(C.yellow, formatTokens(event.usage.inputTokens))} out ${fg(C.yellow, formatTokens(event.usage.outputTokens))} total ${fg(C.yellow, formatTokens(event.usage.totalTokens))}`,
		);
	}
	eventDetailPane.setLines(lines);
}

function updateOps() {
	const lines = [""];
	if (!currentState) {
		lines.push(fg(C.muted, "waiting for runtime snapshot"));
		opsPane.setLines(lines);
		return;
	}
	const o = currentState.observability;
	lines.push(bold("retries"));
	if (currentState.retrying.length === 0) {
		lines.push(fg(C.muted, "none"));
	} else {
		for (const retry of currentState.retrying) {
			const dueIn = Math.max(
				0,
				Math.round((toEpochMs(retry.dueAt) - Date.now()) / 1000),
			);
			lines.push(
				`↻ ${retry.identifier} · attempt ${retry.attempt} · ${dueIn}s`,
			);
			if (retry.error)
				lines.push(`  ${fg(C.muted, truncate(retry.error, 44))}`);
		}
	}
	lines.push("");
	lines.push(bold("queue"));
	lines.push(
		`${fg(C.muted, "depth")} ${padLabel(String(o.commandQueueDepth), 4)} ${fg(C.muted, "peak")} ${padLabel(String(o.commandQueuePeak), 4)} ${fg(C.muted, "pressure")} ${o.commandQueuePressureCount}`,
	);
	lines.push("");
	lines.push(bold("workers"));
	lines.push(
		`${fg(C.muted, "stops")} ${summarizeReasonCounts(o.workerStopsByReason)}`,
	);
	lines.push(
		`${fg(C.muted, "exits")} ${summarizeReasonCounts(o.workerExitsByReason)}`,
	);
	lines.push("");
	lines.push(bold("retry mix"));
	lines.push(summarizeReasonCounts(o.retriesScheduledByReason));
	opsPane.setLines(lines);
}

function updateFooter() {
	const opsLabel = opsVisible ? fg(C.green, "on") : fg(C.muted, "off");
	footerText.setText(
		fg(
			C.muted,
			`j/k move │ h/l focus │ tab switch │ o ops ${opsLabel} │ r refresh │ q quit`,
		),
	);
}

function updateAll() {
	updateHeader();
	updateWorkRail();
	updateEventList();
	updateEventDetail();
	updateOps();
	updateFooter();
}

export async function runTui(options: { api: RuntimeApi }) {
	const api = options.api;
	focusPane = "issues";
	opsVisible = true;
	selectedIssueIdentifier = null;
	selectedEventIndex = 0;
	currentState = null;
	currentIssueDetail = null;
	currentIssueDetailIdentifier = null;
	currentEventLog = null;
	currentEventLogIdentifier = null;
	issueDetailRequestId = 0;
	eventLogRequestId = 0;
	sseStatus = "connecting";
	let disconnectSnapshots = () => {};
	let disconnectEvents = () => {};

	const done = new Promise<void>((resolve, reject) => {
		const finish = () => {
			disconnectSnapshots();
			disconnectEvents();
			resolve();
		};

		void (async () => {
			const terminal = new ProcessTerminal();
			const tui = new TUI(terminal, false);

			headerText = new Text(`${bold("plot")} ${fg(C.muted, "connecting…")}`, 0);
			const headerSpacer = new Spacer(1);
			workRailPane = new Lines();
			eventListPane = new Lines();
			eventDetailPane = new Lines();
			opsPane = new Lines();
			footerText = new Text("", 0);
			const footerSpacer = new Spacer(1);

			const body = new DashboardBody();

			tui.addChild(headerText);
			tui.addChild(headerSpacer);
			tui.addChild(body);
			tui.addChild(footerSpacer);
			tui.addChild(footerText);

			const syncSelectedIssue = () => {
				ensureSelection();
				refreshIssueDetail(api, () => tui.requestRender());
				refreshEventLog(api, () => tui.requestRender());
				updateAll();
			};

			tui.addInputListener((data: string) => {
				if (matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
					tui.stop();
					finish();
					return { consume: true };
				}
				if (matchesKey(data, "tab")) {
					focusPane = focusPane === "issues" ? "events" : "issues";
					updateAll();
					tui.requestRender();
					return { consume: true };
				}
				if (matchesKey(data, "h") || matchesKey(data, "left")) {
					focusPane = "issues";
					updateAll();
					tui.requestRender();
					return { consume: true };
				}
				if (matchesKey(data, "l") || matchesKey(data, "right")) {
					focusPane = "events";
					updateAll();
					tui.requestRender();
					return { consume: true };
				}
				if (matchesKey(data, "o")) {
					opsVisible = !opsVisible;
					updateFooter();
					tui.requestRender(true);
					return { consume: true };
				}
				if (matchesKey(data, "j") || matchesKey(data, "down")) {
					const changed =
						focusPane === "issues" ? selectIssue(1) : selectEvent(1);
					if (changed) {
						syncSelectedIssue();
						tui.requestRender();
					}
					return { consume: true };
				}
				if (matchesKey(data, "k") || matchesKey(data, "up")) {
					const changed =
						focusPane === "issues" ? selectIssue(-1) : selectEvent(-1);
					if (changed) {
						syncSelectedIssue();
						tui.requestRender();
					}
					return { consume: true };
				}
				if (matchesKey(data, "r")) {
					void api.triggerRefresh();
					return { consume: true };
				}
				return undefined;
			});

			disconnectSnapshots = api.connectSnapshots(
				(snapshot: RuntimeSnapshot) => {
					currentState = snapshot;
					ensureSelection();
					refreshIssueDetail(api, () => tui.requestRender());
					refreshEventLog(api, () => tui.requestRender());
					updateAll();
					tui.requestRender();
				},
				(status: SseStatus) => {
					sseStatus = status;
					updateHeader();
					tui.requestRender();
				},
			);
			disconnectEvents = api.connectEvents((event) => {
				mergeRuntimeEvent(event);
				updateEventList();
				updateEventDetail();
				tui.requestRender();
			});

			updateAll();
			tui.start();
			tui.requestRender(true);
		})().catch(reject);
	});

	return done;
}

export function isTuiEntryCommand(command?: string): boolean {
	return command === "__internal-tui";
}
