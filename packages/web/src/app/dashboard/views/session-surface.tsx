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
	useRef,
	useState,
	type ReactNode,
} from "react";

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
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { spring } from "@/lib/springs";
import { useSurface } from "@/lib/surface-context";
import { surfaceClasses } from "@/lib/surface-classes";
import { cn } from "@/lib/utils";
import {
	useProximityHover,
	useRegisterProximityItem,
} from "@/hooks/use-proximity-hover";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { throughputSeries } from "../throughput-series";
import { Row, SectionLabel, Stack } from "./layout";
import { InterruptRunButton, OperatorActionButtons } from "./operator-actions";

const data = "font-mono tabular-nums";

// The activity line is always one line: the agent stream can carry newlines in a
// message/tool delta, so collapse them to spaces before render — truncate clips.
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

// ─────────────────────────────────────────────────────────────────────────
// Plot web session surface — re-imagined as a control surface, not a dashboard.
//
// The room has two modes over the same column of work threads:
//   • fleet  — a column of live one-liners (one per work item). Proximity hover
//              previews where focus will land; weight-on-hover animates the
//              label; a thread that needs you elevates in-place with the action
//              right there. j/k moves selection, enter focuses.
//   • focus  — one thread's rolling-window trail owns the page (the depth),
//              spring-swapped in. esc returns to the fleet.
// Idle (no active work) is a different, sparser room: schedule + last run.
// Motion is information: every transition is a spring tier, never a duration.
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
	const model = useMemo(() => dashboardModelFrom(projection), [projection]);
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
		<Stack gap={3} className="px-6 pt-4">
			<PulseHeader
				workflowName={projection.workflowName}
				state={session?.state ?? projection.status}
				model={projection.runtime.model}
				cwdName={session?.cwdName}
				throughput={model.pulse.throughput.replace("tps", "tok/s")}
				tps={tps}
				totalTokens={model.pulse.totalTokens}
				totalCost={model.pulse.totalCost}
			/>
			<Row gap={4} className="justify-between pt-3">
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
			className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background px-6"
			onMouseEnter={() => setShowStats(true)}
			onMouseLeave={() => setShowStats(false)}
		>
			<span className="relative flex size-2 shrink-0">
				<span className="pulse-beat absolute inline-flex size-2 rounded-full bg-live" />
				<span className="relative inline-flex size-2 rounded-full bg-live" />
			</span>
			<h1 className="text-base font-medium tracking-[-0.01em]">
				{workflowName}
			</h1>
			<span className={cn("font-mono text-2xs text-t3", data)}>
				<span className="capitalize">{state}</span>
				{showStats && model ? ` · ${model}` : ""}
			</span>
			{showStats && cwdName ? (
				<span className="hidden truncate font-mono text-2xs text-t3 sm:inline">
					{cwdName}
				</span>
			) : null}
			<div className={cn("ml-auto flex items-center text-2xs text-t3", data)}>
				<span className="flex items-center gap-2">
					<Sparkline data={tps} />
					<span className="text-muted-foreground">{throughput}</span>
				</span>
				<AnimatePresence>
					{showStats ? (
						<motion.span
							key="stats"
							initial={{ opacity: 0, width: 0 }}
							animate={{ opacity: 1, width: "auto" }}
							exit={{ opacity: 0, width: 0 }}
							transition={spring.fast}
							className="overflow-hidden whitespace-nowrap"
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
		<span className={cn("font-mono text-2xs text-t3", data)}>
			<Divided>{parts}</Divided>
		</span>
	);
}

// ─── fleet column ────────────────────────────────────────────────────────
// A column of live one-liners. Proximity hover previews focus (the FF signature
// hover-as-preview, a spring-tracked background). Weight-on-hover animates the
// label via Inter's variable axis. A thread that needs you elevates in-place
// with the action inline. j/k selects, enter focuses.

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
	const containerRef = useRef<HTMLDivElement>(null);
	const shape = useShape();
	const substrate = useSurface();
	const indicatorLevel = Math.min(substrate + 2, 8);
	const { activeIndex, itemRects, handlers, registerItem } =
		useProximityHover(containerRef);
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

	const hoverRect = activeIndex !== null ? itemRects[activeIndex] : null;
	const selRect = itemRects[selected] ?? null;

	return (
		<Stack gap={3} className="pt-4">
			<SectionLabel count={work.length}>work</SectionLabel>
			<div
				ref={containerRef}
				tabIndex={0}
				onKeyDown={onKeyDown}
				onMouseMove={handlers.onMouseMove}
				onMouseEnter={handlers.onMouseEnter}
				onMouseLeave={handlers.onMouseLeave}
				className="relative flex flex-col outline-none"
			>
				{/* hover-as-preview background, spring-tracked to the hovered row */}
				{hoverRect ? (
					<motion.div
						aria-hidden
						className={cn("pointer-events-none absolute bg-hover", shape.bg)}
						initial={false}
						animate={{
							top: hoverRect.top,
							height: hoverRect.height,
							left: 0,
							right: 0,
							opacity: 1,
						}}
						transition={spring.moderate}
					/>
				) : null}
				{/* keyboard-selection rail */}
				{selRect ? (
					<motion.div
						aria-hidden
						className={cn(
							"pointer-events-none absolute",
							surfaceClasses(indicatorLevel),
							shape.bg,
						)}
						initial={false}
						animate={{
							top: selRect.top,
							height: selRect.height,
							left: 0,
							right: 0,
							opacity: activeIndex === null ? 1 : 0,
						}}
						transition={spring.moderate}
					/>
				) : null}
				<AnimatePresence initial={false}>
					{work.map((row, index) => (
						<ThreadRow
							key={row.work.workKey}
							row={row}
							index={index}
							sessionId={sessionId}
							registerItem={registerItem}
							hovered={activeIndex === index}
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
	registerItem,
	hovered,
	selected,
	onFocus,
	onSelect,
}: {
	row: WorkRowModel;
	index: number;
	sessionId: string;
	registerItem: (index: number, el: HTMLElement | null) => void;
	hovered: boolean;
	selected: boolean;
	onFocus: () => void;
	onSelect: () => void;
}) {
	const ref = useRef<HTMLButtonElement>(null);
	useRegisterProximityItem(registerItem, index, ref);
	const shape = useShape();
	const ChevronRight = useIcon("chevron-right");
	const attempt = row.attempt;
	const live = attempt?.streaming ?? false;
	const elevated = row.attention;
	const rail = elevated
		? "bg-attention"
		: row.stale
			? "bg-border"
			: live
				? "bg-live"
				: "bg-border";
	// weight-on-hover: the label thickens as the proximity hover approaches — the
	// FF ghost-span pattern, animating font-variation-settings (wght+opsz) so the
	// advance width barely moves.
	const weight =
		hovered || selected ? fontWeights.semibold : fontWeights.medium;

	return (
		<motion.div
			layout
			initial={{ opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -4 }}
			transition={spring.fast}
			className={cn("group relative", live && "bg-live/5")}
		>
			<button
				ref={ref}
				type="button"
				data-proximity-index={index}
				onClick={() => {
					onSelect();
					onFocus();
				}}
				className="grid w-full grid-cols-[3px_minmax(0,1fr)_auto_16px] items-center gap-x-4 px-6 py-4 text-left"
			>
				<span className={cn("h-6 w-[3px]", shape.item, rail)} />
				<div className="min-w-0">
					<span
						className="block truncate text-sm"
						style={{ fontVariationSettings: weight }}
					>
						{row.label}
					</span>
					<p
						className={cn(
							"mt-1 truncate font-mono text-2xs whitespace-nowrap",
							live ? "shimmer-text" : "text-t3",
							elevated && !live && "text-attention",
						)}
					>
						{oneLine(row.activity)}
					</p>
				</div>
				<div
					className={cn(
						"justify-self-end whitespace-nowrap font-mono text-2xs text-t3",
						(hovered || selected) && "opacity-100",
						!(hovered || selected) && "opacity-0",
					)}
				>
					{row.meta.length > 0 ? row.meta : null}
				</div>
				<ChevronRight
					size={14}
					className={cn(
						"text-t3 transition-opacity",
						hovered || selected ? "opacity-100" : "opacity-0",
					)}
				/>
			</button>
			{/* a thread that needs you: the action surfaces inline, springing in */}
			<AnimatePresence>
				{elevated ? (
					<motion.div
						key="act"
						initial={{ opacity: 0, height: 0 }}
						animate={{ opacity: 1, height: "auto" }}
						exit={{ opacity: 0, height: 0 }}
						transition={spring.moderate}
						className="overflow-hidden"
					>
						<Row gap={2} className="flex-wrap px-6 pb-4 pl-10">
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
		<div className="relative mt-2 border-y border-border bg-attention/5 px-6 py-4">
			<span className="absolute inset-y-0 left-0 w-0.5 bg-attention" />
			<div className={cn("mb-2 font-mono text-2xs text-attention", data)}>
				attention
			</div>
			<Stack gap={3}>
				{diagnostics.map((entry, index) => (
					<Row
						key={`${entry.workKey ?? "diag"}-${index}`}
						gap={3}
						className="flex-wrap justify-between"
					>
						<p className="min-w-0 font-mono text-2xs text-muted-foreground">
							{entry.text}
						</p>
					</Row>
				))}
			</Stack>
		</div>
	);
}

// ─── focus view ──────────────────────────────────────────────────────────
// One thread owns the page: its rolling-window trail on an elevated surface,
// the operator action as a single contextual gesture. esc / ← all work returns.

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
	const ChevronRight = useIcon("chevron-right");
	const ChevronLeft = useIcon("arrow-left");
	useEsc(onBack);
	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: 8 }}
			transition={spring.moderate}
			className="pt-4"
		>
			<SectionLabel>{row.work.workKey}</SectionLabel>
			<div className="mt-3 grid grid-cols-[3px_1fr] gap-x-4 border-b border-border px-6 pb-4">
				<span
					className={cn(
						"h-8 w-[3px] rounded-full",
						row.attention
							? "bg-attention"
							: attempt?.streaming
								? "bg-live"
								: "bg-border",
					)}
				/>
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">{row.label}</span>
						<ChevronRight size={13} className="text-t3" />
					</div>
					<p
						className={cn(
							"mt-1 truncate font-mono text-2xs",
							attempt?.streaming ? "shimmer-text" : "text-t3",
						)}
					>
						{row.activity}
					</p>
				</div>
			</div>

			<div className="px-6 pt-4">
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
			<div className="px-6 pt-4">
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-1 font-mono text-2xs text-t3 transition-colors hover:text-foreground"
				>
					<ChevronLeft size={13} /> all work
				</button>
			</div>
		</motion.div>
	);
}

// ─── trail (bottom-anchored rolling window) ──────────────────────────────
// Newest at the bottom, live "now" pinned last; fixed-width age track so ages
// tick in place; stable keys so React reuses DOM across coalesced frames.

const trailWindow = 9;

function Trail({ row }: { row: WorkRowModel }) {
	const attempt = row.attempt;
	if (attempt === undefined)
		return <p className="font-mono text-2xs text-t3">No activity yet.</p>;
	const history = [...attempt.timeline]
		.toSorted((a, b) => a.atMs - b.atMs)
		.slice(-trailWindow);
	if (history.length === 0 && !attempt.streaming)
		return <p className="font-mono text-2xs text-t3">No activity yet.</p>;
	return (
		<Stack gap={3} className="mb-4">
			<div className={cn("font-mono text-2xs text-t3", data)}>
				timeline · {attempt.meaningfulCount} of {attempt.eventCount} events
			</div>
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
			<SectionLabel>watching</SectionLabel>
			<Stack className="pt-3">
				{last === undefined ? (
					<p className="border-t border-border px-6 py-4 font-mono text-2xs text-t3">
						Nothing running. Waiting for the next tick.
					</p>
				) : (
					<LastRun row={last} />
				)}
				{scheduled.length > 0 ? (
					<>
						<div className="px-6 pt-4">
							<SectionLabel>retry</SectionLabel>
						</div>
						{scheduled.map((wake) => (
							<div
								key={`${wake.workKey ?? "session"}-${wake.inSeconds}`}
								className="flex items-baseline justify-between gap-3 border-t border-border px-6 py-3"
							>
								<span className="font-mono text-2xs text-muted-foreground">
									↻ {wake.label ?? wake.workKey ?? "session"}
								</span>
								<span
									className={cn(
										"shrink-0 whitespace-nowrap font-mono text-2xs text-t3",
										data,
									)}
								>
									attempt {wake.attempt ?? "n/a"} · in {wake.inSeconds}s
									{wake.reason ? ` · ${wake.reason}` : ""}
								</span>
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
		<div className="grid grid-cols-[3px_1fr_auto] items-center gap-x-4 border-t border-border px-6 py-3">
			<span className="h-5 w-[3px] rounded-full bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]" />
			<span className="truncate text-sm text-muted-foreground">
				{row.label}
			</span>
			<span
				className={cn(
					"shrink-0 whitespace-nowrap font-mono text-2xs text-t3",
					data,
				)}
			>
				<span className={ok ? "text-t3" : "text-destructive"}>
					{ok ? row.status : (message ?? row.status)}
				</span>{" "}
				· {right}
			</span>
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
				<Switch
					label={paused ? "Paused" : "Running"}
					checked={!paused}
					disabled={!isController || stopped}
					onToggle={() =>
						mutateSession(
							sessionId,
							paused ? "resume_session" : "pause_session",
						)
					}
				/>
				<Button
					size="sm"
					variant="tertiary"
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
				{controllerBlockReason ? (
					<span className="font-mono text-2xs text-t3">
						{controllerBlockReason}
					</span>
				) : null}
				{mutationError ? (
					<span className="font-mono text-2xs text-destructive">
						{mutationError}
					</span>
				) : null}
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
							variant="tertiary"
							onClick={() => setCloseOpen(false)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="primary"
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

function SnapshotUnavailable({
	lastError,
}: {
	lastError?: string | undefined;
}) {
	return (
		<Stack gap={2} className="px-6 py-4">
			<p className="font-mono text-2xs text-t3">
				Snapshot unavailable for this Plot Session.
			</p>
			{lastError ? (
				<p className="font-mono text-2xs text-t3">{lastError}</p>
			) : null}
		</Stack>
	);
}
