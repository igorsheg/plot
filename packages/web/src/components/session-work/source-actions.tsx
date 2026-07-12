/**
 * The operator-action controls for a source requirement — the drawer twin of
 * `DecisionActions`. Mutable controls live in the detail drawer so the river
 * stays a scannable status surface. Source actions take no comment; while this
 * requirement's action is in flight the buttons collapse to a progress line and
 * a lone cancel, and `busy` disables the other requirements' buttons meanwhile
 * (source checks are single-flight — a second action must not be offered).
 */

import { useState } from "react";
import { Button } from "../ui/button.js";
import Stack from "../ui/stack.js";
import { Text } from "../ui/text.js";
import { useSessionWork } from "./context.js";
import { decisionActionsClass } from "./styles.js";
import type { OperatorActionView } from "./view-model.js";

export function SourceActions({
	sourceId,
	requirementId,
	actions: requirementActions,
	running,
	busy = false,
}: {
	readonly sourceId: string;
	readonly requirementId: string;
	readonly actions: readonly OperatorActionView[];
	readonly running?:
		| { readonly actionRunId: string; readonly progress?: string | undefined }
		| undefined;
	readonly busy?: boolean;
}) {
	const { actions } = useSessionWork();
	const [confirmingId, setConfirmingId] = useState<string | undefined>(
		undefined,
	);

	if (running !== undefined) {
		return (
			<Stack align="center" gap={8} className={decisionActionsClass()} wrap>
				<Text as="span" size="sm" variant="secondary">
					{running.progress ?? "Working…"}
				</Text>
				<Button
					disabled={actions.acting}
					onClick={() => actions.cancelSourceAction(running.actionRunId)}
					size="sm"
					variant="outline"
				>
					Cancel
				</Button>
			</Stack>
		);
	}

	const onAction = (action: OperatorActionView) => {
		if (action.confirmTitle !== undefined && confirmingId !== action.id) {
			setConfirmingId(action.id);
			return;
		}
		actions.actOnSource({ sourceId, requirementId, actionId: action.id });
		setConfirmingId(undefined);
	};

	return (
		<Stack align="center" gap={8} className={decisionActionsClass()} wrap>
			{requirementActions.map((action) => (
				<Button
					disabled={
						busy || actions.acting || action.disabledReason !== undefined
					}
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
		</Stack>
	);
}
