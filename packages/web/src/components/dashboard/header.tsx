import { useCallback, useEffect } from "react";
import { ActivityIcon, RefreshCwIcon } from "lucide-react";
import { StatusDot } from "./status-dot";
import { useDashboard } from "./root";
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
	const { actions } = useDashboard();
	const counts = snapshot?.counts;
	const handleRefresh = useCallback(() => {
		refresh.mutate();
	}, [refresh]);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (
				e.key === "o" &&
				e.shiftKey &&
				(e.metaKey || e.ctrlKey) &&
				!e.altKey
			) {
				e.preventDefault();
				actions.toggleOps();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [actions]);

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
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={actions.toggleOps}
					>
						<ActivityIcon />
					</Button>
					<Button variant="ghost" size="icon-xs" onClick={handleRefresh}>
						<RefreshCwIcon />
					</Button>
				</div>
			</div>
		</header>
	);
}
