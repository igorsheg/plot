import {
	createCliRenderer,
	BoxRenderable,
	TextRenderable,
	TextTableRenderable,
	ScrollBoxRenderable,
	t,
	bold,
	fg,
	type CliRenderer,
	type KeyEvent,
	type TextChunk,
	type TextTableContent,
} from "@opentui/core";
import { DateTime } from "effect";
import type {
	RuntimeSnapshot,
	SseStatus,
	AgentRuntimeEvent,
	RefreshResult,
} from "@plot/sdk";
import { formatTokens, formatDuration, timeAgo, truncate } from "@plot/sdk";

interface RuntimeApi {
	getState: () => Promise<RuntimeSnapshot>;
	triggerRefresh: () => Promise<RefreshResult>;
	connectEvents: (
		onEvent: (event: AgentRuntimeEvent) => void,
		onStatus: (status: SseStatus) => void,
	) => () => void;
}

const C = {
	bg: "#0d0d0d",
	panel: "#1a1a1a",
	border: "#333333",
	text: "#e0e0e0",
	muted: "#666666",
	green: "#00d4aa",
	yellow: "#e8c97a",
	red: "#ff6b6b",
	blue: "#7aa2f7",
	cyan: "#00d4ff",
	magenta: "#b8a0ff",
};

let renderer: CliRenderer;
let headerText!: TextRenderable;
let runningTable!: TextTableRenderable;
let observabilityText!: TextRenderable;
let retryText!: TextRenderable;
let detailText!: TextRenderable;
let selectedIndex = 0;
let currentState: RuntimeSnapshot | null = null;
let sseStatus = "connecting";

function toEpochMs(dt: DateTime.Utc): number {
	return DateTime.toEpochMillis(dt);
}

function cell(text: string): TextChunk[] {
	return [{ __isChunk: true as const, text }];
}

function summarizeReasonCounts(reasons: Record<string, number>): string {
	const parts = Object.entries(reasons)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([reason, count]) => `${reason} ${count}`);
	return parts.length > 0 ? parts.join(" · ") : "none";
}


function phaseCell(session: { phase: string; activeTools: ReadonlyArray<{ toolName: string }> }): TextChunk[] {
	switch (session.phase) {
		case "thinking":
			return [fg(C.yellow)("thinking")];
		case "tool_execution": {
			const tool = session.activeTools[session.activeTools.length - 1];
			const name = tool?.toolName ?? "exec";
			return [fg(C.cyan)(name)];
		}
		case "compacting":
			return [fg(C.magenta)("compacting")];
		case "retrying":
			return [fg(C.red)("retrying")];
		default:
			return [fg(C.muted)("idle")];
	}
}

function activityCell(session: {
	phase: string;
	activeTools: ReadonlyArray<{ toolName: string }>;
	lastMessage: string | null;
}): TextChunk[] {
	if (session.phase === "tool_execution" && session.activeTools.length > 0) {
		const names = session.activeTools.map(t => t.toolName).join(", ");
		return [fg(C.cyan)(truncate(names, 40))];
	}
	return [fg(C.muted)(truncate(session.lastMessage ?? "—", 40))];
}

function updateHeader() {
	if (!currentState) return;
	const s = currentState;
	const dot = sseStatus === "connected" ? fg(C.green)("●") : fg(C.red)("●");
	headerText.content = t`${bold("plot")} ${dot} ${fg(C.muted)(sseStatus)} │ ${bold(String(s.counts.running))} running ${bold(String(s.counts.retrying))} retrying │ queue ${fg(C.cyan)(`${s.observability.commandQueueDepth}/${s.observability.commandQueuePeak}`)} │ pressure ${fg(C.yellow)(String(s.observability.commandQueuePressureCount))} │ tokens ${fg(C.yellow)(formatTokens(s.codexTotals.totalTokens))} │ up ${fg(C.magenta)(formatDuration(s.codexTotals.secondsRunning))}`;
}

function updateRunningTable() {
	if (!currentState) return;
	const header: TextTableContent[number] = [
		[bold("ID")],
		[bold("State")],
		[bold("Phase")],
		[bold("Age")],
		[bold("Turns")],
		[bold("Tokens")],
		[bold("Activity")],
	];
	const rows: TextTableContent = currentState.running.map((r, i) => {
		const age = timeAgo(toEpochMs(r.startedAt));
		const isSelected = i === selectedIndex;
		const idCell: TextChunk[] = isSelected
			? [fg(C.cyan)(bold(r.issueIdentifier))]
			: cell(r.issueIdentifier);
		return [
			idCell,
			cell(r.state),
			phaseCell(r.session),
			cell(age),
			cell(String(r.session.turnCount)),
			cell(formatTokens(r.session.totalTokens)),
			activityCell(r.session),
		];
	});

	if (rows.length > 0) {
		runningTable.content = [header, ...rows];
	} else {
		runningTable.content = [
			header,
			[
				cell("No active sessions"),
				cell(""),
				cell(""),
				cell(""),
				cell(""),
				cell(""),
				cell(""),
			],
		];
	}
}

function updateObservability() {
	if (!currentState) return;
	const o = currentState.observability;
	observabilityText.content = t`${bold("queue")}
${fg(C.muted)("depth")} ${bold(String(o.commandQueueDepth))} │ ${fg(C.muted)("peak")} ${bold(String(o.commandQueuePeak))} │ ${fg(C.muted)("pressure")} ${bold(String(o.commandQueuePressureCount))}

${bold("retries")}
${fg(C.muted)("queued")} ${bold(String(currentState.counts.retrying))} │ ${fg(C.muted)("stale drops")} ${bold(String(o.staleRetryDropCount))}
${fg(C.muted)("mix")} ${summarizeReasonCounts(o.retriesScheduledByReason)}

${bold("workers")}
${fg(C.muted)("stops")} ${summarizeReasonCounts(o.workerStopsByReason)}
${fg(C.muted)("exits")} ${summarizeReasonCounts(o.workerExitsByReason)}`;
}

function updateRetryQueue() {
	if (!currentState) return;
	if (currentState.retrying.length === 0) {
		retryText.content = t`${fg(C.muted)("No queued retries")}`;
		return;
	}
	const parts = currentState.retrying.map((r) => {
		const dueMs = toEpochMs(r.dueAt);
		const dueIn = Math.max(0, Math.round((dueMs - Date.now()) / 1000));
		const errPart = r.error ? ` ${truncate(r.error, 50)}` : "";
		return `↻ ${r.identifier} attempt ${r.attempt} in ${dueIn}s${errPart}`;
	});
	retryText.content = parts.join("\n");
}

function updateDetail() {
	if (!currentState || currentState.running.length === 0) {
		detailText.content = t`${fg(C.muted)("Select a session to view details")}`;
		return;
	}
	const idx = Math.min(selectedIndex, currentState.running.length - 1);
	const r = currentState.running[idx];
	if (!r) return;

	const s = r.session;
	const phaseColor = s.phase === "thinking" ? C.yellow
		: s.phase === "tool_execution" ? C.cyan
		: s.phase === "compacting" ? C.magenta
		: s.phase === "retrying" ? C.red
		: C.muted;
	const toolNames = s.activeTools.length > 0
		? s.activeTools.map(at => at.toolName).join(", ")
		: "—";
	const message = s.lastAssistantMessage ?? s.lastMessage ?? "—";

	detailText.content = t`${bold(r.issueIdentifier)} ${fg(C.blue)(r.state)} ${fg(phaseColor)(s.phase)}

${fg(C.muted)("workspace")} ${r.workspacePath ?? "—"}
${fg(C.muted)("session")}  ${s.sessionId.slice(0, 12)}…
${fg(C.muted)("phase")}    ${fg(phaseColor)(s.phase)}
${fg(C.muted)("turns")}    ${bold(String(s.turnCount))}
${fg(C.muted)("tokens")}   in ${fg(C.yellow)(formatTokens(s.inputTokens))} out ${fg(C.yellow)(formatTokens(s.outputTokens))} total ${fg(C.yellow)(formatTokens(s.totalTokens))}
${fg(C.muted)("tools")}    ${fg(C.cyan)(toolNames)}

${bold("last response")}
${message}`;
}

function updateAll() {
	updateHeader();
	updateRunningTable();
	updateObservability();
	updateRetryQueue();
	updateDetail();
}

async function refresh(api: RuntimeApi) {
	try {
		currentState = await api.getState();
		updateAll();
	} catch {}
}

let lastRefreshAt = 0;
let refreshPending = false;
let refreshInFlight = false;
const THROTTLE_MS = 1000;

async function throttledRefresh(api: RuntimeApi) {
	if (refreshInFlight) {
		refreshPending = true;
		return;
	}
	const now = Date.now();
	const elapsed = now - lastRefreshAt;
	if (elapsed < THROTTLE_MS) {
		if (!refreshPending) {
			refreshPending = true;
			setTimeout(() => {
				void throttledRefresh(api);
			}, THROTTLE_MS - elapsed);
		}
		return;
	}
	refreshInFlight = true;
	refreshPending = false;
	lastRefreshAt = Date.now();
	try {
		currentState = await api.getState();
		updateAll();
	} catch {}
	refreshInFlight = false;
	if (refreshPending) {
		refreshPending = false;
		setTimeout(() => {
			void throttledRefresh(api);
		}, THROTTLE_MS);
	}
}

export async function runTui(options: { api: RuntimeApi }) {
	const api = options.api;
	selectedIndex = 0;
	currentState = null;
	sseStatus = "connecting";
	let disconnect = () => {};
	const done = new Promise<void>((resolve, reject) => {
		const finish = () => {
			disconnect();
			resolve();
		};

		void (async () => {
			renderer = await createCliRenderer({
				targetFps: 30,
				backgroundColor: C.bg,
				exitOnCtrlC: false,
				onDestroy: finish,
			});
			renderer.disableStdoutInterception();

			const root = renderer.root;

			const headerBox = new BoxRenderable(renderer, {
				id: "header",
				width: "100%",
				height: 3,
				backgroundColor: C.panel,
				borderStyle: "rounded",
				borderColor: C.border,
				border: true,
				paddingLeft: 1,
			});
			headerText = new TextRenderable(renderer, {
				id: "header-text",
				content: t`${bold("plot")} ${fg(C.muted)("connecting…")}`,
				fg: C.text,
				width: "100%",
			});
			headerBox.add(headerText);
			root.add(headerBox);

			const body = new BoxRenderable(renderer, {
				id: "body",
				flexDirection: "row",
				width: "100%",
				flexGrow: 1,
				shouldFill: false,
			});
			root.add(body);

			const leftCol = new BoxRenderable(renderer, {
				id: "left-col",
				flexDirection: "column",
				width: "60%",
				height: "100%",
				shouldFill: false,
			});
			body.add(leftCol);

			const runningBox = new BoxRenderable(renderer, {
				id: "running-box",
				width: "100%",
				flexGrow: 1,
				backgroundColor: C.panel,
				borderStyle: "rounded",
				borderColor: C.border,
				border: true,
				title: "Running Sessions",
				titleAlignment: "left",
				paddingLeft: 1,
			});
			runningTable = new TextTableRenderable(renderer, {
				id: "running-table",
				width: "100%",
				height: "100%",
				content: [
					[
						[bold("ID")],
						[bold("State")],
						[bold("Phase")],
						[bold("Age")],
						[bold("Turns")],
						[bold("Tokens")],
						[bold("Activity")],
					],
				],
				border: false,
				fg: C.text,
			});
			runningBox.add(runningTable);
			leftCol.add(runningBox);

			const observabilityBox = new BoxRenderable(renderer, {
				id: "observability-box",
				width: "100%",
				height: 9,
				backgroundColor: C.panel,
				borderStyle: "rounded",
				borderColor: C.border,
				border: true,
				title: "Runtime Observability",
				titleAlignment: "left",
				paddingLeft: 1,
			});
			observabilityText = new TextRenderable(renderer, {
				id: "observability-text",
				content: t`${fg(C.muted)("Waiting for runtime snapshot")}`,
				fg: C.text,
				width: "100%",
				wrapMode: "word",
			});
			observabilityBox.add(observabilityText);
			leftCol.add(observabilityBox);

			const retryBox = new BoxRenderable(renderer, {
				id: "retry-box",
				width: "100%",
				height: 7,
				backgroundColor: C.panel,
				borderStyle: "rounded",
				borderColor: C.border,
				border: true,
				title: "Retry Queue",
				titleAlignment: "left",
				paddingLeft: 1,
			});
			retryText = new TextRenderable(renderer, {
				id: "retry-text",
				content: t`${fg(C.muted)("No queued retries")}`,
				fg: C.text,
				width: "100%",
			});
			retryBox.add(retryText);
			leftCol.add(retryBox);

			const detailBox = new BoxRenderable(renderer, {
				id: "detail-box",
				width: "40%",
				height: "100%",
				backgroundColor: C.panel,
				borderStyle: "rounded",
				borderColor: C.border,
				border: true,
				title: "Detail",
				titleAlignment: "left",
				paddingLeft: 1,
			});
			const detailScroll = new ScrollBoxRenderable(renderer, {
				id: "detail-scroll",
				width: "100%",
				height: "100%",
				scrollY: true,
				scrollX: false,
			});
			detailText = new TextRenderable(renderer, {
				id: "detail-text",
				content: t`${fg(C.muted)("Select a session to view details")}`,
				fg: C.text,
				width: "100%",
				wrapMode: "word",
			});
			detailScroll.add(detailText);
			detailBox.add(detailScroll);
			body.add(detailBox);

			const footerBox = new BoxRenderable(renderer, {
				id: "footer",
				width: "100%",
				height: 1,
				shouldFill: false,
				paddingLeft: 1,
			});
			const footerText = new TextRenderable(renderer, {
				id: "footer-text",
				content: t`${fg(C.muted)("j/k navigate │ r refresh │ q quit")}`,
				width: "100%",
				height: 1,
			});
			footerBox.add(footerText);
			root.add(footerBox);

			renderer.keyInput.on("keypress", async (key: KeyEvent) => {
				if (key.name === "q" || (key.ctrl && key.name === "c")) {
					renderer.destroy();
					return;
				}
				if (key.name === "j" || key.name === "down") {
					if (currentState && selectedIndex < currentState.running.length - 1) {
						selectedIndex++;
						updateAll();
					}
				}
				if (key.name === "k" || key.name === "up") {
					if (selectedIndex > 0) {
						selectedIndex--;
						updateAll();
					}
				}
				if (key.name === "r") {
					await api.triggerRefresh();
					await refresh(api);
				}
			});

			disconnect = api.connectEvents(
				() => {
					void throttledRefresh(api);
				},
				(status: SseStatus) => {
					sseStatus = status;
					updateHeader();
					if (status === "connected") {
						void throttledRefresh(api);
					}
				},
			);

			await refresh(api);
			renderer.start();
		})().catch(reject);
	});

	return done;
}

export function isTuiEntryCommand(command?: string): boolean {
	return command === "__internal-tui";
}
