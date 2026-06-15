import type { PlotDashboardState } from "./dashboard-state";

export const mockDashboardState: PlotDashboardState = {
	session: {
		name: "local Plot Session",
		workflowPath: "WORKFLOW.md",
		state: "watching",
		model: "agent-model",
	},
	loop: {
		nextWakeSeconds: 38,
		cadenceSeconds: 50,
		observations: 8,
		selected: 4,
		dispatched: 2,
		deferred: 2,
	},
	sources: [
		{
			id: "source:review",
			label: "Review source",
			status: "watching",
			readyWork: 2,
			runningWork: 2,
		},
		{
			id: "source:release",
			label: "Release source",
			status: "blocked",
			readyWork: 1,
			runningWork: 0,
		},
	],
	work: [
		{
			id: "work-review",
			key: "work:review",
			title: "Review changed files",
			sourceId: "source:review",
			sourceLabel: "Review source",
			status: "running",
			activity: "Agent is reading changed files",
			reason: "Selected after reconcile: work state is stale.",
			attempt: 1,
			runId: "run-42",
			timeline: [
				{
					id: "review-1",
					kind: "decision",
					time: "58s ago",
					title: "Work selected",
					detail: "Capacity available.",
				},
			],
		},
		{
			id: "work-release",
			key: "work:release",
			title: "Prepare release package dry run",
			sourceId: "source:release",
			sourceLabel: "Release source",
			status: "blocked",
			activity: "Needs operator confirmation",
			reason: "Runtime policy requires explicit operator input.",
			attempt: 0,
			timeline: [],
		},
	],
	selectedWorkId: "work-review",
	recentEvents: [
		{
			id: "recent-1",
			kind: "tick",
			time: "12s ago",
			title: "Tick completed",
			detail: "8 observations reconciled, 4 work items selected, 2 dispatched.",
		},
	],
	diagnostics: [],
};
