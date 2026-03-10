import {
	TUI,
	ProcessTerminal,
	Text,
	Spacer,
	matchesKey,
} from "@mariozechner/pi-tui";
import { DateTime } from "effect";
import type {
	IssueDetail,
	RuntimeSnapshot,
	SseStatus,
	RefreshResult,
} from "@plot/sdk";

interface RuntimeApi {
	triggerRefresh: () => Promise<RefreshResult>;
	getIssue: (identifier: string) => Promise<IssueDetail>;
	connectSnapshots: (
		handleSnapshot: (snapshot: RuntimeSnapshot) => void,
		handleStatus: (status: SseStatus) => void,
	) => () => void;
}

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
	if (s.length <= max) return s;
	return s.slice(0, max - 1) + "…";
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
			return fg(C.yellow, "thinking");
		case "tool_execution": {
			const tool = session.activeTools[session.activeTools.length - 1];
			return fg(C.cyan, tool?.toolName ?? "exec");
		}
		case "compacting":
			return fg(C.magenta, "compacting");
		case "retrying":
			return fg(C.red, "retrying");
		default:
			return fg(C.muted, "idle");
	}
}

function activityStr(session: {
	phase: string;
	activeTools: ReadonlyArray<{ toolName: string }>;
	lastMessage: string | null;
}): string {
	if (session.phase === "tool_execution" && session.activeTools.length > 0) {
		const names = session.activeTools.map((t) => t.toolName).join(", ");
		return fg(C.cyan, truncate(names, 40));
	}
	return fg(C.muted, truncate(session.lastMessage ?? "—", 40));
}

const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + "\\[[0-9;]*m", "g");

function pad(s: string, len: number): string {
	const visible = s.replace(ANSI_RE, "");
	const diff = len - visible.length;
	return diff > 0 ? s + " ".repeat(diff) : s;
}

let selectedIndex = 0;
let currentState: RuntimeSnapshot | null = null;
let currentIssueDetail: IssueDetail | null = null;
let currentIssueDetailIdentifier: string | null = null;
let issueDetailRequestId = 0;
let sseStatus = "connecting";

let headerText: Text;
let tableText: Text;
let detailText: Text;
let retryText: Text;
let footerText: Text;

function updateHeader() {
	if (!currentState) return;
	const s = currentState;
	const dot = sseStatus === "connected" ? fg(C.green, "●") : fg(C.red, "●");
	const parts = [
		`${bold("plot")} ${dot} ${fg(C.muted, sseStatus)}`,
		`${bold(String(s.counts.running))} running ${bold(String(s.counts.retrying))} retrying`,
		`queue ${fg(C.cyan, `${s.observability.commandQueueDepth}/${s.observability.commandQueuePeak}`)}`,
		`pressure ${fg(C.yellow, String(s.observability.commandQueuePressureCount))}`,
		`tokens ${fg(C.yellow, formatTokens(s.codexTotals.totalTokens))}`,
		`up ${fg(C.magenta, formatDuration(s.codexTotals.secondsRunning))}`,
	];
	headerText.setText(parts.join(" │ "));
}

function updateTable() {
	if (!currentState) return;
	const hdr = [
		pad(bold("ID"), 14),
		pad(bold("State"), 10),
		pad(bold("Phase"), 16),
		pad(bold("Age"), 8),
		pad(bold("Turns"), 6),
		pad(bold("Tokens"), 10),
		bold("Activity"),
	].join(" ");

	const rows = currentState.running.map((r, i) => {
		const age = timeAgo(toEpochMs(r.startedAt));
		const isSelected = i === selectedIndex;
		const id = isSelected
			? fg(C.cyan, bold(r.issueIdentifier))
			: r.issueIdentifier;
		return [
			pad(id, 14),
			pad(r.state, 10),
			pad(phaseStr(r.session), 16),
			pad(age, 8),
			pad(String(r.session.turnCount), 6),
			pad(formatTokens(r.session.totalTokens), 10),
			activityStr(r.session),
		].join(" ");
	});

	if (rows.length === 0) {
		rows.push(fg(C.muted, "No active sessions"));
	}

	tableText.setText(`${hdr}\n${rows.join("\n")}`);
}

function updateDetail() {
	if (!currentState || currentState.running.length === 0) {
		detailText.setText(fg(C.muted, "Select a session to view details"));
		return;
	}
	const idx = Math.min(selectedIndex, currentState.running.length - 1);
	const r = currentState.running[idx];
	if (!r) return;

	const s = r.session;
	const phaseColor =
		s.phase === "thinking"
			? C.yellow
			: s.phase === "tool_execution"
				? C.cyan
				: s.phase === "compacting"
					? C.magenta
					: s.phase === "retrying"
						? C.red
						: C.muted;
	const toolNames =
		s.activeTools.length > 0
			? s.activeTools.map((at) => at.toolName).join(", ")
			: "—";
	const message = s.lastAssistantMessage ?? s.lastMessage ?? "—";

	const prompt = currentIssueDetail?.promptSnapshot;
	const runContext = currentIssueDetail?.runContext;
	const promptSummary = prompt
		? [
				`${fg(C.muted, "prompt")}   system ${fg(C.yellow, formatTokens(prompt.systemCharCount))} user ${fg(C.yellow, formatTokens(prompt.userCharCount))}`,
				`${fg(C.muted, "prefix")}   ${prompt.stablePrefixHash.slice(0, 12)}…`,
			]
		: [`${fg(C.muted, "prompt")}   loading…`];
	const workpadSummary = runContext?.workpadSections.length
		? `${fg(C.muted, "workpad")}  ${runContext.workpadSections.map((section) => section.title).join(", ")}`
		: `${fg(C.muted, "workpad")}  none`;

	const lines = [
		`${bold(r.issueIdentifier)} ${fg(C.blue, r.state)} ${fg(phaseColor, s.phase)}`,
		"",
		`${fg(C.muted, "workspace")} ${r.workspacePath ?? "—"}`,
		`${fg(C.muted, "session")}  ${s.sessionId.slice(0, 12)}…`,
		`${fg(C.muted, "phase")}    ${fg(phaseColor, s.phase)}`,
		`${fg(C.muted, "turns")}    ${bold(String(s.turnCount))}`,
		`${fg(C.muted, "tokens")}   in ${fg(C.yellow, formatTokens(s.inputTokens))} out ${fg(C.yellow, formatTokens(s.outputTokens))} total ${fg(C.yellow, formatTokens(s.totalTokens))}`,
		`${fg(C.muted, "tools")}    ${fg(C.cyan, toolNames)}`,
		...promptSummary,
		workpadSummary,
		"",
		bold("last response"),
		message,
	];
	detailText.setText(lines.join("\n"));
}

function updateRetryQueue() {
	if (!currentState) return;
	if (currentState.retrying.length === 0) {
		retryText.setText(fg(C.muted, "No queued retries"));
		return;
	}
	const parts = currentState.retrying.map((r) => {
		const dueMs = toEpochMs(r.dueAt);
		const dueIn = Math.max(0, Math.round((dueMs - Date.now()) / 1000));
		const errPart = r.error ? ` ${truncate(r.error, 50)}` : "";
		return `↻ ${r.identifier} attempt ${r.attempt} in ${dueIn}s${errPart}`;
	});
	retryText.setText(parts.join("\n"));
}

function updateObservability() {
	if (!currentState) return;
	const o = currentState.observability;
	const lines = [
		bold("queue"),
		`${fg(C.muted, "depth")} ${bold(String(o.commandQueueDepth))} │ ${fg(C.muted, "peak")} ${bold(String(o.commandQueuePeak))} │ ${fg(C.muted, "pressure")} ${bold(String(o.commandQueuePressureCount))}`,
		"",
		bold("retries"),
		`${fg(C.muted, "queued")} ${bold(String(currentState.counts.retrying))} │ ${fg(C.muted, "stale drops")} ${bold(String(o.staleRetryDropCount))}`,
		`${fg(C.muted, "mix")} ${summarizeReasonCounts(o.retriesScheduledByReason)}`,
		"",
		bold("workers"),
		`${fg(C.muted, "stops")} ${summarizeReasonCounts(o.workerStopsByReason)}`,
		`${fg(C.muted, "exits")} ${summarizeReasonCounts(o.workerExitsByReason)}`,
	];
	observabilityText.setText(lines.join("\n"));
}

let observabilityText: Text;

function updateAll() {
	updateHeader();
	updateTable();
	updateDetail();
	updateObservability();
	updateRetryQueue();
}

function refreshIssueDetail(api: RuntimeApi, requestRender?: () => void) {
	if (!currentState || currentState.running.length === 0) {
		currentIssueDetail = null;
		currentIssueDetailIdentifier = null;
		return;
	}
	const idx = Math.min(selectedIndex, currentState.running.length - 1);
	const entry = currentState.running[idx];
	if (!entry) return;
	if (currentIssueDetailIdentifier === entry.issueIdentifier) return;

	currentIssueDetail = null;
	currentIssueDetailIdentifier = entry.issueIdentifier;
	const requestId = ++issueDetailRequestId;
	void api
		.getIssue(entry.issueIdentifier)
		.then((detail) => {
			if (requestId !== issueDetailRequestId) return detail;
			currentIssueDetail = detail;
			updateDetail();
			requestRender?.();
			return detail;
		})
		.catch(() => {
			if (requestId !== issueDetailRequestId) return null;
			currentIssueDetail = null;
			updateDetail();
			requestRender?.();
			return null;
		});
}

export async function runTui(options: { api: RuntimeApi }) {
	const api = options.api;
	selectedIndex = 0;
	currentState = null;
	currentIssueDetail = null;
	currentIssueDetailIdentifier = null;
	issueDetailRequestId = 0;
	sseStatus = "connecting";
	let disconnect = () => {};

	const done = new Promise<void>((resolve, reject) => {
		const finish = () => {
			disconnect();
			resolve();
		};

		void (async () => {
			const terminal = new ProcessTerminal();
			const tui = new TUI(terminal, false);

			headerText = new Text(`${bold("plot")} ${fg(C.muted, "connecting…")}`, 1);
			const headerSpacer = new Spacer(0);

			tableText = new Text(fg(C.muted, "Waiting for data…"), 1);
			const tableSpacer = new Spacer(1);

			detailText = new Text(fg(C.muted, "Select a session to view details"), 1);
			const detailSpacer = new Spacer(1);

			observabilityText = new Text(
				fg(C.muted, "Waiting for runtime snapshot"),
				1,
			);
			const obsSpacer = new Spacer(1);

			retryText = new Text(fg(C.muted, "No queued retries"), 1);
			const retrySpacer = new Spacer(1);

			footerText = new Text(fg(C.muted, "j/k navigate │ r refresh │ q quit"));

			tui.addChild(headerText);
			tui.addChild(headerSpacer);
			tui.addChild(tableText);
			tui.addChild(tableSpacer);
			tui.addChild(detailText);
			tui.addChild(detailSpacer);
			tui.addChild(observabilityText);
			tui.addChild(obsSpacer);
			tui.addChild(retryText);
			tui.addChild(retrySpacer);
			tui.addChild(footerText);

			tui.addInputListener((data: string) => {
				if (matchesKey(data, "q") || matchesKey(data, "ctrl+c")) {
					tui.stop();
					finish();
					return { consume: true };
				}
				if (matchesKey(data, "j") || matchesKey(data, "down")) {
					if (currentState && selectedIndex < currentState.running.length - 1) {
						selectedIndex++;
						currentIssueDetailIdentifier = null;
						refreshIssueDetail(api, () => tui.requestRender());
						updateAll();
						tui.requestRender();
					}
					return { consume: true };
				}
				if (matchesKey(data, "k") || matchesKey(data, "up")) {
					if (selectedIndex > 0) {
						selectedIndex--;
						currentIssueDetailIdentifier = null;
						refreshIssueDetail(api, () => tui.requestRender());
						updateAll();
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

			disconnect = api.connectSnapshots(
				(snapshot: RuntimeSnapshot) => {
					currentState = snapshot;
					refreshIssueDetail(api, () => tui.requestRender());
					updateAll();
					tui.requestRender();
				},
				(status: SseStatus) => {
					sseStatus = status;
					updateHeader();
					tui.requestRender();
				},
			);

			tui.start();
			tui.requestRender();
		})().catch(reject);
	});

	return done;
}

export function isTuiEntryCommand(command?: string): boolean {
	return command === "__internal-tui";
}
