/** Shared work-state icon vocabulary used by the river and detail drawer. */

import { cn } from "../../lib/utils.js";
import { WorkStateIcon, type WorkState } from "../ui/icons.js";

const STATE_COLOR: Record<WorkState, string> = {
	attention: "text-destructive",
	active: "text-foreground",
	queued: "text-muted-foreground",
	held: "text-muted-foreground",
	history: "text-muted-foreground",
};

/** The one state glyph, sized once and coloured for its work state. */
export function StateIcon({
	state,
	className,
}: {
	readonly state: WorkState;
	readonly className?: string;
}) {
	return (
		<WorkStateIcon
			state={state}
			className={cn("size-4 shrink-0", STATE_COLOR[state], className)}
		/>
	);
}
