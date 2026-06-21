import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-indicator";
import type { ConnectionState } from "../web-dashboard-state";
import { useDashboardState } from "../dashboard-context";
import { visibleFleetSessions } from "../fleet-model";
import { Meta, Rail, Row, SectionLabel, Stack } from "./layout";
import {
	connectionLabel,
	connectionTone,
	RoleToggle,
	sessionIsRunning,
} from "./status";

// ─────────────────────────────────────────────────────────────────────────
// Triage Lobby — the cross-fleet landing surface. It answers "what across my
// whole fleet needs me?" from roster SUMMARIES ONLY (no projection attaches
// here — full operator actions / blockedReason live in the Room). The one
// accent (`--attention`) is reserved for actionable NEEDS YOU; everything that
// is autonomous-and-fine reads as neutral ink. Every NEEDS YOU row routes INTO
// the Room rather than rendering an operator action inline.
// ─────────────────────────────────────────────────────────────────────────

// Each row navigates to the session's Room, preserving the controller/observer
// posture carried in the `?role=` search param (defaulting to controller).
const sessionLinkProps = (id: string) =>
	({
		to: "/session/$sessionId",
		params: { sessionId: id },
		search: (prev: { role?: "observer" | "controller" }) => ({
			role: prev.role ?? "controller",
		}),
	}) as const;

// The ink "live" dot — liveness reads through motion (the beat), not hue.
// Mirrors the PulseHeader pulse-dot markup from session-surface.
function LiveDot() {
	return (
		<span className="relative flex size-2 shrink-0">
			<span className="pulse-beat absolute inline-flex size-2 rounded-full bg-foreground" />
			<span className="relative inline-flex size-2 rounded-full bg-foreground" />
		</span>
	);
}

// Sum throughput across the acting sessions — the only honest fleet-wide token
// figure available from summaries (there is no fleet token series, so no
// sparkline). Returns null when there is nothing flowing.
const fleetThroughput = (
	sessions: readonly PlotSessionSummary[],
): number | null => {
	const sum = sessions.reduce(
		(n, s) => n + (s.tokenThroughputPerSecond ?? 0),
		0,
	);
	return sum > 0 ? Math.round(sum) : null;
};

export function TriageLobby() {
	const { roster, connection } = useDashboardState();
	const sessions = visibleFleetSessions(roster, false);

	const needsYou = sessions.filter((s) => s.needsYouCount > 0);
	const acting = sessions.filter(
		(s) => s.needsYouCount === 0 && sessionIsRunning(s),
	);
	const watching = sessions.filter(
		(s) => s.needsYouCount === 0 && !sessionIsRunning(s),
	);
	const needsYouTotal = needsYou.reduce((n, s) => n + s.needsYouCount, 0);

	return (
		<Stack
			gap={6}
			className="mx-auto w-full max-w-[1080px] px-gutter pb-20 pt-6"
		>
			<LobbyChrome
				connection={connection}
				sessionCount={sessions.length}
				throughput={fleetThroughput(acting)}
			/>

			{needsYou.length > 0 ? (
				<Card className="border-attention-border bg-attention-soft p-0">
					<div className="px-4 pt-4">
						<SectionLabel tone="accent" count={needsYouTotal}>
							needs you
						</SectionLabel>
					</div>
					<div className="flex flex-col pt-2">
						{needsYou.map((s) => (
							<NeedsYouRow key={s.id} session={s} />
						))}
					</div>
				</Card>
			) : null}

			{acting.length > 0 ? (
				<Stack gap={2}>
					<SectionLabel count={acting.length}>
						acting · self-driving
					</SectionLabel>
					{acting.map((s) => (
						<ActingRow key={s.id} session={s} />
					))}
				</Stack>
			) : null}

			{watching.length > 0 ? (
				<Stack gap={2}>
					<SectionLabel count={watching.length}>
						watching · scheduled
					</SectionLabel>
					{watching.map((s) => (
						<WatchingRow key={s.id} session={s} />
					))}
				</Stack>
			) : null}

			{sessions.length === 0 ? <EmptyFleet connection={connection} /> : null}

			<Meta className="pt-2">
				⌘K to jump · operator actions record an observation back into the Plot
				loop.
			</Meta>
		</Stack>
	);
}

// ─── chrome ────────────────────────────────────────────────────────────────
function LobbyChrome({
	connection,
	sessionCount,
	throughput,
}: {
	connection: ConnectionState;
	sessionCount: number;
	throughput: number | null;
}) {
	return (
		<Row className="justify-between">
			<Row gap={2}>
				<LiveDot />
				<span className="text-sm font-medium text-foreground">plot</span>
				<StatusDot tone={connectionTone(connection)} />
				<Meta>{connectionLabel(connection)}</Meta>
				<RoleToggle />
				<Meta>
					{sessionCount} {sessionCount === 1 ? "session" : "sessions"}
				</Meta>
			</Row>
			{throughput === null ? null : <Meta>{throughput} tok/s</Meta>}
		</Row>
	);
}

// ─── rows ────────────────────────────────────────────────────────────────
// Each row is a Link styled with the layout kit (NOT a coss Button) — a quiet
// surface that promotes on hover.

function NeedsYouRow({ session }: { session: PlotSessionSummary }) {
	return (
		<Link
			{...sessionLinkProps(session.id)}
			className="grid grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 transition-colors hover:bg-hover"
		>
			<Rail tone="attention" className="h-6" />
			<span className="min-w-0 truncate text-sm font-medium text-foreground">
				{session.workflowName}
			</span>
			<Row gap={2}>
				<Meta className="truncate">{session.cwdName}</Meta>
				<Meta tone="attention">{session.needsYouCount}</Meta>
				<Meta className="inline-flex items-center gap-1">
					open <ArrowRight size={14} />
				</Meta>
			</Row>
		</Link>
	);
}

function ActingRow({ session }: { session: PlotSessionSummary }) {
	const tps = session.tokenThroughputPerSecond;
	return (
		<Link
			{...sessionLinkProps(session.id)}
			className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 transition-colors hover:bg-hover"
		>
			<LiveDot />
			<Row gap={2} className="min-w-0">
				<span className="truncate text-sm font-medium text-foreground">
					{session.workflowName}
				</span>
				<Meta className="truncate">{session.cwdName}</Meta>
			</Row>
			<Row gap={2}>
				<Meta tone="foreground">
					{session.agents.active}
					{session.agents.max > 0 ? `/${session.agents.max}` : ""}
				</Meta>
				<Meta>
					{tps !== null && tps > 0 ? `${Math.round(tps)} tok/s` : "—"}
				</Meta>
			</Row>
		</Link>
	);
}

// The calm baseline states — watching/idle read as genuinely autonomous-and-fine.
// Anything else (error, paused, stopping, starting) is a degraded/transitional
// posture that must stay legible: a session in `error` with needsYouCount 0 is
// NOT needs-you (locked decision #5) and must NOT take the accent (locked #6),
// but it cannot be a silently-calm `○` row either. We surface its `state` word as
// neutral monochrome meta so the degraded posture is visible at a glance.
const calmWatchingStates = new Set<PlotSessionSummary["state"]>([
	"watching",
	"idle",
]);

function WatchingRow({ session }: { session: PlotSessionSummary }) {
	// `↻` reads as reconciling/retry; `○` reads as watching/idle.
	const glyph = session.state === "reconciling" ? "↻" : "○";
	const degraded = !calmWatchingStates.has(session.state);
	return (
		<Link
			{...sessionLinkProps(session.id)}
			className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 transition-colors hover:bg-hover"
		>
			<Meta tone="muted" className="w-3 text-center">
				{glyph}
			</Meta>
			<Row gap={2} className="min-w-0">
				<span className="truncate text-sm text-muted-foreground">
					{session.workflowName}
				</span>
				<Meta tone="muted" className="truncate">
					{session.cwdName}
				</Meta>
			</Row>
			{degraded ? (
				<Meta
					tone="foreground"
					className="justify-self-end uppercase tracking-wider"
				>
					{session.state}
				</Meta>
			) : null}
		</Link>
	);
}

// ─── empty ─────────────────────────────────────────────────────────────────
function EmptyFleet({ connection }: { connection: ConnectionState }) {
	const copy =
		connection === "handoff-missing"
			? "Local Plot Server handoff was not provided."
			: "No sessions yet.";
	return (
		<Stack gap={2} className="py-8">
			<Meta>{copy}</Meta>
		</Stack>
	);
}
