import { Badge } from "@/components/ui/badge";
import { useDashboardState } from "../dashboard-context";

function ConnectionBadge() {
	const { connection } = useDashboardState();
	if (connection === "online")
		return (
			<Badge variant="dot" color="green" size="sm">
				online
			</Badge>
		);
	if (connection === "connecting")
		return (
			<Badge variant="dot" color="gray" size="sm">
				connecting
			</Badge>
		);
	return (
		<Badge variant="dot" color="amber" size="sm">
			{connection === "offline" ? "offline · last frame" : "handoff needed"}
		</Badge>
	);
}

export function TopBar() {
	const { roster } = useDashboardState();
	return (
		<div className="flex items-center justify-between gap-4 py-5 text-xs text-muted-foreground">
			<a href="?view=fleet" className="font-medium text-foreground">
				plot
			</a>
			<div className="flex items-center gap-3">
				<ConnectionBadge />
				<span className="hidden md:inline">
					{roster.length === 1
						? "1 Plot Session"
						: `${roster.length} Plot Sessions`}
				</span>
			</div>
		</div>
	);
}
