import { motion } from "motion/react";
import type { ReactNode } from "react";

import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

// Motion-as-information status dot. The tone maps to a semantic colour token —
// never a raw palette literal — and the dot springs (a single scale beat) when
// the tone changes, so a transition like working → blocked is *felt*, not just
// silently re-coloured. Ported in spirit from fluid-functionalism's motion
// philosophy.
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
	online: "bg-green-500",
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
			transition={spring.moderate}
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
