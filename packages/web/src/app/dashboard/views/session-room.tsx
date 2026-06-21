import {
	dashboardModelFrom,
	formatDuration,
	type WorkRowModel,
} from "@plot/control/dashboard-model";
import type { DashboardProjection } from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Sparkline } from "@/components/ui/sparkline";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { sortPlotSessions } from "../fleet-model";
import { throughputSeries } from "../throughput-series";
import { Meta, Rail, type RailTone, Row, SectionLabel, Stack } from "./layout";
import { InterruptRunButton, OperatorActionButtons } from "./operator-actions";

// ─────────────────────────────────────────────────────────────────────────
// Session Room — the zoomed-in, two-pane detail for one session. Attention is
// global (the Lobby), context is local (this Room). The left pane is the column
// of work; the right pane is the focused work's depth: its agent run, timeline,
// and operator actions. One accent (`--attention`) marks needs-you; everything
// autonomous-and-fine reads as neutral ink, liveness through motion.
//
// Most internals are lifted from the legacy session-surface: useEsc, the
// running-clock + dashboardModelFrom usage, spring tiers, oneLine, the timeline
// (Trail), the throughput header, and SessionControls. The shared `useNow`
// clock now lives in `@/hooks/use-now`.
// ─────────────────────────────────────────────────────────────────────────

// Spring tiers — crisp, professional (bounce 0). Used for the focus-change
// slide, a click-driven transition (keyboard nav stays unanimated, per Emil).
const spring = {
	moderate: { type: "spring" as const, duration: 0.4, bounce: 0 },
};

// The activity line is always one line: the agent stream can carry newlines in a
// message/tool delta, so collapse them to spaces before render — truncate clips.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export function SessionRoom() {
	const { roster, selectedSessionId, projection, lastError } =
		useDashboardState();
	const session = roster.find(
		(candidate) => candidate.id === selectedSessionId,
	);
	if (projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;
	return (
		<RoomShell projection={projection} session={session} roster={roster} />
	);
}

function RoomShell({
	projection,
	session,
	roster,
}: {
	projection: DashboardProjection;
	session?: PlotSessionSummary;
	roster: readonly PlotSessionSummary[];
}) {
	// Live render clock: ages / schedule are time-derived, so they recompute on a
	// clock even when the projection coalescer stops publishing (idle). 125ms
	// while work runs, 1s when idle.
	const running = projection.attempts.size > 0;
	const now = useNow(running ? 125 : 1000);
	const model = useMemo(
		() => dashboardModelFrom(projection, now),
		[projection, now],
	);
	const samples = projection.tokenSamples;
	const tps = useMemo(() => {
		const last = samples[samples.length - 1];
		return last === undefined ? [] : throughputSeries(samples, last.atMs);
	}, [samples]);

	// Stable insertion order — the AttentionColumn surfaces what needs you, so we
	// do NOT reorder blocked rows to the top (that made the old list jump). Sort
	// by start sequence for a stable column.
	const work = useMemo(
		() =>
			model.work.toSorted(
				(a, b) =>
					(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
			),
		[model.work],
	);

	const paused = session?.state === "paused" || projection.status === "paused";
	const stopped =
		session?.state === "stopped" || projection.status === "stopped";

	// Default focus = first actionable (blocked) work item, else first work item.
	const initialFocus = useMemo(() => {
		const blocked = work.find((row) => row.work.status === "blocked");
		return blocked?.work.workKey ?? work[0]?.work.workKey ?? null;
	}, [work]);
	const [focusedKey, setFocusedKey] = useState<string | null>(initialFocus);
	const focused =
		(focusedKey
			? work.find((row) => row.work.workKey === focusedKey)
			: undefined) ??
		work.find((row) => row.work.workKey === initialFocus) ??
		work[0] ??
		null;

	// Diagnostics that aren't already an actionable work row — neutral ink with
	// just an accent rail (accent discipline: the chromatic accent stays reserved
	// for actionable needs-you).
	const diagnostics = useMemo(() => {
		const actionable = work.filter((row) => row.attention);
		return model.attention.filter(
			(entry) => !actionable.some((row) => row.work.workKey === entry.workKey),
		);
	}, [model.attention, work]);

	const sessionId = projection.sessionId;

	return (
		<div className="mx-auto w-full max-w-[1080px] px-gutter pb-20 pt-6">
			<RoomTopBar
				roster={roster}
				currentId={sessionId}
				selectedId={session?.id}
			/>
			<IdentityHeader
				monogram={session?.workflowName ?? projection.workflowName}
				workflowName={session?.workflowName ?? projection.workflowName}
				state={session?.state ?? projection.status}
				mode={session?.mode}
				cwdName={session?.cwdName ?? projection.runtime.cwdName}
				workflowPath={projection.runtime.workflowPath}
				provider={projection.runtime.provider}
				model={projection.runtime.model}
				throughput={model.pulse.throughput.replace("tps", "tok/s")}
				tps={tps}
			/>
			<LoopPulseStrip
				model={model}
				projection={projection}
				paused={paused}
				stopped={stopped}
			/>
			{diagnostics.length > 0 ? (
				<DiagnosticsStrip text={diagnostics[0]?.text ?? ""} />
			) : null}
			<TwoPane
				work={work}
				focused={focused}
				focusedKey={focused?.work.workKey ?? null}
				onFocus={setFocusedKey}
				sessionId={sessionId}
			/>
		</div>
	);
}

// ─── top bar ───────────────────────────────────────────────────────────────
// "← all work · esc" back to the Lobby (esc is keyboard nav → no animation) and
// the session switcher rail. Both preserve the `?role=` posture.

const lobbyLinkProps = {
	to: "/" as const,
	search: (prev: { role?: "observer" | "controller" }) => ({
		role: prev.role ?? "controller",
	}),
};

const sessionLinkProps = (id: string) =>
	({
		to: "/session/$sessionId",
		params: { sessionId: id },
		search: (prev: { role?: "observer" | "controller" }) => ({
			role: prev.role ?? "controller",
		}),
	}) as const;

function RoomTopBar({
	roster,
	currentId,
	selectedId,
}: {
	roster: readonly PlotSessionSummary[];
	currentId: string;
	selectedId?: string;
}) {
	const navigate = useNavigate();
	// esc → back to the Lobby. Keyboard nav, so the Room enters/exits static.
	useEsc(() => {
		void navigate({
			to: "/",
			search: (prev: { role?: "observer" | "controller" }) => ({
				role: prev.role ?? "controller",
			}),
		});
	});
	return (
		<Row className="mb-4 justify-between">
			<Link {...lobbyLinkProps} className="inline-flex items-center gap-1">
				<ArrowLeft size={13} className="text-t3" />
				<Meta>all work · esc</Meta>
			</Link>
			<SessionSwitcherRail
				roster={roster}
				currentId={selectedId ?? currentId}
			/>
		</Row>
	);
}

function SessionSwitcherRail({
	roster,
	currentId,
}: {
	roster: readonly PlotSessionSummary[];
	currentId: string;
}) {
	const sessions = sortPlotSessions(roster);
	if (sessions.length <= 1) return null;
	return (
		<Row gap={1}>
			{sessions.map((session) => (
				<SwitcherTile
					key={session.id}
					session={session}
					current={session.id === currentId}
				/>
			))}
		</Row>
	);
}

function SwitcherTile({
	session,
	current,
}: {
	session: PlotSessionSummary;
	current: boolean;
}) {
	const monogram = session.workflowName.slice(0, 1).toUpperCase();
	return (
		<Link
			{...sessionLinkProps(session.id)}
			title={session.workflowName}
			className="relative"
		>
			<span
				className={cn(
					"flex size-8 items-center justify-center rounded-md font-mono text-2xs font-semibold",
					current
						? "bg-foreground text-background"
						: "bg-selected text-muted-foreground hover:bg-hover",
				)}
			>
				{monogram}
			</span>
			{session.needsYouCount > 0 ? (
				<span className="absolute -right-1 -top-1 size-2 rounded-full bg-attention" />
			) : null}
		</Link>
	);
}

// ─── identity header ─────────────────────────────────────────────────────
// 46px monogram · workflow title (the one place sans is used — text-lg maps to
// the scale's heading role) · state pill · mode chip · sub-line. Right: the
// throughput sparkline + tok/s (lifted from the legacy PulseHeader).

function IdentityHeader({
	monogram,
	workflowName,
	state,
	mode,
	cwdName,
	workflowPath,
	provider,
	model,
	throughput,
	tps,
}: {
	monogram: string;
	workflowName: string;
	state: string;
	mode?: PlotSessionSummary["mode"];
	cwdName?: string;
	workflowPath?: string;
	provider?: string;
	model?: string;
	throughput: string;
	tps: readonly number[];
}) {
	const subline = [
		cwdName,
		workflowPath,
		provider && model ? `${provider}/${model}` : (model ?? provider),
	]
		.filter((part): part is string => Boolean(part))
		.join(" · ");
	return (
		<Row gap={4} className="items-start border-b border-border pb-4">
			<span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-base font-semibold text-background">
				{monogram.slice(0, 1).toUpperCase()}
			</span>
			<div className="min-w-0 flex-1">
				<Row gap={2} className="flex-wrap">
					<h1 className="truncate font-sans text-lg font-medium">
						{workflowName}
					</h1>
					<StatePill state={state} />
					{mode ? <ModeChip mode={mode} /> : null}
				</Row>
				{subline ? (
					<Meta className="mt-1 block truncate">{subline}</Meta>
				) : null}
			</div>
			<Row gap={2} className="shrink-0 self-center">
				<Sparkline data={tps} />
				<Meta tone="muted">{throughput}</Meta>
			</Row>
		</Row>
	);
}

function StatePill({ state }: { state: string }) {
	const error = state === "error";
	return (
		<span
			className={cn(
				"rounded-[10px] px-2 py-1 font-mono text-2xs uppercase tracking-wider",
				error
					? "border border-attention-border text-attention"
					: "border border-border text-t3",
			)}
		>
			{state}
		</span>
	);
}

function ModeChip({ mode }: { mode: PlotSessionSummary["mode"] }) {
	return (
		<span className="rounded-[10px] bg-selected px-2 py-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground">
			{mode}
		</span>
	);
}

// ─── loop-pulse strip ──────────────────────────────────────────────────────
// One line built from the loop pulse + runtime, plus the session controls. The
// controls are lifted wholesale from the legacy SessionControls; observer
// posture dims the group and labels it read-only (mutations already no-op).

function LoopPulseStrip({
	model,
	projection,
	paused,
	stopped,
}: {
	model: ReturnType<typeof dashboardModelFrom>;
	projection: DashboardProjection;
	paused: boolean;
	stopped: boolean;
}) {
	const { isController } = useDashboardMeta();
	const parts: ReactNode[] = [];
	const tick = model.pulse.tick;
	if (tick !== undefined) {
		parts.push(<>tick #{tick.id}</>);
		parts.push(<>{tick.ago}</>);
		parts.push(<>found {tick.found}</>);
		parts.push(<>started {tick.started}</>);
	}
	if (model.pulse.nextTick !== undefined)
		parts.push(<>next tick {model.pulse.nextTick.inSeconds}s</>);
	const max = model.pulse.maxConcurrentRuns;
	parts.push(
		<>
			{model.pulse.runningCount}
			{max === undefined ? "" : `/${max}`} runs
		</>,
	);
	return (
		<div className="my-4 border-y border-border bg-card px-gutter py-3">
			<Row gap={4} className="flex-wrap justify-between">
				<Row gap={2} className="min-w-0">
					<span className="size-2 shrink-0 rounded-full bg-t3" />
					<Meta className="min-w-0 truncate">
						<Divided>{parts}</Divided>
					</Meta>
				</Row>
				<div
					className={cn(
						"flex flex-col items-end gap-1",
						!isController && "opacity-50",
					)}
				>
					<SessionControls
						projection={projection}
						paused={paused}
						stopped={stopped}
					/>
					{!isController ? <Meta>observer · read-only</Meta> : null}
				</div>
			</Row>
		</div>
	);
}

function SessionControls({
	projection,
	paused,
	stopped,
}: {
	projection: DashboardProjection;
	paused: boolean;
	stopped: boolean;
}) {
	const sessionId = projection.sessionId;
	const { mutateSession } = useDashboardActions();
	const { isController, controllerBlockReason } = useDashboardMeta();
	const { mutationError } = useDashboardState();
	const [closeOpen, setCloseOpen] = useState(false);
	return (
		<>
			<Row gap={4} className="flex-wrap">
				<label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
					<Switch
						checked={!paused}
						disabled={!isController || stopped}
						onCheckedChange={() =>
							mutateSession(
								sessionId,
								paused ? "resume_session" : "pause_session",
							)
						}
					/>
					{paused ? "Paused" : "Live"}
				</label>
				<Button
					size="sm"
					variant="outline"
					disabled={!isController || paused || stopped}
					onClick={() => mutateSession(sessionId, "request_tick")}
				>
					Reconcile now
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-destructive"
					disabled={!isController || stopped}
					onClick={() => setCloseOpen(true)}
				>
					Close session
				</Button>
			</Row>
			<Row gap={3} className="flex-wrap">
				{controllerBlockReason ? <Meta>{controllerBlockReason}</Meta> : null}
				{mutationError ? <Meta tone="destructive">{mutationError}</Meta> : null}
			</Row>
			<Dialog open={closeOpen} onOpenChange={setCloseOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Close this Plot Session?</DialogTitle>
						<DialogDescription>
							Active Agent Runs will be interrupted; Session History is kept.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							size="sm"
							variant="outline"
							onClick={() => setCloseOpen(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="default"
							className="bg-destructive text-white"
							onClick={() => {
								mutateSession(sessionId, "close_session");
								setCloseOpen(false);
							}}
						>
							Close session
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

// ─── diagnostics strip ─────────────────────────────────────────────────────
// Decision #6: diagnostics are NEUTRAL ink. Only the rail carries the accent —
// they are a signal worth surfacing, but not an actionable needs-you.

function DiagnosticsStrip({ text }: { text: string }) {
	return (
		<div className="relative mb-4 border-y border-border px-gutter py-3">
			<Rail tone="attention" className="absolute inset-y-0 left-0" />
			<Meta tone="muted" className="min-w-0">
				{text}
			</Meta>
		</div>
	);
}

// ─── two pane ────────────────────────────────────────────────────────────

function TwoPane({
	work,
	focused,
	focusedKey,
	onFocus,
	sessionId,
}: {
	work: readonly WorkRowModel[];
	focused: WorkRowModel | null;
	focusedKey: string | null;
	onFocus: (key: string) => void;
	sessionId: string;
}) {
	return (
		<div className="grid min-h-[440px] grid-cols-[minmax(0,360px)_1fr] gap-x-6">
			<LeftPane work={work} focusedKey={focusedKey} onFocus={onFocus} />
			<div className="border-l border-border pl-6">
				{focused ? (
					<FocusedDetail
						key={focused.work.workKey}
						row={focused}
						sessionId={sessionId}
					/>
				) : (
					<Meta className="block pt-4">No work in this session.</Meta>
				)}
			</div>
		</div>
	);
}

// ─── left pane (work list) ─────────────────────────────────────────────────
// A column of work; j/k moves selection, enter focuses (lifted from the legacy
// FleetColumn keyboard handler). Selecting a row focuses it in the right pane.

function LeftPane({
	work,
	focusedKey,
	onFocus,
}: {
	work: readonly WorkRowModel[];
	focusedKey: string | null;
	onFocus: (key: string) => void;
}) {
	const selectedIndex = Math.max(
		0,
		work.findIndex((row) => row.work.workKey === focusedKey),
	);
	const clamp = useCallback(
		(next: number) => Math.max(0, Math.min(work.length - 1, next)),
		[work.length],
	);
	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "j" || e.key === "ArrowDown") {
			e.preventDefault();
			const row = work[clamp(selectedIndex + 1)];
			if (row) onFocus(row.work.workKey);
		} else if (e.key === "k" || e.key === "ArrowUp") {
			e.preventDefault();
			const row = work[clamp(selectedIndex - 1)];
			if (row) onFocus(row.work.workKey);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const row = work[selectedIndex];
			if (row) onFocus(row.work.workKey);
		}
	};
	return (
		<Stack gap={2}>
			<SectionLabel count={work.length}>work</SectionLabel>
			<div
				tabIndex={0}
				onKeyDown={onKeyDown}
				className="flex flex-col outline-none"
			>
				{work.map((row) => (
					<WorkRow
						key={row.work.workKey}
						row={row}
						selected={row.work.workKey === focusedKey}
						onSelect={() => onFocus(row.work.workKey)}
					/>
				))}
			</div>
		</Stack>
	);
}

const railToneFor = (row: WorkRowModel): RailTone => {
	const status = row.work.status;
	if (status === "blocked" || status === "failed") return "attention";
	if (status === "running") return row.stale ? "resolved" : "live";
	if (status === "done" || status === "draining" || row.stale)
		return "resolved";
	return "border";
};

const workStatusLabel = (row: WorkRowModel): string => row.work.status;

function WorkRow({
	row,
	selected,
	onSelect,
}: {
	row: WorkRowModel;
	selected: boolean;
	onSelect: () => void;
}) {
	const live = row.attempt?.streaming ?? false;
	const status = row.work.status;
	const sub =
		status === "running"
			? oneLine(row.activity)
			: status === "blocked"
				? "waiting for you"
				: (row.work.subtitle ?? oneLine(row.activity));
	return (
		<button
			type="button"
			onClick={onSelect}
			className={cn(
				"group grid w-full grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-x-3 px-2 py-2 text-left transition-colors",
				selected ? "bg-selected" : "hover:bg-hover",
			)}
		>
			<Rail tone={railToneFor(row)} className="h-6" />
			<div className="min-w-0">
				<span
					className={cn(
						"block truncate text-sm",
						selected ? "font-semibold" : "font-medium",
					)}
				>
					{row.label}
				</span>
				<Meta
					tone={row.attention ? "attention" : "default"}
					className={cn("mt-1 block truncate", live && "shimmer-text")}
				>
					{sub}
				</Meta>
			</div>
			<Meta className="justify-self-end whitespace-nowrap uppercase tracking-wider">
				{workStatusLabel(row)}
			</Meta>
		</button>
	);
}

// ─── focused detail (right pane) ─────────────────────────────────────────────
// Keyed by workKey so a focus change remounts and slides up (0.26s). Focus
// changes are click/keyboard driven on the same surface; a short transform-only
// slide is fine. By status: blocked → reason box; failed → fail box + retry
// wake; run present → AgentRunPanel; done/idle → one-line summary. Then operator
// actions, interrupt (running only), and the timeline.

function FocusedDetail({
	row,
	sessionId,
}: {
	row: WorkRowModel;
	sessionId: string;
}) {
	const attempt = row.attempt;
	const status = row.work.status;
	const glyph =
		status === "blocked" || status === "failed"
			? "▲"
			: attempt?.streaming
				? "●"
				: "○";
	return (
		<motion.div
			initial={{ y: 8 }}
			animate={{ y: 0 }}
			transition={spring.moderate}
			className="pt-4"
		>
			<Row gap={2} className="min-w-0">
				<Meta tone={row.attention ? "attention" : "muted"}>{glyph}</Meta>
				<span className="truncate text-sm font-medium">{row.label}</span>
			</Row>
			{row.work.subtitle ||
			(row.work.labels && row.work.labels.length > 0) ||
			row.work.url ? (
				<Row gap={2} className="mt-2 flex-wrap">
					{row.work.subtitle ? (
						<Meta tone="muted">{row.work.subtitle}</Meta>
					) : null}
					{(row.work.labels ?? []).map((label) => (
						<span
							key={label}
							className="rounded-[10px] bg-selected px-2 py-1 font-mono text-2xs text-muted-foreground"
						>
							{label}
						</span>
					))}
					{row.work.url ? (
						<a
							href={row.work.url}
							className="font-mono text-2xs text-attention underline"
						>
							{row.work.url}
						</a>
					) : null}
				</Row>
			) : null}

			<div className="mt-4">
				{status === "blocked" && row.work.blockedReason ? (
					<div className="rounded border border-attention-border bg-attention-soft px-4 py-3">
						<Meta tone="attention">{row.work.blockedReason}</Meta>
					</div>
				) : null}
				{status === "failed" ? (
					<Stack gap={2}>
						<div className="rounded border border-attention-border bg-attention-soft px-4 py-3">
							<Meta tone="attention">{oneLine(row.activity)}</Meta>
						</div>
						<Meta tone="muted">↻ will auto-retry on the next wake.</Meta>
					</Stack>
				) : null}
				{attempt ? (
					<AgentRunPanel row={row} attempt={attempt} />
				) : status !== "blocked" && status !== "failed" ? (
					<Meta tone="muted" className="block">
						{oneLine(row.activity)}
					</Meta>
				) : null}
			</div>

			<Row gap={2} className="mt-4 flex-wrap">
				<OperatorActionButtons
					item={row.work}
					sessionId={sessionId}
					prominent
				/>
				{attempt && status === "running" ? (
					<InterruptRunButton
						item={row.work}
						attempt={attempt}
						sessionId={sessionId}
					/>
				) : null}
			</Row>

			<div className="mt-4">
				<Timeline row={row} />
			</div>
		</motion.div>
	);
}

// ─── agent run panel ─────────────────────────────────────────────────────

function AgentRunPanel({
	row,
	attempt,
}: {
	row: WorkRowModel;
	attempt: NonNullable<WorkRowModel["attempt"]>;
}) {
	const check =
		attempt.check === "running"
			? "checking…"
			: attempt.check === "passed"
				? "check passed"
				: attempt.check === "failed"
					? "check failed"
					: undefined;
	const meta = [
		formatTokensMeta(attempt),
		`turn ${attempt.turnCount}`,
		`${attempt.eventCount} events`,
		`${attempt.meaningfulCount} meaningful`,
	]
		.filter((part) => part.length > 0)
		.join(" · ");
	return (
		<Stack gap={2} className="mt-4">
			<Row gap={2} className="flex-wrap">
				<Meta tone="muted">agent run · {attempt.runId}</Meta>
				<Meta>stage · {attempt.stage}</Meta>
			</Row>
			{attempt.streaming ? (
				<Meta tone="foreground" className="block truncate shimmer-text">
					{oneLine(row.activity)}
				</Meta>
			) : null}
			{attempt.phases.length > 0 ? (
				<Row gap={2} className="flex-wrap">
					{attempt.phases.map((phase, index) => (
						<Meta key={`${phase.kind}-${index}`} tone="muted">
							{phase.kind}·{phase.count}
						</Meta>
					))}
				</Row>
			) : null}
			{check ? (
				<Meta tone={attempt.check === "running" ? "muted" : "attention"}>
					{check}
				</Meta>
			) : null}
			<Meta tone="muted">{meta}</Meta>
			{attempt.commands.length > 0 ? (
				<div className="rounded bg-foreground px-4 py-3 text-background">
					<Stack gap={1}>
						{attempt.commands.map((command, index) => (
							<span
								key={`${index}-${command}`}
								className="block truncate font-mono text-2xs"
							>
								<span className="text-t3">$ </span>
								{command}
							</span>
						))}
					</Stack>
				</div>
			) : null}
		</Stack>
	);
}

const formatTokensMeta = (
	attempt: NonNullable<WorkRowModel["attempt"]>,
): string => {
	const total = attempt.tokens?.total ?? 0;
	if (total === 0) return "";
	const tok = total < 1000 ? String(total) : `${(total / 1000).toFixed(1)}k`;
	const cost = attempt.tokens?.cost;
	return cost === undefined || cost === 0
		? `${tok} tok`
		: `${tok} tok · $${cost.toFixed(2)}`;
};

// ─── timeline (rolling window) ─────────────────────────────────────────────
// 3-col grid `age · KIND · text`, newest first, with a live `now` shimmer row
// when streaming. KIND is the entry's activityKind. Lifted from the legacy
// Trail and re-laid-out to the handoff's 3-column form.

const timelineWindow = 9;

function Timeline({ row }: { row: WorkRowModel }) {
	const attempt = row.attempt;
	if (attempt === undefined) return <Meta>No activity yet.</Meta>;
	const history = [...attempt.timeline]
		.toSorted((a, b) => b.atMs - a.atMs)
		.slice(0, timelineWindow);
	if (history.length === 0 && !attempt.streaming)
		return <Meta>No activity yet.</Meta>;
	return (
		<Stack gap={2}>
			<SectionLabel>timeline</SectionLabel>
			<div className="grid grid-cols-[7ch_8ch_minmax(0,1fr)] gap-x-3 gap-y-1">
				{attempt.streaming ? (
					<Fragment key="live">
						<Meta tone="foreground">now</Meta>
						<Meta tone="foreground" className="uppercase">
							{attempt.activityKind}
						</Meta>
						<Meta
							tone="foreground"
							className="min-w-0 truncate whitespace-nowrap shimmer-text"
						>
							{oneLine(row.activity)}
						</Meta>
					</Fragment>
				) : null}
				{history.map((entry) => (
					<Fragment key={`${entry.atMs}-${entry.kind}`}>
						<Meta>{formatDuration(Date.now() - entry.atMs)}</Meta>
						<Meta tone="muted" className="uppercase">
							{entry.kind}
						</Meta>
						<Meta tone="muted" className="min-w-0 truncate whitespace-nowrap">
							{oneLine(entry.text)}
						</Meta>
					</Fragment>
				))}
			</div>
		</Stack>
	);
}

// ─── primitives (lifted) ───────────────────────────────────────────────────

function Divided({ children }: { children: readonly ReactNode[] }) {
	return (
		<>
			{children.map((child, index) => (
				<Fragment key={index}>
					{index > 0 ? (
						<span className="mx-3 h-2 w-px self-center bg-border" />
					) : null}
					{child}
				</Fragment>
			))}
		</>
	);
}

// esc → back. A control-surface affordance: the depth is one keystroke away.
function useEsc(onEsc: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onEsc();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onEsc]);
}

function SnapshotUnavailable({
	lastError,
}: {
	lastError?: string | undefined;
}) {
	return (
		<Stack gap={2} className="px-gutter py-4">
			<Meta>Snapshot unavailable for this Plot Session.</Meta>
			{lastError ? <Meta>{lastError}</Meta> : null}
		</Stack>
	);
}
