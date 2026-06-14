export type WorkStatus =
	| "running"
	| "blocked"
	| "ready"
	| "backoff"
	| "completed";

export type TimelineKind =
	| "tick"
	| "observation"
	| "decision"
	| "run"
	| "diagnostic";

export interface SessionSummary {
	name: string;
	workflowPath: string;
	state: "watching" | "reconciling" | "acting" | "paused";
	model: string;
}

export interface LoopSummary {
	// Seconds until the next scheduled wake, and the nominal tick cadence the
	// countdown resets to. Numeric so the UI can tick them down live instead of
	// rendering a frozen "38s" string.
	nextWakeSeconds: number;
	cadenceSeconds: number;
	observations: number;
	selected: number;
	dispatched: number;
	deferred: number;
}

export interface SourceSummary {
	id: string;
	label: string;
	status: "watching" | "blocked" | "idle";
	readyWork: number;
	runningWork: number;
}

export interface WorkTimelineEvent {
	id: string;
	kind: TimelineKind;
	time: string;
	title: string;
	detail: string;
}

export interface WorkItemSummary {
	id: string;
	key: string;
	title: string;
	sourceId: string;
	sourceLabel: string;
	status: WorkStatus;
	activity: string;
	reason: string;
	attempt: number;
	runId?: string;
	url?: string;
	timeline: WorkTimelineEvent[];
}

export interface DiagnosticSummary {
	id: string;
	severity: "info" | "warning" | "error";
	title: string;
	detail: string;
}

export interface PlotDashboardState {
	session: SessionSummary;
	loop: LoopSummary;
	sources: SourceSummary[];
	work: WorkItemSummary[];
	selectedWorkId: string;
	recentEvents: WorkTimelineEvent[];
	diagnostics: DiagnosticSummary[];
}
