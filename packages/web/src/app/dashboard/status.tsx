import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import type { WorkStatus } from "./dashboard-state";

// Explicit status-dot variants — named components, not a <Dot status={...}>
// mode prop (composition-patterns: patterns-explicit-variants). Amber is the
// single accent, spent only where a human is needed (blocked / backoff).
function Dot({ className }: { className?: string }) {
	return <span className={cn("size-1.5 shrink-0 rounded-full", className)} />;
}

export const RunningDot = () => <Dot className="bg-foreground" />;
export const BlockedDot = () => <Dot className="bg-amber-500" />;
export const BackoffDot = () => <Dot className="bg-amber-500/60" />;
export const ReadyDot = () => <Dot className="bg-muted-foreground/50" />;
export const CompletedDot = () => <Dot className="bg-muted-foreground/30" />;

// Lookup for genuinely dynamic lists (the resting roster mixes statuses) — the
// permitted data-driven exception to explicit variants.
export const STATUS_DOT: Record<WorkStatus, ComponentType> = {
	running: RunningDot,
	blocked: BlockedDot,
	backoff: BackoffDot,
	ready: ReadyDot,
	completed: CompletedDot,
};

export const STATUS_LABEL: Record<WorkStatus, string> = {
	running: "running",
	blocked: "blocked",
	backoff: "backoff",
	ready: "ready",
	completed: "completed",
};
