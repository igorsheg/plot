const labels: Record<string, string> = {
	PreparingWorkspace: "Setting up",
	BuildingPrompt: "Preparing",
	LaunchingAgentProcess: "Launching",
	InitializingSession: "Starting",
	StreamingTurn: "Working",
	Finishing: "Wrapping up",
	Succeeded: "Done",
	Failed: "Failed",
	TimedOut: "Timed out",
	Stalled: "Stalled",
	CanceledByReconciliation: "Canceled",
};

export function statusLabel(state: string): string {
	return labels[state] ?? state;
}

type Variant = "default" | "success" | "warning" | "error" | "info" | "outline";

const variants: Record<string, Variant> = {
	StreamingTurn: "default",
	PreparingWorkspace: "info",
	BuildingPrompt: "info",
	LaunchingAgentProcess: "info",
	InitializingSession: "info",
	Finishing: "info",
	Succeeded: "success",
	Failed: "error",
	TimedOut: "error",
	Stalled: "warning",
	CanceledByReconciliation: "outline",
};

export function statusVariant(state: string): Variant {
	return variants[state] ?? "outline";
}

const activeStates = new Set([
	"StreamingTurn",
	"BuildingPrompt",
	"LaunchingAgentProcess",
	"InitializingSession",
	"PreparingWorkspace",
	"Finishing",
]);

export function isActiveState(state: string): boolean {
	return activeStates.has(state);
}
