import { isRecord } from "@plot/common/primitives";
import type {
	ActivityKind,
	AttemptStage,
	WorkItemProjection,
} from "@plot/session/projection";
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

export const stageVariant: Record<AttemptStage, BadgeProps["variant"]> = {
	starting: "secondary",
	working: "info",
	verifying: "warning",
	finishing: "success",
	failed: "error",
};

/** Mirrors the sdk OperatorAction contract; Sources are trusted TypeScript. */
export interface WorkOperatorAction {
	readonly id: string;
	readonly label: string;
	readonly tone?: "primary" | "secondary" | "danger" | undefined;
	readonly disabledReason?: string | undefined;
	readonly requiresComment?: boolean | undefined;
	readonly confirm?:
		| { readonly title: string; readonly message?: string | undefined }
		| undefined;
}

export const workOperatorActions = (
	work: WorkItemProjection,
): readonly WorkOperatorAction[] =>
	(work.operatorActions ?? []).flatMap((value) => {
		if (!isRecord(value)) return [];
		const id = value["id"];
		const label = value["label"];
		if (typeof id !== "string" || typeof label !== "string") return [];
		const tone = value["tone"];
		const disabledReason = value["disabledReason"];
		const confirmValue = value["confirm"];
		const confirmTitle = isRecord(confirmValue)
			? confirmValue["title"]
			: undefined;
		const confirmMessage = isRecord(confirmValue)
			? confirmValue["message"]
			: undefined;
		return [
			{
				id,
				label,
				...(tone === "primary" || tone === "secondary" || tone === "danger"
					? { tone }
					: {}),
				...(typeof disabledReason === "string" ? { disabledReason } : {}),
				...(value["requiresComment"] === true ? { requiresComment: true } : {}),
				...(typeof confirmTitle === "string"
					? {
							confirm: {
								title: confirmTitle,
								...(typeof confirmMessage === "string"
									? { message: confirmMessage }
									: {}),
							},
						}
					: {}),
			},
		];
	});

/** Stable CSS custom-ident for per-card view transitions. */
export const viewTransitionName = (key: string): string => {
	let hash = 5381;
	for (const char of key) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
	return `wi-${hash.toString(36)}`;
};

export const workItemHref = (workKey: string): string =>
	`#wi=${encodeURIComponent(workKey)}`;

const WorkCardContext = createContext<WorkLaneItem | null>(null);

const useWorkItem = (): WorkLaneItem => {
	const item = use(WorkCardContext);
	if (item === null) throw new Error("WorkCard part outside WorkCard.Frame");
	return item;
};

export function MetaRow({ children }: { readonly children: ReactNode }) {
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
	selected,
}: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly item: WorkLaneItem;
	readonly selected?: boolean | undefined;
}) {
	return (
		<WorkCardContext value={item}>
			<a
				href={workItemHref(item.work.workKey)}
				aria-current={selected === true ? "true" : undefined}
				className={cn(
					"block space-y-1.5 rounded-md border bg-card p-2.5 shadow-xs hover:border-ring/60",
					selected === true && "ring-2 ring-ring",
					className,
				)}
				style={{ viewTransitionName: viewTransitionName(item.work.workKey) }}
			>
				{children}
			</a>
		</WorkCardContext>
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
	const actions = workOperatorActions(work);
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{actions.map((action) => (
				<Badge
					key={action.id}
					size="sm"
					variant={action.tone === "danger" ? "error" : "warning"}
				>
					{action.label}
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

const WorkCard = {
	Frame,
	Header,
	Subtitle,
	Activity,
	BlockedReason,
	OperatorActions,
	Meta,
};

export interface WorkCardProps {
	readonly item: WorkLaneItem;
	readonly selected?: boolean | undefined;
}

/** Discovered by a Source; no Agent Run yet. */
export function IncomingCard({ item, selected }: WorkCardProps) {
	return (
		<WorkCard.Frame item={item} selected={selected}>
			<WorkCard.Header />
			<WorkCard.Subtitle />
			<WorkCard.Meta />
		</WorkCard.Frame>
	);
}

/** An Agent Run is live; the inspector shows its timeline and streams. */
export function ActingCard({ item, selected }: WorkCardProps) {
	return (
		<WorkCard.Frame item={item} selected={selected}>
			<WorkCard.Header />
			<WorkCard.Subtitle />
			<WorkCard.Activity />
			<WorkCard.Meta />
		</WorkCard.Frame>
	);
}

/** Blocked on the operator: reason and declared Operator Actions up front. */
export function NeedsYouCard({ item, selected }: WorkCardProps) {
	return (
		<WorkCard.Frame
			item={item}
			selected={selected}
			className="border-warning/40 bg-warning/4"
		>
			<WorkCard.Header />
			<WorkCard.Subtitle />
			<WorkCard.BlockedReason />
			<WorkCard.OperatorActions />
			<WorkCard.Meta />
		</WorkCard.Frame>
	);
}

/** Done or failed work item that has no completed record yet. */
export function SettledCard({ item, selected }: WorkCardProps) {
	return (
		<WorkCard.Frame item={item} selected={selected} className="opacity-80">
			<WorkCard.Header />
			<WorkCard.Subtitle />
			<WorkCard.Meta />
		</WorkCard.Frame>
	);
}

/** Historical completion record; a different shape, not a work item view. */
export function CompletedCard({
	item,
	selected,
}: {
	readonly item: CompletedLaneItem;
	readonly selected?: boolean | undefined;
}) {
	const { completed } = item;
	const failed = completed.status !== "done";
	return (
		<a
			href={workItemHref(completed.workKey)}
			aria-current={selected === true ? "true" : undefined}
			className={cn(
				"block space-y-1.5 rounded-md border bg-card p-2.5 opacity-80 shadow-xs hover:border-ring/60",
				selected === true && "ring-2 ring-ring",
			)}
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
		</a>
	);
}
