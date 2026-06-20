import { Link } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { useDashboardState } from "../dashboard-context";
import { Row } from "./layout";

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
		<header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
			<Link
				to="/"
				search={(prev) => ({ role: prev.role ?? "controller" })}
				className="text-sm font-medium text-foreground"
			>
				plot
			</Link>
			<Row gap={3}>
				<ConnectionBadge />
				<span className="hidden font-mono text-2xs tabular-nums text-t3 md:inline">
					{roster.length === 1
						? "1 Plot Session"
						: `${roster.length} Plot Sessions`}
				</span>
			</Row>
		</header>
	);
}
