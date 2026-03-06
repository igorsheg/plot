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
import type { RuntimeSnapshot } from "@plot/shared";
import { getState, connectSse, triggerRefresh } from "./api.js";
import { formatTokens, formatDuration, timeAgo, truncate } from "@plot/shared";

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
let headerText: TextRenderable;
let runningTable: TextTableRenderable;
let retryText: TextRenderable;
let detailText: TextRenderable;
let selectedIndex = 0;
let currentState: RuntimeSnapshot | null = null;
let sseStatus = "connecting";

function toEpochMs(dt: DateTime.Utc): number {
	return DateTime.toEpochMillis(dt);
}

function cell(text: string): TextChunk[] {
	return [{ __isChunk: true as const, text }];
}

function updateHeader() {
	if (!currentState) return;
	const s = currentState;
	const dot = sseStatus === "connected" ? fg(C.green)("●") : fg(C.red)("●");
	headerText.content = t`${bold("plot")} ${dot} ${fg(C.muted)(sseStatus)} │ ${bold(String(s.counts.running))} running ${bold(String(s.counts.retrying))} retrying │ tokens ${fg(C.yellow)(formatTokens(s.codexTotals.totalTokens))} │ up ${fg(C.magenta)(formatDuration(s.codexTotals.secondsRunning))}`;
}

function updateRunningTable() {
	if (!currentState) return;
	const header: TextTableContent[number] = [
		[bold("ID")],
		[bold("State")],
		[bold("Age")],
		[bold("Turns")],
		[bold("Tokens")],
		[bold("Message")],
	];
	const rows: TextTableContent = currentState.running.map((r, i) => {
		const age = timeAgo(toEpochMs(r.startedAt));
		const msg = truncate(r.session.lastMessage ?? "—", 40);
		const isSelected = i === selectedIndex;
		const idCell: TextChunk[] = isSelected
			? [fg(C.cyan)(bold(r.issueIdentifier))]
			: cell(r.issueIdentifier);
		return [
			idCell,
			cell(r.state),
			cell(age),
			cell(String(r.session.turnCount)),
			cell(formatTokens(r.session.totalTokens)),
			[fg(C.muted)(msg)],
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
			],
		];
	}
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

	detailText.content = t`${bold(r.issueIdentifier)} ${fg(C.blue)(r.state)}

${fg(C.muted)("workspace")} ${r.workspacePath ?? "—"}
${fg(C.muted)("session")}  ${r.session.sessionId.slice(0, 12)}…
${fg(C.muted)("turns")}    ${bold(String(r.session.turnCount))}
${fg(C.muted)("tokens")}   in ${fg(C.yellow)(formatTokens(r.session.inputTokens))} out ${fg(C.yellow)(formatTokens(r.session.outputTokens))} total ${fg(C.yellow)(formatTokens(r.session.totalTokens))}

${bold("last message")}
${r.session.lastMessage ?? "—"}`;
}

function updateAll() {
	updateHeader();
	updateRunningTable();
	updateRetryQueue();
	updateDetail();
}

async function refresh() {
	try {
		currentState = await getState();
		updateAll();
	} catch {}
}

let lastRefreshAt = 0;
let refreshPending = false;
let refreshInFlight = false;
const THROTTLE_MS = 1000;

async function throttledRefresh() {
	if (refreshInFlight) {
		refreshPending = true;
		return;
	}
	const now = Date.now();
	const elapsed = now - lastRefreshAt;
	if (elapsed < THROTTLE_MS) {
		if (!refreshPending) {
			refreshPending = true;
			setTimeout(throttledRefresh, THROTTLE_MS - elapsed);
		}
		return;
	}
	refreshInFlight = true;
	refreshPending = false;
	lastRefreshAt = Date.now();
	try {
		currentState = await getState();
		updateAll();
	} catch {}
	refreshInFlight = false;
	if (refreshPending) {
		refreshPending = false;
		setTimeout(throttledRefresh, THROTTLE_MS);
	}
}

export async function runTui() {
	renderer = await createCliRenderer({
		targetFps: 30,
		backgroundColor: C.bg,
		exitOnCtrlC: false,
	});

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
				[bold("Age")],
				[bold("Turns")],
				[bold("Tokens")],
				[bold("Message")],
			],
		],
		border: false,
		fg: C.text,
	});
	runningBox.add(runningTable);
	leftCol.add(runningBox);

	const retryBox = new BoxRenderable(renderer, {
		id: "retry-box",
		width: "100%",
		height: 6,
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
			process.exit(0);
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
			await triggerRefresh();
			await refresh();
		}
	});

	connectSse(
		() => {
			throttledRefresh();
		},
		(status) => {
			sseStatus = status;
			updateHeader();
			if (status === "connected") {
				throttledRefresh();
			}
		},
	);

	await refresh();

	renderer.start();
}

export function isTuiEntryCommand(command?: string): boolean {
	return command === "__internal-tui";
}

if (import.meta.main) {
	runTui().catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
