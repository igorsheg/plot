import type { WorkItemProjection } from "@plot/session/projection";
import { useEffect, useRef, useState } from "react";
import { useActionQueue } from "./action-queue.js";
import type { ObservationInput } from "./api.js";
import { Button } from "./components/ui/button.js";
import { cn } from "./lib/utils.js";
import { useOptionalSession } from "./session-context.js";
import { useNow } from "./use-countdown.js";
import { workOperatorActions, type WorkOperatorAction } from "./work-card.js";

export const actionVariant = (
	tone: WorkOperatorAction["tone"],
): "default" | "outline" => (tone === "primary" ? "default" : "outline");

export interface SentAction {
	readonly atMs: number;
	readonly label: string;
	/** Work item fingerprint at send time; a change means the Source reconciled. */
	readonly fingerprint: string;
}

export const workFingerprint = (work: WorkItemProjection): string =>
	`${work.status}:${work.version ?? ""}:${work.blockedReason ?? ""}`;

const secondsLeft = (sendAtMs: number, nowMs: number): number =>
	Math.max(0, Math.ceil((sendAtMs - nowMs) / 1000));

const actionInput = (
	work: WorkItemProjection,
	action: WorkOperatorAction,
	comment: string | undefined,
): ObservationInput => ({
	sourceId: work.sourceId,
	workKey: work.workKey,
	actionId: action.id,
	actionLabel: action.label,
	...(comment === undefined ? {} : { comment }),
});

function HoldActionButton({
	action,
	disabled,
	onRun,
}: {
	readonly action: WorkOperatorAction;
	readonly disabled: boolean;
	readonly onRun: () => void;
}) {
	const [holding, setHolding] = useState(false);
	const timerRef = useRef<number | undefined>(undefined);
	const cancel = () => {
		window.clearTimeout(timerRef.current);
		timerRef.current = undefined;
		setHolding(false);
	};
	const start = () => {
		if (disabled) return;
		cancel();
		setHolding(true);
		timerRef.current = window.setTimeout(() => {
			setHolding(false);
			timerRef.current = undefined;
			onRun();
		}, 600);
	};
	return (
		<Button
			type="button"
			size="sm"
			variant={actionVariant(action.tone)}
			className={cn(
				"masthead-hold overflow-hidden",
				action.tone === "danger" &&
					"border-destructive/40 text-destructive-foreground",
			)}
			data-holding={holding ? "true" : "false"}
			disabled={disabled}
			title={action.disabledReason ?? action.confirm?.message}
			onPointerDown={start}
			onPointerCancel={cancel}
			onPointerLeave={cancel}
			onPointerUp={cancel}
		>
			<span className="relative z-10">Hold to {action.label}</span>
		</Button>
	);
}

function CommentComposer({
	action,
	onCancel,
	onSend,
}: {
	readonly action: WorkOperatorAction;
	readonly onCancel: () => void;
	readonly onSend: (comment: string) => void;
}) {
	const [comment, setComment] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => ref.current?.focus(), []);
	const send = () => {
		const value = comment.trim();
		if (value !== "") onSend(value);
	};
	return (
		<div className="space-y-1.5">
			<textarea
				ref={ref}
				className="min-h-20 w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
				placeholder={`${action.label} — comment`}
				value={comment}
				onChange={(event) => setComment(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						send();
					}
				}}
			/>
			<div className="flex items-center gap-1.5">
				<Button size="sm" onClick={send} disabled={comment.trim() === ""}>
					Send
				</Button>
				<Button size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<span className="text-xs text-muted-foreground">⌘Enter sends</span>
			</div>
		</div>
	);
}

/** The reason the web exists: record a human decision, let the Source reconcile. */
export function OperatorZoneBody({
	work,
}: {
	readonly work: WorkItemProjection;
}) {
	const queue = useActionQueue();
	const session = useOptionalSession()?.state;
	const scrubbing = session?.scrubbing ?? false;
	const nowMs = useNow();
	const [commentAction, setCommentAction] = useState<WorkOperatorAction>();
	const [status, setStatus] = useState<string>();
	const rootRef = useRef<HTMLDivElement>(null);
	const actions = workOperatorActions(work);
	const queued = queue.state.items.find(
		(action) => action.input.workKey === work.workKey,
	);
	const runAction = (action: WorkOperatorAction, comment?: string) => {
		queue.actions.enqueue(actionInput(work, action, comment));
		setCommentAction(undefined);
		setStatus(undefined);
	};
	const startAction = (action: WorkOperatorAction) => {
		if (
			scrubbing ||
			action.disabledReason !== undefined ||
			queued !== undefined
		)
			return;
		if (action.requiresComment === true) {
			setCommentAction(action);
			return;
		}
		if (action.confirm !== undefined) {
			// SPEC-GAP: keyboard `e` says fire primary action, but confirm actions
			// are hold-only deliberate judgment; pointer hold remains the only runner.
			setStatus("Hold to run.");
			return;
		}
		runAction(action);
	};
	useEffect(() => {
		const element = rootRef.current;
		if (element === null) return;
		const onQueueAction = (event: Event) => {
			const detail = (event as CustomEvent<{ readonly kind?: string }>).detail;
			const action =
				detail.kind === "comment"
					? actions.find(
							(item) =>
								item.requiresComment === true &&
								item.disabledReason === undefined,
						)
					: actions.find((item) => item.disabledReason === undefined);
			if (action !== undefined) startAction(action);
		};
		element.addEventListener("plot:queue-action", onQueueAction);
		return () =>
			element.removeEventListener("plot:queue-action", onQueueAction);
	}, [actions, queued]);
	const blocked = work.status === "blocked";
	return (
		<div ref={rootRef} className="space-y-1.5" data-operator-zone="true">
			{work.blockedReason !== undefined && (
				<p
					className={
						blocked
							? "text-xs text-warning-foreground"
							: "text-xs text-muted-foreground"
					}
				>
					{work.blockedReason}
				</p>
			)}
			{queued !== undefined && queued.status !== "failed" ? (
				<p className="text-xs text-muted-foreground">
					{queued.status === "pending" ? (
						<>
							✓ {queued.label} — undo (
							<span className="font-mono tabular-nums">
								{secondsLeft(queued.sendAtMs, nowMs)}
							</span>
							)
						</>
					) : queued.status === "sent" ? (
						<>
							✓ {queued.label} recorded · waiting for {work.sourceId} to
							reconcile…
						</>
					) : (
						<>recording {queued.label}…</>
					)}
				</p>
			) : (
				actions.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{actions.map((action) => {
							const disabled =
								scrubbing ||
								action.disabledReason !== undefined ||
								queued !== undefined;
							return action.confirm !== undefined ? (
								<HoldActionButton
									action={action}
									disabled={disabled}
									key={action.id}
									onRun={() => runAction(action)}
								/>
							) : (
								<Button
									key={action.id}
									size="sm"
									variant={actionVariant(action.tone)}
									className={
										action.tone === "danger"
											? "border-destructive/40 text-destructive-foreground"
											: undefined
									}
									disabled={disabled}
									title={action.disabledReason}
									onClick={() => startAction(action)}
								>
									{action.label}
								</Button>
							);
						})}
					</div>
				)
			)}
			{commentAction !== undefined && queued === undefined && (
				<CommentComposer
					action={commentAction}
					onCancel={() => setCommentAction(undefined)}
					onSend={(comment) => runAction(commentAction, comment)}
				/>
			)}
			{queued?.status === "failed" && (
				<p className="text-xs text-destructive-foreground">
					{queued.error ?? "failed"} · Retry from undo rail.
				</p>
			)}
			{status !== undefined && (
				<p className="text-xs text-muted-foreground">{status}</p>
			)}
		</div>
	);
}

export function OperatorZone(props: { readonly work: WorkItemProjection }) {
	return <OperatorZoneBody {...props} />;
}
