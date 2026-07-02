import { isRecord } from "@plot/common/primitives";
import type { ActivityKind, AttemptStage } from "@plot/session/projection";
import { createContext, use } from "react";
import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "./components/ui/badge.js";
import { Dot } from "./components/ui/dot.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import type { CompletedLaneItem, WorkLaneItem } from "./lanes.js";
import { cn } from "./lib/utils.js";

export const kindGlyph: Record<ActivityKind, string> = {
	think: "✻",
	read: "⌗",
	edit: "✎",
	search: "⌕",
	run: "❯",
	test: "✓",
	finish: "⚑",
	message: "✉",
	wait: "◷",
};

const stageVariant: Record<AttemptStage, BadgeProps["variant"]> = {
	starting: "secondary",
	working: "info",
	verifying: "warning",
	finishing: "success",
	failed: "error",
};

const operatorActionLabel = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return undefined;
	const label =
		value["label"] ?? value["title"] ?? value["name"] ?? value["id"];
	return typeof label === "string" ? label : undefined;
};

/** Stable CSS custom-ident for per-card view transitions. */
const viewTransitionName = (key: string): string => {
	let hash = 5381;
	for (const char of key) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
	return `wi-${hash.toString(36)}`;
};

const WorkCardContext = createContext<WorkLaneItem | null>(null);

const useWorkItem = (): WorkLaneItem => {
	const item = use(WorkCardContext);
	if (item === null) throw new Error("WorkCard part outside WorkCard.Frame");
	return item;
};

function MetaRow({ children }: { readonly children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
			{children}
		</div>
	);
}

function Frame({
	children,
	className,
	item,
}: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly item: WorkLaneItem;
}) {
	return (
		<WorkCardContext value={item}>
			<details
				className={cn(
					"group rounded-md border bg-card p-2.5 shadow-xs open:shadow-sm",
					className,
				)}
				style={{ viewTransitionName: viewTransitionName(item.work.workKey) }}
			>
				{children}
			</details>
		</WorkCardContext>
	);
}

function Summary({ children }: { readonly children: ReactNode }) {
	return (
		<summary className="cursor-pointer select-none space-y-1.5 outline-none">
			{children}
		</summary>
	);
}

function Header() {
	const { work } = useWorkItem();
	return (
		<div className="flex items-start justify-between gap-2">
			<span className="min-w-0 truncate text-sm font-medium">{work.title}</span>
			<Badge size="sm" variant="outline" className="shrink-0">
				{work.sourceId}
			</Badge>
		</div>
	);
}

function Subtitle() {
	const { work } = useWorkItem();
	if (work.subtitle === undefined) return null;
	return (
		<p className="truncate text-xs text-muted-foreground">{work.subtitle}</p>
	);
}

function Activity() {
	const { attempt } = useWorkItem();
	if (attempt === undefined) return null;
	return (
		<div className="flex items-center gap-1.5 text-xs">
			<Badge size="sm" variant={stageVariant[attempt.stage]}>
				{attempt.stage}
			</Badge>
			{attempt.streaming && <Dot className="animate-pulse bg-success" />}
			<span className="truncate font-mono text-muted-foreground">
				{kindGlyph[attempt.activityKind]} {attempt.activity}
			</span>
		</div>
	);
}

function BlockedReason() {
	const { work } = useWorkItem();
	if (work.blockedReason === undefined) return null;
	return (
		<p className="text-xs text-warning-foreground">{work.blockedReason}</p>
	);
}

function OperatorActions() {
	const { work } = useWorkItem();
	const actions = (work.operatorActions ?? [])
		.map(operatorActionLabel)
		.filter((label) => label !== undefined);
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{actions.map((label) => (
				<Badge
					key={label}
					size="sm"
					variant="warning"
					title="Take this action from plot tui"
				>
					{label}
				</Badge>
			))}
		</div>
	);
}

function Meta() {
	const { work, attempt } = useWorkItem();
	const tokens = attempt?.tokens?.total ?? attempt?.tokens?.output;
	return (
		<MetaRow>
			{attempt !== undefined && (
				<>
					<span className="font-mono">
						{attempt.phases.map((phase) => kindGlyph[phase.kind]).join(" ")}
					</span>
					<span>{attempt.turnCount} turns</span>
					{tokens !== undefined && <span>{formatTokens(tokens)} tok</span>}
					{attempt.check === "running" && (
						<Badge size="sm" variant="info">
							checking
						</Badge>
					)}
					{attempt.check === "passed" && (
						<Badge size="sm" variant="success">
							checks ✓
						</Badge>
					)}
					{attempt.check === "failed" && (
						<Badge size="sm" variant="error">
							checks ✗
						</Badge>
					)}
				</>
			)}
			{work.labels.map((label) => (
				<Badge key={label} size="sm" variant="secondary">
					{label}
				</Badge>
			))}
		</MetaRow>
	);
}

function Detail() {
	const { attempt } = useWorkItem();
	if (attempt === undefined) return null;
	return (
		<div className="mt-2 space-y-2 border-t pt-2 text-xs">
			{attempt.timeline.length > 0 && (
				<ol className="space-y-0.5">
					{attempt.timeline.slice(-10).map((entry) => (
						<li
							key={`${entry.atMs}:${entry.text}`}
							className="flex gap-1.5 text-muted-foreground"
						>
							<span className="shrink-0 font-mono">
								{kindGlyph[entry.kind]}
							</span>
							<span className="min-w-0 flex-1 truncate">{entry.text}</span>
							<span className="shrink-0">{formatAgo(entry.atMs)}</span>
						</li>
					))}
				</ol>
			)}
			{(["thinking", "message", "tool"] as const).map((stream) => {
				const text = attempt.streams[stream];
				return text === undefined || text === "" ? null : (
					<p
						key={stream}
						className="line-clamp-3 font-mono text-muted-foreground"
					>
						{text}
					</p>
				);
			})}
			{attempt.observations.length > 0 && (
				<MetaRow>
					{attempt.observations.map((observation) => (
						<Badge key={observation} size="sm" variant="outline">
							{observation}
						</Badge>
					))}
				</MetaRow>
			)}
			{attempt.transcript?.path !== undefined && (
				<p className="truncate font-mono text-muted-foreground">
					{attempt.transcript.path}
				</p>
			)}
		</div>
	);
}

const WorkCard = {
	Frame,
	Summary,
	Header,
	Subtitle,
	Activity,
	BlockedReason,
	OperatorActions,
	Meta,
	Detail,
};

/** Discovered by a Source; no Agent Run yet. */
export function IncomingCard({ item }: { readonly item: WorkLaneItem }) {
	return (
		<WorkCard.Frame item={item}>
			<WorkCard.Summary>
				<WorkCard.Header />
				<WorkCard.Subtitle />
				<WorkCard.Meta />
			</WorkCard.Summary>
		</WorkCard.Frame>
	);
}

/** An Agent Run is live; expandable into its timeline and streams. */
export function ActingCard({ item }: { readonly item: WorkLaneItem }) {
	return (
		<WorkCard.Frame item={item}>
			<WorkCard.Summary>
				<WorkCard.Header />
				<WorkCard.Subtitle />
				<WorkCard.Activity />
				<WorkCard.Meta />
			</WorkCard.Summary>
			<WorkCard.Detail />
		</WorkCard.Frame>
	);
}

/** Blocked on the operator: reason and declared Operator Actions up front. */
export function NeedsYouCard({ item }: { readonly item: WorkLaneItem }) {
	return (
		<WorkCard.Frame item={item} className="border-warning/40 bg-warning/4">
			<WorkCard.Summary>
				<WorkCard.Header />
				<WorkCard.Subtitle />
				<WorkCard.BlockedReason />
				<WorkCard.OperatorActions />
				<WorkCard.Meta />
			</WorkCard.Summary>
			<WorkCard.Detail />
		</WorkCard.Frame>
	);
}

/** Done or failed work item that has no completed record yet. */
export function SettledCard({ item }: { readonly item: WorkLaneItem }) {
	return (
		<WorkCard.Frame item={item} className="opacity-80">
			<WorkCard.Summary>
				<WorkCard.Header />
				<WorkCard.Subtitle />
				<WorkCard.Meta />
			</WorkCard.Summary>
			<WorkCard.Detail />
		</WorkCard.Frame>
	);
}

/** Historical completion record; a different shape, not a work item view. */
export function CompletedCard({ item }: { readonly item: CompletedLaneItem }) {
	const { completed } = item;
	const failed = completed.status !== "done";
	return (
		<div
			className="space-y-1.5 rounded-md border bg-card p-2.5 opacity-80 shadow-xs"
			style={{ viewTransitionName: viewTransitionName(completed.workKey) }}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 truncate text-sm font-medium">
					{completed.label}
				</span>
				<Badge size="sm" variant={failed ? "error" : "success"}>
					{completed.status}
				</Badge>
			</div>
			{completed.message !== "" && (
				<p className="line-clamp-2 text-xs text-muted-foreground">
					{completed.message}
				</p>
			)}
			<MetaRow>
				<span>{formatAgo(completed.atMs)} ago</span>
				{completed.durationMs !== undefined && (
					<span>{formatDuration(completed.durationMs)}</span>
				)}
				{completed.tokens?.total !== undefined && (
					<span>{formatTokens(completed.tokens.total)} tok</span>
				)}
			</MetaRow>
		</div>
	);
}
