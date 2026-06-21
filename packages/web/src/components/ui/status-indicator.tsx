import { motion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Motion-as-information status dot. The tone maps to a semantic colour token
// and the dot springs (a single scale beat) when the tone changes, so a
// transition like working → blocked is *felt*, not just silently re-coloured.
export type StatusTone =
	| "active"
	| "attention"
	| "danger"
	| "muted"
	| "online"
	| "live";

const toneClass: Record<StatusTone, string> = {
	active: "bg-foreground",
	attention: "bg-attention",
	danger: "bg-destructive",
	muted: "bg-muted-foreground",
	// One-accent rule: a healthy "online" connection is autonomous & fine, so it
	// reads as neutral ink — never a second chromatic signal. Degraded states use
	// the `attention` accent instead.
	online: "bg-foreground",
	live: "bg-live",
};

export function StatusDot({
	tone,
	className,
}: {
	tone: StatusTone;
	className?: string;
}) {
	return (
		<motion.span
			// Re-key on tone so the enter animation replays on every transition.
			key={tone}
			aria-hidden
			initial={{ scale: 0.6, opacity: 0.5 }}
			animate={{ scale: 1, opacity: 1 }}
			transition={{ type: "spring", stiffness: 400, damping: 30 }}
			className={cn(
				"inline-block size-2 rounded-full",
				toneClass[tone],
				className,
			)}
		/>
	);
}

export function StatusIndicator({
	tone,
	children,
	className,
}: {
	tone: StatusTone;
	children: ReactNode;
	className?: string;
}) {
	return (
		<span className={cn("inline-flex items-center gap-2", className)}>
			<StatusDot tone={tone} />
			{children}
		</span>
	);
}
