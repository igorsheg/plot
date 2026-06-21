import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { StatusDot } from "@/components/ui/status-indicator";
import type { ConnectionState } from "../web-dashboard-state";
import { useDashboardState } from "../dashboard-context";
import { visibleFleetSessions } from "../fleet-model";
import { Meta, Rail, Row, SectionLabel, Stack } from "./layout";
import { sessionLinkProps } from "./session-links";
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
// is autonomous-and-fine reads as neutral ink. Every row routes INTO the Room
// via the shared `sessionLinkProps`, preserving the `?role=` posture.
//
// Layout: a full-bleed sticky chrome bar (the app frame) over a bounded,
// centred content measure. Edge-to-edge ledger rows don't scan — a name on the
// far left and its status on the far right are too far apart — so the page is
// full-bleed but the reading column is held to a comfortable measure.
// ─────────────────────────────────────────────────────────────────────────

// The ink "live" dot — liveness reads through motion (the beat), not hue.
function LiveDot() {
	return (
		<span className="relative flex size-2 shrink-0">
			<span className="pulse-beat absolute inline-flex size-2 rounded-full bg-foreground" />
			<span className="relative inline-flex size-2 rounded-full bg-foreground" />
		</span>
	);
}

// Sum throughput across the acting sessions — the only honest fleet-wide token
// figure available from summaries. Returns null when nothing is flowing.
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
		<div className="w-full">
			<LobbyChrome
				connection={connection}
				sessionCount={sessions.length}
				throughput={fleetThroughput(acting)}
			/>
			<div className="mx-auto w-full max-w-4xl px-gutter pb-24 pt-12">
				<Stack gap={8}>
					{needsYou.length > 0 ? (
						<Section label="needs you" count={needsYouTotal} accent>
							{needsYou.map((s) => (
								<NeedsYouRow key={s.id} session={s} />
							))}
						</Section>
					) : null}

					{acting.length > 0 ? (
						<Section label="acting · self-driving" count={acting.length}>
							{acting.map((s) => (
								<ActingRow key={s.id} session={s} />
							))}
						</Section>
					) : null}

					{watching.length > 0 ? (
						<Section label="watching · scheduled" count={watching.length}>
							{watching.map((s) => (
								<WatchingRow key={s.id} session={s} />
							))}
						</Section>
					) : null}

					{sessions.length === 0 ? (
						<EmptyFleet connection={connection} />
					) : null}

					<Meta tone="muted" className="pt-2">
						⌘K to jump · operator actions record an observation back into the
						Plot loop.
					</Meta>
				</Stack>
			</div>
		</div>
	);
}

// ─── chrome ────────────────────────────────────────────────────────────────
// A full-bleed sticky app bar: a hairline edge-to-edge rule frames the page so
// the bounded content below never reads as "floating in a void".

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
		<div className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
			<Row className="h-12 justify-between px-gutter">
				<Row gap={3}>
					<Row gap={2}>
						<LiveDot />
						<span className="text-sm font-semibold tracking-tight text-foreground">
							plot
						</span>
					</Row>
					<span className="h-3 w-px bg-border" />
					<Row gap={2}>
						<StatusDot tone={connectionTone(connection)} />
						<Meta>{connectionLabel(connection)}</Meta>
					</Row>
					<RoleToggle />
				</Row>
				<Row gap={3}>
					{throughput === null ? null : (
						<Meta tone="muted">{throughput} tok/s</Meta>
					)}
					<Meta>
						{sessionCount} {sessionCount === 1 ? "session" : "sessions"}
					</Meta>
				</Row>
			</Row>
		</div>
	);
}

// ─── section ─────────────────────────────────────────────────────────────
// A labelled group: the section label + count over a hairline rule, then its
// rows as a quiet ledger. Rows manage their own hover; the rule anchors them.

function Section({
	label,
	count,
	accent = false,
	children,
}: {
	label: string;
	count: number;
	accent?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="border-b border-border pb-2">
				<SectionLabel tone={accent ? "accent" : "default"} count={count}>
					{label}
				</SectionLabel>
			</div>
			<div className="flex flex-col pt-1">{children}</div>
		</div>
	);
}

// ─── rows ────────────────────────────────────────────────────────────────
// Each row is a Link styled with the layout kit — a quiet surface that promotes
// on hover. The row body is the lead glyph + name + cwd; trailing meta sits at
// the right of the bounded measure (close enough to scan).

const rowClass =
	"group -mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-hover";

function NeedsYouRow({ session }: { session: PlotSessionSummary }) {
	return (
		<Link {...sessionLinkProps(session.id)} className={rowClass}>
			<Rail tone="attention" className="h-5" />
			<Row gap={2} className="min-w-0">
				<span className="truncate text-sm font-medium text-foreground">
					{session.workflowName}
				</span>
				<Meta className="truncate">{session.cwdName}</Meta>
			</Row>
			<Row gap={3}>
				<Meta tone="attention">
					{session.needsYouCount} need{session.needsYouCount === 1 ? "" : "s"}{" "}
					you
				</Meta>
				<Meta
					tone="muted"
					className="inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
				>
					open <ArrowRight size={13} />
				</Meta>
			</Row>
		</Link>
	);
}

function ActingRow({ session }: { session: PlotSessionSummary }) {
	const tps = session.tokenThroughputPerSecond;
	return (
		<Link {...sessionLinkProps(session.id)} className={rowClass}>
			<LiveDot />
			<Row gap={2} className="min-w-0">
				<span className="truncate text-sm font-medium text-foreground">
					{session.workflowName}
				</span>
				<Meta className="truncate">{session.cwdName}</Meta>
			</Row>
			<Row gap={3}>
				<Meta tone="foreground">
					{session.agents.active}
					{session.agents.max > 0 ? `/${session.agents.max}` : ""}
				</Meta>
				<Meta tone="muted" className="tabular-nums">
					{tps !== null && tps > 0 ? `${Math.round(tps)} tok/s` : "—"}
				</Meta>
			</Row>
		</Link>
	);
}

// The calm baseline states — watching/idle read as genuinely autonomous-and-fine.
// Anything else (error, paused, stopping, starting) is a degraded/transitional
// posture that stays legible: a session in `error` with needsYouCount 0 is NOT
// needs-you (locked decision #5) and must NOT take the accent (locked #6), but it
// cannot be a silently-calm `○` row either. We surface its `state` word as
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
		<Link {...sessionLinkProps(session.id)} className={rowClass}>
			<Meta tone="muted" className="w-2 text-center">
				{glyph}
			</Meta>
			<Row gap={2} className="min-w-0">
				<span className="truncate text-sm text-muted-foreground transition-colors group-hover:text-foreground">
					{session.workflowName}
				</span>
				<Meta tone="muted" className="truncate">
					{session.cwdName}
				</Meta>
			</Row>
			{degraded ? (
				<Meta tone="foreground" className="uppercase tracking-wider">
					{session.state}
				</Meta>
			) : (
				<span />
			)}
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
		<Stack gap={2} className="py-16">
			<Meta>{copy}</Meta>
		</Stack>
	);
}
