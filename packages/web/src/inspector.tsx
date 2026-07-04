import type {
	SerializedAgentAttemptProjection,
	TimelineEntry,
	WorkItemProjection,
} from "@plot/session/projection";
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Link } from "@astryxdesign/core/Link";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { TranscriptView } from "./transcript-view.js";
import {
	kindGlyph,
	stageVariant,
	workOperatorActions,
	type WorkOperatorAction,
} from "./work-card.js";

/** Display-side tail of a turn-scoped stream; the reducer owns the real window. */
const streamTail = (text: string): string =>
	text.length > 2000 ? `…${text.slice(-2000)}` : text;

/** Follow the tail of a growing log unless the operator scrolled back up. */
const useTailFollow = (dep: unknown) => {
	const ref = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	useEffect(() => {
		const element = ref.current;
		if (element !== null && stick.current)
			element.scrollTop = element.scrollHeight;
	}, [dep]);
	const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		stick.current =
			element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
	};
	return { ref, onScroll };
};

function Section({
	children,
	title,
	tone,
}: {
	readonly children: ReactNode;
	readonly title: string;
	readonly tone?: "attention" | undefined;
}) {
	return (
		<section
			className={clsx(
				"plot-section",
				tone === "attention" && "plot-section-hot",
			)}
		>
			<VStack gap={1.5}>
				<Text type="label" color="secondary" className="plot-lane-title">
					{title}
				</Text>
				{children}
			</VStack>
		</section>
	);
}

function Fact({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="plot-fact">
			<Text type="supporting" size="3xs" className="plot-fact-label">
				{label}
			</Text>
			<Text type="supporting" maxLines={1} color="primary">
				{children}
			</Text>
		</div>
	);
}

type ButtonVariant = NonNullable<ComponentProps<typeof Button>["variant"]>;

function GrayBadge({ label }: { readonly label: ReactNode }) {
	return (
		<Badge
			variant="neutral"
			label={<span className="plot-badge-label">{label}</span>}
			className="plot-badge-gray"
		/>
	);
}

/**
 * The agent's live voice in a fixed-height frame: the frame never resizes
 * while tokens stream, so nothing below it moves. Message wins over thinking
 * as the newer voice; the tool line lives in vitals and the timeline.
 */
function LiveVoice({
	streams,
}: {
	readonly streams: SerializedAgentAttemptProjection["streams"];
}) {
	// ponytail: hold the last turn's text dimmed so the window does not blink
	// empty at turn_end; bounded to one turn by the reducer's reset.
	const held = useRef({ label: "thinking", text: "" });
	const live =
		streams.message !== undefined && streams.message !== ""
			? { label: "message", text: streams.message }
			: streams.thinking !== undefined && streams.thinking !== ""
				? { label: "thinking", text: streams.thinking }
				: undefined;
	if (live !== undefined) held.current = live;
	const shown = live ?? held.current;
	const follow = useTailFollow(shown.text);
	return (
		<VStack gap={0.5}>
			<Text type="label" color="secondary" className="plot-lane-title">
				{shown.label}
				{live === undefined && shown.text !== "" && " · last turn"}
			</Text>
			<div
				ref={follow.ref}
				onScroll={follow.onScroll}
				className="plot-tail plot-tail-live"
			>
				<Text
					type="code"
					color="secondary"
					className={clsx("plot-stream", live === undefined && "plot-dim")}
				>
					{shown.text === ""
						? "waiting for the model…"
						: streamTail(shown.text)}
				</Text>
			</div>
		</VStack>
	);
}

function Timeline({ entries }: { readonly entries: readonly TimelineEntry[] }) {
	const follow = useTailFollow(entries.length);
	return (
		<div ref={follow.ref} onScroll={follow.onScroll} className="plot-tail">
			<ol className="plot-timeline">
				{entries.map((entry) => (
					<li key={`${entry.atMs}:${entry.text}`} className="plot-timeline-row">
						<Text type="code" color="secondary">
							{kindGlyph[entry.kind]}
						</Text>
						<Text type="supporting" maxLines={1} className="plot-fill">
							{entry.text}
						</Text>
						<Text type="supporting" hasTabularNumbers>
							{formatAgo(entry.atMs)}
						</Text>
					</li>
				))}
			</ol>
		</div>
	);
}

function AttemptSummaryRow({
	attempt,
}: {
	readonly attempt: SerializedAgentAttemptProjection;
}) {
	const tokens = attempt.tokens?.total ?? attempt.tokens?.output;
	return (
		<HStack gap={2} align="center">
			<Badge variant={stageVariant[attempt.stage]} label={attempt.stage} />
			<Text type="supporting" maxLines={1} className="plot-fill">
				{attempt.lastDisplay}
			</Text>
			<Text type="supporting">{attempt.turnCount} turns</Text>
			{tokens !== undefined && (
				<Text type="supporting">{formatTokens(tokens)} tok</Text>
			)}
			{attempt.lastEventAtMs !== undefined && (
				<Text type="supporting">{formatAgo(attempt.lastEventAtMs)} ago</Text>
			)}
		</HStack>
	);
}

const actionVariant = (tone: WorkOperatorAction["tone"]): ButtonVariant =>
	tone === "primary"
		? "primary"
		: tone === "danger"
			? "destructive"
			: "secondary";

interface SentAction {
	readonly atMs: number;
	readonly label: string;
	/** Work item fingerprint at send time; a change means the Source reconciled. */
	readonly fingerprint: string;
}

const workFingerprint = (work: WorkItemProjection): string =>
	`${work.status}:${work.version ?? ""}:${work.blockedReason ?? ""}`;

/** The reason the web exists: record a human decision, let the Source reconcile. */
function OperatorZone({
	onAction,
	work,
}: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly work: WorkItemProjection;
}) {
	const [pendingId, setPendingId] = useState<string>();
	const [status, setStatus] = useState<string>();
	const [sent, setSent] = useState<SentAction>();
	const actions = workOperatorActions(work);
	// The Source answered (status/version/reason moved): the decision is consumed.
	if (sent !== undefined && workFingerprint(work) !== sent.fingerprint) {
		setSent(undefined);
		setStatus(undefined);
	}
	const act = async (action: WorkOperatorAction) => {
		if (
			action.confirm !== undefined &&
			!window.confirm(
				[action.confirm.title, action.confirm.message]
					.filter((part) => part !== undefined)
					.join("\n"),
			)
		)
			return;
		let comment: string | undefined;
		if (action.requiresComment === true) {
			const value = window.prompt(`${action.label} — comment`);
			if (value === null || value.trim() === "") return;
			comment = value;
		}
		setPendingId(action.id);
		setStatus(undefined);
		try {
			const accepted = await onAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: action.id,
				actionLabel: action.label,
				clientId: crypto.randomUUID(),
				...(comment === undefined ? {} : { comment }),
			});
			if (accepted) {
				setSent({
					atMs: Date.now(),
					label: action.label,
					fingerprint: workFingerprint(work),
				});
			} else {
				setStatus("rejected · session queue is full, try again");
			}
		} catch (caught) {
			setStatus(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPendingId(undefined);
		}
	};
	const blocked = work.status === "blocked";
	return (
		<Section
			title={blocked ? "Needs you" : "Waiting"}
			tone={blocked ? "attention" : undefined}
		>
			{work.blockedReason !== undefined && (
				<Text
					type="supporting"
					className={blocked ? "plot-warning-text" : undefined}
				>
					{work.blockedReason}
				</Text>
			)}
			{sent !== undefined ? (
				<Text type="supporting">
					✓ {sent.label} recorded {formatAgo(sent.atMs)} ago · waiting for{" "}
					<Text type="code" color="secondary">
						{work.sourceId}
					</Text>{" "}
					to reconcile…
				</Text>
			) : (
				actions.length > 0 && (
					<HStack gap={1.5} wrap="wrap">
						{actions.map((action) => (
							<Button
								key={action.id}
								label={action.label}
								size="sm"
								variant={actionVariant(action.tone)}
								isLoading={pendingId === action.id}
								isDisabled={
									action.disabledReason !== undefined || pendingId !== undefined
								}
								{...(action.disabledReason === undefined
									? {}
									: { tooltip: action.disabledReason })}
								onClick={() => void act(action)}
							/>
						))}
					</HStack>
				)
			)}
			{status !== undefined && <Text type="supporting">{status}</Text>}
		</Section>
	);
}

export function Inspector({
	onAction,
	onClose,
	projection,
	sessionRunId,
	workKey,
}: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly onClose: () => void;
	readonly projection: WebDashboardProjection;
	readonly sessionRunId: string;
	readonly workKey: string;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const work = projection.work[workKey];
	const attempts = Object.values(projection.attempts)
		.filter((attempt) => attempt.workKey === workKey)
		.toSorted((left, right) => right.startedAtSeq - left.startedAtSeq);
	const current = attempts[0];
	const history = attempts.slice(1);
	const completed = projection.completed.filter(
		(entry) => entry.workKey === workKey,
	);
	if (work === undefined && current === undefined && completed.length === 0) {
		return null;
	}

	const held = work?.status === "blocked" || work?.status === "waiting";

	const elapsedMs =
		current?.startedAtMs === undefined
			? undefined
			: (current.streaming
					? Date.now()
					: (current.lastEventAtMs ?? Date.now())) - current.startedAtMs;
	const workUrl = work?.url ?? completed[0]?.url;

	return (
		<aside
			aria-label="Work item inspector"
			role="complementary"
			className="plot-inspector"
		>
			<header className="plot-inspector-header">
				<div className="plot-fill">
					<HStack gap={2} align="center">
						<Text
							type="body"
							weight="semibold"
							maxLines={1}
							className="plot-card-title"
						>
							{work?.title ?? completed[0]?.label ?? workKey}
						</Text>
						{work !== undefined && <GrayBadge label={work.sourceId} />}
					</HStack>
					{work?.subtitle !== undefined && (
						<Text type="supporting" maxLines={1}>
							{work.subtitle}
						</Text>
					)}
					<div className="plot-meta">
						{workUrl !== undefined && (
							<Link href={workUrl} isExternalLink isStandalone>
								open
							</Link>
						)}
						{(work?.labels ?? []).map((label) => (
							<GrayBadge key={label} label={label} />
						))}
						<Text type="code" color="disabled" maxLines={1}>
							{workKey}
						</Text>
					</div>
				</div>
				<HStack gap={1.5} align="center">
					<Kbd keys="escape" />
					<IconButton
						label="Close"
						icon="✕"
						variant="ghost"
						size="sm"
						onClick={onClose}
					/>
				</HStack>
			</header>
			<div className="plot-scroll">
				{held && work !== undefined && (
					<OperatorZone onAction={onAction} work={work} />
				)}
				{current !== undefined && (
					<Section title="Agent run">
						{/* Fixed six-slot grid: unknown values render "—" so the grid never reflows mid-stream. */}
						<div className="plot-facts">
							<Fact label="stage">
								<Badge
									variant={stageVariant[current.stage]}
									label={current.stage}
								/>
							</Fact>
							<Fact label="elapsed">
								{elapsedMs === undefined ? "—" : formatDuration(elapsedMs)}
							</Fact>
							<Fact label="turns">{current.turnCount}</Fact>
							<Fact label="tokens">
								{current.tokens?.total === undefined
									? "—"
									: `${formatTokens(current.tokens.total)}${
											current.tokens.cost === undefined
												? ""
												: ` · $${current.tokens.cost.toFixed(2)}`
										}`}
							</Fact>
							<Fact label="check">{current.check}</Fact>
							<Fact label="live">
								{current.streaming ? (
									<HStack gap={1} align="center">
										<StatusDot variant="success" isPulsing label="streaming" />
										<Text type="supporting">streaming</Text>
									</HStack>
								) : (
									"idle"
								)}
							</Fact>
						</div>
					</Section>
				)}
				{current !== undefined && (
					<Section title="Now">
						<LiveVoice streams={current.streams} />
					</Section>
				)}
				{current !== undefined && current.timeline.length > 0 && (
					<Section title="Timeline">
						<Timeline entries={current.timeline} />
					</Section>
				)}
				{(history.length > 0 || completed.length > 0) && (
					<Section title="History">
						{completed.map((entry) => (
							<HStack
								gap={2}
								align="center"
								key={`${entry.workKey}:${entry.atMs}`}
							>
								<Badge
									variant={entry.status === "done" ? "green" : "error"}
									label={entry.status}
								/>
								<Text type="supporting" maxLines={1} className="plot-fill">
									{entry.message}
								</Text>
								{entry.durationMs !== undefined && (
									<Text type="supporting">
										{formatDuration(entry.durationMs)}
									</Text>
								)}
								<Text type="supporting">{formatAgo(entry.atMs)} ago</Text>
							</HStack>
						))}
						{history.map((attempt) => (
							<AttemptSummaryRow attempt={attempt} key={attempt.runId} />
						))}
					</Section>
				)}
				{/* While streaming, the Now pane and timeline already narrate;
				    the transcript is the retrospective record. */}
				{current?.transcript?.path !== undefined && !current.streaming && (
					<Section title="Agent transcript">
						<TranscriptView
							key={current.runId}
							attemptRunId={current.runId}
							path={current.transcript.path}
							runId={sessionRunId}
						/>
					</Section>
				)}
			</div>
		</aside>
	);
}
