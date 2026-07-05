import { Button } from "./components/ui/button.js";
import { cn } from "./lib/utils.js";
import { useActionQueue, type QueuedAction } from "./action-queue.js";
import { useNow } from "./use-countdown.js";

const secondsLeft = (action: QueuedAction, nowMs: number): number =>
	Math.max(0, Math.ceil((action.sendAtMs - nowMs) / 1000));

function UndoToast({
	action,
	nowMs,
}: {
	readonly action: QueuedAction;
	readonly nowMs: number;
}) {
	const queue = useActionQueue();
	const failed = action.status === "failed";
	return (
		<div
			className={cn(
				"min-w-56 rounded-md border bg-background px-3 py-2 text-xs shadow-sm",
				failed && "border-destructive/40 text-destructive-foreground",
			)}
		>
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate">{action.label}</span>
				{action.status === "pending" && (
					<span className="font-mono tabular-nums text-muted-foreground">
						{secondsLeft(action, nowMs)}
					</span>
				)}
			</div>
			{action.status === "pending" && (
				<Button
					size="sm"
					variant="ghost"
					className="mt-1 h-auto px-0 py-0 text-xs"
					onClick={() => queue.actions.cancel(action.id)}
				>
					Undo
				</Button>
			)}
			{action.status === "sending" && (
				<p className="mt-1 text-muted-foreground">sending…</p>
			)}

			{failed && (
				<div className="mt-1 flex items-center gap-2">
					<span className="min-w-0 flex-1 truncate">
						{action.error ?? "failed"}
					</span>
					<Button
						size="sm"
						variant="ghost"
						className="h-auto px-0 py-0 text-xs text-destructive-foreground"
						onClick={() => queue.actions.retry(action.id)}
					>
						Retry
					</Button>
				</div>
			)}
		</div>
	);
}

export function UndoRail() {
	const queue = useActionQueue();
	const nowMs = useNow();
	if (queue.state.items.length === 0) return null;
	return (
		<div className="fixed right-4 bottom-4 z-50 space-y-2" aria-live="polite">
			{queue.state.items.map((action) => (
				<UndoToast action={action} key={action.id} nowMs={nowMs} />
			))}
		</div>
	);
}
