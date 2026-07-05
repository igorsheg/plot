import type { WorkItemProjection } from "@plot/session/projection";
import { useState } from "react";
import type { ObservationInput } from "./api.js";
import { Button } from "./components/ui/button.js";
import { formatAgo } from "./format.js";
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

/** The reason the web exists: record a human decision, let the Source reconcile. */
export function OperatorZoneBody({
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
		<>
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
			{sent !== undefined ? (
				<p className="text-xs text-muted-foreground">
					✓ {sent.label} recorded {formatAgo(sent.atMs)} ago · waiting for{" "}
					<span className="font-mono">{work.sourceId}</span> to reconcile…
				</p>
			) : (
				actions.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{actions.map((action) => (
							<Button
								key={action.id}
								size="sm"
								variant={actionVariant(action.tone)}
								className={
									action.tone === "danger"
										? "border-destructive/40 text-destructive-foreground"
										: undefined
								}
								disabled={
									action.disabledReason !== undefined || pendingId !== undefined
								}
								title={action.disabledReason}
								onClick={() => void act(action)}
							>
								{pendingId === action.id ? "…" : action.label}
							</Button>
						))}
					</div>
				)
			)}
			{status !== undefined && (
				<p className="text-xs text-muted-foreground">{status}</p>
			)}
		</>
	);
}

export function OperatorZone(props: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly work: WorkItemProjection;
}) {
	return <OperatorZoneBody {...props} />;
}
