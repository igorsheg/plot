import {
	dashboardModelFrom,
	formatDuration,
	type WorkRowModel,
} from "@plot/control/dashboard-model";
import type { DashboardProjection } from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { AnimatePresence, motion } from "motion/react";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

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
import { cn } from "@/lib/utils";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { throughputSeries } from "../throughput-series";
import { Meta, Rail, type RailTone, Row, SectionLabel, Stack } from "./layout";
import { InterruptRunButton, OperatorActionButtons } from "./operator-actions";

// Spring tiers (Apple-style: duration + bounce, easier to reason about than
// stiffness/damping/mass). bounce 0 — a crisp professional control surface,
// not a playful one. fast for rows, moderate for room-level swaps.
const spring = {
	fast: { type: "spring" as const, duration: 0.3, bounce: 0 },
	moderate: { type: "spring" as const, duration: 0.4, bounce: 0 },
};

// The activity line is always one line: the agent stream can carry newlines in a
// message/tool delta, so collapse them to spaces before render — truncate clips.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// The thread row surfaces only how long the run has been going — the one datum
// that orients you in a live fleet. Per-run tokens/cost are data-dump; they live
// in the focus view, not every row. No age yet (run not started) -> nothing.
const rowAge = (row: WorkRowModel): string => {
	const started = row.attempt?.startedAtMs;
	if (started === undefined) return row.stale ? row.lastEventAgo : "";
	return formatDuration(Date.now() - started);
};

// ─────────────────────────────────────────────────────────────────────────
// Plot web session surface — a control surface, not a dashboard.
//
// The room has two modes over the same column of work threads:
//   • fleet  — a column of live one-liners (one per work item). A thread that
//              needs you elevates in-place with the action right there.
//              j/k moves selection, enter focuses.
//   • focus  — one thread's rolling-window trail owns the page (the depth),
//              spring-swapped in. esc returns to the fleet.
// Idle (no active work) is a different, sparser room: schedule + last run.
// ─────────────────────────────────────────────────────────────────────────

export function SessionSurface() {
	const { roster, selectedSessionId, projection, lastError } =
		useDashboardState();
	const session = roster.find(
		(candidate) => candidate.id === selectedSessionId,
	);
	if (session === undefined && projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;
	if (projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;
	return <SessionDetail projection={projection} session={session} />;
}

function SessionDetail({
	projection,
	session,
}: {
	projection: DashboardProjection;
	session?: PlotSessionSummary;
}) {
	// Live render clock: ages and the watching schedule are time-derived, so
	// they must recompute on a clock even when the projection is idle (the
	// coalescer stops publishing). 125ms while work runs, 1s when idle.
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
	const idle = model.work.length === 0;
	// Stable insertion order — the AttentionColumn surfaces what needs you, and
	// reordering blocked rows to the top is what made the old list jump.
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
	const [focusedKey, setFocusedKey] = useState<string | null>(null);
	const focused = focusedKey
		? (work.find((row) => row.work.workKey === focusedKey) ?? null)
		: null;

	return (
		<Stack gap={3} className="pt-4">
			<PulseHeader
				workflowName={session?.workflowName ?? projection.workflowName}
				state={session?.state ?? projection.status}
				model={projection.runtime.model}
				cwdName={session?.cwdName}
				throughput={model.pulse.throughput.replace("tps", "tok/s")}
				tps={tps}
				totalTokens={model.pulse.totalTokens}
				totalCost={model.pulse.totalCost}
			/>
			<Row gap={4} className="justify-between px-gutter pt-3">
				<SessionControls
					projection={projection}
					paused={paused}
					stopped={stopped}
				/>
				{idle ? <WatchingMeta model={model} /> : null}
			</Row>

			<AnimatePresence mode="wait" initial={false}>
				{focused ? (
					<FocusView
						key="focus"
						row={focused}
						sessionId={projection.sessionId}
						onBack={() => setFocusedKey(null)}
					/>
				) : idle ? (
					<IdleRoom key="idle" model={model} />
				) : (
					<FleetColumn
						key="fleet"
						work={work}
						sessionId={projection.sessionId}
						model={model}
						onFocus={setFocusedKey}
					/>
				)}
			</AnimatePresence>
		</Stack>
	);
}

// ─── pulse header ────────────────────────────────────────────────────────
// One living element (the breathing dot, beat = a tick) + one number that
// matters (throughput). Tokens/cost/model demote to a hover reveal — they're
// data, not the pulse.

function PulseHeader({
	workflowName,
	state,
	model,
	cwdName,
	throughput,
	tps,
	totalTokens,
	totalCost,
}: {
	workflowName: string;
	state: string;
	model?: string;
	cwdName?: string;
	throughput: string;
	tps: readonly number[];
	totalTokens: string;
	totalCost?: string;
}) {
	const [showStats, setShowStats] = useState(false);
	return (
		<div
			className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-gutter"
			onMouseEnter={() => setShowStats(true)}
			onMouseLeave={() => setShowStats(false)}
		>
			<span className="relative flex size-2 shrink-0">
				<span className="pulse-beat absolute inline-flex size-2 rounded-full bg-live" />
				<span className="relative inline-flex size-2 rounded-full bg-live" />
			</span>
			<h1 className="text-base font-medium">{workflowName}</h1>
			<Meta>
				<span className="capitalize">{state}</span>
				{showStats && model ? ` · ${model}` : ""}
			</Meta>
			{showStats && cwdName ? (
				<Meta className="hidden truncate sm:inline">{cwdName}</Meta>
			) : null}
			<div className="ml-auto flex items-center gap-2">
				<span className="flex items-center gap-2">
					<Sparkline data={tps} />
					<span className="text-muted-foreground">{throughput}</span>
				</span>
				<AnimatePresence>
					{showStats ? (
						<motion.span
							key="stats"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={spring.fast}
							className="whitespace-nowrap"
						>
							<span className="mx-3 h-2 w-px self-center bg-border" />
							<b className="font-normal text-muted-foreground">
								{totalTokens}
							</b>{" "}
							tok{totalCost ? ` · ${totalCost}` : ""}
						</motion.span>
					) : null}
				</AnimatePresence>
			</div>
		</div>
	);
}

// ─── watching meta (idle schedule) ───────────────────────────────────────

function WatchingMeta({
	model,
}: {
	model: ReturnType<typeof dashboardModelFrom>;
}) {
	const parts: ReactNode[] = [];
	const tick = model.pulse.tick;
	if (tick !== undefined)
		parts.push(
			<>
				tick #{tick.id} · {tick.ago}
			</>,
		);
	if (model.pulse.nextTick !== undefined)
		parts.push(<>next tick in {model.pulse.nextTick.inSeconds}s</>);
	if (model.pulse.nextWake !== undefined) {
		const wake = model.pulse.nextWake;
		parts.push(
			<>
				{wake.kind === "retry" ? "retry" : "next wake"} in {wake.inSeconds}s
			</>,
		);
	}
	if (parts.length === 0) return null;
	return (
		<Meta>
			<Divided>{parts}</Divided>
		</Meta>
	);
}

// ─── fleet column ────────────────────────────────────────────────────────
// A column of live one-liners. A thread that needs you elevates in-place with
// the action inline. j/k selects, enter focuses.

function FleetColumn({
	work,
	sessionId,
	model,
	onFocus,
}: {
	work: readonly WorkRowModel[];
	sessionId: string;
	model: ReturnType<typeof dashboardModelFrom>;
	onFocus: (key: string) => void;
}) {
	const [selected, setSelected] = useState(0);
	const clamp = useCallback(
		(next: number) => Math.max(0, Math.min(work.length - 1, next)),
		[work.length],
	);

	// keep selection valid as threads enter/leave
	useEffect(() => {
		setSelected((s) => (work.length === 0 ? 0 : Math.min(s, work.length - 1)));
	}, [work.length]);

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "j" || e.key === "ArrowDown") {
			e.preventDefault();
			setSelected((s) => clamp(s + 1));
		} else if (e.key === "k" || e.key === "ArrowUp") {
			e.preventDefault();
			setSelected((s) => clamp(s - 1));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const row = work[selected];
			if (row) onFocus(row.work.workKey);
		}
	};

	return (
		<Stack gap={3} className="pt-4">
			<div className="px-gutter">
				<SectionLabel count={work.length}>work</SectionLabel>
			</div>
			<div
				tabIndex={0}
				onKeyDown={onKeyDown}
				className="relative flex flex-col outline-none"
			>
				<AnimatePresence initial={false}>
					{work.map((row, index) => (
						<ThreadRow
							key={row.work.workKey}
							row={row}
							index={index}
							sessionId={sessionId}
							selected={selected === index}
							onFocus={() => {
								setSelected(index);
								onFocus(row.work.workKey);
							}}
							onSelect={() => setSelected(index)}
						/>
					))}
				</AnimatePresence>
			</div>
			{model.attention.length > 0 ? <AttentionList model={model} /> : null}
		</Stack>
	);
}

function ThreadRow({
	row,
	index,
	sessionId,
	selected,
	onFocus,
	onSelect,
}: {
	row: WorkRowModel;
	index: number;
	sessionId: string;
	selected: boolean;
	onFocus: () => void;
	onSelect: () => void;
}) {
	const attempt = row.attempt;
	const live = attempt?.streaming ?? false;
	const elevated = row.attention;
	const railTone: RailTone = elevated
		? "attention"
		: row.stale
			? "border"
			: live
				? "live"
				: "border";

	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={spring.fast}
			className={cn(
				"group relative",
				live && "bg-live/5",
				selected && "bg-selected",
				!selected && "hover:bg-hover",
			)}
		>
			<button
				type="button"
				data-proximity-index={index}
				onClick={() => {
					onSelect();
					onFocus();
				}}
				className="grid w-full grid-cols-[3px_minmax(0,1fr)_auto_16px] items-center gap-x-4 px-gutter py-4 text-left"
			>
				<Rail tone={railTone} className="h-6" />
				<div className="min-w-0">
					<span
						className={cn(
							"block truncate text-sm transition-[font-weight]",
							selected ? "font-semibold" : "font-medium",
							"group-hover:font-semibold",
							!live && !elevated && "text-muted-foreground",
						)}
					>
						{row.label}
					</span>
					<Meta
						tone={elevated && !live ? "attention" : "default"}
						className={cn(
							"mt-1 truncate whitespace-nowrap",
							live && "shimmer-text",
						)}
					>
						{oneLine(row.activity)}
					</Meta>
				</div>
				<Meta
					className={cn(
						"justify-self-end whitespace-nowrap transition-opacity",
						selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
					)}
				>
					{rowAge(row)}
				</Meta>
				<ChevronRight
					size={14}
					className={cn(
						"text-t3 transition-opacity",
						selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
					)}
				/>
			</button>
			{/* a thread that needs you: the action surfaces inline */}
			<AnimatePresence>
				{elevated ? (
					<motion.div
						key="act"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={spring.fast}
					>
						<Row gap={2} className="flex-wrap px-gutter pb-4 pl-10">
							<OperatorActionButtons
								item={row.work}
								sessionId={sessionId}
								prominent
							/>
						</Row>
					</motion.div>
				) : null}
			</AnimatePresence>
		</motion.div>
	);
}

// ─── attention (diagnostics + stale, the non-thread needs-you signals) ───

function AttentionList({
	model,
}: {
	model: ReturnType<typeof dashboardModelFrom>;
}) {
	const actionable = model.work.filter((row) => row.attention);
	const diagnostics = model.attention.filter(
		(entry) => !actionable.some((row) => row.work.workKey === entry.workKey),
	);
	if (diagnostics.length === 0) return null;
	return (
		<div className="relative mt-2 border-y border-border bg-attention/5 px-gutter py-4">
			<Rail tone="attention" className="absolute inset-y-0 left-0" />
			<Meta tone="attention" className="mb-2">
				attention
			</Meta>
			<Stack gap={3}>
				{diagnostics.map((entry, index) => (
					<Row
						key={`${entry.workKey ?? "diag"}-${index}`}
						gap={3}
						className="flex-wrap justify-between"
					>
						<Meta tone="muted" className="min-w-0">
							{entry.text}
						</Meta>
					</Row>
				))}
			</Stack>
		</div>
	);
}

// ─── focus view ──────────────────────────────────────────────────────────
// One thread owns the page: its rolling-window trail, the operator action as a
// single contextual gesture. esc / ← all work returns.

function FocusView({
	row,
	sessionId,
	onBack,
}: {
	row: WorkRowModel;
	sessionId: string;
	onBack: () => void;
}) {
	const attempt = row.attempt;
	useEsc(onBack);
	// Keyboard-initiated (Enter) or click swap: no enter animation. This path is
	// used repeatedly; animating it makes navigation feel delayed (Emil: never
	// animate keyboard-initiated actions).
	return (
		<div className="pt-4">
			<div className="px-gutter">
				<SectionLabel>{row.work.workKey}</SectionLabel>
			</div>
			<div className="mt-3 grid grid-cols-[3px_1fr] gap-x-4 border-b border-border px-gutter pb-4">
				<Rail
					tone={
						row.attention ? "attention" : attempt?.streaming ? "live" : "border"
					}
					className="h-8"
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">{row.label}</span>
						<ChevronRight size={13} className="text-t3" />
					</div>
					<Meta
						tone={attempt?.streaming ? "foreground" : "default"}
						className={cn(
							"mt-1 truncate",
							attempt?.streaming && "shimmer-text",
						)}
					>
						{row.activity}
					</Meta>
				</div>
			</div>

			<div className="px-gutter pt-4">
				<Trail row={row} />
				<Row gap={2} className="mt-4 flex-wrap">
					<OperatorActionButtons
						item={row.work}
						sessionId={sessionId}
						prominent
					/>
					{attempt === undefined ? null : (
						<InterruptRunButton
							item={row.work}
							attempt={attempt}
							sessionId={sessionId}
						/>
					)}
				</Row>
			</div>
			<div className="px-gutter pt-4">
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-1 font-mono text-2xs text-t3 transition-colors hover:text-foreground"
				>
					<ArrowLeft size={13} /> all work
				</button>
			</div>
		</div>
	);
}

// ─── trail (bottom-anchored rolling window) ──────────────────────────────
// Newest at the bottom, live "now" pinned last; fixed-width age track so ages
// tick in place; stable keys so React reuses DOM across coalesced frames.

const trailWindow = 9;

function Trail({ row }: { row: WorkRowModel }) {
	const attempt = row.attempt;
	if (attempt === undefined) return <Meta>No activity yet.</Meta>;
	const history = [...attempt.timeline]
		.toSorted((a, b) => a.atMs - b.atMs)
		.slice(-trailWindow);
	if (history.length === 0 && !attempt.streaming)
		return <Meta>No activity yet.</Meta>;
	return (
		<Stack gap={3} className="mb-4">
			<Meta>
				timeline · {attempt.meaningfulCount} of {attempt.eventCount} events
			</Meta>
			<div className="grid grid-cols-[7ch_minmax(0,1fr)] gap-x-3 font-mono text-2xs">
				{history.map((entry) => (
					<Fragment key={`${entry.atMs}-${entry.kind}`}>
						<span className="text-t3">
							{formatDuration(Date.now() - entry.atMs)}
						</span>
						<span className="min-w-0 truncate whitespace-nowrap text-muted-foreground">
							{oneLine(entry.text)}
						</span>
					</Fragment>
				))}
				{attempt.streaming ? (
					<Fragment key="live">
						<span className="text-foreground">now</span>
						<span className="min-w-0 truncate whitespace-nowrap text-foreground shimmer-text">
							{oneLine(row.activity)}
						</span>
					</Fragment>
				) : null}
			</div>
		</Stack>
	);
}

// ─── idle room ───────────────────────────────────────────────────────────
// A different, sparser surface when no work is running: the schedule and the
// last run's outcome. No empty lanes, no "no active work" — the room breathes.

function IdleRoom({ model }: { model: ReturnType<typeof dashboardModelFrom> }) {
	const last = model.completed[0];
	const scheduled = model.scheduled;
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={spring.moderate}
			className="pt-4"
		>
			<div className="px-gutter">
				<SectionLabel>watching</SectionLabel>
			</div>
			<Stack className="pt-3">
				{last === undefined ? (
					<Meta className="block border-t border-border px-gutter py-4">
						Nothing running. Waiting for the next tick.
					</Meta>
				) : (
					<LastRun row={last} />
				)}
				{scheduled.length > 0 ? (
					<>
						<div className="px-gutter pt-4">
							<SectionLabel>retry</SectionLabel>
						</div>
						{scheduled.map((wake) => (
							<div
								key={`${wake.workKey ?? "session"}-${wake.inSeconds}`}
								className="flex items-baseline justify-between gap-3 border-t border-border px-gutter py-3"
							>
								<Meta tone="muted">
									↻ {wake.label ?? wake.workKey ?? "session"}
								</Meta>
								<Meta className="shrink-0 whitespace-nowrap">
									attempt {wake.attempt ?? "n/a"} · in {wake.inSeconds}s
									{wake.reason ? ` · ${wake.reason}` : ""}
								</Meta>
							</div>
						))}
					</>
				) : null}
			</Stack>
		</motion.div>
	);
}

function LastRun({
	row,
}: {
	row: ReturnType<typeof dashboardModelFrom>["completed"][number];
}) {
	const ok = row.tone === "ok";
	const message =
		row.message === "completed" || row.message === row.status
			? undefined
			: row.message;
	const right = ok
		? (row.meta ?? row.ago)
		: [
				row.status,
				...(message === undefined ? [] : [message]),
				row.meta ?? row.ago,
			].join(" · ");
	return (
		<div className="grid grid-cols-[3px_1fr_auto] items-center gap-x-4 border-t border-border px-gutter py-3">
			<Rail tone="outline" className="h-5" />
			<span className="truncate text-sm text-muted-foreground">
				{row.label}
			</span>
			<Meta className="shrink-0 whitespace-nowrap">
				<span className={ok ? "text-t3" : "text-destructive"}>
					{ok ? row.status : (message ?? row.status)}
				</span>{" "}
				· {right}
			</Meta>
		</div>
	);
}

// ─── session controls (quiet chrome) ─────────────────────────────────────

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

// ─── primitives ──────────────────────────────────────────────────────────

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

// esc → back. A control surface affordance: the depth is one keystroke away.
function useEsc(onEsc: () => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onEsc();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onEsc]);
}

// A live render clock, mirroring the TUI's syncLiveRenderTimer. The web only
// re-renders when the projection coalescer publishes — which stops when idle —
// so ages ("28s ago") and the watching schedule would freeze. This ticks `now`
// at the given interval so the view recomputes time-derived text in real time:
// 125ms when work is running (a smooth pulse), 1s when idle (the schedule).
function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = window.setInterval(() => setNow(Date.now()), intervalMs);
		return () => window.clearInterval(id);
	}, [intervalMs]);
	return now;
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
