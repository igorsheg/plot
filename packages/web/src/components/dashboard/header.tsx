import { useCallback } from "react";
import { RefreshCwIcon } from "lucide-react";
import { StatusDot } from "./status-dot";
import { useRuntimeState, useTriggerRefresh } from "@/lib/hooks";
import { useEventStream } from "@/lib/use-event-stream";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipTrigger,
	TooltipPopup,
	TooltipProvider,
} from "@/components/ui/tooltip";

export function Header() {
	const { data: snapshot } = useRuntimeState();
	const refresh = useTriggerRefresh();
	const { status: sseStatus } = useEventStream();
	const counts = snapshot?.counts;
	const handleRefresh = useCallback(() => {
		refresh.mutate();
	}, [refresh]);

	return (
		<header className="header-surface">
			<div className="header-shell">
				<div className="min-w-0">
					<h1 className="type-title">plot</h1>
					<p className="type-meta">
						{counts
							? `${counts.running} active${counts.retrying > 0 ? ` · ${counts.retrying} needs attention` : ""}`
							: "loading status"}
					</p>
				</div>
				<div className="cluster-shell-lg">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger className="type-meta cluster-shell">
								<StatusDot status={sseStatus} className="size-2" />
								<span className="capitalize">{sseStatus}</span>
							</TooltipTrigger>
							<TooltipPopup>stream {sseStatus}</TooltipPopup>
						</Tooltip>
					</TooltipProvider>
					<Button variant="ghost" size="icon-xs" onClick={handleRefresh}>
						<RefreshCwIcon />
					</Button>
				</div>
			</div>
		</header>
	);
}
