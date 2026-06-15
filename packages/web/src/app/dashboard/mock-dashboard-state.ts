import type { PlotDashboardState } from "./dashboard-state";

export const mockDashboardState: PlotDashboardState = {
	session: {
		name: "local Plot Session",
		workflowPath: "WORKFLOW.md",
		state: "watching",
		model: "claude-sonnet-4.5",
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
			id: "extension:github-pr-reviewer",
			label: "GitHub PR reviewer",
			status: "watching",
			readyWork: 2,
			runningWork: 2,
		},
		{
			id: "workflow:release",
			label: "Release workflow",
			status: "blocked",
			readyWork: 1,
			runningWork: 0,
		},
		{
			id: "operator:manual",
			label: "Manual observations",
			status: "idle",
			readyWork: 0,
			runningWork: 0,
		},
	],
	work: [
		{
			id: "work-pr-120-review",
			key: "github:igorsheg/plot:pr:120:sha-bf5e3c7",
			title: "Review web substrate PR",
			sourceId: "extension:github-pr-reviewer",
			sourceLabel: "GitHub PR reviewer",
			status: "running",
			activity: "Agent is reading changed web substrate files",
			reason:
				"Selected after reconcile: PR head moved and review state is stale.",
			attempt: 1,
			runId: "run-42",
			url: "https://github.com/igorsheg/plot/pull/120",
			timeline: [
				{
					id: "pr120-1",
					kind: "observation",
					time: "1m ago",
					title: "PR head changed",
					detail: "bf5e3c7 pushed to feat/web-dashboard-infra.",
				},
				{
					id: "pr120-2",
					kind: "decision",
					time: "58s ago",
					title: "Work selected",
					detail: "Per-source capacity available; previous review marked done.",
				},
				{
					id: "pr120-3",
					kind: "run",
					time: "54s ago",
					title: "Agent session started",
					detail: "run-42 using claude-sonnet-4.5.",
				},
			],
		},
		{
			id: "work-protocol-smoke",
			key: "workflow:web:protocol-smoke",
			title: "Design protocol smoke fixture",
			sourceId: "operator:manual",
			sourceLabel: "Manual observations",
			status: "ready",
			activity: "Waiting for capacity",
			reason: "Ready after operator note; global capacity is currently full.",
			attempt: 0,
			timeline: [
				{
					id: "smoke-1",
					kind: "observation",
					time: "4m ago",
					title: "Operator requested web UX planning",
					detail: "Dashboard mock should expose the Plot product model.",
				},
			],
		},
		{
			id: "work-release",
			key: "release:v0.2.0",
			title: "Prepare release package dry run",
			sourceId: "workflow:release",
			sourceLabel: "Release workflow",
			status: "blocked",
			activity: "Needs operator confirmation",
			reason:
				"Blocked by runtime policy: release work requires explicit approval.",
			attempt: 0,
			timeline: [
				{
					id: "release-1",
					kind: "decision",
					time: "8m ago",
					title: "Dispatch denied",
					detail: "Policy gate requires an approval observation before acting.",
				},
			],
		},
		{
			id: "work-flaky-test",
			key: "github:igorsheg/plot:issue:71",
			title: "Investigate flaky dashboard test",
			sourceId: "extension:github-pr-reviewer",
			sourceLabel: "GitHub PR reviewer",
			status: "backoff",
			activity: "Retry available in 9m",
			reason: "Previous attempt failed; source requested exponential backoff.",
			attempt: 2,
			timeline: [
				{
					id: "flaky-1",
					kind: "diagnostic",
					time: "13m ago",
					title: "Attempt failed",
					detail:
						"Runner exited after inactivity watchdog interrupted the session.",
				},
			],
		},
		{
			id: "work-docs",
			key: "workflow:docs:extension-guide",
			title: "Update extension author notes",
			sourceId: "operator:manual",
			sourceLabel: "Manual observations",
			status: "completed",
			activity: "Completed 18m ago",
			reason: "Source reconciled completion as terminal for this work key.",
			attempt: 1,
			timeline: [
				{
					id: "docs-1",
					kind: "run",
					time: "18m ago",
					title: "Run succeeded",
					detail: "Completion accepted during the next reconciliation tick.",
				},
			],
		},
	],
	selectedWorkId: "work-pr-120-review",
	recentEvents: [
		{
			id: "recent-1",
			kind: "tick",
			time: "12s ago",
			title: "Tick completed",
			detail: "8 observations reconciled, 4 work items selected, 2 dispatched.",
		},
		{
			id: "recent-2",
			kind: "run",
			time: "54s ago",
			title: "run-42 started",
			detail: "Review web substrate PR.",
		},
	],
	diagnostics: [
		{
			id: "diag-1",
			severity: "warning",
			title: "One work item is backed off",
			detail:
				"github:igorsheg/plot:issue:71 can retry after its source wakeup.",
		},
	],
};
