/**
 * The operator-action controls for a blocked decision. Mutable controls live in
 * the detail drawer so the river stays a scannable status surface.
 */

import { useRef, useState } from "react";
import { Button } from "../ui/button.js";
import Stack from "../ui/stack.js";
import { useSessionWork } from "./context.js";
import { decisionActionsClass, decisionCommentInputClass } from "./styles.js";
import type { DecisionActionTarget } from "./detail-view-model.js";
import type { OperatorActionView } from "./view-model.js";

export function DecisionActions({
	target,
}: {
	readonly target: DecisionActionTarget;
}) {
	const { actions } = useSessionWork();
	const [comment, setComment] = useState("");
	const [commentOpen, setCommentOpen] = useState(false);
	const [confirmingId, setConfirmingId] = useState<string | undefined>(
		undefined,
	);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const focusOnMount = (element: HTMLInputElement | null) => {
		inputRef.current = element;
		element?.focus();
	};

	const send = (action: OperatorActionView) => {
		const trimmed = comment.trim();
		const input: Parameters<typeof actions.act>[0] = {
			sourceId: target.sourceId,
			workKey: target.workKey,
			actionId: action.id,
			actionLabel: action.label,
		};
		actions.act(trimmed === "" ? input : { ...input, comment: trimmed });
		setConfirmingId(undefined);
	};

	const onAction = (action: OperatorActionView) => {
		if (action.requiresComment && comment.trim() === "") {
			setCommentOpen(true);
			inputRef.current?.focus();
			return;
		}
		if (action.confirmTitle !== undefined && confirmingId !== action.id) {
			setConfirmingId(action.id);
			return;
		}
		send(action);
	};

	return (
		<Stack align="center" gap={8} className={decisionActionsClass()} wrap>
			{target.actions.map((action) => (
				<Button
					disabled={actions.acting || action.disabledReason !== undefined}
					key={action.id}
					onBlur={() => {
						if (confirmingId === action.id) setConfirmingId(undefined);
					}}
					onClick={() => onAction(action)}
					onKeyDown={(event) => {
						if (event.key === "Escape") setConfirmingId(undefined);
					}}
					size="sm"
					title={action.disabledReason}
					variant={action.tone === "danger" ? "destructive-outline" : "outline"}
				>
					{confirmingId === action.id && action.confirmTitle !== undefined
						? action.confirmTitle
						: action.label}
				</Button>
			))}
			{commentOpen ? (
				<input
					className={decisionCommentInputClass()}
					onChange={(event) => setComment(event.target.value)}
					placeholder="comment…"
					ref={focusOnMount}
					value={comment}
				/>
			) : (
				<Button onClick={() => setCommentOpen(true)} size="sm" variant="ghost">
					comment…
				</Button>
			)}
		</Stack>
	);
}
