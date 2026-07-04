import { isRecord } from "@plot/common/primitives";
import type {
	ActivityKind,
	AttemptStage,
	WorkItemProjection,
} from "@plot/session/projection";
import { Badge } from "@astryxdesign/core/Badge";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import clsx from "clsx";
import { createContext, use } from "react";
import type { ComponentProps, ReactNode } from "react";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import type { CompletedLaneItem, WorkLaneItem } from "./lanes.js";

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

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>["variant"]>;

export const stageVariant: Record<AttemptStage, BadgeVariant> = {
	starting: "neutral",
	working: "blue",
	verifying: "yellow",
	finishing: "green",
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

function GrayBadge({ label }: { readonly label: ReactNode }) {
	return (
		<Badge
			variant="neutral"
			label={<span className="plot-badge-label">{label}</span>}
			className="plot-badge-gray"
		/>
	);
}

export function MetaRow({ children }: { readonly children: ReactNode }) {
	return <div className="plot-meta">{children}</div>;
}

function Frame({
	children,
	className,
	item,
	selected,
	variant,
}: {
	readonly children: ReactNode;
	readonly className?: string | undefined;
	readonly item: WorkLaneItem;
	readonly selected?: boolean | undefined;
	readonly variant?:
		| NonNullable<ComponentProps<typeof ClickableCard>["variant"]>
		| undefined;
}) {
	return (
		<WorkCardContext value={item}>
			<ClickableCard
				href={workItemHref(item.work.workKey)}
				label={item.work.title}
				padding={3}
				variant={variant ?? "default"}
				aria-current={selected === true ? "true" : undefined}
				className={clsx(
					"plot-card",
					selected === true && "plot-card-selected",
					className,
				)}
				style={{ viewTransitionName: viewTransitionName(item.work.workKey) }}
			>
				<VStack gap={1.5}>{children}</VStack>
			</ClickableCard>
		</WorkCardContext>
	);
}

function Header() {
	const { work } = useWorkItem();
	return (
		<HStack gap={2} justify="between" align="start">
			<Text
				type="body"
				weight="medium"
				maxLines={1}
				className="plot-card-title"
			>
				{work.title}
			</Text>
			<GrayBadge label={work.sourceId} />
		</HStack>
	);
}

function Subtitle() {
	const { work } = useWorkItem();
	if (work.subtitle === undefined) return null;
	return (
		<Text as="p" type="supporting" maxLines={1}>
			{work.subtitle}
		</Text>
	);
}

function Activity() {
	const { attempt } = useWorkItem();
	if (attempt === undefined) return null;
	return (
		<HStack gap={1.5} align="center">
			<Badge variant={stageVariant[attempt.stage]} label={attempt.stage} />
			{attempt.streaming && (
				<StatusDot variant="success" isPulsing label="streaming" />
			)}
			<Text type="code" color="secondary" maxLines={1}>
				{kindGlyph[attempt.activityKind]} {attempt.activity}
			</Text>
		</HStack>
	);
}

function HeldReason() {
	const { work } = useWorkItem();
	if (work.blockedReason === undefined) return null;
	const waiting = work.status === "waiting";
	return (
		<HStack gap={1} align="center">
			{waiting && <Badge variant="neutral" label="waiting" />}
			<Text
				type="supporting"
				className={waiting ? undefined : "plot-warning-text"}
			>
				{work.blockedReason}
			</Text>
		</HStack>
	);
}

function OperatorActions() {
	const { work } = useWorkItem();
	const actions = workOperatorActions(work);
	if (actions.length === 0) return null;
	return (
		<HStack gap={1} wrap="wrap">
			{actions.map((action) => (
				<Badge
					key={action.id}
					variant={action.tone === "danger" ? "error" : "warning"}
					label={action.label}
				/>
			))}
		</HStack>
	);
}

function Meta() {
	const { work, attempt } = useWorkItem();
	const tokens = attempt?.tokens?.total ?? attempt?.tokens?.output;
	return (
		<MetaRow>
			{attempt !== undefined && (
				<>
					<Text type="code" color="secondary">
						{attempt.phases.map((phase) => kindGlyph[phase.kind]).join(" ")}
					</Text>
					<Text type="supporting">{attempt.turnCount} turns</Text>
					{tokens !== undefined && (
						<Text type="supporting">{formatTokens(tokens)} tok</Text>
					)}
					{attempt.check === "running" && (
						<Badge variant="blue" label="checking" />
					)}
					{attempt.check === "passed" && (
						<Badge variant="green" label="checks ✓" />
					)}
					{attempt.check === "failed" && (
						<Badge variant="error" label="checks ✗" />
					)}
				</>
			)}
			{work.labels.map((label) => (
				<GrayBadge key={label} label={label} />
			))}
		</MetaRow>
	);
}

const WorkCard = {
	Frame,
	Header,
	Subtitle,
	Activity,
	HeldReason,
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
			<WorkCard.HeldReason />
			{item.work.status === "waiting" && <WorkCard.OperatorActions />}
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
			className="plot-card-attention"
		>
			<WorkCard.Header />
			<WorkCard.Subtitle />
			<WorkCard.HeldReason />
			<WorkCard.OperatorActions />
			<WorkCard.Meta />
		</WorkCard.Frame>
	);
}

/** Done or failed work item that has no completed record yet. */
export function SettledCard({ item, selected }: WorkCardProps) {
	return (
		<WorkCard.Frame
			item={item}
			selected={selected}
			className="plot-card-settled"
		>
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
		<ClickableCard
			href={workItemHref(completed.workKey)}
			label={completed.label}
			padding={3}
			aria-current={selected === true ? "true" : undefined}
			className={clsx(
				"plot-card plot-card-settled",
				selected === true && "plot-card-selected",
			)}
			style={{ viewTransitionName: viewTransitionName(completed.workKey) }}
		>
			<VStack gap={1.5}>
				<HStack gap={2} justify="between" align="start">
					<Text
						type="body"
						weight="medium"
						maxLines={1}
						className="plot-card-title"
					>
						{completed.label}
					</Text>
					<Badge
						variant={failed ? "error" : "green"}
						label={completed.status}
					/>
				</HStack>
				{completed.message !== "" && (
					<Text type="supporting" maxLines={2}>
						{completed.message}
					</Text>
				)}
				<MetaRow>
					<Text type="supporting">{formatAgo(completed.atMs)} ago</Text>
					{completed.durationMs !== undefined && (
						<Text type="supporting">
							{formatDuration(completed.durationMs)}
						</Text>
					)}
					{completed.tokens?.total !== undefined && (
						<Text type="supporting">
							{formatTokens(completed.tokens.total)} tok
						</Text>
					)}
				</MetaRow>
			</VStack>
		</ClickableCard>
	);
}
