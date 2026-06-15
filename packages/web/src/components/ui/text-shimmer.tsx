import { cn } from "@/lib/utils";

// A stable-width line of text that shimmers while it is "live", instead of
// streaming raw variable-length content into a reflowing slot. The text node is
// always present (truncated to one line), so length changes never move
// neighbours — the *motion* carries the "working" signal, not the layout.
// Adapted from opencode's TextShimmer to our token system; shimmer is pure CSS
// (see globals.css), silenced under reduced-motion.
export function TextShimmer({
	text,
	active = true,
	className,
}: {
	text: string;
	active?: boolean;
	className?: string;
}) {
	return (
		<span
			data-active={active ? "true" : "false"}
			aria-label={text}
			className={cn(
				"block truncate",
				active ? "text-shimmer" : "text-muted-foreground",
				className,
			)}
		>
			{text}
		</span>
	);
}
