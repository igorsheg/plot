import { describe, expect, mock, test } from "bun:test";
import {
	emptyProjection,
	reduceSessionHistoryEvent,
} from "@plot/control/projection";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { renderToStaticMarkup } from "react-dom/server";

import {
	chooseInitialSession,
	sortPlotSessions,
	visibleFleetSessions,
} from "../src/app/dashboard/fleet-model";
import type { PlotWebDashboardState } from "../src/app/dashboard/web-dashboard-state";

// The router's <Link> needs a RouterProvider, and TanStack Router won't build
// its route tree under bun's non-DOM test env. Stub <Link> to a plain anchor so
// the surfaces — where the asserted markup actually comes from — render directly
// through the DashboardProvider. The routing itself is declarative glue, and
// the collapse decision (chooseInitialSession) is unit-tested below.
mock.module("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
	}: {
		children?: unknown;
		className?: string;
	}) => <a className={className}>{children as never}</a>,
}));

const { DashboardProvider } =
	await import("../src/app/dashboard/dashboard-context");
const { SessionSurface } =
	await import("../src/app/dashboard/views/session-surface");
const { TopBar } = await import("../src/app/dashboard/views/top-bar");

// Render the dashboard chrome (TopBar) + session surface for a fixed frame,
// mirroring what the router's RootLayout composes around the session route.
function renderSession(override: PlotWebDashboardState): string {
	return renderToStaticMarkup(
		<DashboardProvider state={override}>
			<TopBar />
			<SessionSurface />
		</DashboardProvider>,
	);
}

const summary = (
	overrides: Partial<PlotSessionSummary> & Pick<PlotSessionSummary, "id">,
): PlotSessionSummary => ({
	id: overrides.id,
	epoch: overrides.epoch ?? "epoch-1",
	mode: overrides.mode ?? "watch",
	state: overrides.state ?? "idle",
	workflowName: overrides.workflowName ?? overrides.id,
	workflowPath: overrides.workflowPath ?? "WORKFLOW.md",
	cwd: overrides.cwd ?? `/repo/${overrides.id}`,
	cwdName: overrides.cwdName ?? overrides.id,
	agents: overrides.agents ?? { active: 0, max: 4 },
	needsYouCount: overrides.needsYouCount ?? 0,
	tokenThroughputPerSecond: overrides.tokenThroughputPerSecond ?? null,
	totalTokens: overrides.totalTokens ?? 0,
	lastActivityAt: overrides.lastActivityAt ?? null,
	attachments: overrides.attachments ?? { observers: 0, controllers: 0 },
});

const state = (
	overrides: Partial<PlotWebDashboardState>,
): PlotWebDashboardState => ({
	connection: "online",
	roster: [],
	controlRole: "controller",
	...overrides,
});

const workStarted = (sessionId: string): SessionHistoryEvent => ({
	sessionId,
	epoch: "epoch-1",
	sequence: 1,
	timestamp: "2026-06-15T00:00:00.000Z",
	type: "work_started",
	payload: {
		run: {
			workKey: "work:alpha",
			runId: "run-1",
			sourceId: "source",
			display: { primary: "alpha", title: "Prepare package" },
		},
	},
});

describe("plot web dashboard", () => {
	test("sorts Level 0 by Needs You, error, active, paused, idle, stopped and collapses stopped", () => {
		const sessions = [
			summary({ id: "stopped", state: "stopped" }),
			summary({ id: "idle", state: "idle" }),
			summary({ id: "paused", state: "paused" }),
			summary({ id: "active", state: "acting", agents: { active: 1, max: 4 } }),
			summary({ id: "error", state: "error" }),
			summary({ id: "needs", needsYouCount: 1 }),
		];

		expect(sortPlotSessions(sessions).map((session) => session.id)).toEqual([
			"needs",
			"error",
			"active",
			"paused",
			"idle",
			"stopped",
		]);
		expect(
			visibleFleetSessions(sessions, false).map((session) => session.id),
		).not.toContain("stopped");
	});

	test("a single reachable session collapses to /session and renders it", () => {
		const session = summary({ id: "session-1", workflowName: "release" });
		const projection = reduceSessionHistoryEvent(
			emptyProjection("session-1", "release"),
			workStarted("session-1"),
		);
		// The collapse decision itself (index route → session) is unit-tested here;
		// the destination render is asserted below.
		expect(
			chooseInitialSession({ roster: [session], explicitFleet: false }),
		).toBe("session-1");
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);
		expect(html).toContain("all sessions");
		expect(html).toContain("Prepare package");
	});

	test("projection events render an updated Level 1 Work Item row", () => {
		const session = summary({ id: "session-1", workflowName: "build" });
		const agentEvent: SessionHistoryEvent = {
			sessionId: "session-1",
			epoch: "epoch-1",
			sequence: 2,
			timestamp: "2026-06-15T00:00:01.000Z",
			type: "agent_run_event",
			payload: {
				workKey: "work:alpha",
				runId: "run-1",
				sourceId: "source",
				eventType: "tool_execution_start",
				event: {
					type: "tool_execution_start",
					toolName: "bash",
					args: { command: "bun run check" },
					toolCallId: "tc-2",
				},
			},
		};
		const projection = [workStarted("session-1"), agentEvent].reduce(
			(current, event) => reduceSessionHistoryEvent(current, event),
			emptyProjection("session-1", "build"),
		);
		const html = renderSession(
			state({
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);

		expect(html).toContain("work:alpha");
		expect(html).toContain("run-1");
		expect(html).toContain("bun run check");
	});

	test("renders Operator Action confirm comment danger disabled and observer states", () => {
		const session = summary({ id: "session-1", workflowName: "review" });
		const event: SessionHistoryEvent = {
			...workStarted("session-1"),
			payload: {
				run: {
					workKey: "work:alpha",
					runId: "run-1",
					sourceId: "source",
					display: { title: "Needs operator" },
					operatorActions: [
						{
							id: "ship",
							label: "Ship",
							tone: "danger",
							requiresComment: true,
							confirm: { title: "Ship now?", message: "This is final." },
						},
						{ id: "hold", label: "Hold", disabledReason: "not ready" },
					],
				},
			},
		};
		const projection = reduceSessionHistoryEvent(
			emptyProjection("session-1", "review"),
			event,
		);
		const html = renderSession(
			state({
				controlRole: "observer",
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);

		expect(html).toContain("Ship");
		expect(html).toContain("Hold");
		expect(html).toContain("not ready");
		expect(html).toContain("controller required");
	});

	test("offline state preserves the last good frame", () => {
		const session = summary({ id: "session-1", workflowName: "docs" });
		const projection = reduceSessionHistoryEvent(
			emptyProjection("session-1", "docs"),
			workStarted("session-1"),
		);
		const html = renderSession(
			state({
				connection: "offline",
				lastError: "Local Plot Server connection closed",
				roster: [session],
				selectedSessionId: "session-1",
				projection,
			}),
		);

		expect(html).toContain("offline · last frame");
		expect(html).toContain("Prepare package");
	});
});
