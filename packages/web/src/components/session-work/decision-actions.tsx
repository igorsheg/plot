/**
 * The operator-action row for a blocked decision. One source of truth: it
 * renders in the river's `DecisionRow` AND the drawer's decision body, so the
 * comment box, confirm-title arming, and dispatch behave identically in both.
 * It takes only the `DecisionActionTarget` slice it needs and reads `act` from
 * the session-work context.
 */

import { useRef, useState } from "react";
import { Button } from "../ui/button.js";
import Stack from "../ui/stack.js";
import { useSessionWork } from "./context.js";
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
		actions.act({
			sourceId: target.sourceId,
			workKey: target.workKey,
			actionId: action.id,
			actionLabel: action.label,
			comment: trimmed === "" ? undefined : trimmed,
		});
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
		<Stack alignCenter gap={8} style={{ paddingTop: 4 }} wrap>
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
					variant={
						action.tone === "danger" ? "secondary-destructive" : "outline"
					}
				>
					{confirmingId === action.id && action.confirmTitle !== undefined
						? action.confirmTitle
						: action.label}
				</Button>
			))}
			{commentOpen ? (
				<input
					className="h-6.5 min-w-40 rounded-md bg-transparent px-2 text-sm text-kumo-default ring ring-kumo-line focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/50"
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
