import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { AgentRuntimeEvent, IssueEventLog } from "@plot/sdk";
import type {
	RuntimeSnapshot,
	LiveSession,
} from "@plot/sdk";
type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

export interface RuntimeApi {
	connectSnapshots: (
		handleSnapshot: (snapshot: RuntimeSnapshot) => void,
		handleStatus: (status: SseStatus) => void,
	) => () => void;
	connectEvents: (handleEvent: (event: AgentRuntimeEvent) => void) => () => void;
}

type PaneFocus = "issues" | "events";

function toEpochMs(dt: string | null): number {
	if (!dt) return 0;
	return new Date(dt).getTime();
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

function phaseStr(session: LiveSession): string {
	switch (session.phase) {
		case "thinking":
			return "thinking…";
		case "tool_execution": {
			const tool = session.activeTools[session.activeTools.length - 1];
			const labels: Record<string, string> = {
				read: "reading",
				edit: "editing",
				write: "writing",
				bash: "running cmd",
				grep: "searching",
				find: "finding",
				ls: "listing",
			};
			return (labels[tool?.toolName ?? ""] ?? tool?.toolName ?? "exec") + "…";
		}
		case "compacting":
			return "compacting…";
		case "retrying":
			return "retrying…";
		default:
			return "idle";
	}
}

function eventSummary(event: AgentRuntimeEvent): string {
	if (event.toolName) return event.toolName;
	if (event.message) {
		const cleaned = event.message.replace(/\s+/g, " ");
		return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
	}
	return "";
}

function formatClock(dt: string): string {
	return new Date(dt).toISOString().slice(11, 19);
}

function formatIso(dt: string): string {
	return new Date(dt).toISOString();
}

function summarizeReasonCounts(reasons: Record<string, number>): string {
	const parts = Object.entries(reasons)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1])
		.map(([reason, count]) => `${reason} ${count}`);
	return parts.length > 0 ? parts.join(" · ") : "none";
}

const shortLabelMap: Record<string, string> = {
	agent_start: "agent▸",
	agent_end: "agent◂",
	turn_start: "turn▸",
	turn_end: "turn◂",
	message_start: "msg▸",
	message_update: "msg",
	message_end: "msg◂",
	tool_execution_start: "tool▸",
	tool_execution_update: "tool",
	tool_execution_end: "tool◂",
	auto_compaction_start: "compact▸",
	auto_compaction_end: "compact◂",
	auto_retry_start: "retry▸",
	auto_retry_end: "retry◂",
	notification: "··",
};

// ─── Header ────────────────────────────────────────────────

function Header({
	snapshot,
	sseStatus,
}: {
	snapshot: RuntimeSnapshot | null;
	sseStatus: SseStatus;
}) {
	const runningCount = snapshot?.running.length ?? 0;
	const retryingCount = snapshot?.retrying.length ?? 0;
	const dotColor = sseStatus === "connected" ? "#22c55e" : "#ef4444";

	const parts = [
		"plot",
		`● ${sseStatus}`,
		`${runningCount} active`,
		retryingCount > 0 ? `${retryingCount} retrying` : null,
		snapshot ? `tokens ${formatTokens(snapshot.codexTotals.totalTokens)}` : null,
		snapshot ? `up ${formatDuration(snapshot.codexTotals.secondsRunning)}` : null,
	]
		.filter(Boolean)
		.join(" │ ");

	return (
		<box style={{ height: 1, width: "100%" }}>
			<text fg={dotColor}>
				<strong>{parts}</strong>
			</text>
		</box>
	);
}

// ─── WorkRail ──────────────────────────────────────────────

function WorkRail({
	snapshot,
	focusedIdentifier,
	isActive,
}: {
	snapshot: RuntimeSnapshot | null;
	focusedIdentifier: string | null;
	isActive: boolean;
}) {
	const running = [...(snapshot?.running ?? [])].sort((a, b) => {
		const aAt = a.session.lastEventAt ? toEpochMs(a.session.lastEventAt) : 0;
		const bAt = b.session.lastEventAt ? toEpochMs(b.session.lastEventAt) : 0;
		return bAt - aAt;
	});
	const retrying = snapshot?.retrying ?? [];

	if (running.length === 0 && retrying.length === 0) {
		return (
			<box
				title={`work ${isActive ? "●" : "○"}`}
				border
				borderStyle="single"
				style={{ flexGrow: 0, width: 30, height: "100%" }}
			>
				<text fg="#71717a">no active work</text>
			</box>
		);
	}

	return (
		<box
			title={`work ${isActive ? "●" : "○"}`}
			border
			borderStyle="single"
			style={{ flexGrow: 0, width: 30, height: "100%" }}
		>
			<scrollbox focused={false} style={{ width: "100%", height: "100%" }}>
				{running.map((entry) => {
					const selected = entry.issueIdentifier === focusedIdentifier;
					return (
						<box key={entry.issueId} style={{ width: "100%", marginBottom: 0 }}>
							<text fg={selected ? "#22d3ee" : "#e4e4e7"}>
								{selected ? (
									<strong>
										{"› "}
										{entry.issueIdentifier} {entry.state}
									</strong>
								) : (
									<>
										{"  "}
										{entry.issueIdentifier} {entry.state}
									</>
								)}
							</text>
							<text fg="#71717a">
								{"  "}
								{phaseStr(entry.session)} · t{entry.session.turnCount} ·{" "}
								{formatTokens(entry.session.totalTokens)} ·{" "}
								{entry.session.lastEventAt ? timeAgo(toEpochMs(entry.session.lastEventAt)) : "idle"}
							</text>
						</box>
					);
				})}
				{retrying.length > 0 && (
					<box style={{ width: "100%", marginTop: 1 }}>
						<text fg="#71717a">retrying</text>
						{retrying.map((entry) => {
							const selected = entry.identifier === focusedIdentifier;
							return (
								<box key={entry.issueId}>
									<text fg={selected ? "#22d3ee" : "#fbbf24"}>
										{selected ? (
											<strong>
												{"› "}↻ {entry.identifier} · attempt {entry.attempt}
											</strong>
										) : (
											<>
												{"  "}↻ {entry.identifier} · attempt {entry.attempt}
											</>
										)}
									</text>
									{entry.error && (
										<text fg="#71717a">
											{"  "}
											{entry.error.length > 28 ? entry.error.slice(0, 28) + "…" : entry.error}
										</text>
									)}
								</box>
							);
						})}
					</box>
				)}
			</scrollbox>
		</box>
	);
}

// ─── EventList ─────────────────────────────────────────────

function EventList({
	events,
	selectedIndex,
	identifier,
	isActive,
}: {
	events: readonly AgentRuntimeEvent[];
	selectedIndex: number;
	identifier: string | null;
	isActive: boolean;
}) {
	const header = identifier ? `${identifier} · ${events.length} events` : "select an issue";

	return (
		<box
			title={`trace ${isActive ? "●" : "○"}`}
			border
			borderStyle="single"
			style={{ flexGrow: 1, height: "100%" }}
		>
			<text fg="#71717a">{header}</text>
			{events.length === 0 ? (
				<text fg="#71717a">{identifier ? "loading trace…" : "select an issue to inspect"}</text>
			) : (
				<scrollbox focused={false} style={{ width: "100%", flexGrow: 1 }}>
					{events.map((event, index) => {
						const selected = index === selectedIndex;
						const label = shortLabelMap[event.event] ?? event.event;
						return (
							<text
								key={`${event.timestamp}-${index}`}
								fg={selected ? "#22d3ee" : "#a1a1aa"}
							>
								{selected ? "› " : "  "}
								{formatClock(event.timestamp)} {label} {eventSummary(event)}
							</text>
						);
					})}
				</scrollbox>
			)}
		</box>
	);
}

// ─── DetailPane ────────────────────────────────────────────

function DetailPane({ event }: { event: AgentRuntimeEvent | null }) {
	if (!event) {
		return (
			<box title="detail" border borderStyle="single" style={{ width: 38, height: "100%" }}>
				<text fg="#71717a">select an event</text>
			</box>
		);
	}

	const fields: Array<{ key: string; value: string; color: string }> = [];
	if (event.message) fields.push({ key: "message", value: event.message, color: "#e4e4e7" });
	if (event.toolName) fields.push({ key: "tool", value: event.toolName, color: "#e4e4e7" });
	if (event.toolCallId) fields.push({ key: "call", value: event.toolCallId, color: "#e4e4e7" });
	if (event.sessionId)
		fields.push({
			key: "session",
			value: event.sessionId.length > 18 ? event.sessionId.slice(0, 18) + "…" : event.sessionId,
			color: "#e4e4e7",
		});
	if (event.isError !== undefined)
		fields.push({
			key: "error",
			value: String(event.isError),
			color: event.isError ? "#f87171" : "#22c55e",
		});
	if (event.usage) {
		fields.push({
			key: "in",
			value: formatTokens(event.usage.inputTokens),
			color: "#34d399",
		});
		fields.push({
			key: "out",
			value: formatTokens(event.usage.outputTokens),
			color: "#34d399",
		});
		fields.push({
			key: "total",
			value: formatTokens(event.usage.totalTokens),
			color: "#34d399",
		});
	}

	return (
		<box title="detail" border borderStyle="single" style={{ width: 38, height: "100%" }}>
			<text fg="#e4e4e7">
				<strong>{event.event}</strong>
			</text>
			<text fg="#71717a">{formatIso(event.timestamp)}</text>
			<text> </text>
			{fields.map((field, i) => {
				const branch = i === fields.length - 1 ? "└─" : "├─";
				return (
					<text key={field.key + i}>
						<span fg="#71717a">{branch} </span>
						<span fg="#38bdf8">{field.key}</span>
						<span fg="#71717a">: </span>
						<span fg={field.color}>{field.value}</span>
					</text>
				);
			})}
		</box>
	);
}

// ─── OpsPanel ──────────────────────────────────────────────

function OpsPanel({ snapshot }: { snapshot: RuntimeSnapshot | null }) {
	if (!snapshot) {
		return (
			<box title="ops" border borderStyle="single" style={{ width: 34, height: "100%" }}>
				<text fg="#71717a">waiting for snapshot</text>
			</box>
		);
	}

	const o = snapshot.observability;

	return (
		<box title="ops" border borderStyle="single" style={{ width: 34, height: "100%" }}>
			<text fg="#e4e4e7">
				<strong>retries</strong>
			</text>
			{snapshot.retrying.length === 0 ? (
				<text fg="#71717a">none</text>
			) : (
				snapshot.retrying.map((retry) => {
					const dueIn = Math.max(0, Math.round((new Date(retry.dueAt).getTime() - Date.now()) / 1000));
					return (
						<box key={retry.issueId}>
							<text fg="#fbbf24">
								↻ {retry.identifier} · attempt {retry.attempt} · {dueIn}s
							</text>
							{retry.error && (
								<text fg="#71717a">
									{"  "}
									{retry.error.length > 44 ? retry.error.slice(0, 44) + "…" : retry.error}
								</text>
							)}
						</box>
					);
				})
			)}
			<text> </text>
			<text fg="#e4e4e7">
				<strong>queue</strong>
			</text>
			<text fg="#71717a">
				depth {o.commandQueueDepth} · peak {o.commandQueuePeak} · pressure{" "}
				{o.commandQueuePressureCount}
			</text>
			<text> </text>
			<text fg="#e4e4e7">
				<strong>workers</strong>
			</text>
			<text fg="#71717a">stops {summarizeReasonCounts(o.workerStopsByReason)}</text>
			<text fg="#71717a">exits {summarizeReasonCounts(o.workerExitsByReason)}</text>
			<text> </text>
			<text fg="#e4e4e7">
				<strong>retry mix</strong>
			</text>
			<text fg="#71717a">{summarizeReasonCounts(o.retriesScheduledByReason)}</text>
		</box>
	);
}

// ─── Footer ────────────────────────────────────────────────

function Footer({ opsVisible }: { opsVisible: boolean }) {
	const opsLabel = opsVisible ? "on" : "off";
	return (
		<box style={{ height: 1, width: "100%" }}>
			<text fg="#71717a">
				j/k move │ h/l focus │ tab switch │ o ops {opsLabel} │ r refresh │ q quit
			</text>
		</box>
	);
}

// ─── App ───────────────────────────────────────────────────

export function App({ api }: { api: RuntimeApi }) {
	const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
	const [sseStatus, setSseStatus] = useState<SseStatus>("connecting");
	const [focusedIdentifier, setFocusedIdentifier] = useState<string | null>(null);
	const [focusPane, setFocusPane] = useState<PaneFocus>("issues");
	const [opsVisible, setOpsVisible] = useState(true);
	const [selectedEventIndex, setSelectedEventIndex] = useState(0);
	const [eventLog, setEventLog] = useState<IssueEventLog | null>(null);

	const eventLogIdRef = useRef<string | null>(null);

	const resetDetail = useCallback(() => {
		setEventLog(null);
		setSelectedEventIndex(0);
		eventLogIdRef.current = null;
	}, []);

	// derive rail entries
	const running = useMemo(() => {
		return [...(snapshot?.running ?? [])].sort((a, b) => {
			const aAt = a.session.lastEventAt ? toEpochMs(a.session.lastEventAt) : 0;
			const bAt = b.session.lastEventAt ? toEpochMs(b.session.lastEventAt) : 0;
			return bAt - aAt;
		});
	}, [snapshot]);

	const retrying = snapshot?.retrying ?? [];

	const railIdentifiers = useMemo(() => {
		const ids: string[] = [];
		for (const entry of running) ids.push(entry.issueIdentifier);
		for (const entry of retrying) ids.push(entry.identifier);
		return ids;
	}, [running, retrying]);

	// auto-focus
	useEffect(() => {
		if (
			railIdentifiers.length > 0 &&
			(!focusedIdentifier || !railIdentifiers.includes(focusedIdentifier))
		) {
			setFocusedIdentifier(railIdentifiers[0] ?? null);
			resetDetail();
		}
	}, [railIdentifiers, focusedIdentifier]);

	// connect SSE
	useEffect(() => {
		const disconnectSnapshots = api.connectSnapshots(
			(snap) => setSnapshot(snap),
			(status) => setSseStatus(status),
		);
		const disconnectEvents = api.connectEvents((event) => {
			setEventLog((prev) => {
				if (!prev || prev.issueId !== event.issueId) return prev;
				if (
					event.event === "notification" &&
					prev.events.length > 0 &&
					prev.events[prev.events.length - 1]?.event === "notification"
				) {
					const last = prev.events[prev.events.length - 1]!;
					const merged: AgentRuntimeEvent = {
						...last,
						timestamp: event.timestamp,
						message: (last.message ?? "") + (event.message ?? ""),
					};
					return {
						...prev,
						events: [...prev.events.slice(0, -1), merged],
					} satisfies IssueEventLog;
				}
				return { ...prev, events: [...prev.events, event] } satisfies IssueEventLog;
			});
		});

		return () => {
			disconnectSnapshots();
			disconnectEvents();
		};
	}, [api]);

	// auto-follow tail on new events
	const events = eventLog?.events ?? [];
	useEffect(() => {
		if (events.length > 0) {
			setSelectedEventIndex((prev) => {
				if (prev >= events.length - 2) return events.length - 1;
				return prev;
			});
		}
	}, [events.length]);

	const selectedEvent = events[selectedEventIndex] ?? null;

	// keyboard
	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) {
			process.exit(0);
		}
		if (key.name === "tab") {
			setFocusPane((prev) => (prev === "issues" ? "events" : "issues"));
		}
		if (key.name === "h" || key.name === "left") {
			setFocusPane("issues");
		}
		if (key.name === "l" || key.name === "right") {
			setFocusPane("events");
		}
		if (key.name === "o") {
			setOpsVisible((prev) => !prev);
		}
		if (key.name === "j" || key.name === "down") {
			if (focusPane === "issues") {
				const idx = railIdentifiers.indexOf(focusedIdentifier ?? "");
				const next = Math.min(railIdentifiers.length - 1, idx + 1);
				if (railIdentifiers[next] && railIdentifiers[next] !== focusedIdentifier) {
					setFocusedIdentifier(railIdentifiers[next]!);
					resetDetail();
				}
			} else {
				setSelectedEventIndex((prev) => Math.min(events.length - 1, prev + 1));
			}
		}
		if (key.name === "k" || key.name === "up") {
			if (focusPane === "issues") {
				const idx = railIdentifiers.indexOf(focusedIdentifier ?? "");
				const next = Math.max(0, idx - 1);
				if (railIdentifiers[next] && railIdentifiers[next] !== focusedIdentifier) {
					setFocusedIdentifier(railIdentifiers[next]!);
					resetDetail();
				}
			} else {
				setSelectedEventIndex((prev) => Math.max(0, prev - 1));
			}
		}
	});

	return (
		<box flexDirection="column" style={{ width: "100%", height: "100%" }}>
			<Header snapshot={snapshot} sseStatus={sseStatus} />
			<box flexDirection="row" style={{ flexGrow: 1, width: "100%", gap: 1 }}>
				<WorkRail
					snapshot={snapshot}
					focusedIdentifier={focusedIdentifier}
					isActive={focusPane === "issues"}
				/>
				<box flexDirection="row" style={{ flexGrow: 1, gap: 1 }}>
					<EventList
						events={events}
						selectedIndex={selectedEventIndex}
						identifier={focusedIdentifier}
						isActive={focusPane === "events"}
					/>
					<DetailPane event={selectedEvent} />
				</box>
				{opsVisible && <OpsPanel snapshot={snapshot} />}
			</box>
			<Footer opsVisible={opsVisible} />
		</box>
	);
}
