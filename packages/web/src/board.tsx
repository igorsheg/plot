import type { DashboardStatus } from "@plot/session/projection";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import clsx from "clsx";
import { useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { Inspector } from "./inspector.js";
import { deriveLanes } from "./lanes.js";
import type { PlotRun } from "./run.js";
import {
	ActingCard,
	CompletedCard,
	IncomingCard,
	NeedsYouCard,
	SettledCard,
} from "./work-card.js";

export interface BoardState {
	readonly loading: boolean;
	readonly error?: string | undefined;
	readonly live?: boolean | undefined;
	readonly projection?: WebDashboardProjection | undefined;
}

const isRunLive = (run: PlotRun): boolean =>
	run.status === "online" || run.status === "running";

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

const statusVariant: Record<DashboardStatus, BadgeVariant> = {
	starting: "blue",
	idle: "neutral",
	running: "green",
	shutting_down: "yellow",
	paused: "yellow",
	stopped: "neutral",
	error: "error",
};

const activityTone: Record<
	string,
	ComponentProps<typeof StatusDot>["variant"]
> = {
	ok: "success",
	bad: "error",
	info: "accent",
};

export const useHeartbeat = () => {
	const [, setBeat] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setBeat((beat) => beat + 1), 5000);
		return () => clearInterval(interval);
	}, []);
};

const parseWorkKeyHash = (): string | undefined => {
	const match = /^#wi=(.+)$/.exec(window.location.hash);
	return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
};

/** Selection lives in the URL hash: cards are links, back button closes. */
const useSelectedWorkKey = (): string | undefined => {
	const [key, setKey] = useState(parseWorkKeyHash);
	useEffect(() => {
		const onChange = () => setKey(parseWorkKeyHash());
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return key;
};

function Lane({
	children,
	count,
	title,
	tone,
}: {
	readonly children: ReactNode;
	readonly count: number;
	readonly title: string;
	readonly tone?: "attention" | undefined;
}) {
	const hot = tone === "attention" && count > 0;
	return (
		<section className={clsx("plot-lane", hot && "plot-lane-hot")}>
			<header className="plot-lane-header">
				<Text as="p" type="label" color="secondary" className="plot-lane-title">
					{title}
				</Text>
				<Badge variant={hot ? "warning" : "neutral"} label={String(count)} />
			</header>
			<div className="plot-lane-scroll">
				{count === 0 ? (
					<Text type="supporting" color="disabled">
						empty
					</Text>
				) : (
					children
				)}
			</div>
		</section>
	);
}

function BoardHeader({
	onStop,
	projection,
	run,
}: {
	readonly onStop: () => void;
	readonly projection: WebDashboardProjection | undefined;
	readonly run: PlotRun;
}) {
	const runtime = projection?.runtime;
	const nextWake = projection?.scheduledWakes
		.map((wake) => wake.dueAtMs)
		.toSorted((left, right) => left - right)[0];
	const facts = [
		runtime?.cwdName ?? run.cwdName ?? run.cwd,
		runtime?.model,
		runtime?.provider,
	].filter((fact) => fact !== undefined && fact !== "");
	return (
		<header className="plot-board-header">
			<div className="plot-fill">
				<div className="plot-row">
					<Text as="p" type="body" weight="semibold" maxLines={1}>
						{projection?.workflowName ?? run.workflowName ?? run.id}
					</Text>
					{projection !== undefined && (
						<Badge
							variant={statusVariant[projection.status]}
							label={projection.status}
						/>
					)}
				</div>
				<Text type="supporting" maxLines={1}>
					{facts.join(" · ")}
				</Text>
			</div>
			<div className="plot-header-metrics">
				{projection !== undefined && (
					<Text type="supporting">
						{formatTokens(projection.usageTotals.tokens)} tok
						{projection.usageTotals.cost !== undefined &&
							` · $${projection.usageTotals.cost.toFixed(2)}`}
					</Text>
				)}
				{nextWake !== undefined && (
					<Text type="supporting">
						{nextWake <= Date.now()
							? "wake due"
							: `next wake in ${formatDuration(nextWake - Date.now())}`}
					</Text>
				)}
			</div>
			{isRunLive(run) && (
				<Button
					label="Stop"
					size="sm"
					variant="secondary"
					onClick={() => {
						if (
							window.confirm(
								`Stop session "${projection?.workflowName ?? run.workflowName ?? run.id}"? Running agent work is interrupted.`,
							)
						)
							onStop();
					}}
				/>
			)}
		</header>
	);
}

/** The one thing a live dashboard must never do is silently go stale. */
function LivenessBanner({
	run,
	state,
}: {
	readonly run: PlotRun;
	readonly state: BoardState;
}) {
	if (state.projection === undefined) return null;
	if (!isRunLive(run)) {
		return (
			<div className="plot-strip">
				<div className="plot-stack-tight">
					<Text type="supporting">
						{run.status === "error"
							? "This session crashed · showing its last known state."
							: "This session has ended · showing its last known state."}
					</Text>
					<CrashDiagnostics run={run} />
				</div>
			</div>
		);
	}
	if (state.live === false) {
		return (
			<Banner
				status="warning"
				container="section"
				title="Live stream interrupted"
				description="Reconnecting… the board may lag behind the session."
			/>
		);
	}
	return null;
}

function ActivityStrip({
	projection,
}: {
	readonly projection: WebDashboardProjection;
}) {
	const latest = projection.activity[0] ?? projection.activity.at(-1);
	if (latest === undefined) return null;
	return (
		<div className="plot-strip plot-strip-row">
			<StatusDot
				variant={activityTone[latest.tone] ?? "neutral"}
				label={latest.tone}
			/>
			<Text type="supporting" maxLines={1}>
				{latest.text}
			</Text>
			<Text type="supporting" className="plot-right">
				{formatAgo(latest.atMs)} ago
			</Text>
		</div>
	);
}

/** A crashed session's last words; runs.json is the only other place they live. */
export function CrashDiagnostics({ run }: { readonly run: PlotRun }) {
	if (run.status !== "error" || (run.stderrTail ?? "") === "") return null;
	return (
		<div className="plot-crash">
			<CodeBlock
				code={run.stderrTail ?? ""}
				language="plaintext"
				size="sm"
				isWrapped
				maxHeight={192}
				width="100%"
				hasCopyButton={false}
			/>
		</div>
	);
}

export function NoLiveBoard({
	error,
	run,
}: {
	readonly error: string;
	readonly run: PlotRun;
}) {
	return (
		<div className="plot-center">
			<EmptyState
				title={run.status === "error" ? "Session crashed" : "No live board"}
				description={
					run.status === "online"
						? error
						: `This session is ${run.status} and left no recorded history.`
				}
			/>
			<CrashDiagnostics run={run} />
		</div>
	);
}

/** An idle board must read as "watching", not as "broken". */
function WatchingForWork({
	projection,
}: {
	readonly projection: WebDashboardProjection;
}) {
	const nextWake = projection.scheduledWakes
		.map((wake) => wake.dueAtMs)
		.toSorted((left, right) => left - right)[0];
	return (
		<div className="plot-center">
			<EmptyState
				title="Watching for work"
				description={`Sources scan on every tick; discovered Work Items appear here and flow through the lanes.${
					nextWake !== undefined && nextWake > Date.now()
						? ` Next scan in ${formatDuration(nextWake - Date.now())}.`
						: ""
				}`}
			/>
		</div>
	);
}

function LaneSkeletons() {
	return (
		<div className="plot-board-lanes">
			{[0, 1, 2, 3].map((index) => (
				<Skeleton key={index} height={160} width="100%" index={index} />
			))}
		</div>
	);
}

export function SessionBoard({
	onAction,
	onStop,
	run,
	state,
}: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly onStop: () => void;
	readonly run: PlotRun;
	readonly state: BoardState;
}) {
	useHeartbeat();
	const selectedKey = useSelectedWorkKey();
	const { projection } = state;
	const lanes = projection === undefined ? undefined : deriveLanes(projection);
	const boardEmpty =
		lanes !== undefined &&
		lanes.incoming.length === 0 &&
		lanes.acting.length === 0 &&
		lanes.needsYou.length === 0 &&
		lanes.done.length === 0;
	return (
		<div className="plot-board-shell">
			<BoardHeader onStop={onStop} projection={projection} run={run} />
			<LivenessBanner run={run} state={state} />
			{projection !== undefined && <ActivityStrip projection={projection} />}
			{state.error !== undefined && projection === undefined ? (
				<NoLiveBoard error={state.error} run={run} />
			) : boardEmpty && projection !== undefined ? (
				<WatchingForWork projection={projection} />
			) : (
				<div className="plot-main-row">
					<div className="plot-board">
						{lanes === undefined ? (
							<LaneSkeletons />
						) : (
							<div className="plot-board-lanes">
								<Lane title="Incoming" count={lanes.incoming.length}>
									{lanes.incoming.map((item) => (
										<IncomingCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane title="Acting" count={lanes.acting.length}>
									{lanes.acting.map((item) => (
										<ActingCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane
									tone="attention"
									title="Needs you"
									count={lanes.needsYou.length}
								>
									{lanes.needsYou.map((item) => (
										<NeedsYouCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane title="Done" count={lanes.done.length}>
									{lanes.done.map((item) =>
										item.kind === "work" ? (
											<SettledCard
												key={item.work.workKey}
												item={item}
												selected={item.work.workKey === selectedKey}
											/>
										) : (
											<CompletedCard
												key={`${item.completed.workKey}:${item.completed.atMs}`}
												item={item}
												selected={item.completed.workKey === selectedKey}
											/>
										),
									)}
								</Lane>
							</div>
						)}
					</div>
					{selectedKey !== undefined && projection !== undefined && (
						<Inspector
							onAction={onAction}
							onClose={() => {
								window.location.hash = "";
							}}
							projection={projection}
							sessionRunId={run.id}
							workKey={selectedKey}
						/>
					)}
				</div>
			)}
		</div>
	);
}
