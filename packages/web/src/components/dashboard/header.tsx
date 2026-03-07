import { RefreshCwIcon } from "lucide-react";
import { useDashboard } from "./root";
import { StatusDot } from "./status-dot";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipTrigger,
	TooltipPopup,
	TooltipProvider,
} from "@/components/ui/tooltip";

export function Header() {
	const { state, actions, meta } = useDashboard();
	const { snapshot, sseStatus } = state;
	const { counts, codexTotals, observability } = snapshot;

	const parts = [
		`${counts.running} agent${counts.running !== 1 ? "s" : ""} working`,
		`${meta.formatTokens(codexTotals.totalTokens)} tokens`,
		`${meta.formatDuration(codexTotals.secondsRunning)} uptime`,
		`queue ${observability.commandQueueDepth}/${observability.commandQueuePeak}`,
	];
	if (counts.retrying > 0) parts.push(`${counts.retrying} retrying`);
	if (observability.commandQueuePressureCount > 0) {
		parts.push(`${observability.commandQueuePressureCount} pressure`);
	}

	return (
		<header className="sticky top-0 z-50 flex items-center justify-between border-b border-border bg-background px-8 py-3">
			<div className="flex items-center gap-4">
				<h1 className="text-sm font-semibold tracking-tight">plot</h1>
				<span className="text-xs text-muted-foreground">
					{parts.join(" · ")}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger className="flex items-center">
							<StatusDot status={sseStatus} />
						</TooltipTrigger>
						<TooltipPopup>{sseStatus}</TooltipPopup>
					</Tooltip>
				</TooltipProvider>
				<Button variant="ghost" size="icon-xs" onClick={actions.triggerRefresh}>
					<RefreshCwIcon />
				</Button>
			</div>
		</header>
	);
}
