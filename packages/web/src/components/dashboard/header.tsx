import { useCallback } from "react";
import { ActivityIcon, RefreshCwIcon } from "lucide-react";
import { StatusDot } from "./status-dot";
import { useDashboard } from "./root";
import { useStreamStatus, useTriggerRefresh } from "@/lib/runtime";
import { Button } from "@plot/ui/components/button";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "@plot/ui/components/tooltip";
import { cn } from "@plot/ui/lib/utils";

export function Header() {
	const { meta, state, actions } = useDashboard();
	const refresh = useTriggerRefresh();
	const sseStatus = useStreamStatus();
	const handleRefresh = useCallback(() => {
		refresh.mutate();
	}, [refresh]);

	return (
		<header className="header-surface">
			<div className="header-shell">
				<h1 className="type-title">
					plot{" "}
					<span className="type-meta">
						· {meta.runningCount} active
						{meta.retryingCount > 0 ? ` · ${meta.retryingCount} retrying` : ""}
					</span>
				</h1>
				<div className="cluster-shell-lg">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger className="flex items-center">
								<StatusDot status={sseStatus} className="size-2" />
								{sseStatus !== "connected" && (
									<span className="type-meta ml-2 capitalize">{sseStatus}</span>
								)}
							</TooltipTrigger>
							<TooltipPopup>stream {sseStatus}</TooltipPopup>
						</Tooltip>
					</TooltipProvider>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={actions.toggleOps}
						className={cn(state.opsOpen && "bg-accent")}
						aria-label="toggle ops"
					>
						<ActivityIcon />
					</Button>
					<Button variant="ghost" size="icon-xs" onClick={handleRefresh} aria-label="refresh">
						<RefreshCwIcon />
					</Button>
				</div>
			</div>
		</header>
	);
}
