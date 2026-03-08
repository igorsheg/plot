import { motion, AnimatePresence } from "motion/react";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { derivePhase, type Phase } from "@plot/sdk";
import { cn } from "@/lib/utils";

interface PhaseLabelProps {
	events: ReadonlyArray<AgentRuntimeEvent>;
	className?: string;
}

const PHASE_DISPLAY: Record<Phase, { label: string; tone: string }> = {
	starting: { label: "starting", tone: "text-info-foreground" },
	working: { label: "working", tone: "text-foreground" },
	tool_call: { label: "reading", tone: "text-chart-1" },
	waiting: { label: "waiting", tone: "text-warning-foreground" },
	done: { label: "done", tone: "text-success-foreground" },
	error: { label: "error", tone: "text-destructive-foreground" },
};

const CROSSFADE_INITIAL = { opacity: 0, y: 8 };
const CROSSFADE_ANIMATE = { opacity: 1, y: 0 };
const CROSSFADE_EXIT = { opacity: 0, y: -8 };
const CROSSFADE_TRANSITION = { duration: 0.2 };

export function PhaseLabel({ events, className }: PhaseLabelProps) {
	const phase = derivePhase(events);
	const display = PHASE_DISPLAY[phase];

	return (
		<span
			className={cn(
				"relative inline-flex h-4 items-center overflow-hidden",
				className,
			)}
		>
			<AnimatePresence mode="wait">
				<motion.span
					key={phase}
					initial={CROSSFADE_INITIAL}
					animate={CROSSFADE_ANIMATE}
					exit={CROSSFADE_EXIT}
					transition={CROSSFADE_TRANSITION}
					className={cn("text-xs font-medium", display.tone)}
				>
					{display.label}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
