import type { OperatorAction } from "@plot/control/operator";
import type {
	AgentAttemptProjection,
	WorkItemProjection,
} from "@plot/control/projection";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputField, InputGroup } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import {
	operatorActionTone,
	useDashboardActions,
	useDashboardMeta,
} from "../dashboard-context";

function dangerClass(action: OperatorAction) {
	return action.tone === "danger"
		? "border-destructive/40 text-destructive"
		: "";
}

// A single operator action. A plain action fires immediately; one that carries
// a `confirm` or `requiresComment` opens a Dialog (FF overlay) instead of the
// old native window.confirm / window.prompt — the comment is captured with an
// InputGroup field, danger actions read in the destructive tone.
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
				className={cn(dangerClass(action), prominent && "font-medium")}
				disabled={disabledReason !== undefined || pending}
				loading={pending}
				onClick={() => (needsDialog ? setOpen(true) : void run(undefined))}
			>
				{action.label}
			</Button>

			{needsDialog ? (
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{action.confirm?.title ?? action.label}</DialogTitle>
							{action.confirm?.message ? (
								<DialogDescription>{action.confirm.message}</DialogDescription>
							) : null}
						</DialogHeader>
						{action.requiresComment ? (
							<InputGroup>
								<InputField
									index={0}
									label="Comment"
									value={comment}
									onChange={(next) => {
										setComment(next);
										if (commentError) setCommentError(undefined);
									}}
									error={commentError}
								/>
							</InputGroup>
						) : null}
						<DialogFooter>
							<Button
								size="sm"
								variant="tertiary"
								onClick={() => setOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="primary"
								className={
									action.tone === "danger" ? "bg-destructive text-white" : ""
								}
								loading={pending}
								onClick={onConfirm}
							>
								{action.label}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : null}

			{disabledReason ? (
				<span className="text-xs text-muted-foreground">{disabledReason}</span>
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
				<span className="ml-2 text-muted-foreground">
					{controllerBlockReason}
				</span>
			) : null}
		</Button>
	);
}
