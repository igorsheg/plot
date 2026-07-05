import type React from "react";
import { cn } from "../../lib/utils.js";

/** Status dot; color/size via className tokens (bg-success, size-2, ...). */
export function Dot({
	className,
}: {
	readonly className?: string | undefined;
}): React.ReactElement {
	return (
		<span
			aria-hidden
			data-slot="dot"
			className={cn(
				"size-1.5 shrink-0 rounded-full bg-muted-foreground/40",
				className,
			)}
		/>
	);
}
