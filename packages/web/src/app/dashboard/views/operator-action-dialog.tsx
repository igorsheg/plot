import type { OperatorAction } from "@plot/control/operator";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";

// The confirm/comment Dialog for an operator action, extracted so the Room
// action rows (and anywhere else) can reuse it without rebuilding the markup.
// The 420px width / scrim come from the coss `DialogContent`; this is not a
// hand-rolled modal. Title/message derive from `action.confirm`; the comment
// is captured with a required-validation input group. Danger reads in the one
// accent — `--destructive` now aliases the accent, so no special red here.
export function OperatorActionDialog({
	action,
	open,
	onOpenChange,
	pending,
	comment,
	onCommentChange,
	commentError,
	onConfirm,
}: {
	action: OperatorAction;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	pending: boolean;
	comment: string;
	onCommentChange: (comment: string) => void;
	commentError: string | undefined;
	onConfirm: () => void;
}): React.ReactElement {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{action.confirm?.title ?? action.label}</DialogTitle>
					{action.confirm?.message ? (
						<DialogDescription>{action.confirm.message}</DialogDescription>
					) : null}
				</DialogHeader>
				{action.requiresComment ? (
					<div className="px-6">
						<label className="mb-1 block text-sm text-muted-foreground">
							Comment
						</label>
						<InputGroup>
							<InputGroupInput
								value={comment}
								aria-invalid={commentError !== undefined}
								onChange={(e) => onCommentChange(e.target.value)}
							/>
						</InputGroup>
						{commentError ? (
							<p className="mt-1 text-sm text-destructive">{commentError}</p>
						) : null}
					</div>
				) : null}
				<DialogFooter>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						variant="default"
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
	);
}
