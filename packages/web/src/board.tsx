import type { WebDashboardProjection } from "./api.js";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import type { PlotRun } from "./run.js";

export interface BoardState {
	readonly loading: boolean;
	readonly error?: string | undefined;
	readonly live?: boolean | undefined;
	readonly projection?: WebDashboardProjection | undefined;
}

export const isRunLive = (run: PlotRun): boolean =>
	run.status === "online" || run.status === "running";

/** A crashed session's last words; runs.json is the only other place they live. */
export function CrashDiagnostics({ run }: { readonly run: PlotRun }) {
	if (run.status !== "error" || (run.stderrTail ?? "") === "") return null;
	return (
		<pre className="max-h-48 max-w-xl overflow-y-auto rounded-md border border-destructive/30 bg-destructive/4 p-3 text-left font-mono text-xs whitespace-pre-wrap text-destructive-foreground">
			{run.stderrTail}
		</pre>
	);
}

/** The one thing a live dashboard must never do is silently go stale. */
export function LivenessBanner({
	run,
	state,
}: {
	readonly run: PlotRun;
	readonly state: BoardState;
}) {
	if (state.projection === undefined) return null;
	if (!isRunLive(run)) {
		return (
			<div className="space-y-1.5 border-b px-4 py-1.5">
				<p className="text-xs text-muted-foreground">
					{run.status === "error"
						? "This session crashed · showing its last known state."
						: "This session has ended · showing its last known state."}
				</p>
				<CrashDiagnostics run={run} />
			</div>
		);
	}
	if (state.live === false) {
		return (
			<p className="border-b bg-warning/8 px-4 py-1.5 text-xs text-warning-foreground">
				Live stream interrupted · reconnecting… the board may lag behind the
				session.
			</p>
		);
	}
	return null;
}

export function NoLiveBoard({
	error,
	run,
}: {
	readonly error: string;
	readonly run: PlotRun;
}) {
	return (
		<div className="grid flex-1 place-items-center">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>
						{run.status === "error" ? "Session crashed" : "No live board"}
					</EmptyTitle>
					<EmptyDescription>
						{run.status === "online"
							? error
							: `This session is ${run.status} and left no recorded history.`}
					</EmptyDescription>
				</EmptyHeader>
				<CrashDiagnostics run={run} />
			</Empty>
		</div>
	);
}
