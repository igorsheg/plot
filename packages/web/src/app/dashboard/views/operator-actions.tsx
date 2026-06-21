import type { OperatorAction } from "@plot/control/operator";
import type {
	AgentAttemptProjection,
	WorkItemProjection,
} from "@plot/control/projection";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	operatorActionTone,
	useDashboardActions,
	useDashboardMeta,
} from "../dashboard-context";
import { Meta } from "./layout";
import { OperatorActionDialog } from "./operator-action-dialog";

// Danger reads in the one accent: `--destructive` now aliases the accent, so
// `text-destructive` already renders in-accent (no red on the product surface).
function dangerClass(action: OperatorAction) {
	return action.tone === "danger" ? "text-destructive" : "";
}

// A single operator action. A plain action fires immediately; one that carries
// a `confirm` or `requiresComment` opens a Dialog instead of the old native
// window.confirm / window.prompt — the comment is captured with an input group,
// danger actions read in the accent tone.
function OperatorActionButton({
	action,
	item,
	sessionId,
	prominent,
}: {
	action: OperatorAction;
	item: WorkItemProjection;
	sessionId: string;
	prominent: boolean;
}) {
	const { performOperatorAction } = useDashboardActions();
	const { controllerBlockReason } = useDashboardMeta();
	const [pending, setPending] = useState(false);
	const [open, setOpen] = useState(false);
	const [comment, setComment] = useState("");
	const [commentError, setCommentError] = useState<string | undefined>();

	const disabledReason =
		action.disabledReason ?? controllerBlockReason ?? undefined;
	const needsDialog = action.confirm !== undefined || action.requiresComment;

	const run = async (withComment: string | undefined) => {
		setPending(true);
		try {
			await performOperatorAction({
				sessionId,
				workKey: item.workKey,
				actionId: action.id,
				comment: withComment,
			});
			setOpen(false);
			setComment("");
		} catch {
			// surfaced via state.mutationError
		} finally {
			setPending(false);
		}
	};

	const onConfirm = () => {
		if (action.requiresComment && comment.trim() === "") {
			setCommentError("A comment is required.");
			return;
		}
		void run(action.requiresComment ? comment : undefined);
	};

	return (
		<>
			<Button
				size="sm"
				variant={operatorActionTone(action)}
				className={cn(
					dangerClass(action),
					prominent && "font-medium",
					// `label` is extension-defined and unbounded — cap the button so a
					// long label truncates instead of stretching the wrapping row.
					"max-w-full",
				)}
				disabled={disabledReason !== undefined || pending}
				loading={pending}
				onClick={() => (needsDialog ? setOpen(true) : void run(undefined))}
			>
				<span className="min-w-0 truncate">{action.label}</span>
			</Button>

			{needsDialog ? (
				<OperatorActionDialog
					action={action}
					open={open}
					onOpenChange={setOpen}
					pending={pending}
					comment={comment}
					onCommentChange={(next) => {
						setComment(next);
						if (commentError) setCommentError(undefined);
					}}
					commentError={commentError}
					onConfirm={onConfirm}
				/>
			) : null}

			{disabledReason ? (
				// `disabledReason` is extension-defined — keep it on one truncating line
				// so a long reason can't widen the action row.
				<Meta className="min-w-0 max-w-full truncate">{disabledReason}</Meta>
			) : null}
		</>
	);
}

export function OperatorActionButtons({
	item,
	sessionId,
	prominent = false,
}: {
	item: WorkItemProjection;
	sessionId: string;
	prominent?: boolean;
}) {
	const actions = item.operatorActions ?? [];
	if (actions.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2">
			{actions.map((action) => (
				<OperatorActionButton
					key={action.id}
					action={action}
					item={item}
					sessionId={sessionId}
					prominent={prominent}
				/>
			))}
		</div>
	);
}

export function InterruptRunButton({
	item,
	attempt,
	sessionId,
}: {
	item: WorkItemProjection;
	attempt: AgentAttemptProjection;
	sessionId: string;
}) {
	const { interruptRun } = useDashboardActions();
	const { isController, controllerBlockReason } = useDashboardMeta();
	const runId = attempt.runId;
	return (
		<Button
			size="sm"
			variant="ghost"
			className="text-destructive"
			disabled={!isController}
			onClick={() => interruptRun({ sessionId, runId, workKey: item.workKey })}
		>
			Interrupt Agent Run
			{controllerBlockReason ? (
				<Meta className="ml-2">{controllerBlockReason}</Meta>
			) : null}
		</Button>
	);
}
