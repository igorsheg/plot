import { Link } from "@tanstack/react-router";

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
		<header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3 text-xs text-muted-foreground">
			<Link
				to="/"
				search={(prev) => ({ role: prev.role ?? "controller" })}
				className="font-medium text-foreground"
			>
				plot
			</Link>
			<div className="flex items-center gap-3">
				<ConnectionBadge />
				<span className="hidden md:inline">
					{roster.length === 1
						? "1 Plot Session"
						: `${roster.length} Plot Sessions`}
				</span>
			</div>
		</header>
	);
}
