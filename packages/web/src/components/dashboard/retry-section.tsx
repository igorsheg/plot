import { useState } from "react";
import { DateTime } from "effect";
import { motion, AnimatePresence } from "motion/react";
import { TriangleAlertIcon, ChevronRightIcon } from "lucide-react";
import { useDashboard } from "./root";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleTrigger,
	CollapsiblePanel,
} from "@/components/ui/collapsible";

const FADE_INITIAL = { opacity: 0 };
const FADE_ANIMATE = { opacity: 1 };
const FADE_EXIT = { opacity: 0 };
const FADE_TRANSITION = { duration: 0.15 };

function formatDueIn(dueAt: DateTime.Utc): string {
	const diff = (DateTime.toEpochMillis(dueAt) - Date.now()) / 1000;
	if (diff <= 0) return "now";
	if (diff < 60) return `${Math.round(diff)}s`;
	if (diff < 3600) return `${Math.round(diff / 60)}m`;
	const h = Math.floor(diff / 3600);
	const m = Math.round((diff % 3600) / 60);
	return `${h}h ${m}m`;
}

export function RetrySection() {
	const { state } = useDashboard();
	const { retrying } = state.snapshot;
	const [open, setOpen] = useState(false);

	if (retrying.length === 0) return null;

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-xs text-muted-foreground">
				<ChevronRightIcon
					className={`size-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
				/>
				<span>Retrying</span>
				<Badge variant="warning" size="sm">
					{retrying.length}
				</Badge>
			</CollapsibleTrigger>
			<CollapsiblePanel>
				<div className="flex flex-col gap-2 pt-2">
					<AnimatePresence>
						{retrying.map((entry) => (
							<motion.div
								key={entry.issueId}
								initial={FADE_INITIAL}
								animate={FADE_ANIMATE}
								exit={FADE_EXIT}
								transition={FADE_TRANSITION}
							>
								<Alert variant="warning">
									<TriangleAlertIcon />
									<AlertTitle className="flex items-center gap-2">
										<span>{entry.identifier}</span>
										<Badge variant="outline" size="sm">
											attempt {entry.attempt}
										</Badge>
										<span className="text-muted-foreground">
											· due in {formatDueIn(entry.dueAt)}
										</span>
									</AlertTitle>
									{entry.error && (
										<AlertDescription>{entry.error}</AlertDescription>
									)}
								</Alert>
							</motion.div>
						))}
					</AnimatePresence>
				</div>
			</CollapsiblePanel>
		</Collapsible>
	);
}
