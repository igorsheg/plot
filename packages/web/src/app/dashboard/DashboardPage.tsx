import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { ListRow } from "@/components/ui/list-row";
import { Stat } from "@/components/ui/stat";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type {
	LoopSummary,
	PlotDashboardState,
	WorkItemSummary,
	WorkStatus,
} from "./dashboard-state";
import { mockDashboardState } from "./mock-dashboard-state";
import { RunningDot, STATUS_DOT } from "./status";

const accent = "text-amber-600 dark:text-amber-500";
const restingOrder: WorkStatus[] = ["backoff", "ready", "completed"];

const restingNote: Record<WorkStatus, (work: WorkItemSummary) => string> = {
	backoff: (work) => work.activity,
	ready: () => "queued",
	completed: (work) => work.activity,
	running: (work) => work.activity,
	blocked: (work) => work.activity,
};

// Count the next wake down once a second, wrapping to the cadence on each tick.
// The interval genuinely needs an effect — it isn't render logic.
function useLoopCountdown(loop: LoopSummary) {
	const [remaining, setRemaining] = useState(loop.nextWakeSeconds);
	useEffect(() => {
		const id = window.setInterval(() => {
			setRemaining((value) => (value <= 1 ? loop.cadenceSeconds : value - 1));
		}, 1000);
		return () => window.clearInterval(id);
	}, [loop.cadenceSeconds]);
	return remaining;
}

export function DashboardPage({
	state = mockDashboardState,
}: {
	state?: PlotDashboardState;
}) {
	const remaining = useLoopCountdown(state.loop);
	const sinceTick = state.loop.cadenceSeconds - remaining;

	// One heartbeat beat per tick: derive a counter from a render-time ref compare
	// (no extra effect) and key the pulse element so it remounts and replays.
	const beatCount = useRef(0);
	const previousRemaining = useRef(remaining);
	if (remaining > previousRemaining.current) beatCount.current += 1;
	previousRemaining.current = remaining;

	// Resolved blocked items lift to page state so the card can animate out and
	// the heartbeat's "needs you" count drops — no external toast needed.
	const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
	const resolve = (id: string) => setResolved((prev) => new Set(prev).add(id));

	const needsYou = state.work.filter(
		(work) => work.status === "blocked" && !resolved.has(work.id),
	);
	const inFlight = state.work.filter((work) => work.status === "running");
	const resting = state.work
		.filter((work) => restingOrder.includes(work.status))
		.toSorted(
			(a, b) => restingOrder.indexOf(a.status) - restingOrder.indexOf(b.status),
		);

	return (
		<main className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 pb-16">
				<TopBar workflowPath={state.session.workflowPath} />
				<div className="flex flex-1 flex-col gap-10 py-12 md:py-16">
					<Heartbeat
						beatKey={beatCount.current}
						inFlight={inFlight.length}
						needsYou={needsYou.length}
						remaining={remaining}
						sessionState={state.session.state}
					/>
					<NeedsYou items={needsYou} onResolve={resolve} />
					{inFlight.length > 0 ? <InFlight items={inFlight} /> : null}
					{resting.length > 0 ? <Resting items={resting} /> : null}
				</div>
				<Footer
					loop={state.loop}
					sinceTick={sinceTick}
					sources={state.sources}
				/>
			</div>
		</main>
	);
}

function TopBar({ workflowPath }: { workflowPath: string }) {
	return (
		<div className="flex items-center justify-between py-5 text-[12px] text-muted-foreground">
			<span className="font-medium text-foreground">plot</span>
			<span>{workflowPath}</span>
		</div>
	);
}

function Heartbeat({
	beatKey,
	inFlight,
	needsYou,
	remaining,
	sessionState,
}: {
	beatKey: number;
	inFlight: number;
	needsYou: number;
	remaining: number;
	sessionState: string;
}) {
	return (
		<section className="flex flex-col items-center gap-5 text-center">
			<Pulse beatKey={beatKey} />
			<div className="flex flex-col items-center gap-1">
				<p className="text-[13px] text-muted-foreground">{sessionState}</p>
				<h1 className="text-4xl font-semibold">
					next act in <span className="tabular-nums">{remaining}s</span>
				</h1>
			</div>
			<div className="flex items-center gap-4">
				<Stat>
					<Stat.Value>{inFlight}</Stat.Value>
					<Stat.Label>in flight</Stat.Label>
				</Stat>
				<span className="h-3 w-px bg-border" aria-hidden />
				<Stat>
					<Stat.Value className={cn(needsYou > 0 && accent)}>
						{needsYou}
					</Stat.Value>
					<Stat.Label className={cn(needsYou > 0 && accent)}>
						needs you
					</Stat.Label>
				</Stat>
			</div>
		</section>
	);
}

function Pulse({ beatKey }: { beatKey: number }) {
	return (
		<span className="relative flex size-2.5 items-center justify-center">
			<span
				key={beatKey}
				aria-hidden
				className="pulse-beat absolute size-full rounded-full bg-foreground"
			/>
			<span className="relative size-1.5 rounded-full bg-foreground" />
		</span>
	);
}

function SectionLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			className={cn(
				"mb-3 text-[12px] font-medium text-muted-foreground",
				className,
			)}
		>
			{children}
		</p>
	);
}

function NeedsYou({
	items,
	onResolve,
}: {
	items: WorkItemSummary[];
	onResolve: (id: string) => void;
}) {
	return (
		<AnimatePresence initial={false}>
			{items.length > 0 ? (
				<motion.section
					key="needs-you"
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					exit={{ opacity: 0, height: 0 }}
					transition={{ ...spring.moderate, bounce: 0 }}
					className="overflow-hidden"
				>
					<SectionLabel className={accent}>needs you</SectionLabel>
					<div className="flex flex-col gap-3">
						<AnimatePresence initial={false}>
							{items.map((item) => (
								<motion.div
									key={item.id}
									layout
									initial={{ opacity: 0, y: 8 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, scale: 0.97 }}
									transition={spring.moderate}
								>
									<NeedsCard item={item} onResolve={onResolve} />
								</motion.div>
							))}
						</AnimatePresence>
					</div>
				</motion.section>
			) : null}
		</AnimatePresence>
	);
}

function NeedsCard({
	item,
	onResolve,
}: {
	item: WorkItemSummary;
	onResolve: (id: string) => void;
}) {
	return (
		<Card>
			<Card.Header>
				<div className="flex items-center justify-between gap-3">
					<p className="text-[13px] font-medium">{item.title}</p>
					<Badge variant="dot" color="amber" size="sm">
						blocked
					</Badge>
				</div>
			</Card.Header>
			<Card.Body>
				<p className="text-[13px] text-muted-foreground">{item.reason}</p>
				<p className="mt-2 truncate text-[12px] text-muted-foreground">
					{item.key}
				</p>
			</Card.Body>
			<Card.Footer>
				<Button
					size="sm"
					leadingIcon={Check}
					onClick={() => onResolve(item.id)}
				>
					Approve
				</Button>
				<Button size="sm" variant="ghost" onClick={() => onResolve(item.id)}>
					Hold
				</Button>
			</Card.Footer>
		</Card>
	);
}

function InFlight({ items }: { items: WorkItemSummary[] }) {
	return (
		<section>
			<SectionLabel>in flight</SectionLabel>
			<div className="flex flex-col divide-y divide-border">
				{items.map((item) => (
					<ListRow key={item.id}>
						<ListRow.Leading>
							<RunningDot />
						</ListRow.Leading>
						<ListRow.Body>
							<ListRow.Title>{item.title}</ListRow.Title>
							<ListRow.Subtitle>{item.activity}</ListRow.Subtitle>
						</ListRow.Body>
						{item.runId == null ? null : (
							<ListRow.Trailing>{item.runId}</ListRow.Trailing>
						)}
					</ListRow>
				))}
			</div>
		</section>
	);
}

function Resting({ items }: { items: WorkItemSummary[] }) {
	return (
		<Disclosure>
			<Disclosure.Trigger>
				<span>
					<span className="tabular-nums">{items.length}</span> resting
				</span>
			</Disclosure.Trigger>
			<Disclosure.Panel>
				<div className="mt-1 flex flex-col divide-y divide-border">
					{items.map((item) => {
						const StatusDot = STATUS_DOT[item.status];
						return (
							<ListRow key={item.id}>
								<ListRow.Leading>
									<StatusDot />
								</ListRow.Leading>
								<ListRow.Body>
									<ListRow.Title className="text-muted-foreground">
										{item.title}
									</ListRow.Title>
								</ListRow.Body>
								<ListRow.Trailing>
									{restingNote[item.status](item)}
								</ListRow.Trailing>
							</ListRow>
						);
					})}
				</div>
			</Disclosure.Panel>
		</Disclosure>
	);
}

function Footer({
	loop,
	sinceTick,
	sources,
}: {
	loop: LoopSummary;
	sinceTick: number;
	sources: PlotDashboardState["sources"];
}) {
	const blockedSources = sources.filter(
		(source) => source.status === "blocked",
	).length;
	const parts: Array<{ label: string; value: string }> = [
		{ label: "last tick", value: `${sinceTick}s ago` },
		{ label: "observed", value: String(loop.observations) },
		{ label: "selected", value: String(loop.selected) },
		{ label: "dispatched", value: String(loop.dispatched) },
		{ label: "deferred", value: String(loop.deferred) },
		{
			label: "sources",
			value:
				blockedSources > 0
					? `${sources.length} · ${blockedSources} blocked`
					: String(sources.length),
		},
	];
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-5">
			{parts.map((part) => (
				<Stat key={part.label}>
					<Stat.Label className="text-[12px]">{part.label}</Stat.Label>
					<Stat.Value className="text-[12px]">{part.value}</Stat.Value>
				</Stat>
			))}
		</div>
	);
}
